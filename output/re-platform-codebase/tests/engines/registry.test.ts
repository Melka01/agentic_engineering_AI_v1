import { describe, expect, it } from 'vitest';
import { createEngine, designRuleBriefs } from '../../src/engines/registry.js';
import { compliantMendixDesign, story } from '../fixtures/mendix.js';
import { compliantOutSystemsDesign } from '../fixtures/outsystems.js';

const stories = [story('US-001'), story('US-002', { goal: 'search my expense claims' })];

describe('paradigm engine registry (platform switch)', () => {
  it('selects the platform-specific rule catalogue per paradigm', () => {
    const mendix = createEngine('mendix');
    const outsystems = createEngine('outsystems');
    const mxIds = mendix.catalog.map((r) => r.id);
    const osIds = outsystems.catalog.map((r) => r.id);

    expect(mendix.name).toBe('mendix-best-practice-engine');
    expect(outsystems.name).toBe('outsystems-best-practice-engine');
    expect(mxIds.some((id) => id.startsWith('MX-'))).toBe(true);
    expect(mxIds.some((id) => id.startsWith('OS-'))).toBe(false);
    expect(osIds.some((id) => id.startsWith('OS-'))).toBe(true);
    expect(osIds.some((id) => id.startsWith('MX-'))).toBe(false);
    // Common rules apply to both.
    for (const id of ['RE-US-001', 'RE-NFR-001', 'RE-COV-001']) {
      expect(mxIds).toContain(id);
      expect(osIds).toContain(id);
    }
  });

  it('validates each reference design cleanly with its own engine', () => {
    const mx = createEngine('mendix').validate({ stories, nfrs: [], design: compliantMendixDesign() });
    const os = createEngine('outsystems').validate({ stories, nfrs: [], design: compliantOutSystemsDesign() });
    expect(mx.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(os.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(mx.summary.passed).toBe(true);
    expect(os.summary.passed).toBe(true);
  });

  it('rejects a design that does not match the session paradigm', () => {
    const report = createEngine('outsystems').validate({ stories, nfrs: [], design: compliantMendixDesign() });
    expect(report.findings[0]).toMatchObject({ ruleId: 'RE-DES-001', severity: 'error' });
    expect(report.summary.passed).toBe(false);
  });

  it('derives story compliance and a score from findings', () => {
    const design = compliantMendixDesign();
    const vm = design.modules[0]?.entities.find((e) => e.name === 'ExpenseClaimSearchVM');
    if (vm) vm.persistable = true; // MX-DM-001 error on US-002
    const report = createEngine('mendix').validate({ stories, nfrs: [], design });
    const us2 = report.storyCompliance.find((s) => s.storyId === 'US-002');
    expect(us2?.status).toBe('non-compliant');
    expect(report.summary.score).toBeLessThan(100);
    expect(report.findings[0]?.severity).toBe('error'); // sorted errors first
  });

  it('applies threshold overrides and renders them into prompt guidance', () => {
    const engine = createEngine('mendix', { mendix: { microflowActivityWarning: 12 } });
    expect(engine.designGuidance().join(' ')).toContain('at most 12 activities');
    const briefs = designRuleBriefs(engine);
    expect(briefs.every((b) => b.id.startsWith('MX-') || b.id.startsWith('RE-COV-'))).toBe(true);
  });

  it('flags uncovered stories (RE-COV-001) and unknown story references (RE-COV-002)', () => {
    const report = createEngine('outsystems').validate({
      stories: [...stories, story('US-003', { goal: 'download receipts as PDF' })],
      nfrs: [],
      design: (() => {
        const d = compliantOutSystemsDesign();
        d.modules[0]?.screens.push({ name: 'Ghost', storyRefs: ['US-404'] });
        return d;
      })(),
    });
    const ids = report.findings.map((f) => `${f.ruleId}:${f.target.id}`);
    expect(ids).toContain('RE-COV-001:US-003');
    expect(ids).toContain('RE-COV-002:story-ref:US-404');
  });
});
