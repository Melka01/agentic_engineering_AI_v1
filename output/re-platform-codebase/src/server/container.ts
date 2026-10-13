/**
 * Composition root: wires providers → runner → pipeline → session service.
 */
import { AnthropicProvider } from '../agents/anthropic-provider.js';
import type { Logger } from '../agents/logger.js';
import type { LlmProvider } from '../agents/provider.js';
import { CircuitBreakerRegistry } from '../agents/resilience.js';
import { AgentRunner } from '../agents/runner.js';
import { RequirementsPipeline } from '../services/pipeline.js';
import { InMemorySessionRepository, SessionService } from '../services/session-service.js';
import type { AppConfig } from './config.js';

export interface AppServices {
  readonly sessions: SessionService;
  readonly circuits: CircuitBreakerRegistry;
  readonly mode: 'anthropic' | 'offline' | 'custom';
  readonly providers: readonly string[];
}

export function createProviders(config: AppConfig): LlmProvider[] {
  if (config.aiMode === 'offline') return [];
  const providers: LlmProvider[] = [
    new AnthropicProvider({
      name: 'anthropic-primary',
      model: config.primaryModel,
      serverFallbacks: config.serverFallbacks,
    }),
  ];
  if (config.fallbackModel !== null) {
    providers.push(
      new AnthropicProvider({
        name: 'anthropic-fallback',
        model: config.fallbackModel,
        serverFallbacks: config.serverFallbacks,
      }),
    );
  }
  return providers;
}

export interface ServiceOverrides {
  readonly providers?: readonly LlmProvider[];
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createServices(config: AppConfig, logger: Logger, overrides: ServiceOverrides = {}): AppServices {
  const providers = overrides.providers ?? createProviders(config);
  const circuits = new CircuitBreakerRegistry({
    failureThreshold: config.circuitFailureThreshold,
    cooldownMs: config.circuitCooldownMs,
  });
  const runner = new AgentRunner({
    providers,
    logger,
    circuits,
    retry: { maxRetries: config.agentMaxRetries, baseDelayMs: 500, maxDelayMs: 8_000 },
    timeoutMs: config.agentTimeoutMs,
    repairRounds: config.agentRepairRounds,
    ...(overrides.sleep === undefined ? {} : { sleep: overrides.sleep }),
  });
  const pipeline = new RequirementsPipeline({ runner, logger, designRepairRounds: config.designRepairRounds });
  return {
    sessions: new SessionService({ pipeline, repository: new InMemorySessionRepository() }),
    circuits,
    mode: overrides.providers === undefined ? config.aiMode : 'custom',
    providers: runner.providerNames,
  };
}
