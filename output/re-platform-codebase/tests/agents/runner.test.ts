import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRunError, ProviderError } from '../../src/agents/errors.js';
import { MemoryLogger } from '../../src/agents/logger.js';
import { MockProvider, type MockStep } from '../../src/agents/mock-provider.js';
import type { LlmProvider } from '../../src/agents/provider.js';
import { backoffDelay, CircuitBreakerRegistry } from '../../src/agents/resilience.js';
import { type AgentDefinition, AgentRunner, type AgentRunnerOptions, extractJson } from '../../src/agents/runner.js';

const AnswerSchema = z.object({ answer: z.string(), score: z.number() });
type Answer = z.infer<typeof AnswerSchema>;

const testAgent: AgentDefinition<{ q: string }, Answer> = {
  name: 'test-agent',
  schemaName: 'Answer',
  schema: AnswerSchema,
  effort: 'low',
  maxTokens: 256,
  system: () => 'You answer questions.',
  prompt: (input) => `Question: ${input.q}`,
  check: (output) => (output.score < 0 ? ['score: must be >= 0'] : []),
  fallback: () => ({ answer: 'deterministic', score: 0 }),
};

const ok: MockStep = { type: 'json', value: { answer: '42', score: 1 } };

function makeRunner(providers: LlmProvider[], overrides: Partial<AgentRunnerOptions> = {}) {
  const logger = new MemoryLogger();
  const delays: number[] = [];
  const runner = new AgentRunner({
    providers,
    logger,
    circuits: new CircuitBreakerRegistry({ failureThreshold: 3, cooldownMs: 1_000 }),
    retry: { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1_000 },
    timeoutMs: 200,
    repairRounds: 1,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  });
  return { runner, logger, delays };
}

