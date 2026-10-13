/**
 * Normalises agent output into canonical session data: sequential ids,
 * remapped references, trimmed text and lowercase tags. Unknown references are
 * preserved verbatim so the rule engine can report them (RE-US-007).
 */
import type { StoryGenerationOutput } from '../agents/schemas.js';
import { formatId } from './story-extractor.js';

export function normalizeBacklog(output: StoryGenerationOutput): StoryGenerationOutput {
  const nfrIdMap = new Map<string, string>();
  const nfrs = output.nfrs.map((n, i) => {
    const id = formatId('NFR', i + 1);
    if (!nfrIdMap.has(n.id)) nfrIdMap.set(n.id, id);
    return { ...n, id, statement: n.statement.trim() };
  });
  const stories = output.stories.map((s, i) => ({
    ...s,
    id: formatId('US', i + 1),
    title: s.title.trim(),
    role: s.role.trim(),
    goal: s.goal.trim(),
    benefit: s.benefit.trim(),
    acceptanceCriteria: s.acceptanceCriteria.map((ac) => ({
      given: ac.given.trim(),
      when: ac.when.trim(),
      then: ac.then.trim(),
    })),
    nfrRefs: [...new Set(s.nfrRefs.map((ref) => nfrIdMap.get(ref) ?? ref))],
    tags: [...new Set(s.tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))],
  }));
  return { stories, nfrs };
}
