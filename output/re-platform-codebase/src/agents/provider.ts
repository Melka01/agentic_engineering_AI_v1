/**
 * Provider abstraction. Agents never talk to a vendor SDK directly — only to an
 * LlmProvider. Swapping vendors, adding a cheaper fallback model or running
 * fully offline is a composition concern, not an agent concern.
 */
import type { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface StructuredRequest {
  /** Agent name, for logging/telemetry. */
  readonly agent: string;
  readonly correlationId: string;
  readonly system: string;
  /** Single user turn. Untrusted content must already be fenced in tags by the prompt builder. */
  readonly prompt: string;
  /** Output contract. Providers should constrain decoding to it when supported. */
  readonly schema: z.ZodType;
  readonly schemaName: string;
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface StructuredResponse {
  /** Raw text produced by the model (expected to be a JSON document). */
  readonly rawText: string;
  /** Model that actually served the request (may differ under server-side fallback). */
  readonly model: string;
  readonly stopReason: string;
  readonly usage: TokenUsage;
}

export interface LlmProvider {
  /** Stable identifier used for circuit breaking and telemetry, e.g. "anthropic-primary". */
  readonly name: string;
  readonly model: string;
  /**
   * Must throw a ProviderError (see ./errors.ts) on failure so the runner can
   * classify it. Must honour `request.signal`.
   */
  generate(request: StructuredRequest): Promise<StructuredResponse>;
}
