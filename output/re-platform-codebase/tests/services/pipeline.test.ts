import { describe, expect, it } from 'vitest';
import { MemoryLogger } from '../../src/agents/logger.js';
import { MockProvider, type MockStep } from '../../src/agents/mock-provider.js';
import type { LlmProvider, StructuredRequest } from '../../src/agents/provider.js';
import { CircuitBreakerRegistry } from '../../src/agents/resilience.js';
import { AgentRunner } from '../../src/agents/runner.js';
import { RequirementsPipeline } from '../../src/services/pipeline.js';
import { InMemorySessionRepository, SessionNotFoundError, SessionService } from '../../src/services/session-service.js';
import type { SessionInput } from '../../src/shared/session.js';
import { compliantMendixDesign, story } from '../fixtures/mendix.js';

const input: SessionInput = {
  projectName: 'Expense Portal',
  paradigm: 'mendix',
  requirementsText:
    'Employees submit expense claims with receipts. Managers approve claims. Pages load within 2 seconds. Data is encrypted.',
  domainContext: '',
};

const aiBacklog = {
  stories: [
    story('S-1', { nfrRefs: ['P-1'], title: 'Submit claim' }),
    story('S-2', { goal: 'search my expense claims', title: 'Search claims', tags: ['Search'] }),
  ],
  nfrs: [
    {
      id: 'P-1',
      category: 'performance',
      statement: 'Search returns within 2 s.',
      metric: { name: 'response time', comparator: '<=', target: 2, unit: 's' },
      verificationMethod: 'test',
      priority: 'must',
    },
    {
      id: 'S-1',
      category: 'security',
      statement: 'SSO with MFA.',
      metric: null,
      verificationMethod: 'test',
      priority: 'must',
    },
    {
      id: 'A-1',
      category: 'availability',
      statement: '99.5% availability.',
      metric: { name: 'availability', comparator: '>=', target: 99.5, unit: '%' },
      verificationMethod: 'analysis',
      priority: 'must',
    },
  ],
};

function nonCompliantDesign() {
  const design = compliantMendixDesign();
  const module = design.modules[0];
  const vm = module?.entities.find((e) => e.name === 'ExpenseClaimSearchVM');
  if (vm) vm.persistable = true; // MX-DM-001
  const sce = module?.microflows.find((m) => m.name === 'SCE_ExpenseClaim_Reminders');
  if (sce) sce.commitsInLoop = true; // MX-MF-004
  return design;
}

const draft = (design: unknown) => ({
  summary: 'AI blueprint',
  design,
  decisions: [{ id: 'ADR-1', title: 'Nanoflows first', decision: 'd', rationale: 'r', ruleRefs: ['MX-RT-001'] }],
});

const aiRisks = {
  risks: [
    {
      title: 'Key-user availability for acceptance testing',
      description: 'Finance key users are only available at month end.',
      category: 'delivery',
      likelihood: 3,
      impact: 3,
      mitigation: 'Book key users for UAT windows now.',
      sourceRefs: ['US-001'],
    },
  ],
};

function scripted(blueprintStep: (request: StructuredRequest, call: number) => MockStep): MockProvider {
  let blueprintCalls = 0;
  return new MockProvider('mock-claude', (request) => {
    if (request.agent === 'story-generator') return { type: 'json', value: aiBacklog };
    if (request.agent.startsWith('blueprint-synthesizer')) return blueprintStep(request, blueprintCalls++);
    return { type: 'json', value: aiRisks };
  });
}

function service(providers: LlmProvider[], logger = new MemoryLogger()) {
  const runner = new AgentRunner({
    providers,
    logger,
    circuits: new CircuitBreakerRegistry(),
    retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 },
    timeoutMs: 1_000,
    sleep: async () => {},
  });
  const pipeline = new RequirementsPipeline({ runner, logger, designRepairRounds: 1 });
  let id = 0;
  return {
    logger,
    sessions: new SessionService({
      pipeline,
      repository: new InMemorySessionRepository(),
      newId: () => `00000000-0000-4000-8000-00000000000${id++}`,
    }),
  };
}

