/**
 * Resilience primitives: exponential backoff with jitter, per-attempt deadlines
 * and a per-provider circuit breaker.
 */
import { ProviderError } from './errors.js';

export interface RetryPolicy {
  /** Retries after the first attempt for transient failures (0 = no retry). */
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

/**
 * Delay before retry number `retry` (1-based): exponential growth, capped, with
 * "equal jitter" (50–100 % of the step) to avoid thundering herds. A server
 * supplied Retry-After wins when it is longer, but is still capped.
 */
export function backoffDelay(
  retry: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
  retryAfterMs?: number,
): number {
  const step = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, retry - 1));
  const jittered = Math.round(step / 2 + random() * (step / 2));
  if (retryAfterMs !== undefined && retryAfterMs > jittered) return Math.min(retryAfterMs, policy.maxDelayMs);
  return jittered;
}

export const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `task` with a hard deadline. The task receives a signal that aborts on
 * deadline or when `parent` aborts; the returned promise rejects even if the
 * task ignores its signal.
 */
export async function withDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  provider: string,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const onParentAbort = (): void => controller.abort(parent?.reason);
  if (parent?.aborted) throw new ProviderError('aborted', 'Run was cancelled by the caller', { provider });
  parent?.addEventListener('abort', onParentAbort, { once: true });

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderError('timeout', `Attempt exceeded ${timeoutMs} ms`, { provider });
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        if (parent?.aborted) reject(new ProviderError('aborted', 'Run was cancelled by the caller', { provider }));
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([task(controller.signal), deadline, cancelled]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. */
  readonly failureThreshold: number;
  /** How long the circuit stays open before a single probe is allowed. */
  readonly cooldownMs: number;
}

export const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = { failureThreshold: 3, cooldownMs: 30_000 };

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private probeInFlight = false;

  constructor(
    private readonly options: CircuitBreakerOptions = DEFAULT_CIRCUIT_OPTIONS,
    private readonly now: () => number = Date.now,
  ) {}

  get currentState(): CircuitState {
    this.refresh();
    return this.state;
  }

  /** Whether a request may be sent now. In half-open state only one probe is admitted. */
  tryAcquire(): boolean {
    this.refresh();
    if (this.state === 'closed') return true;
    if (this.state === 'half-open' && !this.probeInFlight) {
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
  }

  recordFailure(): void {
    this.probeInFlight = false;
    this.consecutiveFailures += 1;
    if (this.state === 'half-open' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  private refresh(): void {
    if (this.state === 'open' && this.now() - this.openedAt >= this.options.cooldownMs) {
      this.state = 'half-open';
      this.probeInFlight = false;
    }
  }
}

/** One breaker per provider name, shared across agent runs. */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly options: CircuitBreakerOptions = DEFAULT_CIRCUIT_OPTIONS,
    private readonly now: () => number = Date.now,
  ) {}

  get(provider: string): CircuitBreaker {
    let breaker = this.breakers.get(provider);
    if (breaker === undefined) {
      breaker = new CircuitBreaker(this.options, this.now);
      this.breakers.set(provider, breaker);
    }
    return breaker;
  }

  snapshot(): Record<string, CircuitState> {
    return Object.fromEntries([...this.breakers].map(([name, breaker]) => [name, breaker.currentState]));
  }
}
