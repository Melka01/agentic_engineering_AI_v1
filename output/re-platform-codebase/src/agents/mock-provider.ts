/**
 * Scriptable provider for tests, demos and contract checks. Each call consumes
 * the next step of the script (the last step repeats when the script runs out).
 */
import { ProviderError, type ProviderErrorKind } from './errors.js';
import type { LlmProvider, StructuredRequest, StructuredResponse } from './provider.js';

export type MockStep =
  | { readonly type: 'json'; readonly value: unknown; readonly delayMs?: number }
  | { readonly type: 'text'; readonly text: string; readonly delayMs?: number }
  | { readonly type: 'error'; readonly kind: ProviderErrorKind; readonly status?: number; readonly delayMs?: number }
  | { readonly type: 'hang' };

export type MockScript = readonly MockStep[] | ((request: StructuredRequest, call: number) => MockStep);

export class MockProvider implements LlmProvider {
  readonly calls: StructuredRequest[] = [];

  constructor(
    readonly name: string,
    private readonly script: MockScript,
    readonly model = 'mock-model',
  ) {}

  async generate(request: StructuredRequest): Promise<StructuredResponse> {
    const call = this.calls.length;
    this.calls.push(request);
    const step = typeof this.script === 'function' ? this.script(request, call) : this.pick(call);

    if (step.type === 'hang') {
      return new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    }
    if (step.delayMs !== undefined) await delay(step.delayMs, request.signal);

    switch (step.type) {
      case 'json':
        return this.respond(JSON.stringify(step.value));
      case 'text':
        return this.respond(step.text);
      case 'error':
        throw new ProviderError(step.kind, `mock ${step.kind} error`, { provider: this.name, status: step.status });
    }
  }

  private pick(call: number): MockStep {
    const steps = this.script as readonly MockStep[];
    const step = steps[Math.min(call, steps.length - 1)];
    if (step === undefined) throw new Error(`MockProvider "${this.name}" has an empty script`);
    return step;
  }

  private respond(rawText: string): StructuredResponse {
    return {
      rawText,
      model: this.model,
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: Math.ceil(rawText.length / 4) },
    };
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
