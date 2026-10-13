/**
 * Error taxonomy for the AI agent layer.
 *
 * Every failure coming out of a provider is normalised to a ProviderError with a
 * `kind` that drives the runner's decision: retry the same provider, repair the
 * prompt, move on to the next provider, or stop.
 */

export type ProviderErrorKind =
  /** Transient (429, 5xx, 529, connection reset). Retry with backoff. */
  | 'retryable'
  /** The attempt exceeded its deadline. Retry with backoff. */
  | 'timeout'
  /** Permanent for this request (400, 401, 403, 404, 413, 422). Move to next provider. */
  | 'fatal'
  /** Output was not valid JSON or failed schema / semantic validation. Repair, then next provider. */
  | 'invalid-output'
  /** The model declined for policy reasons (stop_reason "refusal"). Next provider. */
  | 'refusal'
  /** Output hit max_tokens and is incomplete. Next provider. */
  | 'truncated'
  /** The provider's circuit breaker is open. Skip provider. */
  | 'circuit-open'
  /** The caller cancelled the run. Stop everything. */
  | 'aborted';

export interface ProviderErrorOptions {
  readonly provider: string;
  readonly status?: number | undefined;
  readonly retryAfterMs?: number | undefined;
  readonly cause?: unknown;
  /** Raw model output, kept for repair prompts on invalid-output. */
  readonly rawOutput?: string | undefined;
  /** Human-readable validation issues for invalid-output. */
  readonly issues?: readonly string[] | undefined;
}

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly rawOutput: string | undefined;
  readonly issues: readonly string[];

  constructor(kind: ProviderErrorKind, message: string, options: ProviderErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.rawOutput = options.rawOutput;
    this.issues = options.issues ?? [];
  }

  /** True when retrying the same provider may succeed. */
  get transient(): boolean {
    return this.kind === 'retryable' || this.kind === 'timeout';
  }
}

/** Raised when an agent run fails completely and no fallback is allowed. */
export class AgentRunError extends Error {
  override readonly name = 'AgentRunError';
  constructor(
    message: string,
    readonly agent: string,
    readonly causes: readonly ProviderError[],
  ) {
    super(message);
  }
}

/** HTTP status codes that are worth retrying on any HTTP-based provider. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Normalises anything thrown by a provider into a ProviderError. */
export function toProviderError(error: unknown, provider: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError('fatal', message, { provider, cause: error });
}
