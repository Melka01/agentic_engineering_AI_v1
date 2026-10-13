/**
 * Non-functional requirement validation: measurability, coverage, conflicts
 * and platform feasibility for the selected paradigm.
 */
import type { Comparator, NfrCategory, NonFunctionalRequirement, Paradigm, UserStory } from '../shared/domain.js';
import { findAmbiguousTerms } from './story-rules.js';
import type { FindingDraft, RuleDefinition } from './types.js';

export interface PlatformProfile {
  readonly label: string;
  /**
   * Highest availability (%) assumed achievable on the vendor's standard managed
   * cloud tiers. An assumption to verify against the actual contract.
   */
  readonly managedAvailabilityCeiling: number;
  readonly fastResponseGuidance: string;
}

export const PLATFORM_PROFILES: Readonly<Record<Paradigm, PlatformProfile>> = {
  mendix: {
    label: 'Mendix Cloud',
    managedAvailabilityCeiling: 99.95,
    fastResponseGuidance:
      'Meet it with nanoflows for client-side logic, one microflow call per action, indexed shallow XPath and load tests on a production-sized cloud node.',
  },
  outsystems: {
    label: 'OutSystems Cloud',
    managedAvailabilityCeiling: 99.95,
    fastResponseGuidance:
      'Meet it with paginated aggregates, on-demand data fetching, async timers for heavy work and load tests on a production-sized environment.',
  },
};

export interface NfrContext {
  readonly paradigm: Paradigm;
  readonly nfrs: readonly NonFunctionalRequirement[];
  readonly stories: readonly UserStory[];
  readonly profile: PlatformProfile;
}

const MEASURABLE_CATEGORIES: ReadonlySet<NfrCategory> = new Set([
  'performance',
  'scalability',
  'availability',
  'reliability',
]);
const REQUIRED_CATEGORIES: readonly NfrCategory[] = ['security', 'performance', 'availability'];

const nfrTarget = (n: NonFunctionalRequirement) => ({ kind: 'nfr' as const, id: n.id });
const normaliseMetric = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/** Interval of values a comparator allows, used for conflict detection. */
function interval(comparator: Comparator, target: number): [number, number, boolean, boolean] {
  switch (comparator) {
    case '<=':
      return [Number.NEGATIVE_INFINITY, target, false, true];
    case '<':
      return [Number.NEGATIVE_INFINITY, target, false, false];
    case '>=':
      return [target, Number.POSITIVE_INFINITY, true, false];
    case '>':
      return [target, Number.POSITIVE_INFINITY, false, false];
    case '=':
      return [target, target, true, true];
  }
}

const TIME_UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, sec: 1_000, min: 60_000, h: 3_600_000 };

/** Brings time metrics to milliseconds so "≤ 2 s" and "≥ 5000 ms" compare; other units must match exactly. */
function toComparable(n: NonFunctionalRequirement): NonFunctionalRequirement | null {
  if (n.metric === null) return null;
  const factor = TIME_UNIT_MS[n.metric.unit.toLowerCase()];
  if (factor === undefined) return { ...n, metric: { ...n.metric, unit: n.metric.unit.toLowerCase() } };
  return { ...n, metric: { ...n.metric, target: n.metric.target * factor, unit: 'ms' } };
}

function intervalsOverlap(a: NonFunctionalRequirement, b: NonFunctionalRequirement): boolean {
  if (a.metric === null || b.metric === null) return true;
  if (a.metric.unit !== b.metric.unit) return true; // incomparable units cannot be proven to conflict
  const [aLo, aHi, aLoIn, aHiIn] = interval(a.metric.comparator, a.metric.target);
  const [bLo, bHi, bLoIn, bHiIn] = interval(b.metric.comparator, b.metric.target);
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  if (lo < hi) return true;
  if (lo > hi) return false;
  const loIncluded = (lo === aLo ? aLoIn : true) && (lo === bLo ? bLoIn : true);
  const hiIncluded = (hi === aHi ? aHiIn : true) && (hi === bHi ? bHiIn : true);
  return loIncluded && hiIncluded;
}

