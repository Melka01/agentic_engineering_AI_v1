/**
 * Risk assessment: a deterministic risk register derived from rule-engine
 * findings, NFR analysis and backlog shape, optionally enriched with
 * agent-identified risks (deduplicated, clamped and normalised).
 */
import type { RiskDraft } from '../agents/schemas.js';
import type {
  Finding,
  NonFunctionalRequirement,
  Paradigm,
  Risk,
  RiskCategory,
  RiskLevel,
  UserStory,
} from '../shared/domain.js';
import { PARADIGM_DESCRIPTORS } from '../shared/paradigms.js';
import { formatId } from './story-extractor.js';
import { similarity } from './text.js';

export interface RiskInput {
  readonly paradigm: Paradigm;
  readonly stories: readonly UserStory[];
  readonly nfrs: readonly NonFunctionalRequirement[];
  readonly findings: readonly Finding[];
}

type RiskSeed = Omit<Risk, 'id' | 'score' | 'level'>;

interface FindingGroupProfile {
  readonly category: RiskCategory;
  readonly impact: number;
  readonly title: string;
  readonly mitigation: string;
}

const FINDING_GROUPS: Readonly<Record<string, FindingGroupProfile>> = {
  'architecture-layers': {
    category: 'architecture',
    impact: 4,
    title: 'Architecture layering violations',
    mitigation: 'Fix layer violations before build starts; add Discovery/architecture checks to the CI pipeline.',
  },
  dependencies: {
    category: 'architecture',
    impact: 5,
    title: 'Circular module dependencies',
    mitigation: 'Break cycles by extracting shared elements into lower-layer modules; gate merges on an acyclic graph.',
  },
  encapsulation: {
    category: 'architecture',
    impact: 3,
    title: 'Weak module encapsulation',
    mitigation:
      'Expose entities read-only, route writes through wrapper actions and keep end-user modules consumer-only.',
  },
  'domain-model': {
    category: 'data',
    impact: 3,
    title: 'Domain model polluted with view state',
    mitigation: 'Introduce non-persistable view models and keep persisted entities business-only.',
  },
  'round-trips': {
    category: 'performance',
    impact: 3,
    title: 'Excessive client–server round trips',
    mitigation: 'Move client-only logic to nanoflows and combine server calls per user action.',
  },
  'microflow-complexity': {
    category: 'quality',
    impact: 3,
    title: 'Complex or loop-heavy server logic',
    mitigation: 'Split flows, remove commits/retrieves in loops and add unit tests for extracted sub-flows.',
  },
  xpath: {
    category: 'performance',
    impact: 4,
    title: 'Inefficient XPath data retrieval',
    mitigation: 'Add indexes, shorten association paths and remove negations before data volumes grow.',
  },
  'data-access': {
    category: 'performance',
    impact: 4,
    title: 'Inefficient or unsafe data access',
    mitigation: 'Use paginated aggregates, eliminate queries in loops and justify/parameterise any SQL.',
  },
  offline: {
    category: 'delivery',
    impact: 4,
    title: 'Offline requirements not supported by the design',
    mitigation: 'Design offline pages over synchronised data and test sync conflicts early.',
  },
  'async-processing': {
    category: 'performance',
    impact: 3,
    title: 'Bulk work executed synchronously',
    mitigation: 'Move bulk processing to scheduled/timer jobs with batching and checkpoints.',
  },
  'model-integrity': {
    category: 'quality',
    impact: 4,
    title: 'Inconsistent blueprint (dangling references)',
    mitigation: 'Resolve every dangling reference before handing the blueprint to developers.',
  },
  'story-quality': {
    category: 'delivery',
    impact: 3,
    title: 'Backlog quality gaps (INVEST)',
    mitigation: 'Refine stories with the product owner: clear value, testable criteria, right size.',
  },
  'nfr-quality': {
    category: 'quality',
    impact: 3,
    title: 'Unverifiable non-functional requirements',
    mitigation: 'Make every quality attribute measurable and assign a verification method and owner.',
  },
  traceability: {
    category: 'delivery',
    impact: 3,
    title: 'Stories not traced to the blueprint',
    mitigation: 'Map every story to design elements and keep the traceability current.',
  },
};

