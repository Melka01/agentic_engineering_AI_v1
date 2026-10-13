/**
 * Deterministic backlog extraction — the always-available fallback of the
 * story-generator agent. It turns requirement statements into INVEST-shaped
 * stories and measurable NFRs using lexicons and patterns. It is honest about
 * what it cannot infer: ambiguity and gaps are left for the rule engine to report.
 */
import type { StoryGenerationOutput } from '../agents/schemas.js';
import type {
  AcceptanceCriterion,
  NfrCategory,
  NfrMetric,
  NonFunctionalRequirement,
  Priority,
  UserStory,
} from '../shared/domain.js';
import { extractObjectPhrase } from './concepts.js';
import { KNOWN_SYSTEMS, NFR_LEXICON, TAG_LEXICON, type VerbClass } from './lexicon.js';
import {
  lowerFirst,
  singularize,
  splitStatements,
  stripTrailingPunctuation,
  truncateWords,
  upperFirst,
} from './text.js';

export interface ExtractionInput {
  readonly projectName: string;
  readonly requirementsText: string;
  readonly domainContext: string;
}

const AS_A = /^as an?\s+(.+?),?\s+i\s+(?:want|need|would like|wish)\s+(?:to\s+)?(.+?)(?:,?\s+so\s+that\s+(.+))?$/i;
const MODAL =
  /^(.*?)\s+(?:must be able to|should be able to|needs? to be able to|wants? to be able to|are able to|is able to|wants? to|needs? to|can|could|must|should|shall|will|may)\s+(.+)$/i;
const SO_THAT = /^(.+?),?\s+so\s+that\s+(.+)$/i;
const SYSTEM_SUBJECT = /^(?:the\s+)?(?:system|application|app|platform|portal|solution|tool)$/i;
/** Subjects that describe the product or its data rather than a human actor. */
const NON_ACTOR_SUBJECT =
  /^(?:the\s+|all\s+)?(?:(?:personal\s+|customer\s+|user\s+)?data|pages?|screens?|responses?|response times?|requests?|search(?:es| results?)?|reports?|backups?|files?|documents?|database|system|application|app|platform|portal|solution|service|api)$/i;

const BENEFITS: Readonly<Record<VerbClass, string>> = {
  create: 'the request enters the process without manual re-entry or paperwork',
  update: 'the information stays accurate for everyone who relies on it',
  approve: 'decisions are made on time and recorded for audit',
  view: 'I have the information I need without asking colleagues',
  delete: 'obsolete records no longer clutter the process',
  export: 'stakeholders can act on up-to-date information',
  notify: 'nobody misses an action that needs their attention',
  import: 'data stays consistent across systems without manual re-keying',
  other: 'the process runs without manual workarounds',
};

const BASE_POINTS: Readonly<Record<VerbClass, number>> = {
  create: 3,
  update: 2,
  approve: 5,
  view: 2,
  delete: 1,
  export: 3,
  notify: 2,
  import: 5,
  other: 3,
};

const FIBONACCI = [1, 2, 3, 5, 8, 13] as const;

const VERIFICATION: Readonly<Record<NfrCategory, NonFunctionalRequirement['verificationMethod']>> = {
  performance: 'test',
  scalability: 'test',
  availability: 'analysis',
  reliability: 'analysis',
  security: 'test',
  usability: 'demonstration',
  maintainability: 'inspection',
  compliance: 'inspection',
  interoperability: 'test',
};

export function extractBacklog(input: ExtractionInput): StoryGenerationOutput {
  const statements = splitStatements(`${input.requirementsText}\n${input.domainContext}`);
  const storyDrafts: Omit<UserStory, 'id' | 'nfrRefs'>[] = [];
  const nfrDrafts: Omit<NonFunctionalRequirement, 'id'>[] = [];

  for (const statement of statements) {
    const functional = parseFunctional(statement);
    const categories = classifyNfr(statement);
    const quality = categories.length > 0 && (functional === null || NON_ACTOR_SUBJECT.test(functional.subject));
    // A statement with a human actor and a recognised verb is a capability even if it mentions a quality keyword.
    if (
      functional !== null &&
      !quality &&
      (categories.length === 0 || AS_A.test(statement) || hasActorVerb(functional.goal))
    ) {
      storyDrafts.push(buildStory(statement, functional));
    } else if (categories.length > 0) {
      categories.forEach((category, index) => {
        const metric = parseMetric(statement, category);
        // The primary category always yields an NFR; secondary ones only when they add a metric or a control.
        if (index > 0 && metric === null && category !== 'security' && category !== 'compliance') return;
        nfrDrafts.push({
          category,
          statement: stripTrailingPunctuation(statement),
          metric,
          verificationMethod: VERIFICATION[category],
          priority: priorityOf(statement),
        });
      });
    }
  }

  if (storyDrafts.length === 0) {
    storyDrafts.push(
      buildStory(input.projectName, {
        subject: 'business user',
        role: 'business user',
        goal: `record and track ${input.projectName.toLowerCase()} work items`,
        benefit: null,
      }),
    );
  }

  const nfrs: NonFunctionalRequirement[] = nfrDrafts.map((n, i) => ({ id: formatId('NFR', i + 1), ...n }));
  const stories: UserStory[] = storyDrafts.map((s, i) => ({
    id: formatId('US', i + 1),
    ...s,
    nfrRefs: linkNfrs(s.tags, nfrs),
  }));
  return { stories, nfrs };
}

