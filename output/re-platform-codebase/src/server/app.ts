/**
 * HTTP API (Fastify). Every request body is validated with zod; domain errors
 * map to precise status codes; long-running agent work is cancelled when the
 * client disconnects.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from 'fastify';
import { ZodError, z } from 'zod';
import { ProviderError } from '../agents/errors.js';
import type { Logger } from '../agents/logger.js';
import { createEngine, ENGINE_VERSION } from '../engines/registry.js';
import { SessionNotFoundError } from '../services/session-service.js';
import { NonFunctionalRequirementSchema, ParadigmSchema, UserStorySchema } from '../shared/domain.js';
import { MendixDesignSchema } from '../shared/mendix.js';
import { OutSystemsDesignSchema } from '../shared/outsystems.js';
import { PARADIGM_LIST } from '../shared/paradigms.js';
import { SessionInputSchema } from '../shared/session.js';
import type { AppServices } from './container.js';

export const API_VERSION = '1.0.0';

const IdParams = z.object({ id: z.string().uuid() });
const ParadigmParams = z.object({ paradigm: ParadigmSchema });
const SwitchBody = z.object({ paradigm: ParadigmSchema });
const ValidateBody = z.object({
  paradigm: ParadigmSchema,
  stories: z.array(UserStorySchema).max(500),
  nfrs: z.array(NonFunctionalRequirementSchema).max(500).default([]),
  design: z.discriminatedUnion('paradigm', [MendixDesignSchema, OutSystemsDesignSchema]).nullable().default(null),
});

export interface BuildAppOptions {
  /** Services, or a factory that receives Fastify's (pino) logger. */
  readonly services: AppServices | ((logger: Logger) => AppServices);
  readonly logger?: FastifyServerOptions['logger'];
  /** Directory containing the built web UI (served with SPA fallback). */
  readonly webDist?: string | null;
}

/** Aborts when the client disconnects before the response is sent. */
function disconnectSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableEnded) controller.abort();
  });
  return controller.signal;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1_048_576 });
  const services = typeof options.services === 'function' ? options.services(app.log) : options.services;

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_error',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (error instanceof SessionNotFoundError) {
      return reply.status(404).send({ error: 'not_found', message: error.message });
    }
    if (error instanceof ProviderError && error.kind === 'aborted') {
      // The client disconnected; agent work was cancelled. Nobody is listening for a body.
      request.log.info({ reqId: request.id }, 'request.cancelled_by_client');
      return reply.status(499).send({ error: 'client_closed_request' });
    }
    const status =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) request.log.error({ err: error }, 'request.failed');
    return reply.status(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: status >= 500 ? 'An unexpected error occurred.' : (error as Error).message,
      requestId: request.id,
    });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    version: API_VERSION,
    engineVersion: ENGINE_VERSION,
    aiMode: services.mode,
    providers: services.providers,
    circuits: services.circuits.snapshot(),
  }));

  app.get('/api/paradigms', async () =>
    PARADIGM_LIST.map((p) => ({ ...p, ruleCount: createEngine(p.id).catalog.length })),
  );

  app.get('/api/paradigms/:paradigm/rules', async (request) => {
    const { paradigm } = ParadigmParams.parse(request.params);
    const engine = createEngine(paradigm);
    return {
      paradigm,
      engine: engine.name,
      version: engine.version,
      rules: engine.catalog,
      guidance: engine.designGuidance(),
    };
  });

  app.get('/api/sessions', async () => services.sessions.list());

  app.post('/api/sessions', async (request, reply) => {
    const input = SessionInputSchema.parse(request.body);
    const session = await services.sessions.create(input, disconnectSignal(reply));
    return reply.status(201).send(session);
  });

  app.get('/api/sessions/:id', async (request) => {
    const { id } = IdParams.parse(request.params);
    return services.sessions.get(id);
  });

  app.put('/api/sessions/:id/paradigm', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { paradigm } = SwitchBody.parse(request.body);
    return services.sessions.switchParadigm(id, paradigm, disconnectSignal(reply));
  });

  app.post('/api/validate', async (request) => {
    const body = ValidateBody.parse(request.body);
    return services.sessions.validate(body.paradigm, { stories: body.stories, nfrs: body.nfrs, design: body.design });
  });

  const webDist = options.webDist ?? null;
  if (webDist !== null && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply
        .status(404)
        .send({ error: 'not_found', message: `Route ${request.method} ${request.url} not found` });
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      reply.status(404).send({ error: 'not_found', message: `Route ${request.method} ${request.url} not found` }),
    );
  }

  return app;
}
