/**
 * Paradigm-independent user-story quality rules (INVEST + testability).
 */
import type { NonFunctionalRequirement, Paradigm, UserStory } from '../shared/domain.js';
import type { FindingDraft, RuleDefinition } from './types.js';

export interface StoryContext {
  readonly paradigm: Paradigm;
  readonly stories: readonly UserStory[];
  readonly nfrs: readonly NonFunctionalRequirement[];
}

export const AMBIGUOUS_TERMS = [
  'fast',
  'quick',
  'quickly',
  'easy',
  'easily',
  'simple',
  'user-friendly',
  'user friendly',
  'intuitive',
  'flexible',
  'robust',
  'efficient',
  'seamless',
  'seamlessly',
  'appropriate',
  'adequate',
  'as needed',
  'as appropriate',
  'etc',
  'and/or',
  'tbd',
  'state-of-the-art',
  'optimal',
  'several',
  'various',
] as const;

const FIBONACCI = new Set([1, 2, 3, 5, 8, 13, 21]);
const GENERIC_ROLES = new Set(['user', 'users', 'system', 'the system', 'someone', 'person', 'actor']);
const SOLUTION_TERMS =
  /\b(microflows?|nanoflows?|xpath|aggregates?|advanced sql|sql|database tables?|tables?|entit(?:y|ies)|rest endpoints?|api endpoints?|json|stored procedures?)\b/i;

export function findAmbiguousTerms(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  return AMBIGUOUS_TERMS.filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(lower);
  });
}

