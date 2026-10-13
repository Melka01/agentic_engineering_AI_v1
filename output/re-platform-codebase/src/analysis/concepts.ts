/**
 * Derives business concepts (candidate entities) from user-story goals, e.g.
 * "submit expense claims with receipts" → verb "submit" (create), concept "ExpenseClaim".
 */
import type { UserStory } from '../shared/domain.js';
import { PHRASE_BREAKERS, STOP_WORDS, type VerbClass, verbClassOf } from './lexicon.js';
import { pascalCase, singularize } from './text.js';

export interface ObjectPhrase {
  readonly verb: string;
  readonly verbClass: VerbClass;
  /** Lowercase singular noun phrase, e.g. "expense claim"; null when none was found. */
  readonly object: string | null;
}

const CONTAINER_NOUNS = new Set([
  'list',
  'overview',
  'summary',
  'history',
  'number',
  'set',
  'collection',
  'total',
  'details',
  'status',
  'copy',
  'batch',
  'report',
  'dashboard',
  'export',
  'view',
]);
const PRONOUNS = new Set(['me', 'them', 'it', 'us', 'i', 'him', 'her', 'you', 'everyone', 'others']);
const FILLER = new Set(['be', 'able', 'to', 'also', 'easily', 'quickly', 'directly', 'automatically', 'always']);

export function extractObjectPhrase(goal: string): ObjectPhrase {
  const tokens = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  let i = 0;
  while (i < tokens.length && (FILLER.has(tokens[i] ?? '') || (tokens[i] ?? '').endsWith('ly'))) i += 1;
  const verb = tokens[i] ?? '';
  i += 1;

  const collect = (start: number): { words: string[]; next: number } => {
    const words: string[] = [];
    let j = start;
    while (j < tokens.length && words.length < 3) {
      const t = tokens[j] ?? '';
      if (PHRASE_BREAKERS.has(t)) break;
      if (!STOP_WORDS.has(t) && !PRONOUNS.has(t) && !/^\d+$/.test(t) && !t.endsWith('ly')) words.push(t);
      j += 1;
    }
    return { words, next: j };
  };

  let { words, next } = collect(i);
  if (words.length === 1 && CONTAINER_NOUNS.has(words[0] ?? '') && tokens[next] === 'of') {
    ({ words } = collect(next + 1));
  }
  if (words.length === 0) return { verb, verbClass: verbClassOf(verb), object: null };
  const last = words.length - 1;
  const singular = words.map((w, k) => (k === last ? singularize(w) : w));
  return { verb, verbClass: verbClassOf(verb), object: singular.join(' ') };
}

export interface Concept {
  /** PascalCase entity name, e.g. "ExpenseClaim". */
  readonly name: string;
  /** Human label, e.g. "expense claim". */
  readonly label: string;
  readonly storyIds: string[];
  readonly verbs: Set<VerbClass>;
  readonly storiesByVerb: Map<VerbClass, string[]>;
  offline: boolean;
  bulk: boolean;
  readonly integrations: Set<string>;
}

export interface ConceptModel {
  readonly concepts: Concept[];
  readonly roles: string[];
  readonly integrations: string[];
}

const MAX_CONCEPTS = 10;
const GENERIC_CONCEPT = 'WorkItem';

export function deriveConcepts(stories: readonly UserStory[]): ConceptModel {
  const byName = new Map<string, Concept>();
  const pending: { story: UserStory; phrase: ObjectPhrase }[] = [];

  const ensure = (name: string, label: string): Concept => {
    let concept = byName.get(name);
    if (concept === undefined) {
      concept = {
        name,
        label,
        storyIds: [],
        verbs: new Set(),
        storiesByVerb: new Map(),
        offline: false,
        bulk: false,
        integrations: new Set(),
      };
      byName.set(name, concept);
    }
    return concept;
  };

  const attach = (concept: Concept, story: UserStory, verbClass: VerbClass) => {
    concept.storyIds.push(story.id);
    concept.verbs.add(verbClass);
    concept.storiesByVerb.set(verbClass, [...(concept.storiesByVerb.get(verbClass) ?? []), story.id]);
    const tags = story.tags.map((t) => t.toLowerCase());
    if (tags.includes('offline')) concept.offline = true;
    if (tags.includes('bulk')) concept.bulk = true;
    for (const t of tags) if (t.startsWith('integration:')) concept.integrations.add(pascalCase(t.slice(12)));
  };

  for (const story of stories) {
    const phrase = extractObjectPhrase(story.goal);
    const name = phrase.object === null ? '' : pascalCase(phrase.object);
    // Notifications name the message ("reminder e-mail"), not a business concept.
    if (name.length < 3 || phrase.verbClass === 'notify' || (byName.size >= MAX_CONCEPTS && !byName.has(name))) {
      pending.push({ story, phrase });
      continue;
    }
    attach(ensure(name, phrase.object ?? name), story, phrase.verbClass);
  }

  // "Claim" and "ExpenseClaim" are one concept: fold shorter names into a longer name ending with them.
  for (const concept of [...byName.values()]) {
    const host = [...byName.values()].find(
      (c) => c !== concept && c.name.length > concept.name.length && c.name.endsWith(concept.name),
    );
    if (host === undefined) continue;
    for (const [verb, ids] of concept.storiesByVerb) {
      for (const id of ids) {
        const story = stories.find((s) => s.id === id);
        if (story !== undefined) attach(host, story, verb);
      }
    }
    byName.delete(concept.name);
  }

  // Stories without a recognisable object join the busiest concept (or a generic one).
  const busiest = [...byName.values()].sort((a, b) => b.storyIds.length - a.storyIds.length)[0];
  for (const { story, phrase } of pending) {
    const target = busiest ?? ensure(GENERIC_CONCEPT, 'work item');
    attach(target, story, phrase.verbClass);
  }
  if (byName.size === 0) ensure(GENERIC_CONCEPT, 'work item');

  const roles = [...new Set(stories.map((s) => pascalCase(s.role)).filter((r) => r.length > 0))];
  const integrations = [...new Set([...byName.values()].flatMap((c) => [...c.integrations]))];
  return { concepts: [...byName.values()], roles: roles.length > 0 ? roles : ['User'], integrations };
}
