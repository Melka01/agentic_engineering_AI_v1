import { describe, expect, it } from 'vitest';
import { synthesizeBlueprint, toBlueprint } from '../../src/analysis/blueprint/index.js';
import { deriveConcepts, extractObjectPhrase } from '../../src/analysis/concepts.js';
import { normalizeBacklog } from '../../src/analysis/normalize.js';
import { assessRisks, finaliseRisks, mergeAgentRisks, riskLevel } from '../../src/analysis/risk.js';
import { extractBacklog, parseMetric } from '../../src/analysis/story-extractor.js';
import { createEngine } from '../../src/engines/registry.js';
import { PARADIGMS } from '../../src/shared/domain.js';
import { story } from '../fixtures/mendix.js';

const EXPENSES = `Employees must be able to submit expense claims with photos of receipts from their phone, also when they are offline.
Managers can approve or reject expense claims within 2 working days.
Finance officers need to export approved claims to SAP every night.
Employees should search their previous claims.
The system must send a reminder e-mail to managers when a claim is pending for more than 3 days.
The portal must be available 99.9% of the time.
Pages must load within 2 seconds for 500 concurrent users.
All personal data must be encrypted and handled according to GDPR.`;

const SAMPLES: Record<string, string> = {
  expenses: EXPENSES,
  fieldService: `As a field technician, I want to record work orders on my tablet without connectivity so that I can work in basements.
Planners can assign work orders to technicians.
Planners should view a list of open work orders per region.
Customers will receive an SMS when the technician is on the way.
Dispatchers can import service contracts from Salesforce in bulk.
Supervisors can delete cancelled appointments.
The application must support 2,000 concurrent users.
Backups must allow recovery within 4 hours.`,
  minimal: 'Members can book a meeting room for a time slot.',
  noFunctional: 'The platform must be available 99.5% of the time and all data must be encrypted at rest.',
};

describe('deterministic backlog extraction', () => {
  it('extracts stories and measurable NFRs from free text', () => {
    const { stories, nfrs } = extractBacklog({
      projectName: 'Expense Portal',
      requirementsText: EXPENSES,
      domainContext: '',
    });
    expect(stories.map((s) => s.role)).toEqual(['employee', 'manager', 'finance officer', 'employee', 'system']);
    expect(stories[0]?.tags).toEqual(expect.arrayContaining(['offline', 'document', 'mobile']));
    expect(stories[2]?.tags).toEqual(expect.arrayContaining(['integration:sap', 'bulk', 'reporting']));
    expect(stories.every((s) => s.acceptanceCriteria.length >= 2)).toBe(true);
    expect(nfrs.map((n) => [n.category, n.metric?.target ?? null])).toEqual([
      ['availability', 99.9],
      ['performance', 2],
      ['scalability', 500],
      ['security', null],
      ['compliance', null],
    ]);
  });

  it('parses "As a … I want … so that …" stories verbatim', () => {
    const { stories } = extractBacklog({
      projectName: 'Field',
      requirementsText: SAMPLES.fieldService ?? '',
      domainContext: '',
    });
    expect(stories[0]).toMatchObject({
      role: 'field technician',
      goal: 'record work orders on my tablet without connectivity',
      benefit: 'I can work in basements',
    });
    expect(stories[0]?.tags).toContain('offline');
  });

  it('always returns at least one story', () => {
    const { stories, nfrs } = extractBacklog({
      projectName: 'Ops',
      requirementsText: SAMPLES.noFunctional ?? '',
      domainContext: '',
    });
    expect(stories).toHaveLength(1);
    expect(nfrs.map((n) => n.category)).toEqual(['availability', 'security']);
  });

  it('parses metrics with units and thousands separators', () => {
    expect(parseMetric('support 2,000 concurrent users', 'scalability')).toEqual({
      name: 'concurrent users',
      comparator: '>=',
      target: 2000,
      unit: 'users',
    });
    expect(parseMetric('respond in under 300 ms', 'performance')).toEqual({
      name: 'response time',
      comparator: '<=',
      target: 300,
      unit: 'ms',
    });
    expect(parseMetric('recovery within 4 hours', 'reliability')?.name).toBe('recovery time objective');
    expect(parseMetric('99,95% uptime', 'availability')?.target).toBe(99.95);
  });

  it('derives concepts and folds synonyms into one entity', () => {
    expect(extractObjectPhrase('view a list of open work orders per region')).toMatchObject({
      verbClass: 'view',
      object: 'work order',
    });
    const model = deriveConcepts([
      story('US-001', { goal: 'submit expense claims' }),
      story('US-002', { goal: 'approve claims' }),
      story('US-003', { goal: 'send a reminder e-mail to managers', role: 'system' }),
    ]);
    expect(model.concepts.map((c) => c.name)).toEqual(['ExpenseClaim']);
    expect(model.concepts[0]?.storyIds).toEqual(['US-001', 'US-002', 'US-003']);
  });
});

