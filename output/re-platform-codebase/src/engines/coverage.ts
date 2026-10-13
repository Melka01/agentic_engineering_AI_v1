/**
 * Traceability between the backlog and the blueprint (both paradigms).
 */
import type { UserStory } from '../shared/domain.js';
import type { Design } from '../shared/session.js';
import type { RuleDefinition } from './types.js';

export interface CoverageContext {
  readonly stories: readonly UserStory[];
  readonly design: Design;
}

/** All story ids referenced anywhere in a design. */
export function collectStoryRefs(design: Design): Set<string> {
  const refs = new Set<string>();
  const add = (list: readonly string[]) => {
    for (const r of list) refs.add(r);
  };
  if (design.paradigm === 'mendix') {
    for (const m of design.modules) {
      for (const e of m.entities) add(e.storyRefs);
      for (const f of m.microflows) add(f.storyRefs);
      for (const f of m.nanoflows) add(f.storyRefs);
      for (const p of m.pages) add(p.storyRefs);
    }
  } else {
    for (const m of design.modules) {
      for (const e of m.entities) add(e.storyRefs);
      for (const a of m.actions) add(a.storyRefs);
      for (const q of m.queries) add(q.storyRefs);
      for (const s of m.screens) add(s.storyRefs);
    }
  }
  return refs;
}

export const COVERAGE_RULES: readonly RuleDefinition<CoverageContext>[] = [
  {
    id: 'RE-COV-001',
    title: 'Every story is realised in the blueprint',
    category: 'traceability',
    severity: 'warning',
    rationale: 'Stories without a design element are silently dropped from delivery.',
    evaluate: (ctx) => {
      const refs = collectStoryRefs(ctx.design);
      return ctx.stories
        .filter((s) => s.priority !== 'wont' && !refs.has(s.id))
        .map((s) => ({
          message: `Story ${s.id} ("${s.title}") is not referenced by any design element.`,
          target: { kind: 'story' as const, id: s.id },
          remediation: 'Add the screens/pages, logic and data needed to deliver the story to the blueprint.',
          storyRefs: [s.id],
        }));
    },
  },
  {
    id: 'RE-COV-002',
    title: 'Design elements trace to known stories',
    category: 'traceability',
    severity: 'warning',
    rationale: 'References to unknown stories indicate scope creep or stale traceability.',
    evaluate: (ctx) => {
      const known = new Set(ctx.stories.map((s) => s.id));
      return [...collectStoryRefs(ctx.design)]
        .filter((ref) => !known.has(ref))
        .map((ref) => ({
          message: `The blueprint references unknown story ${ref}.`,
          target: { kind: 'project' as const, id: `story-ref:${ref}` },
          remediation: 'Remove the reference or add the story to the backlog.',
        }));
    },
  },
];
