/**
 * Claude provider backed by the official Anthropic TypeScript SDK.
 *
 * - Structured outputs: `output_config.format` built from the agent's zod schema
 *   (`betaZodOutputFormat`), so decoding is constrained to the contract. The
 *   runner still re-validates with zod (defence in depth).
 * - Thinking: Claude Opus 5.5 always uses adaptive thinking; depth is controlled
 *   with `output_config.effort`, set explicitly per agent.
 * - Server-side refusal fallback: `fallbacks: "default"` (beta
 *   `server-side-fallback-2026-07-01`) lets the API re-route a policy decline to
 *   the model's default fallback inside the same call. Configurable.
 * - Retries are owned by the AgentRunner (SDK `maxRetries: 0`) so that retry,
 *   circuit breaking and provider fallback follow one policy.
 * - SDK errors are classified with the SDK's typed error classes.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { isRetryableStatus, ProviderError } from './errors.js';
import type { LlmProvider, StructuredRequest, StructuredResponse } from './provider.js';

type BetaCreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** The slice of the SDK this provider depends on (eases testing and wrapping). */
export interface AnthropicMessagesApi {
  create(
    params: BetaCreateParams,
    options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
  ): PromiseLike<BetaMessage>;
}

export type ServerFallbackMode = 'default' | 'off';

export interface AnthropicProviderOptions {
  readonly name: string;
  readonly model: string;
  readonly serverFallbacks: ServerFallbackMode;
  /** Injected messages API; defaults to `new Anthropic().beta.messages`. */
  readonly messages?: AnthropicMessagesApi;
  /** Passed to the SDK client when `messages` is not injected. */
  readonly apiKey?: string;
  readonly baseURL?: string;
}

export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly serverFallbacks: ServerFallbackMode;
  private readonly messages: AnthropicMessagesApi;

  constructor(options: AnthropicProviderOptions) {
    this.name = options.name;
    this.model = options.model;
    this.serverFallbacks = options.serverFallbacks;
    this.messages =
      options.messages ??
      new Anthropic({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
        maxRetries: 0,
      }).beta.messages;
  }

  /** Builds the exact request body (exposed for tests and diagnostics). */
  buildParams(request: StructuredRequest): BetaCreateParams {
    const params: BetaCreateParams = {
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      output_config: {
        effort: request.effort,
        format: betaZodOutputFormat(request.schema),
      },
    };
    if (this.serverFallbacks === 'default') {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = 'default';
    }
    return params;
  }

  async generate(request: StructuredRequest): Promise<StructuredResponse> {
    let response: BetaMessage;
    try {
      response = await this.messages.create(this.buildParams(request), {
        signal: request.signal,
        timeout: request.timeoutMs,
        maxRetries: 0,
      });
    } catch (error) {
      throw classifyAnthropicError(error, this.name, request.signal);
    }
    return interpretMessage(response, this.name);
  }
}

/** Turns a Messages API response into a StructuredResponse or a classified error. */
export function interpretMessage(response: BetaMessage, provider: string): StructuredResponse {
  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? 'unspecified';
    throw new ProviderError('refusal', `Model declined the request (category: ${category})`, { provider });
  }
  const rawText = response.content
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (response.stop_reason === 'max_tokens' || response.stop_reason === 'model_context_window_exceeded') {
    throw new ProviderError('truncated', `Output truncated (stop_reason: ${response.stop_reason})`, {
      provider,
      rawOutput: rawText,
    });
  }
  return {
    rawText,
    model: response.model,
    stopReason: response.stop_reason ?? 'unknown',
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

/** Maps SDK errors (most specific first) onto the platform's error taxonomy. */
export function classifyAnthropicError(error: unknown, provider: string, signal?: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIUserAbortError) {
    const reason: unknown = signal?.reason;
    if (reason instanceof ProviderError) return reason;
    return new ProviderError('aborted', 'Request aborted', { provider, cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', 'Anthropic API request timed out', { provider, cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('retryable', `Connection error: ${error.message}`, { provider, cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError('retryable', 'Rate limited (429)', {
      provider,
      status: 429,
      retryAfterMs: parseRetryAfter(error.headers),
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    const kind = isRetryableStatus(error.status) ? 'retryable' : 'fatal';
    return new ProviderError(kind, `Anthropic API error ${error.status}: ${error.message}`, {
      provider,
      status: error.status,
      retryAfterMs: parseRetryAfter(error.headers),
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError('fatal', message, { provider, cause: error });
}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  const value = headers?.get('retry-after');
  if (value === null || value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