describe('deterministic blueprint synthesis', () => {
  for (const [name, text] of Object.entries(SAMPLES)) {
    for (const paradigm of PARADIGMS) {
      it(`${name} → ${paradigm}: zero design errors and full story coverage`, () => {
        const backlog = extractBacklog({ projectName: `${name} app`, requirementsText: text, domainContext: '' });
        const draft = synthesizeBlueprint(paradigm, { projectName: `${name} app`, stories: backlog.stories });
        const report = createEngine(paradigm).validate({ ...backlog, design: draft.design });
        const designFindings = report.findings.filter(
          (f) => !f.ruleId.startsWith('RE-US-') && !f.ruleId.startsWith('RE-NFR-'),
        );
        expect(designFindings).toEqual([]);
        expect(draft.decisions.length).toBeGreaterThanOrEqual(4);
        expect(toBlueprint(draft, 'deterministic').paradigm).toBe(paradigm);
      });
    }
  }

  it('builds an OutSystems canvas with downward-only references', () => {
    const backlog = extractBacklog({ projectName: 'Expense Portal', requirementsText: EXPENSES, domainContext: '' });
    const draft = synthesizeBlueprint('outsystems', { projectName: 'Expense Portal', stories: backlog.stories });
    if (draft.design.paradigm !== 'outsystems') throw new Error('expected outsystems');
    expect(draft.design.modules.map((m) => `${m.name}:${m.kind}`)).toEqual([
      'ExpensePortal:end-user',
      'ExpensePortal_BL:business-process',
      'ExpensePortal_CS:core-entities',
      'Sap_IS:connector',
      'ExpensePortal_Th:library',
    ]);
  });
});

describe('risk assessment', () => {
  it('derives risks from findings, NFR gaps and backlog shape', () => {
    const backlog = extractBacklog({ projectName: 'Expense Portal', requirementsText: EXPENSES, domainContext: '' });
    const report = createEngine('mendix').validate({ ...backlog, design: null });
    const risks = finaliseRisks(assessRisks({ paradigm: 'mendix', ...backlog, findings: report.findings }));
    const titles = risks.map((r) => r.title);
    expect(titles).toContain('External system dependencies');
    expect(titles).toContain('Offline synchronisation conflicts');
    expect(titles).toContain('Regulatory compliance obligations');
    expect(risks[0]?.id).toBe('RISK-001');
    for (let i = 1; i < risks.length; i += 1) expect(risks[i - 1]?.score).toBeGreaterThanOrEqual(risks[i]?.score ?? 0);
  });

  it('flags missing security requirements', () => {
    const risks = assessRisks({ paradigm: 'outsystems', stories: [story('US-001')], nfrs: [], findings: [] });
    expect(risks.map((r) => r.title)).toContain('Security requirements undefined');
  });

  it('clamps and deduplicates agent risks', () => {
    const base = assessRisks({ paradigm: 'mendix', stories: [story('US-001')], nfrs: [], findings: [] });
    const merged = mergeAgentRisks(base, [
      {
        title: 'Security requirements are undefined',
        description: 'dup',
        category: 'security',
        likelihood: 3,
        impact: 4,
        mitigation: 'x',
        sourceRefs: [],
      },
      {
        title: 'Key-user availability for UAT',
        description: 'd',
        category: 'delivery',
        likelihood: 9,
        impact: 0,
        mitigation: 'Book key users',
        sourceRefs: [],
      },
    ]);
    const added = merged.filter((r) => r.origin === 'agent');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ likelihood: 5, impact: 1 });
  });

  it('maps scores to levels', () => {
    expect([riskLevel(4), riskLevel(5), riskLevel(12), riskLevel(20)]).toEqual(['low', 'medium', 'high', 'critical']);
  });
});

describe('normalisation of agent output', () => {
  it('renumbers ids, remaps NFR references and keeps unknown references for the engine', () => {
    const normalized = normalizeBacklog({
      stories: [
        story('S1', { nfrRefs: ['P1', 'X9'], tags: [' Search ', 'search'] }),
        story('S2', { title: '  Spaced  ' }),
      ],
      nfrs: [
        {
          id: 'P1',
          category: 'performance',
          statement: ' fast ',
          metric: null,
          verificationMethod: 'test',
          priority: 'must',
        },
      ],
    });
    expect(normalized.stories.map((s) => s.id)).toEqual(['US-001', 'US-002']);
    expect(normalized.stories[0]?.nfrRefs).toEqual(['NFR-001', 'X9']);
    expect(normalized.stories[0]?.tags).toEqual(['search']);
    expect(normalized.stories[1]?.title).toBe('Spaced');
    expect(normalized.nfrs[0]?.statement).toBe('fast');
  });
});