export function formatId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

interface FunctionalParts {
  readonly subject: string;
  readonly role: string;
  readonly goal: string;
  readonly benefit: string | null;
}

function parseFunctional(statement: string): FunctionalParts | null {
  const text = stripTrailingPunctuation(statement);
  const asA = AS_A.exec(text);
  if (asA !== null) {
    return {
      subject: asA[1] ?? '',
      role: normaliseRole(asA[1] ?? ''),
      goal: lowerFirst(asA[2] ?? ''),
      benefit: asA[3] ?? null,
    };
  }
  const modal = MODAL.exec(text);
  if (modal === null) return null;
  const subject = (modal[1] ?? '').trim();
  if (subject.length === 0 || subject.split(/\s+/).length > 5) return null;
  let predicate = (modal[2] ?? '').replace(/^be able to\s+/i, '').trim();
  let benefit: string | null = null;
  const soThat = SO_THAT.exec(predicate);
  if (soThat !== null) {
    predicate = soThat[1] ?? predicate;
    benefit = soThat[2] ?? null;
  }
  if (/^be\b/i.test(predicate)) return null; // "must be available 99.9%" is a quality, not a capability
  return {
    subject,
    role: SYSTEM_SUBJECT.test(subject) ? 'system' : normaliseRole(subject),
    goal: lowerFirst(predicate),
    benefit,
  };
}

function hasActorVerb(goal: string): boolean {
  return extractObjectPhrase(goal).verbClass !== 'other';
}

function normaliseRole(subject: string): string {
  const words = subject
    .replace(/^(?:the|all|our|every|each|any)\s+/i, '')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()));
  const last = words.length - 1;
  return words.map((w, i) => (i === last ? singularize(w) : w)).join(' ');
}

function buildStory(statement: string, parts: FunctionalParts): Omit<UserStory, 'id' | 'nfrRefs'> {
  const goal = stripTrailingPunctuation(parts.goal);
  const phrase = extractObjectPhrase(goal);
  const tags = tagsOf(statement);
  const benefit = parts.benefit === null ? BENEFITS[phrase.verbClass] : stripTrailingPunctuation(parts.benefit);
  return {
    title: upperFirst(truncateWords(goal, 8)),
    role: parts.role,
    goal,
    benefit,
    acceptanceCriteria: acceptanceCriteria(phrase.verbClass, parts.role, goal, phrase.object ?? 'record'),
    priority: priorityOf(statement),
    storyPoints: estimate(phrase.verbClass, tags),
    tags,
  };
}

function tagsOf(statement: string): string[] {
  const tags = TAG_LEXICON.filter(({ pattern }) => pattern.test(statement)).map(({ tag }) => tag);
  for (const system of KNOWN_SYSTEMS) {
    if (system.pattern.test(statement)) tags.push(`integration:${system.name.toLowerCase()}`);
  }
  return [...new Set(tags)];
}

