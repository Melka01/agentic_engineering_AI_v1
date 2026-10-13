/**
 * AgentRunner — the orchestration core of the AI layer.
 *
 * For one agent invocation it walks the provider chain in order:
 *
 *   for each provider (skipped while its circuit is open):
 *     attempt → JSON extraction → zod schema → semantic checks
 *       transient error (429/5xx/timeout) → exponential backoff + retry (bounded)
 *       invalid output                     → one repair round with the validation errors
 *       refusal / truncation / fatal       → next provider
 *   all providers failed (or none configured) → deterministic fallback
 *
 * Every attempt is logged with a correlation id and recorded in the run trace
 * that is returned to the caller (and surfaced in the UI).
 */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { AgentAttempt, AgentRunTrace, AttemptOutcome } from '../shared/domain.js';
import { AgentRunError, ProviderError, type ProviderErrorKind, toProviderError } from './errors.js';
import type { Logger } from './logger.js';
import type { Effort, LlmProvider } from './provider.js';
import {
  backoffDelay,
  type CircuitBreakerRegistry,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
  realSleep,
  withDeadline,
} from './resilience.js';

export interface AgentDefinition<I, O> {
  readonly name: string;
  readonly schemaName: string;
  readonly schema: z.ZodType<O>;
  readonly effort: Effort;
  readonly maxTokens: number;
  system(input: I): string;
  prompt(input: I): string;
  /** Semantic checks beyond the schema. Returns human-readable issues (empty = valid). */
  check?(output: O, input: I): string[];
  /** Deterministic, always-available implementation of the agent. */
  fallback(input: I): O;
}

