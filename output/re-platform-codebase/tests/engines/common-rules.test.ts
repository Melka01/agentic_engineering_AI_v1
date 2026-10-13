import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/engines/registry.js';
import { findAmbiguousTerms } from '../../src/engines/story-rules.js';
import type { NonFunctionalRequirement, UserStory } from '../../src/shared/domain.js';
import { story } from '../fixtures/mendix.js';

const nfr = (id: string, overrides: Partial<NonFunctionalRequirement> = {}): NonFunctionalRequirement => ({
  id,
  category: 'security',
  statement: 'Access requires single sign-on with MFA.',
  metric: null,
  verificationMethod: 'test',
  priority: 'must',
  ...overrides,
});

const baselineNfrs = [
  nfr('NFR-001'),
  nfr('NFR-002', {
    category: 'performance',
    statement: 'Pages load within 2 seconds.',
    metric: { name: 'response time', comparator: '<=', target: 2, unit: 's' },
  }),
  nfr('NFR-003', {
    category: 'availability',
    statement: 'Available 99.5% of business hours.',
    metric: { name: 'availability', comparator: '>=', target: 99.5, unit: '%' },
    verificationMethod: 'analysis',
  }),
];

function ruleIds(
  stories: UserStory[],
  nfrs: NonFunctionalRequirement[] = baselineNfrs,
  paradigm: 'mendix' | 'outsystems' = 'mendix',
) {
  return createEngine(paradigm)
    .validate({ stories, nfrs, design: null })
    .findings.map((f) => f.ruleId);
}

describe('user-story rules (INVEST)', () => {
  it('accepts a well-formed story', () => {
    expect(ruleIds([story('US-001')])).toEqual(['RE-DES-002']);
  });

  it('RE-US-001 / RE-US-002 require role, goal, benefit and testable criteria', () => {
    const ids = ruleIds([story('US-001', { benefit: '', acceptanceCriteria: [] })]);
    expect(ids).toEqual(expect.arrayContaining(['RE-US-001', 'RE-US-002']));
    const partial = ruleIds([story('US-001', { acceptanceCriteria: [{ given: 'x', when: '', then: 'y' }] })]);
    expect(partial).toContain('RE-US-002');
  });

  it('RE-US-003 detects ambiguous wording without false positives on substrings', () => {
    expect(findAmbiguousTerms('a fast and user-friendly flow, etc.')).toEqual(['fast', 'user-friendly', 'etc']);
    expect(findAmbiguousTerms('breakfast steadfast')).toEqual([]);
    expect(ruleIds([story('US-001', { goal: 'quickly find claims' })])).toContain('RE-US-003');
  });

  it('RE-US-004 flags oversized and non-Fibonacci estimates', () => {
    const engine = createEngine('mendix');
    const report = engine.validate({
      stories: [story('US-001', { storyPoints: 13 }), story('US-002', { storyPoints: 4, goal: 'other goal' })],
      nfrs: baselineNfrs,
      design: null,
    });
    const sizes = report.findings.filter((f) => f.ruleId === 'RE-US-004').map((f) => [f.target.id, f.severity]);
    expect(sizes).toEqual([
      ['US-001', 'warning'],
      ['US-002', 'info'],
    ]);
  });

  it('RE-US-006 / RE-US-010 detect duplicate stories and ids', () => {
    const ids = ruleIds([story('US-001'), story('US-001')]);
    expect(ids).toEqual(expect.arrayContaining(['RE-US-006', 'RE-US-010']));
  });

  it('RE-US-007 rejects unknown NFR references', () => {
    expect(ruleIds([story('US-001', { nfrRefs: ['NFR-999'] })])).toContain('RE-US-007');
  });

  it('RE-US-008 / RE-US-009 / RE-US-011 cover persona, value and estimation', () => {
    const ids = ruleIds([story('US-001', { role: 'user', benefit: 'useful', storyPoints: null })]);
    expect(ids).toEqual(expect.arrayContaining(['RE-US-008', 'RE-US-009', 'RE-US-011']));
  });

  it('RE-US-012 flags solution-prescriptive stories with paradigm-specific guidance', () => {
    const report = createEngine('outsystems').validate({
      stories: [story('US-001', { goal: 'have a microflow that updates the claims table' })],
      nfrs: baselineNfrs,
      design: null,
    });
    const finding = report.findings.find((f) => f.ruleId === 'RE-US-012');
    expect(finding?.remediation).toContain('OutSystems');
  });
});