function priorityOf(statement: string): Priority {
  if (/\b(must|shall|required|mandatory|needs? to)\b/i.test(statement)) return 'must';
  if (/\b(could|nice to have|optional|ideally|may)\b/i.test(statement)) return 'could';
  if (/\b(won'?t|will not|out of scope)\b/i.test(statement)) return 'wont';
  return 'should';
}

function estimate(verbClass: VerbClass, tags: readonly string[]): number {
  let points = BASE_POINTS[verbClass];
  if (tags.some((t) => t.startsWith('integration:'))) points += 3;
  if (tags.includes('offline')) points += 3;
  if (tags.includes('document')) points += 1;
  if (tags.includes('bulk')) points += 2;
  return FIBONACCI.find((f) => f >= points) ?? 13;
}

function acceptanceCriteria(cls: VerbClass, role: string, goal: string, object: string): AcceptanceCriterion[] {
  const actor = role === 'system' ? 'the system' : 'I';
  const signedIn = role === 'system' ? 'the triggering conditions are met' : `I am signed in as a ${role}`;
  const plural = `${object}s`;
  const happy = (then: string): AcceptanceCriterion => ({ given: signedIn, when: `${actor} ${goal}`, then });
  switch (cls) {
    case 'create':
      return [
        happy(`the ${object} is saved and a confirmation with its reference number is shown`),
        {
          given: 'required information is missing',
          when: `I try to ${goal}`,
          then: 'I see which fields to complete and nothing is saved',
        },
      ];
    case 'update':
      return [
        happy('the changes are saved and visible to other authorised users'),
        {
          given: `another user changed the ${object} in the meantime`,
          when: 'I save my changes',
          then: 'I am warned and no changes are overwritten',
        },
      ];
    case 'approve':
      return [
        happy(`the ${object} status changes and the requester is informed of the decision`),
        {
          given: `I am not authorised to decide on the ${object}`,
          when: `I open the ${object}`,
          then: 'the approve and reject actions are not available',
        },
      ];
    case 'view':
      return [
        happy(`I see only the ${plural} I am authorised to see, most recent first`),
        { given: 'no records match my criteria', when: `I ${goal}`, then: 'I see a clear "no results" message' },
      ];
    case 'delete':
      return [
        happy(`the ${object} no longer appears in active lists and the action is logged`),
        {
          given: `the ${object} is still used by an open process`,
          when: `I try to ${goal}`,
          then: 'the action is blocked with an explanation',
        },
      ];
    case 'export':
      return [
        happy(`a file with the selected ${plural} is produced in the agreed format`),
        { given: 'the selection is empty', when: `I try to ${goal}`, then: 'no file is produced and I am told why' },
      ];
    case 'notify':
      return [
        {
          given: `an event occurs that concerns a ${object}`,
          when: `${actor} ${goal}`,
          then: `the recipient receives a message that links to the ${object}`,
        },
        { given: 'the message cannot be delivered', when: 'delivery fails', then: 'the failure is logged and retried' },
      ];
    case 'import':
      return [
        happy('records are created or updated and a summary of processed and rejected rows is shown'),
        {
          given: 'the source contains invalid rows',
          when: 'the import runs',
          then: 'invalid rows are reported and valid rows are still processed',
        },
      ];
    case 'other':
      return [
        happy('the outcome is saved and visible to authorised users'),
        {
          given: 'I do not have permission',
          when: `I try to ${goal}`,
          then: 'the action is refused with a clear message',
        },
      ];
  }
}

function classifyNfr(statement: string): NfrCategory[] {
  return NFR_LEXICON.filter(({ pattern }) => pattern.test(statement)).map(({ category }) => category);
}

function parseNumber(raw: string): number {
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) return Number(raw.replaceAll(',', ''));
  return Number(raw.replace(',', '.'));
}

export function parseMetric(statement: string, category: NfrCategory): NfrMetric | null {
  const percent = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(statement);
  if (category === 'availability' && percent?.[1] !== undefined) {
    return { name: 'availability', comparator: '>=', target: parseNumber(percent[1]), unit: '%' };
  }
  const time =
    /(?:within|under|below|less than|in|max(?:imum)?(?: of)?|at most|no more than|<=?)\s*(\d+(?:[.,]\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|hours?|hrs?|h)\b/i.exec(
      statement,
    );
  if (time?.[1] !== undefined && time[2] !== undefined && (category === 'performance' || category === 'reliability')) {
    const unit = normaliseTimeUnit(time[2]);
    const name =
      category === 'performance'
        ? 'response time'
        : /\b(RPO|data loss)\b/i.test(statement)
          ? 'recovery point objective'
          : 'recovery time objective';
    return { name, comparator: '<=', target: parseNumber(time[1]), unit };
  }
  const users = /(\d[\d,.]*)\s*(k)?\s+(?:concurrent\s+|simultaneous\s+|active\s+)*users/i.exec(statement);
  if (category === 'scalability' && users?.[1] !== undefined) {
    const n = parseNumber(users[1]) * (users[2] === undefined ? 1 : 1000);
    return { name: 'concurrent users', comparator: '>=', target: n, unit: 'users' };
  }
  const volume =
    /(\d[\d,.]*)\s*(k|thousand|million)?\s+(records|transactions|requests|orders|claims|documents)(?:\s+(?:per|a|each)\s+(day|hour|month|year))?/i.exec(
      statement,
    );
  if (category === 'scalability' && volume?.[1] !== undefined && volume[3] !== undefined) {
    const factor = volume[2] === undefined ? 1 : /k|thousand/i.test(volume[2]) ? 1000 : 1_000_000;
    const noun = volume[3].toLowerCase();
    return {
      name: volume[4] === undefined ? `${noun} volume` : `${noun} per ${volume[4].toLowerCase()}`,
      comparator: '>=',
      target: parseNumber(volume[1]) * factor,
      unit: noun,
    };
  }
  return null;
}

function normaliseTimeUnit(raw: string): string {
  const unit = raw.toLowerCase();
  if (unit === 'ms' || unit.startsWith('millisecond')) return 'ms';
  if (unit === 's' || unit.startsWith('sec')) return 's';
  if (unit.startsWith('min')) return 'min';
  return 'h';
}

function linkNfrs(tags: readonly string[], nfrs: readonly NonFunctionalRequirement[]): string[] {
  const has = (t: string) =>
    tags.includes(t) || (t === 'integration' && tags.some((x) => x.startsWith('integration:')));
  return nfrs
    .filter((n) => {
      if (n.category === 'performance' || n.category === 'scalability')
        return has('search') || has('reporting') || has('bulk');
      if (n.category === 'security' || n.category === 'compliance')
        return has('document') || has('approval') || has('integration');
      if (n.category === 'usability') return has('mobile');
      return false;
    })
    .map((n) => n.id);
}
