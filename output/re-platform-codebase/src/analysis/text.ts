/**
 * Small, dependency-free text utilities used by the deterministic agents.
 */

export function splitStatements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/^\s*(?:[-*•▪]|\d+[.)])\s+/, '').split(/(?<=[.!?])\s+(?=[A-Z"'(])/))
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length >= 12 && /[a-z]/i.test(s));
}

export function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s.!?;:,]+$/, '').trim();
}

export function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

export function upperFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

export function pascalCase(text: string): string {
  return text
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

const IRREGULAR_SINGULARS: Readonly<Record<string, string>> = {
  people: 'person',
  children: 'child',
  staff: 'staff',
  data: 'data',
  media: 'media',
  analyses: 'analysis',
  statuses: 'status',
  addresses: 'address',
  processes: 'process',
};

export function singularize(word: string): string {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_SINGULARS[lower];
  if (irregular !== undefined) return matchCase(word, irregular);
  if (/ies$/i.test(word) && word.length > 4) return word.slice(0, -3) + matchCase(word.slice(-3), 'y');
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/ss$/i.test(word) || /us$/i.test(word) || /is$/i.test(word)) return word;
  if (/s$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

function matchCase(source: string, target: string): string {
  return source === source.toUpperCase() ? target.toUpperCase() : target;
}

export function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  return words.length <= max ? text : `${words.slice(0, max).join(' ')}`;
}

/** Jaccard similarity of lowercase word sets. */
export function similarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    );
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared);
}