export function riskLevel(score: number): RiskLevel {
  if (score >= 20) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

export function assessRisks(input: RiskInput): RiskSeed[] {
  const seeds: RiskSeed[] = [];
  const platform = PARADIGM_DESCRIPTORS[input.paradigm].name;

  // 1. Rule-engine findings, grouped per category.
  const byCategory = new Map<string, Finding[]>();
  for (const f of input.findings) {
    if (f.severity === 'info') continue;
    byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f]);
  }
  for (const [category, findings] of byCategory) {
    const profile = FINDING_GROUPS[category];
    if (profile === undefined) continue;
    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.length - errors;
    seeds.push({
      title: profile.title,
      description: `${errors} error and ${warnings} warning finding(s) in "${category}" against ${platform} best practices.`,
      category: profile.category,
      likelihood: clamp(errors > 0 ? 2 + errors : 1 + Math.ceil(warnings / 2)),
      impact: errors > 0 ? profile.impact : clamp(profile.impact - 1),
      mitigation: profile.mitigation,
      sourceRefs: [...new Set(findings.map((f) => f.ruleId))],
      origin: 'rule-engine',
    });
  }
  if (input.findings.some((f) => f.ruleId === 'OS-DATA-002')) {
    seeds.push({
      title: 'SQL injection exposure',
      description: 'Advanced SQL uses Expand Inline parameters.',
      category: 'security',
      likelihood: 4,
      impact: 5,
      mitigation: 'Replace Expand Inline with bound parameters and add a security review gate.',
      sourceRefs: ['OS-DATA-002'],
      origin: 'rule-engine',
    });
  }

  // 2. NFR analysis.
  const has = (c: NonFunctionalRequirement['category']) => input.nfrs.some((n) => n.category === c);
  if (!has('security')) {
    seeds.push({
      title: 'Security requirements undefined',
      description: 'No security NFR was specified; access control, data protection and audit needs are implicit.',
      category: 'security',
      likelihood: 3,
      impact: 4,
      mitigation: 'Run a threat-modelling session and define authentication, authorisation and data-protection NFRs.',
      sourceRefs: ['RE-NFR-004'],
      origin: 'nfr-analysis',
    });
  }
  const highAvailability = input.findings.filter((f) => f.ruleId === 'RE-NFR-006');
  if (highAvailability.length > 0) {
    seeds.push({
      title: 'Availability target beyond standard managed tiers',
      description: `Availability target exceeds the standard ${platform} cloud tier assumption.`,
      category: 'compliance',
      likelihood: 3,
      impact: 4,
      mitigation: `Confirm ${platform} high-availability options and SLA contractually before committing to the target.`,
      sourceRefs: highAvailability.map((f) => f.target.id),
      origin: 'nfr-analysis',
    });
  }
  const unmeasurable = input.findings.filter((f) => f.ruleId === 'RE-NFR-001');
  if (unmeasurable.length > 0) {
    seeds.push({
      title: 'Performance acceptance cannot be proven',
      description: `${unmeasurable.length} quality attribute(s) lack measurable targets.`,
      category: 'performance',
      likelihood: 4,
      impact: 3,
      mitigation: 'Agree measurable targets and add load tests to the definition of done.',
      sourceRefs: unmeasurable.map((f) => f.target.id),
      origin: 'nfr-analysis',
    });
  }
  const compliance = input.nfrs.filter((n) => n.category === 'compliance');
  if (compliance.length > 0) {
    seeds.push({
      title: 'Regulatory compliance obligations',
      description: 'Compliance NFRs (e.g. GDPR) impose data residency, retention and audit obligations.',
      category: 'compliance',
      likelihood: 2,
      impact: 4,
      mitigation: `Select a compliant ${platform} cloud region, define retention policies and log personal-data access.`,
      sourceRefs: compliance.map((n) => n.id),
      origin: 'nfr-analysis',
    });
  }

  // 3. Backlog shape.
  const systems = [
    ...new Set(
      input.stories.flatMap((s) => s.tags.filter((t) => t.startsWith('integration:')).map((t) => t.slice(12))),
    ),
  ];
  if (systems.length > 0) {
    const refs = input.stories.filter((s) => s.tags.some((t) => t.startsWith('integration:'))).map((s) => s.id);
    seeds.push({
      title: 'External system dependencies',
      description: `Delivery depends on ${systems.length} external system(s): ${systems.join(', ')}.`,
      category: 'integration',
      likelihood: clamp(2 + systems.length),
      impact: 4,
      mitigation:
        'Agree API contracts early, build connectors against mocks, add contract tests and error handling/retries.',
      sourceRefs: refs,
      origin: 'story-analysis',
    });
  }
  const large = input.stories.filter((s) => (s.storyPoints ?? 0) >= 13);
  if (large.length > 0) {
    seeds.push({
      title: 'Oversized stories threaten sprint predictability',
      description: `${large.length} story(ies) are estimated at 13 points or more.`,
      category: 'delivery',
      likelihood: 4,
      impact: 3,
      mitigation: 'Split large stories before sprint planning.',
      sourceRefs: large.map((s) => s.id),
      origin: 'story-analysis',
    });
  }
  const offline = input.stories.filter((s) => s.tags.includes('offline'));
  if (offline.length > 0) {
    seeds.push({
      title: 'Offline synchronisation conflicts',
      description: 'Offline-capable stories introduce data synchronisation and conflict-resolution complexity.',
      category: 'data',
      likelihood: 3,
      impact: 3,
      mitigation: 'Define sync scope and conflict rules up front; test with realistic offline scenarios.',
      sourceRefs: offline.map((s) => s.id),
      origin: 'story-analysis',
    });
  }
  return seeds;
}

/** Clamps, normalises and deduplicates agent risks against the deterministic register. */
export function mergeAgentRisks(base: readonly RiskSeed[], agentRisks: readonly RiskDraft[], max = 6): RiskSeed[] {
  const merged = [...base];
  let added = 0;
  for (const draft of agentRisks) {
    if (added >= max) break;
    if (draft.title.trim().length === 0) continue;
    if (merged.some((r) => similarity(r.title, draft.title) >= 0.5)) continue;
    merged.push({
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      likelihood: clamp(draft.likelihood),
      impact: clamp(draft.impact),
      mitigation: draft.mitigation.trim(),
      sourceRefs: draft.sourceRefs,
      origin: 'agent',
    });
    added += 1;
  }
  return merged;
}

/** Scores, levels, sorts (highest first) and numbers the register. */
export function finaliseRisks(seeds: readonly RiskSeed[]): Risk[] {
  return seeds
    .map((seed) => {
      const score = seed.likelihood * seed.impact;
      return { ...seed, score, level: riskLevel(score) };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .map((risk, i) => ({ id: formatId('RISK', i + 1), ...risk }));
}