const storyTarget = (s: UserStory) => ({ kind: 'story' as const, id: s.id });
const each = (fn: (s: UserStory, ctx: StoryContext) => FindingDraft[]) => (ctx: StoryContext) =>
  ctx.stories.flatMap((s) => fn(s, ctx));

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const STORY_RULES: readonly RuleDefinition<StoryContext>[] = [
  {
    id: 'RE-US-001',
    title: 'Story states role, goal and benefit',
    category: 'story-quality',
    severity: 'error',
    rationale: 'A story without a role, goal or benefit cannot be prioritised or validated against user value.',
    evaluate: each((s) => {
      const missing = (['role', 'goal', 'benefit'] as const).filter((f) => s[f].trim().length === 0);
      return missing.length === 0
        ? []
        : [
            {
              message: `Story ${s.id} is missing: ${missing.join(', ')}.`,
              target: storyTarget(s),
              remediation: 'Write it as "As a <role>, I want <goal>, so that <benefit>".',
              storyRefs: [s.id],
            },
          ];
    }),
  },
  {
    id: 'RE-US-002',
    title: 'Story has testable acceptance criteria',
    category: 'story-quality',
    severity: 'error',
    rationale: 'Acceptance criteria in Given/When/Then form make the story testable (INVEST: Testable).',
    evaluate: each((s) => {
      if (s.acceptanceCriteria.length === 0) {
        return [
          {
            message: `Story ${s.id} has no acceptance criteria.`,
            target: storyTarget(s),
            remediation: 'Add at least two Given/When/Then criteria covering the happy path and a failure path.',
            storyRefs: [s.id],
          },
        ];
      }
      const incomplete = s.acceptanceCriteria.filter((ac) => [ac.given, ac.when, ac.then].some((p) => p.trim() === ''));
      return incomplete.length === 0
        ? []
        : [
            {
              message: `Story ${s.id} has ${incomplete.length} acceptance criteria with an empty Given/When/Then part.`,
              target: storyTarget(s),
              remediation: 'Complete every Given, When and Then clause.',
              storyRefs: [s.id],
            },
          ];
    }),
  },
  {
    id: 'RE-US-003',
    title: 'Avoid ambiguous wording',
    category: 'story-quality',
    severity: 'warning',
    rationale: 'Words like "fast" or "user-friendly" are untestable; quantify them as NFRs or acceptance criteria.',
    evaluate: each((s) => {
      const text = [s.goal, s.benefit, ...s.acceptanceCriteria.flatMap((ac) => [ac.given, ac.when, ac.then])].join(' ');
      const terms = findAmbiguousTerms(text);
      return terms.length === 0
        ? []
        : [
            {
              message: `Story ${s.id} uses ambiguous terms: ${terms.join(', ')}.`,
              target: storyTarget(s),
              remediation: 'Replace them with measurable criteria or reference a measurable NFR.',
              storyRefs: [s.id],
            },
          ];
    }),
  },
  {
    id: 'RE-US-004',
    title: 'Stories are small',
    category: 'story-quality',
    severity: 'warning',
    rationale: 'Stories above 8 points rarely fit a sprint and hide unknowns (INVEST: Small).',
    evaluate: each((s) => {
      if (s.storyPoints === null) return [];
      if (s.storyPoints > 8) {
        return [
          {
            message: `Story ${s.id} is estimated at ${s.storyPoints} points.`,
            target: storyTarget(s),
            remediation: 'Split it by workflow step, data variation or business rule.',
            storyRefs: [s.id],
          },
        ];
      }
      return FIBONACCI.has(s.storyPoints)
        ? []
        : [
            {
              message: `Story ${s.id} uses a non-Fibonacci estimate (${s.storyPoints}).`,
              target: storyTarget(s),
              remediation: 'Use the Fibonacci scale (1, 2, 3, 5, 8, 13).',
              storyRefs: [s.id],
              severity: 'info',
            },
          ];
    }),
  },
  {
    id: 'RE-US-005',
    title: 'Limit acceptance criteria per story',
    category: 'story-quality',
    severity: 'warning',
    rationale: 'More than eight acceptance criteria usually means the story covers several capabilities.',
    evaluate: each((s) =>
      s.acceptanceCriteria.length > 8
        ? [
            {
              message: `Story ${s.id} has ${s.acceptanceCriteria.length} acceptance criteria.`,
              target: storyTarget(s),
              remediation: 'Split the story so each one has a focused set of criteria.',
              storyRefs: [s.id],
            },
          ]
        : [],
    ),
  },
  {
    id: 'RE-US-006',
    title: 'No duplicate stories',
    category: 'story-quality',
    severity: 'warning',
    rationale: 'Duplicated stories break independence and double-count scope (INVEST: Independent).',
    evaluate: (ctx) => {
      const seen = new Map<string, string>();
      const findings: FindingDraft[] = [];
      for (const s of ctx.stories) {
        const key = `${normalise(s.role)}|${normalise(s.goal)}`;
        const first = seen.get(key);
        if (first === undefined) seen.set(key, s.id);
        else
          findings.push({
            message: `Story ${s.id} duplicates ${first} (same role and goal).`,
            target: storyTarget(s),
            remediation: `Merge ${s.id} into ${first} or differentiate the goal.`,
            storyRefs: [s.id, first],
          });
      }
      return findings;
    },
  },
  {
    id: 'RE-US-007',
    title: 'NFR references must resolve',
    category: 'story-quality',
    severity: 'error',
    rationale: 'A story that cites a non-existent NFR has an unverifiable quality constraint.',
    evaluate: each((s, ctx) => {
      const known = new Set(ctx.nfrs.map((n) => n.id));
      const unknown = s.nfrRefs.filter((r) => !known.has(r));
      return unknown.length === 0
        ? []
        : [
            {
              message: `Story ${s.id} references unknown NFR(s): ${unknown.join(', ')}.`,
              target: storyTarget(s),
              remediation: 'Fix the reference or add the missing NFR.',
              storyRefs: [s.id],
            },
          ];
    }),
  },
  {
    id: 'RE-US-008',
    title: 'Name a concrete persona',
    category: 'story-quality',
    severity: 'info',
    rationale: 'Generic roles ("user", "system") hide who benefits and which security role is needed.',
    evaluate: each((s) =>
      GENERIC_ROLES.has(s.role.trim().toLowerCase())
        ? [
            {
              message: `Story ${s.id} uses the generic role "${s.role}".`,
              target: storyTarget(s),
              remediation: 'Name the persona (e.g. "claims approver") — it also drives the user-role model.',
              storyRefs: [s.id],
            },
          ]
        : [],
    ),
  },
  {
    id: 'RE-US-009',
    title: 'Benefit expresses value',
    category: 'story-quality',
    severity: 'warning',
    rationale:
      'A benefit that repeats the goal or is a single word gives no basis for prioritisation (INVEST: Valuable).',
    evaluate: each((s) => {
      const benefit = normalise(s.benefit);
      if (benefit.length === 0) return []; // covered by RE-US-001
      const restates = benefit === normalise(s.goal);
      const tooShort = benefit.split(' ').length < 3;
      return restates || tooShort
        ? [
            {
              message: `Story ${s.id} has a weak benefit ("${s.benefit}").`,
              target: storyTarget(s),
              remediation: 'State the business outcome the goal enables.',
              storyRefs: [s.id],
            },
          ]
        : [];
    }),
  },
  {
    id: 'RE-US-010',
    title: 'Story ids are unique',
    category: 'story-quality',
    severity: 'error',
    rationale: 'Duplicate ids break traceability from requirements to design and tests.',
    evaluate: (ctx) => {
      const counts = new Map<string, number>();
      for (const s of ctx.stories) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
      return [...counts]
        .filter(([, n]) => n > 1)
        .map(([id, n]) => ({
          message: `Story id ${id} is used ${n} times.`,
          target: { kind: 'story' as const, id },
          remediation: 'Give every story a unique id.',
          storyRefs: [id],
        }));
    },
  },
  {
    id: 'RE-US-011',
    title: 'Stories are estimated',
    category: 'story-quality',
    severity: 'info',
    rationale: 'Unestimated stories cannot be planned (INVEST: Estimable).',
    evaluate: each((s) =>
      s.storyPoints === null
        ? [
            {
              message: `Story ${s.id} has no estimate.`,
              target: storyTarget(s),
              remediation: 'Estimate with the team in story points.',
              storyRefs: [s.id],
            },
          ]
        : [],
    ),
  },
  {
    id: 'RE-US-012',
    title: 'Stories describe needs, not low-code solutions',
    category: 'story-quality',
    severity: 'warning',
    rationale:
      'Naming microflows, aggregates, tables or SQL in a story fixes the solution too early (INVEST: Negotiable); keep design in the blueprint.',
    evaluate: each((s, ctx) => {
      const match = SOLUTION_TERMS.exec(`${s.goal} ${s.benefit}`);
      return match === null
        ? []
        : [
            {
              message: `Story ${s.id} prescribes implementation ("${match[0]}") instead of a user need.`,
              target: storyTarget(s),
              remediation: `Rephrase in business terms; the ${ctx.paradigm === 'mendix' ? 'Mendix' : 'OutSystems'} blueprint decides the implementation.`,
              storyRefs: [s.id],
            },
          ];
    }),
  },
];