describe('NFR validation', () => {
  it('RE-NFR-001 requires metrics for measurable categories', () => {
    expect(
      ruleIds(
        [story('US-001')],
        [...baselineNfrs, nfr('NFR-004', { category: 'scalability', statement: 'Must scale.' })],
      ),
    ).toContain('RE-NFR-001');
  });

  it('RE-NFR-002 / RE-NFR-003 require verification and unambiguous wording', () => {
    const ids = ruleIds(
      [story('US-001')],
      [
        ...baselineNfrs,
        nfr('NFR-004', { category: 'usability', statement: 'The UI is intuitive.', verificationMethod: null }),
      ],
    );
    expect(ids).toEqual(expect.arrayContaining(['RE-NFR-002', 'RE-NFR-003']));
  });

  it('RE-NFR-004 reports missing core categories', () => {
    const report = createEngine('mendix').validate({ stories: [story('US-001')], nfrs: [], design: null });
    expect(report.findings.filter((f) => f.ruleId === 'RE-NFR-004').map((f) => f.target.id)).toEqual([
      'nfr-coverage:availability',
      'nfr-coverage:performance',
      'nfr-coverage:security',
    ]);
  });

  it('RE-NFR-005 detects conflicting targets but accepts compatible ones', () => {
    const conflicting = nfr('NFR-004', {
      category: 'performance',
      statement: 'Pages load in at least 5 s.',
      metric: { name: 'Response Time', comparator: '>=', target: 5, unit: 's' },
    });
    expect(ruleIds([story('US-001')], [...baselineNfrs, conflicting])).toContain('RE-NFR-005');
    const compatible = nfr('NFR-004', {
      category: 'performance',
      statement: 'Pages load within 1 s.',
      metric: { name: 'response time', comparator: '<=', target: 1, unit: 's' },
    });
    expect(ruleIds([story('US-001')], [...baselineNfrs, compatible])).not.toContain('RE-NFR-005');
  });

  it('RE-NFR-006 flags availability above the managed-cloud ceiling for both paradigms', () => {
    const fourNines = nfr('NFR-003', {
      category: 'availability',
      statement: '99.99% availability.',
      metric: { name: 'availability', comparator: '>=', target: 99.99, unit: '%' },
    });
    const nfrs = [baselineNfrs[0], baselineNfrs[1], fourNines].filter(
      (n): n is NonFunctionalRequirement => n !== undefined,
    );
    const mx = createEngine('mendix').validate({ stories: [story('US-001')], nfrs, design: null });
    const os = createEngine('outsystems').validate({ stories: [story('US-001')], nfrs, design: null });
    expect(mx.findings.find((f) => f.ruleId === 'RE-NFR-006')?.message).toContain('Mendix Cloud');
    expect(os.findings.find((f) => f.ruleId === 'RE-NFR-006')?.message).toContain('OutSystems Cloud');
  });

  it('RE-NFR-007 / RE-NFR-008 / RE-NFR-009 check plausibility, tight targets and unique ids', () => {
    const ids = ruleIds(
      [story('US-001')],
      [
        ...baselineNfrs,
        nfr('NFR-004', {
          category: 'availability',
          metric: { name: 'uptime', comparator: '>=', target: 120, unit: '%' },
        }),
        nfr('NFR-005', {
          category: 'performance',
          metric: { name: 'api latency', comparator: '<=', target: 300, unit: 'ms' },
        }),
        nfr('NFR-001'),
      ],
    );
    expect(ids).toEqual(expect.arrayContaining(['RE-NFR-007', 'RE-NFR-008', 'RE-NFR-009']));
  });
});
