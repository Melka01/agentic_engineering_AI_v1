/**
 * ApiClient that runs the real platform in the browser: rule engines,
 * deterministic agents, pipeline and session service, with no server and no
 * AI provider (the Claude agents need the server and an API key).
 *
 * Only the standalone demo imports this module; the server-backed UI keeps
 * zod and the engines out of its bundle.
 */
import { ZodError } from 'zod';
import { silentLogger } from '../../src/agents/logger.js';
import { CircuitBreakerRegistry } from '../../src/agents/resilience.js';
import { AgentRunner } from '../../src/agents/runner.js';
import { RequirementsPipeline } from '../../src/services/pipeline.js';
import { InMemorySessionRepository, SessionNotFoundError, SessionService } from '../../src/services/session-service.js';
import { SessionInputSchema } from '../../src/shared/session.js';
import { type ApiClient, ApiError } from './api.js';

export function createInBrowserApiClient(): ApiClient {
  const runner = new AgentRunner({ providers: [], logger: silentLogger, circuits: new CircuitBreakerRegistry() });
  const sessions = new SessionService({
    pipeline: new RequirementsPipeline({ runner, logger: silentLogger }),
    repository: new InMemorySessionRepository(50),
  });

  const translate = (error: unknown): never => {
    if (error instanceof ZodError) {
      const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      throw new ApiError(400, issues.map((i) => `${i.path || 'input'}: ${i.message}`).join('; '), issues);
    }
    if (error instanceof SessionNotFoundError) throw new ApiError(404, error.message);
    throw error;
  };

  return {
    health: async () => ({
      status: 'ok',
      version: 'browser-demo',
      engineVersion: '1.0.0',
      aiMode: 'offline',
      providers: [],
      circuits: {},
    }),
    createSession: async (input) => {
      try {
        return await sessions.create(SessionInputSchema.parse(input));
      } catch (error) {
        return translate(error);
      }
    },
    switchParadigm: async (sessionId, paradigm) => {
      try {
        return await sessions.switchParadigm(sessionId, paradigm);
      } catch (error) {
        return translate(error);
      }
    },
  };
}
