/**
 * Generic, fault-tolerant rule execution. A rule that throws never breaks
 * validation: it is converted into an ENGINE-001 finding so the failure is
 * visible instead of silently skipping a best-practice check.
 */
import type { Logger } from '../agents/logger.js';
import type { Finding, Severity, StoryCompliance, UserStory, ValidationSummary } from '../shared/domain.js';
import type { RuleCatalogEntry, RuleDefinition } from './types.js';

export interface RuleRunResult {
  readonly findings: Finding[];
  readonly evaluated: number;
}

export function runRules<C>(rules: readonly RuleDefinition<C>[], context: C, logger?: Logger): RuleRunResult {
  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      for (const draft of rule.evaluate(context)) {
        findings.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          severity: draft.severity ?? rule.severity,
          category: rule.category,
          message: draft.message,
          target: draft.target,
          remediation: draft.remediation,
          storyRefs: [...(draft.storyRefs ?? [])],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ ruleId: rule.id, err: message }, 'engine.rule.crashed');
      findings.push({
        ruleId: 'ENGINE-001',
        ruleTitle: 'Rule evaluation failed',
        severity: 'error',
        category: 'engine',
        message: `Rule ${rule.id} could not be evaluated: ${message}`,
        target: { kind: 'project', id: rule.id },
        remediation: 'Inspect the input model for malformed data; report the defect if the model is valid.',
        storyRefs: [],
      });
    }
  }
  return { findings, evaluated: rules.length };
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.target.id.localeCompare(b.target.id),
  );
}

/** Compliance score: 100 minus weighted penalties, floored at 0. */
export function summarize(findings: readonly Finding[], rulesEvaluated: number): ValidationSummary {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;
  const score = Math.max(0, Math.round(100 - errors * 10 - warnings * 3 - infos * 0.5));
  return { errors, warnings, infos, score, passed: errors === 0, rulesEvaluated };
}

export function storyCompliance(stories: readonly UserStory[], findings: readonly Finding[]): StoryCompliance[] {
  return stories.map((story) => {
    const related = findings.filter(
      (f) => f.storyRefs.includes(story.id) || (f.target.kind === 'story' && f.target.id === story.id),
    );
    const errors = related.filter((f) => f.severity === 'error').length;
    const warnings = related.filter((f) => f.severity === 'warning').length;
    const status = errors > 0 ? 'non-compliant' : warnings > 0 ? 'needs-attention' : 'compliant';
    return { storyId: story.id, errors, warnings, status };
  });
}

export function toCatalog<C>(
  rules: readonly RuleDefinition<C>[],
  scope: RuleCatalogEntry['scope'],
): RuleCatalogEntry[] {
  return rules.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    severity: r.severity,
    rationale: r.rationale,
    scope,
  }));
}

/** Strips a module qualifier: "Sales.Order" → "Order". */
export function bareName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(dot + 1);
}