export interface AgentRunnerOptions {
  readonly providers: readonly LlmProvider[];
  readonly logger: Logger;
  readonly circuits: CircuitBreakerRegistry;
  readonly retry?: RetryPolicy;
  readonly timeoutMs?: number;
  /** Repair rounds per provider when output fails validation. */
  readonly repairRounds?: number;
  /** When false, a run that exhausts all providers throws instead of falling back. */
  readonly allowFallback?: boolean;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

export interface AgentRunOptions {
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
}

export interface AgentRunResult<O> {
  readonly output: O;
  readonly trace: AgentRunTrace;
}

const OUTCOME_OF_KIND: Readonly<Record<ProviderErrorKind, AttemptOutcome>> = {
  retryable: 'retryable-error',
  timeout: 'timeout',
  fatal: 'fatal-error',
  'invalid-output': 'invalid-output',
  refusal: 'refusal',
  truncated: 'truncated',
  'circuit-open': 'circuit-open',
  aborted: 'fatal-error',
};

const MAX_REPAIR_ECHO_CHARS = 24_000;

export class AgentRunner {
  private readonly providers: readonly LlmProvider[];
  private readonly logger: Logger;
  private readonly circuits: CircuitBreakerRegistry;
  private readonly retry: RetryPolicy;
  private readonly timeoutMs: number;
  private readonly repairRounds: number;
  private readonly allowFallback: boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(options: AgentRunnerOptions) {
    this.providers = options.providers;
    this.logger = options.logger;
    this.circuits = options.circuits;
    this.retry = options.retry ?? DEFAULT_RETRY_POLICY;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.repairRounds = options.repairRounds ?? 1;
    this.allowFallback = options.allowFallback ?? true;
    this.sleep = options.sleep ?? realSleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  get providerNames(): readonly string[] {
    return this.providers.map((p) => `${p.name}:${p.model}`);
  }

  async run<I, O>(agent: AgentDefinition<I, O>, input: I, options: AgentRunOptions = {}): Promise<AgentRunResult<O>> {
    const correlationId = options.correlationId ?? randomUUID();
    const startedAt = new Date().toISOString();
    const t0 = this.now();
    const attempts: AgentAttempt[] = [];
    const failures: ProviderError[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let repairRounds = 0;
    const system = agent.system(input);
    const basePrompt = agent.prompt(input);
    const log = { agent: agent.name, correlationId };

    for (const provider of this.providers) {
      const breaker = this.circuits.get(provider.name);
      if (!breaker.tryAcquire()) {
        attempts.push(attempt(provider, 0, 'circuit-open', 0, 'Circuit breaker open'));
        this.logger.warn({ ...log, provider: provider.name }, 'agent.provider.skipped_circuit_open');
        continue;
      }

      let prompt = basePrompt;
      let transientRetries = 0;
      let providerRepairs = 0;
      let attemptNo = 0;

      while (true) {
        attemptNo += 1;
        const started = this.now();
        try {
          const response = await withDeadline(
            (signal) =>
              provider.generate({
                agent: agent.name,
                correlationId,
                system,
                prompt,
                schema: agent.schema,
                schemaName: agent.schemaName,
                maxTokens: agent.maxTokens,
                effort: agent.effort,
                timeoutMs: this.timeoutMs,
                signal,
              }),
            this.timeoutMs,
            provider.name,
            options.signal,
          );
          usage.inputTokens += response.usage.inputTokens;
          usage.outputTokens += response.usage.outputTokens;
          const output = validateOutput(agent, input, response.rawText, provider.name);
          breaker.recordSuccess();
          attempts.push(attempt(provider, attemptNo, 'success', this.now() - started, null, response.model));
          this.logger.info(
            { ...log, provider: provider.name, model: response.model, attempts: attempts.length, repairRounds },
            'agent.run.succeeded',
          );
          return {
            output,
            trace: {
              agent: agent.name,
              correlationId,
              startedAt,
              durationMs: this.now() - t0,
              attempts,
              servedBy: `${provider.name}:${response.model}`,
              degraded: false,
              repairRounds,
              usage,
              note: null,
            },
          };
        } catch (raw) {
          const error = toProviderError(raw, provider.name);
          failures.push(error);
          attempts.push(attempt(provider, attemptNo, OUTCOME_OF_KIND[error.kind], this.now() - started, error.message));
          const fields = {
            ...log,
            provider: provider.name,
            model: provider.model,
            attempt: attemptNo,
            kind: error.kind,
            status: error.status,
            issues: error.issues.slice(0, 10),
            err: error.message,
          };
          if (error.kind === 'invalid-output') this.logger.warn(fields, 'agent.attempt.invalid_output');
          else this.logger.error(fields, 'agent.attempt.failed');

          if (error.kind === 'aborted') throw error;

          if (error.kind === 'invalid-output') {
            breaker.recordSuccess(); // the provider is reachable; the content was wrong
            if (providerRepairs < this.repairRounds) {
              providerRepairs += 1;
              repairRounds += 1;
              prompt = buildRepairPrompt(basePrompt, error);
              continue;
            }
            break;
          }

          if (error.transient) {
            breaker.recordFailure();
            if (transientRetries < this.retry.maxRetries && breaker.currentState !== 'open') {
              transientRetries += 1;
              await this.sleep(backoffDelay(transientRetries, this.retry, this.random, error.retryAfterMs));
              continue;
            }
            break;
          }

          // fatal (auth, bad request, …) counts against the breaker; refusal/truncation do not.
          if (error.kind === 'fatal') breaker.recordFailure();
          else breaker.recordSuccess();
          break;
        }
      }
    }

    if (!this.allowFallback) {
      throw new AgentRunError(`Agent "${agent.name}" failed on every provider`, agent.name, failures);
    }

    const fallbackStarted = this.now();
    const output = agent.schema.parse(agent.fallback(input));
    const degraded = this.providers.length > 0;
    attempts.push({
      provider: 'deterministic',
      model: 'rule-based',
      attempt: 1,
      outcome: 'success',
      latencyMs: this.now() - fallbackStarted,
      error: null,
    });
    const note = degraded
      ? `All AI providers failed (${summarise(failures)}); deterministic fallback used.`
      : 'Offline mode: no AI provider configured; deterministic agent used.';
    if (degraded) this.logger.warn({ ...log, failures: failures.length, note }, 'agent.run.fallback');
    else this.logger.info({ ...log, note }, 'agent.run.offline');

    return {
      output,
      trace: {
        agent: agent.name,
        correlationId,
        startedAt,
        durationMs: this.now() - t0,
        attempts,
        servedBy: 'deterministic-fallback',
        degraded,
        repairRounds,
        usage,
        note,
      },
    };
  }
}

function attempt(
  provider: LlmProvider,
  attemptNo: number,
  outcome: AttemptOutcome,
  latencyMs: number,
  error: string | null,
  model: string = provider.model,
): AgentAttempt {
  return { provider: provider.name, model, attempt: attemptNo, outcome, latencyMs, error };
}

function summarise(failures: readonly ProviderError[]): string {
  if (failures.length === 0) return 'all circuits open';
  const counts = new Map<string, number>();
  for (const f of failures) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => `${n}× ${kind}`).join(', ');
}

/** Parses and validates raw model text; throws ProviderError('invalid-output') with issues. */
export function validateOutput<I, O>(agent: AgentDefinition<I, O>, input: I, rawText: string, provider: string): O {
  const json = extractJson(rawText);
  if (json === undefined) {
    throw new ProviderError('invalid-output', 'Model output is not valid JSON', {
      provider,
      rawOutput: rawText,
      issues: ['The response must be exactly one JSON document matching the schema.'],
    });
  }
  const parsed = agent.schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`);
    throw new ProviderError('invalid-output', `Output failed schema "${agent.schemaName}" (${issues.length} issues)`, {
      provider,
      rawOutput: rawText,
      issues,
    });
  }
  const semantic = agent.check?.(parsed.data, input) ?? [];
  if (semantic.length > 0) {
    throw new ProviderError('invalid-output', `Output failed semantic checks (${semantic.length} issues)`, {
      provider,
      rawOutput: rawText,
      issues: semantic,
    });
  }
  return parsed.data;
}

/** Tolerant JSON extraction: plain JSON, fenced ```json blocks, or the outermost {...} span. */
export function extractJson(text: string): unknown {
  const candidates = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1] !== undefined) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export function buildRepairPrompt(basePrompt: string, error: ProviderError): string {
  const previous = (error.rawOutput ?? '').slice(0, MAX_REPAIR_ECHO_CHARS);
  const issues = error.issues.slice(0, 40).map((i) => `- ${i}`);
  return [
    basePrompt,
    '',
    '<previous_attempt>',
    previous,
    '</previous_attempt>',
    '<validation_errors>',
    ...issues,
    '</validation_errors>',
    '',
    'Your previous attempt did not satisfy the output contract. Return one corrected, complete JSON document',
    'that fixes every validation error above while keeping all content that was already valid.',
  ].join('\n');
}
