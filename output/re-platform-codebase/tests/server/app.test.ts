import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/agents/logger.js';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { createProviders, createServices } from '../../src/server/container.js';
import type { Session } from '../../src/shared/session.js';
import { story } from '../fixtures/mendix.js';
import { compliantOutSystemsDesign } from '../fixtures/outsystems.js';

const requirementsText = `Employees must be able to submit expense claims with receipts.
Managers can approve or reject expense claims.
Finance officers export approved claims to SAP every night.
Pages must load within 2 seconds. The portal must be available 99.5% of the time.
Access requires single sign-on.`;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ services: createServices(loadConfig({ RE_AI_MODE: 'offline' }), silentLogger) });
});
afterAll(async () => {
  await app.close();
});

async function createSession(paradigm: 'mendix' | 'outsystems'): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { projectName: 'Expense Portal', paradigm, requirementsText },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Session>();
}

describe('HTTP API', () => {
  it('reports health, AI mode and security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', aiMode: 'offline', providers: [] });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('lists both paradigms with their rule catalogues', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/paradigms' });
    const paradigms = res.json<{ id: string; ruleCount: number }[]>();
    expect(paradigms.map((p) => p.id)).toEqual(['mendix', 'outsystems']);
    expect(paradigms.every((p) => p.ruleCount > 40)).toBe(true);

    const rules = (await app.inject({ method: 'GET', url: '/api/paradigms/outsystems/rules' })).json<{
      rules: { id: string }[];
    }>();
    expect(rules.rules.map((r) => r.id)).toContain('OS-ARCH-003');
    expect((await app.inject({ method: 'GET', url: '/api/paradigms/powerapps/rules' })).statusCode).toBe(400);
  });

  it('creates a Mendix session with stories, NFRs, blueprint, validation, risks and trace', async () => {
    const session = await createSession('mendix');
    expect(session.paradigm).toBe('mendix');
    expect(session.stories.length).toBeGreaterThanOrEqual(3);
    expect(session.nfrs.map((n) => n.category)).toEqual(
      expect.arrayContaining(['performance', 'availability', 'security']),
    );
    expect(session.blueprint.paradigm).toBe('mendix');
    expect(session.validation.engine).toBe('mendix-best-practice-engine');
    expect(session.validation.summary.passed).toBe(true);
    expect(session.risks.length).toBeGreaterThan(0);
    expect(session.agentTrace.map((t) => t.agent)).toEqual([
      'story-generator',
      'blueprint-synthesizer:mendix',
      'risk-assessor',
    ]);
  });

  it('creates an OutSystems session with a 3-layer canvas', async () => {
    const session = await createSession('outsystems');
    if (session.blueprint.paradigm !== 'outsystems') throw new Error('expected outsystems blueprint');
    expect(session.blueprint.design.modules.map((m) => m.kind)).toEqual(
      expect.arrayContaining(['end-user', 'business-process', 'core-entities', 'connector', 'library']),
    );
    expect(session.validation.engine).toBe('outsystems-best-practice-engine');
  });

  it('switches the paradigm of an existing session', async () => {
    const created = await createSession('mendix');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${created.id}/paradigm`,
      payload: { paradigm: 'outsystems' },
    });
    expect(res.statusCode).toBe(200);
    const switched = res.json<Session>();
    expect(switched.paradigm).toBe('outsystems');
    expect(switched.blueprint.paradigm).toBe('outsystems');
    expect(switched.stories).toEqual(created.stories);
    expect(switched.history.map((h) => h.type)).toEqual(['created', 'paradigm-switched']);

    const fetched = (await app.inject({ method: 'GET', url: `/api/sessions/${created.id}` })).json<Session>();
    expect(fetched.paradigm).toBe('outsystems');
    const list = (await app.inject({ method: 'GET', url: '/api/sessions' })).json<{ id: string }[]>();
    expect(list.map((s) => s.id)).toContain(created.id);
  });

  it('rejects invalid input with structured validation errors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { projectName: '', paradigm: 'powerapps', requirementsText: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; issues: { path: string }[] }>();
    expect(body.error).toBe('validation_error');
    expect(body.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['projectName', 'paradigm', 'requirementsText']),
    );

    const badSwitch = await app.inject({
      method: 'PUT',
      url: '/api/sessions/00000000-0000-4000-8000-000000000000/paradigm',
      payload: { paradigm: 'x' },
    });
    expect(badSwitch.statusCode).toBe(400);
  });

  it('returns 404 for unknown sessions and routes, 400 for malformed ids', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/sessions/00000000-0000-4000-8000-000000000000' })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/sessions/not-a-uuid' })).statusCode).toBe(400);
    const missing = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found' });
  });

  it('validates caller-supplied artefacts statelessly (CI integration)', async () => {
    const design = compliantOutSystemsDesign();
    design.modules.find((m) => m.name === 'Sap_IS')?.references.push('Expenses_BL'); // upward + cycle
    const res = await app.inject({
      method: 'POST',
      url: '/api/validate',
      payload: {
        paradigm: 'outsystems',
        stories: [story('US-001'), story('US-002', { goal: 'search claims' })],
        design,
      },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json<{ summary: { passed: boolean }; findings: { ruleId: string }[] }>();
    expect(report.summary.passed).toBe(false);
    expect(report.findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['OS-ARCH-001', 'OS-ARCH-003']));
  });
});

describe('static web UI hosting', () => {
  it('serves the SPA and falls back to index.html for client routes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 're-web-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>RE Platform</title>');
    const web = await buildApp({
      services: createServices(loadConfig({ RE_AI_MODE: 'offline' }), silentLogger),
      webDist: dir,
    });
    expect((await web.inject({ method: 'GET', url: '/' })).body).toContain('RE Platform');
    expect((await web.inject({ method: 'GET', url: '/sessions/abc' })).body).toContain('RE Platform');
    expect((await web.inject({ method: 'GET', url: '/api/unknown' })).statusCode).toBe(404);
    await web.close();
  });
});

describe('configuration and composition', () => {
  it('defaults to offline mode without credentials and to anthropic with a key', () => {
    expect(loadConfig({}).aiMode).toBe('offline');
    expect(loadConfig({ ANTHROPIC_API_KEY: 'test-key' }).aiMode).toBe('anthropic');
    expect(loadConfig({ RE_AI_MODE: '', PORT: '' }).port).toBe(3000);
  });

  it('configures the primary/fallback model chain', () => {
    const config = loadConfig({ RE_AI_MODE: 'anthropic', ANTHROPIC_API_KEY: 'test-key' });
    expect(config.primaryModel).toBe('claude-opus-5-5');
    expect(config.fallbackModel).toBe('claude-sonnet-5-5');
    expect(createProviders(config).map((p) => `${p.name}:${p.model}`)).toEqual([
      'anthropic-primary:claude-opus-5-5',
      'anthropic-fallback:claude-sonnet-5-5',
    ]);
    expect(loadConfig({ RE_FALLBACK_MODEL: 'none' }).fallbackModel).toBeNull();
    expect(createProviders(loadConfig({ RE_AI_MODE: 'offline' }))).toEqual([]);
  });

  it('resolves a relative web dist directory to an absolute path', () => {
    expect(loadConfig({ RE_WEB_DIST: 'web/dist' }).webDist).toBe(path.resolve('web/dist'));
  });

  it('fails fast on invalid configuration', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
    expect(() => loadConfig({ RE_AI_MODE: 'gpt' })).toThrow();
  });
});

describe('cancellation', () => {
  it('maps a cancelled agent run to 499 without an error response body', async () => {
    const { ProviderError } = await import('../../src/agents/errors.js');
    const services = createServices(loadConfig({ RE_AI_MODE: 'offline' }), silentLogger);
    const cancelled = {
      ...services,
      sessions: Object.assign(Object.create(Object.getPrototypeOf(services.sessions)), services.sessions, {
        create: async () => {
          throw new ProviderError('aborted', 'Run was cancelled by the caller', { provider: 'p' });
        },
      }),
    };
    const local = await buildApp({ services: cancelled });
    const res = await local.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { projectName: 'X', paradigm: 'mendix', requirementsText },
    });
    expect(res.statusCode).toBe(499);
    await local.close();
  });
});