export const NFR_RULES: readonly RuleDefinition<NfrContext>[] = [
  {
    id: 'RE-NFR-001',
    title: 'Quality attributes are measurable',
    category: 'nfr-quality',
    severity: 'error',
    rationale: 'Performance, scalability, availability and reliability NFRs need a metric and target to be verifiable.',
    evaluate: (ctx) =>
      ctx.nfrs
        .filter((n) => MEASURABLE_CATEGORIES.has(n.category) && n.metric === null)
        .map((n) => ({
          message: `${n.category} NFR ${n.id} has no measurable metric.`,
          target: nfrTarget(n),
          remediation: 'Add a metric, e.g. "95th percentile page load ≤ 2 s at 200 concurrent users".',
        })),
  },
  {
    id: 'RE-NFR-002',
    title: 'NFRs declare a verification method',
    category: 'nfr-quality',
    severity: 'warning',
    rationale: 'Without a verification method nobody owns proving the requirement.',
    evaluate: (ctx) =>
      ctx.nfrs
        .filter((n) => n.verificationMethod === null)
        .map((n) => ({
          message: `NFR ${n.id} has no verification method.`,
          target: nfrTarget(n),
          remediation: 'Choose test, analysis, inspection or demonstration and plan it.',
        })),
  },
  {
    id: 'RE-NFR-003',
    title: 'NFRs avoid ambiguous wording',
    category: 'nfr-quality',
    severity: 'warning',
    rationale: 'Unquantified adjectives make NFRs impossible to accept or reject.',
    evaluate: (ctx) =>
      ctx.nfrs
        .filter((n) => n.metric === null)
        .flatMap((n) => {
          const terms = findAmbiguousTerms(n.statement);
          return terms.length === 0
            ? []
            : [
                {
                  message: `NFR ${n.id} uses ambiguous terms without a metric: ${terms.join(', ')}.`,
                  target: nfrTarget(n),
                  remediation: 'Quantify the requirement or describe a concrete acceptance check.',
                },
              ];
        }),
  },
  {
    id: 'RE-NFR-004',
    title: 'Core quality attributes are covered',
    category: 'nfr-quality',
    severity: 'warning',
    rationale: 'Every production system needs explicit security, performance and availability requirements.',
    evaluate: (ctx) =>
      REQUIRED_CATEGORIES.filter((c) => !ctx.nfrs.some((n) => n.category === c)).map((c) => ({
        message: `No ${c} NFR has been specified.`,
        target: { kind: 'project' as const, id: `nfr-coverage:${c}` },
        remediation: `Elicit a measurable ${c} requirement with the stakeholders.`,
      })),
  },
  {
    id: 'RE-NFR-005',
    title: 'NFRs do not conflict',
    category: 'nfr-quality',
    severity: 'error',
    rationale: 'Two targets for the same metric that cannot both hold make acceptance impossible.',
    evaluate: (ctx) => {
      const findings: FindingDraft[] = [];
      const withMetric = ctx.nfrs.filter((n) => n.metric !== null);
      for (let i = 0; i < withMetric.length; i += 1) {
        for (let j = i + 1; j < withMetric.length; j += 1) {
          const a = withMetric[i];
          const b = withMetric[j];
          if (a?.metric == null || b?.metric == null) continue;
          if (normaliseMetric(a.metric.name) !== normaliseMetric(b.metric.name)) continue;
          const left = toComparable(a);
          const right = toComparable(b);
          if (left === null || right === null) continue;
          if (!intervalsOverlap(left, right)) {
            findings.push({
              message: `NFR ${a.id} (${a.metric.comparator} ${a.metric.target} ${a.metric.unit}) conflicts with ${b.id} (${b.metric.comparator} ${b.metric.target} ${b.metric.unit}).`,
              target: nfrTarget(b),
              remediation: 'Agree on one target with the stakeholders and remove the other.',
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'RE-NFR-006',
    title: 'Availability is feasible on the managed platform',
    category: 'nfr-feasibility',
    severity: 'warning',
    rationale:
      'Targets above the highest standard managed-cloud tier need a high-availability / multi-region setup and contract verification.',
    evaluate: (ctx) =>
      ctx.nfrs
        .filter(
          (n) =>
            n.category === 'availability' &&
            n.metric !== null &&
            n.metric.unit.includes('%') &&
            n.metric.target > ctx.profile.managedAvailabilityCeiling,
        )
        .map((n) => ({
          message: `NFR ${n.id} targets ${n.metric?.target}% availability, above the ${ctx.profile.managedAvailabilityCeiling}% assumed for standard ${ctx.profile.label} tiers.`,
          target: nfrTarget(n),
          remediation: `Confirm the ${ctx.profile.label} tier/SLA (high-availability or private cloud) or renegotiate the target; budget for multi-region failover.`,
        })),
  },
  {
    id: 'RE-NFR-007',
    title: 'Metric targets are plausible',
    category: 'nfr-quality',
    severity: 'error',
    rationale: 'Negative durations or percentages above 100 indicate a specification error.',
    evaluate: (ctx) =>
      ctx.nfrs.flatMap((n) => {
        if (n.metric === null) return [];
        const percent = n.metric.unit.includes('%');
        const bad = (percent && (n.metric.target < 0 || n.metric.target > 100)) || (!percent && n.metric.target < 0);
        return bad
          ? [
              {
                message: `NFR ${n.id} has an implausible target (${n.metric.target} ${n.metric.unit}).`,
                target: nfrTarget(n),
                remediation: 'Correct the target value or unit.',
              },
            ]
          : [];
      }),
  },
  {
    id: 'RE-NFR-008',
    title: 'Tight response-time targets have a platform strategy',
    category: 'nfr-feasibility',
    severity: 'info',
    rationale: 'Sub-second targets are achievable on low-code platforms only with deliberate client/server design.',
    evaluate: (ctx) =>
      ctx.nfrs
        .filter((n) => {
          if (n.category !== 'performance' || n.metric === null) return false;
          const unit = n.metric.unit.toLowerCase();
          const ms = unit === 'ms' ? n.metric.target : unit === 's' ? n.metric.target * 1000 : Number.POSITIVE_INFINITY;
          return ms < 1000;
        })
        .map((n) => ({
          message: `NFR ${n.id} sets a sub-second target (${n.metric?.target} ${n.metric?.unit}).`,
          target: nfrTarget(n),
          remediation: ctx.profile.fastResponseGuidance,
        })),
  },
  {
    id: 'RE-NFR-009',
    title: 'NFR ids are unique',
    category: 'nfr-quality',
    severity: 'error',
    rationale: 'Duplicate NFR ids break traceability from stories to quality constraints.',
    evaluate: (ctx) => {
      const counts = new Map<string, number>();
      for (const n of ctx.nfrs) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
      return [...counts]
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({
          message: `NFR id ${id} is used ${count} times.`,
          target: { kind: 'nfr' as const, id },
          remediation: 'Give every NFR a unique id.',
        }));
    },
  },
];