describe('AgentRunner', () => {
  it('returns validated output from the primary provider', async () => {
    const primary = new MockProvider('primary', [ok]);
    const { runner, logger } = makeRunner([primary]);
    const result = await runner.run(testAgent, { q: 'life' });

    expect(result.output).toEqual({ answer: '42', score: 1 });
    expect(result.trace.servedBy).toBe('primary:mock-model');
    expect(result.trace.degraded).toBe(false);
    expect(result.trace.attempts).toHaveLength(1);
    expect(result.trace.usage.inputTokens).toBe(100);
    expect(primary.calls[0]?.prompt).toBe('Question: life');
    expect(primary.calls[0]?.schemaName).toBe('Answer');
    expect(logger.at('info').map((e) => e.message)).toContain('agent.run.succeeded');
  });

  it('retries transient failures with exponential backoff, then succeeds', async () => {
    const primary = new MockProvider('primary', [
      { type: 'error', kind: 'retryable', status: 429 },
      { type: 'error', kind: 'retryable', status: 529 },
      ok,
    ]);
    const { runner, delays, logger } = makeRunner([primary]);
    const result = await runner.run(testAgent, { q: 'x' });

    expect(result.output.answer).toBe('42');
    expect(result.trace.attempts.map((a) => a.outcome)).toEqual(['retryable-error', 'retryable-error', 'success']);
    expect(delays).toEqual([75, 150]); // 100·2^0 and 100·2^1 with 75 % equal jitter
    expect(logger.at('error')).toHaveLength(2);
    expect(logger.at('error')[0]?.fields.status).toBe(429);
  });

  it('does not retry fatal errors and moves to the next provider', async () => {
    const primary = new MockProvider('primary', [{ type: 'error', kind: 'fatal', status: 400 }]);
    const secondary = new MockProvider('secondary', [ok], 'secondary-model');
    const { runner } = makeRunner([primary, secondary]);
    const result = await runner.run(testAgent, { q: 'x' });

    expect(primary.calls).toHaveLength(1);
    expect(result.trace.servedBy).toBe('secondary:secondary-model');
    expect(result.trace.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual([
      'primary:fatal-error',
      'secondary:success',
    ]);
  });

  it('repairs schema-invalid output by feeding validation errors back to the model', async () => {
    const primary = new MockProvider('primary', [{ type: 'json', value: { answer: 7 } }, ok]);
    const { runner } = makeRunner([primary]);
    const result = await runner.run(testAgent, { q: 'x' });

    expect(result.output.answer).toBe('42');
    expect(result.trace.repairRounds).toBe(1);
    const repairPrompt = primary.calls[1]?.prompt ?? '';
    expect(repairPrompt).toContain('<validation_errors>');
    expect(repairPrompt).toContain('answer:');
    expect(repairPrompt).toContain('score:');
    expect(repairPrompt).toContain('{"answer":7}');
  });

  it('treats semantic-check failures as invalid output and repairs them', async () => {
    const primary = new MockProvider('primary', [{ type: 'json', value: { answer: 'a', score: -1 } }, ok]);
    const { runner } = makeRunner([primary]);
    const result = await runner.run(testAgent, { q: 'x' });
    expect(result.output.score).toBe(1);
    expect(primary.calls[1]?.prompt).toContain('score: must be >= 0');
  });

  it('accepts JSON wrapped in a markdown fence', async () => {
    const primary = new MockProvider('primary', [
      { type: 'text', text: 'Here:\n```json\n{"answer":"x","score":2}\n```' },
    ]);
    const { runner } = makeRunner([primary]);
    expect((await runner.run(testAgent, { q: 'x' })).output.score).toBe(2);
  });

  it('moves on after the repair budget is exhausted', async () => {
    const primary = new MockProvider('primary', [{ type: 'text', text: 'not json at all' }]);
    const secondary = new MockProvider('secondary', [ok]);
    const { runner } = makeRunner([primary, secondary]);
    const result = await runner.run(testAgent, { q: 'x' });
    expect(primary.calls).toHaveLength(2); // original + 1 repair
    expect(result.trace.servedBy).toBe('secondary:mock-model');
  });

  it('skips to the next provider on refusal without retrying', async () => {
    const primary = new MockProvider('primary', [{ type: 'error', kind: 'refusal' }]);
    const secondary = new MockProvider('secondary', [ok]);
    const { runner } = makeRunner([primary, secondary]);
    const result = await runner.run(testAgent, { q: 'x' });
    expect(primary.calls).toHaveLength(1);
    expect(result.trace.attempts[0]?.outcome).toBe('refusal');
  });

  it('falls back to the deterministic agent when every provider fails, and logs each failure', async () => {
    const primary = new MockProvider('primary', [{ type: 'error', kind: 'retryable', status: 503 }]);
    const secondary = new MockProvider('secondary', [{ type: 'error', kind: 'fatal', status: 401 }]);
    const { runner, logger } = makeRunner([primary, secondary]);
    const result = await runner.run(testAgent, { q: 'x' });

    expect(result.output).toEqual({ answer: 'deterministic', score: 0 });
    expect(result.trace.servedBy).toBe('deterministic-fallback');
    expect(result.trace.degraded).toBe(true);
    expect(result.trace.note).toContain('3× retryable');
    expect(result.trace.note).toContain('1× fatal');
    expect(logger.at('error')).toHaveLength(4);
    expect(logger.at('warn').map((e) => e.message)).toContain('agent.run.fallback');
  });

  it('runs the deterministic agent in offline mode without marking the run degraded', async () => {
    const { runner, logger } = makeRunner([]);
    const result = await runner.run(testAgent, { q: 'x' });
    expect(result.trace.servedBy).toBe('deterministic-fallback');
    expect(result.trace.degraded).toBe(false);
    expect(result.trace.note).toContain('Offline mode');
    expect(logger.at('info').map((e) => e.message)).toContain('agent.run.offline');
  });

  it('enforces a per-attempt deadline even if the provider ignores it', async () => {
    const primary = new MockProvider('primary', [{ type: 'hang' }]);
    const { runner } = makeRunner([primary], {
      timeoutMs: 30,
      retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 },
    });
    const result = await runner.run(testAgent, { q: 'x' });
    expect(result.trace.attempts.slice(0, 2).map((a) => a.outcome)).toEqual(['timeout', 'timeout']);
    expect(result.trace.servedBy).toBe('deterministic-fallback');
  });

  it('opens the circuit after repeated failures and skips the provider on later runs', async () => {
    let clock = 0;
    const primary = new MockProvider('primary', [{ type: 'error', kind: 'retryable', status: 500 }]);
    const { runner } = makeRunner([primary], {
      circuits: new CircuitBreakerRegistry({ failureThreshold: 3, cooldownMs: 1_000 }, () => clock),
    });

    await runner.run(testAgent, { q: 'first' }); // 3 failed attempts → circuit opens
    expect(primary.calls).toHaveLength(3);

    const second = await runner.run(testAgent, { q: 'second' });
    expect(primary.calls).toHaveLength(3); // not called at all
    expect(second.trace.attempts[0]?.outcome).toBe('circuit-open');

    clock = 1_000; // cooldown elapsed → half-open → exactly one probe
    await runner.run(testAgent, { q: 'third' });
    expect(primary.calls).toHaveLength(4);
  });

  it('closes the circuit again after a successful half-open probe', async () => {
    let clock = 0;
    let healthy = false;
    const primary = new MockProvider('primary', () =>
      healthy ? ok : { type: 'error', kind: 'retryable', status: 503 },
    );
    const circuits = new CircuitBreakerRegistry({ failureThreshold: 2, cooldownMs: 100 }, () => clock);
    const { runner } = makeRunner([primary], { circuits, retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } });

    await runner.run(testAgent, { q: 'a' });
    expect(circuits.snapshot().primary).toBe('open');
    clock = 100;
    healthy = true;
    const result = await runner.run(testAgent, { q: 'b' });
    expect(result.trace.servedBy).toBe('primary:mock-model');
    expect(circuits.snapshot().primary).toBe('closed');
  });

  it('throws AgentRunError when fallback is disabled', async () => {
    const primary = new MockProvider('primary', [{ type: 'error', kind: 'fatal', status: 403 }]);
    const { runner } = makeRunner([primary], { allowFallback: false });
    await expect(runner.run(testAgent, { q: 'x' })).rejects.toBeInstanceOf(AgentRunError);
  });

  it('stops immediately when the caller aborts', async () => {
    const primary = new MockProvider('primary', [{ type: 'hang' }]);
    const { runner } = makeRunner([primary], { timeoutMs: 5_000 });
    const controller = new AbortController();
    const pending = runner.run(testAgent, { q: 'x' }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('resilience helpers', () => {
  it('caps backoff and honours longer Retry-After hints', () => {
    const policy = { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 1_000 };
    expect(backoffDelay(1, policy, () => 1)).toBe(100);
    expect(backoffDelay(10, policy, () => 1)).toBe(1_000);
    expect(backoffDelay(1, policy, () => 0, 600)).toBe(600);
    expect(backoffDelay(1, policy, () => 0, 60_000)).toBe(1_000);
  });

  it('extracts JSON from plain, fenced and prefixed text', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":3} hope that helps')).toEqual({ a: 3 });
    expect(extractJson('nothing here')).toBeUndefined();
  });

  it('marks transient provider errors', () => {
    expect(new ProviderError('retryable', 'x', { provider: 'p' }).transient).toBe(true);
    expect(new ProviderError('timeout', 'x', { provider: 'p' }).transient).toBe(true);
    expect(new ProviderError('fatal', 'x', { provider: 'p' }).transient).toBe(false);
  });
});
