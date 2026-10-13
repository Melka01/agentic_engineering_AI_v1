import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type AnthropicMessagesApi,
  AnthropicProvider,
  classifyAnthropicError,
  SERVER_FALLBACK_BETA,
} from '../../src/agents/anthropic-provider.js';
import { ProviderError } from '../../src/agents/errors.js';
import { MemoryLogger } from '../../src/agents/logger.js';
import type { StructuredRequest } from '../../src/agents/provider.js';
import { CircuitBreakerRegistry } from '../../src/agents/resilience.js';
import { type AgentDefinition, AgentRunner } from '../../src/agents/runner.js';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const Schema = z.object({ title: z.string() });

function request(overrides: Partial<StructuredRequest> = {}): StructuredRequest {
  return {
    agent: 'story-generator',
    correlationId: 'corr-1',
    system: 'system prompt',
    prompt: 'user prompt',
    schema: Schema,
    schemaName: 'Title',
    maxTokens: 16_000,
    effort: 'medium',
    timeoutMs: 60_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function message(overrides: Partial<Record<keyof BetaMessage, unknown>> = {}): BetaMessage {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: '{"title":', citations: null },
      { type: 'text', text: '"Approve claims"}', citations: null },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 340 },
    ...overrides,
  } as unknown as BetaMessage;
}

class FakeMessages implements AnthropicMessagesApi {
  readonly calls: { params: CreateParams; options: unknown }[] = [];
  constructor(private readonly responses: (BetaMessage | Error)[]) {}
  async create(params: CreateParams, options?: unknown): Promise<BetaMessage> {
    this.calls.push({ params, options });
    const next = this.responses[Math.min(this.calls.length - 1, this.responses.length - 1)];
    if (next === undefined) throw new Error('no response scripted');
    if (next instanceof Error) throw next;
    return next;
  }
}

const apiError = (status: number, headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type: 'api_error', message: `status ${status}` } },
    undefined,
    new Headers(headers),
  );

describe('AnthropicProvider', () => {
  it('builds a structured-output request with explicit effort and server-side fallbacks', () => {
    const provider = new AnthropicProvider({
      name: 'anthropic-primary',
      model: 'claude-opus-5-5',
      serverFallbacks: 'default',
      messages: new FakeMessages([]),
    });
    const params = provider.buildParams(request());

    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(16_000);
    expect(params.system).toBe('system prompt');
    expect(params.messages).toEqual([{ role: 'user', content: 'user prompt' }]);
    expect(params.output_config?.effort).toBe('medium');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(params.output_config?.format?.schema)).toContain('"title"');
    expect(params.betas).toEqual([SERVER_FALLBACK_BETA]);
    expect(params.fallbacks).toBe('default');
    expect(params).not.toHaveProperty('thinking'); // Opus 5.5: adaptive thinking is implicit
    expect(params).not.toHaveProperty('temperature');
  });

  it('omits server-side fallbacks when disabled', () => {
    const provider = new AnthropicProvider({
      name: 'p',
      model: 'claude-opus-5-5',
      serverFallbacks: 'off',
      messages: new FakeMessages([]),
    });
    const params = provider.buildParams(request());
    expect(params.betas).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
  });

  it('joins text blocks, ignores thinking blocks, maps usage and disables SDK retries', async () => {
    const fake = new FakeMessages([message()]);
    const provider = new AnthropicProvider({
      name: 'p',
      model: 'claude-opus-5-5',
      serverFallbacks: 'default',
      messages: fake,
    });
    const response = await provider.generate(request());

    expect(response.rawText).toBe('{"title":"Approve claims"}');
    expect(response.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
    expect(response.model).toBe('claude-opus-5-5');
    expect(fake.calls[0]?.options).toMatchObject({ maxRetries: 0, timeout: 60_000 });
  });

  it('reports the model that actually served the request (server-side fallback)', async () => {
    const fake = new FakeMessages([message({ model: 'claude-opus-4-8' })]);
    const provider = new AnthropicProvider({
      name: 'p',
      model: 'claude-opus-5-5',
      serverFallbacks: 'default',
      messages: fake,
    });
    expect((await provider.generate(request())).model).toBe('claude-opus-4-8');
  });

  it('classifies refusals and truncation', async () => {
    const refusal = new AnthropicProvider({
      name: 'p',
      model: 'm',
      serverFallbacks: 'off',
      messages: new FakeMessages([
        message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } }),
      ]),
    });
    await expect(refusal.generate(request())).rejects.toMatchObject({ kind: 'refusal' });

    const truncated = new AnthropicProvider({
      name: 'p',
      model: 'm',
      serverFallbacks: 'off',
      messages: new FakeMessages([message({ stop_reason: 'max_tokens' })]),
    });
    await expect(truncated.generate(request())).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('maps SDK errors onto the platform taxonomy', () => {
    const rate = classifyAnthropicError(apiError(429, { 'retry-after': '2' }), 'p');
    expect(rate).toMatchObject({ kind: 'retryable', status: 429, retryAfterMs: 2000 });
    expect(classifyAnthropicError(apiError(529), 'p')).toMatchObject({ kind: 'retryable', status: 529 });
    expect(classifyAnthropicError(apiError(500), 'p').kind).toBe('retryable');
    expect(classifyAnthropicError(apiError(400), 'p')).toMatchObject({ kind: 'fatal', status: 400 });
    expect(classifyAnthropicError(apiError(401), 'p').kind).toBe('fatal');
    expect(classifyAnthropicError(apiError(404), 'p').kind).toBe('fatal');
    expect(classifyAnthropicError(new Anthropic.APIConnectionTimeoutError(), 'p').kind).toBe('timeout');
    expect(classifyAnthropicError(new Anthropic.APIConnectionError({ message: 'reset' }), 'p').kind).toBe('retryable');
    expect(classifyAnthropicError(new TypeError('boom'), 'p').kind).toBe('fatal');

    const controller = new AbortController();
    controller.abort(new ProviderError('timeout', 'deadline', { provider: 'p' }));
    expect(classifyAnthropicError(new Anthropic.APIUserAbortError(), 'p', controller.signal).kind).toBe('timeout');
  });

  it('recovers from a rate limit through the AgentRunner', async () => {
    const fake = new FakeMessages([apiError(429), message()]);
    const provider = new AnthropicProvider({
      name: 'anthropic-primary',
      model: 'claude-opus-5-5',
      serverFallbacks: 'default',
      messages: fake,
    });
    const agent: AgentDefinition<object, z.infer<typeof Schema>> = {
      name: 'title-agent',
      schemaName: 'Title',
      schema: Schema,
      effort: 'low',
      maxTokens: 1000,
      system: () => 's',
      prompt: () => 'p',
      fallback: () => ({ title: 'fallback' }),
    };
    const runner = new AgentRunner({
      providers: [provider],
      logger: new MemoryLogger(),
      circuits: new CircuitBreakerRegistry(),
      sleep: async () => {},
    });
    const result = await runner.run(agent, {});
    expect(result.output.title).toBe('Approve claims');
    expect(result.trace.attempts.map((a) => a.outcome)).toEqual(['retryable-error', 'success']);
    expect(result.trace.servedBy).toBe('anthropic-primary:claude-opus-5-5');
  });
});