describe('RequirementsPipeline with mocked AI agents', () => {
  it('normalises AI stories, repairs a non-compliant AI blueprint with engine findings, and merges AI risks', async () => {
    const provider = scripted((_req, call) => ({
      type: 'json',
      value: draft(call === 0 ? nonCompliantDesign() : compliantMendixDesign()),
    }));
    const { sessions, logger } = service([provider]);
    const session = await sessions.create(input);

    // Story agent output normalised.
    expect(session.stories.map((s) => s.id)).toEqual(['US-001', 'US-002']);
    expect(session.stories[0]?.nfrRefs).toEqual(['NFR-001']);
    expect(session.stories[1]?.tags).toEqual(['search']);

    // Blueprint repaired by the agent after rule-engine feedback.
    const blueprintCalls = provider.calls.filter((c) => c.agent.startsWith('blueprint-synthesizer'));
    expect(blueprintCalls).toHaveLength(2);
    expect(blueprintCalls[0]?.system).toContain('[MX-DM-001]'); // rule catalogue injected into the prompt
    expect(blueprintCalls[1]?.prompt).toContain('<findings>');
    expect(blueprintCalls[1]?.prompt).toContain('[MX-DM-001]');
    expect(blueprintCalls[1]?.prompt).toContain('[MX-MF-004]');
    expect(session.blueprint.origin).toBe('agent');
    expect(session.validation.summary.passed).toBe(true);
    expect(session.agentTrace.map((t) => t.agent)).toEqual([
      'story-generator',
      'blueprint-synthesizer:mendix',
      'blueprint-synthesizer:mendix#repair-1',
      'risk-assessor',
    ]);
    expect(logger.at('warn').map((e) => e.message)).toContain('pipeline.design.repair');

    // Risk register = deterministic + agent.
    expect(session.risks.some((r) => r.origin === 'agent' && r.title.startsWith('Key-user'))).toBe(true);
    expect(session.risks.every((r) => r.score === r.likelihood * r.impact)).toBe(true);
  });

  it('strictly enforces best practices: a blueprint that stays non-compliant is replaced by the deterministic one', async () => {
    const provider = scripted(() => ({ type: 'json', value: draft(nonCompliantDesign()) }));
    const { sessions, logger } = service([provider]);
    const session = await sessions.create(input);

    expect(session.blueprint.origin).toBe('deterministic');
    expect(session.validation.findings.filter((f) => f.severity === 'error' && f.ruleId.startsWith('MX-'))).toEqual([]);
    const repairTrace = session.agentTrace.find((t) => t.agent.endsWith('#repair-1'));
    expect(repairTrace?.degraded).toBe(true);
    expect(repairTrace?.note).toContain('MX-DM-001');
    expect(logger.at('warn').map((e) => e.message)).toContain('pipeline.design.enforced_deterministic');
  });

  it('completes the full pipeline when every provider fails (deterministic fallback, degraded)', async () => {
    const down = new MockProvider('mock-claude', [{ type: 'error', kind: 'retryable', status: 503 }]);
    const { sessions, logger } = service([down]);
    const session = await sessions.create(input);

    expect(session.stories.length).toBeGreaterThan(0);
    expect(session.agentTrace.every((t) => t.servedBy === 'deterministic-fallback')).toBe(true);
    expect(session.agentTrace.every((t) => t.degraded)).toBe(true);
    expect(session.blueprint.origin).toBe('deterministic');
    expect(logger.at('error').length).toBeGreaterThan(0);
  });

  it('runs fully offline without providers', async () => {
    const { sessions } = service([]);
    const session = await sessions.create(input);
    expect(session.agentTrace.every((t) => t.servedBy === 'deterministic-fallback' && !t.degraded)).toBe(true);
    expect(session.validation.engine).toBe('mendix-best-practice-engine');
  });
});

describe('SessionService paradigm switch', () => {
  it('keeps the backlog and re-synthesises + re-validates for the other platform', async () => {
    const { sessions } = service([]);
    const created = await sessions.create(input);
    const switched = await sessions.switchParadigm(created.id, 'outsystems');

    expect(switched.paradigm).toBe('outsystems');
    expect(switched.input.paradigm).toBe('outsystems');
    expect(switched.stories).toEqual(created.stories);
    expect(switched.blueprint.paradigm).toBe('outsystems');
    expect(switched.validation.paradigm).toBe('outsystems');
    expect(switched.validation.engine).toBe('outsystems-best-practice-engine');
    expect(switched.validation.findings.some((f) => f.ruleId.startsWith('MX-'))).toBe(false);
    expect(switched.history.map((h) => h.type)).toEqual(['created', 'paradigm-switched']);
    expect(switched.agentTrace[0]?.agent).toBe('story-generator');

    const back = await sessions.switchParadigm(created.id, 'mendix');
    expect(back.blueprint.paradigm).toBe('mendix');
    expect(back.history).toHaveLength(3);
  });

  it('is idempotent for the current paradigm and reports unknown sessions', async () => {
    const { sessions } = service([]);
    const created = await sessions.create(input);
    expect(await sessions.switchParadigm(created.id, 'mendix')).toBe(created);
    await expect(sessions.get('missing')).rejects.toBeInstanceOf(SessionNotFoundError);
    expect((await sessions.list())[0]?.id).toBe(created.id);
  });
});
