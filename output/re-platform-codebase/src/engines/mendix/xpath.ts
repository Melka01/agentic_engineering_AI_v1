/**
 * Lightweight static analyser for Mendix XPath constraints, e.g.
 *   [Sales.Order_Customer/Sales.Customer/Name = 'ACME' and Status != 'Closed']
 *
 * It is not a full parser; it extracts the facts the performance rules need:
 * association path depth, negations, contains(), OR across joins and the
 * attributes constrained directly on the retrieved entity.
 */

export interface XPathAnalysis {
  readonly wellFormed: boolean;
  /** Deepest association path, in association hops. */
  readonly maxAssociationHops: number;
  readonly paths: readonly string[];
  readonly usesNot: boolean;
  /** `!=` applied to an association path (forces NOT EXISTS / outer joins). */
  readonly notEqualsOnPath: boolean;
  readonly usesContains: boolean;
  /** `or` combining conditions where at least one side traverses an association. */
  readonly orAcrossPaths: boolean;
  /** Attributes compared directly on the retrieved entity (index candidates). */
  readonly directAttributes: readonly string[];
}

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'empty', 'div', 'mod', 'id']);

export function analyzeXPath(xpath: string): XPathAnalysis {
  // Neutralise literals and tokens so their content cannot look like syntax.
  const source = xpath
    .replace(/'(?:[^']|'')*'/g, "'S'")
    .replace(/"(?:[^"]|"")*"/g, '"S"')
    .replace(/%[\w.]+%/g, 'TOKEN')
    .trim();

  const paths = [...source.matchAll(/[A-Za-z_][\w.]*(?:\/[A-Za-z_][\w.]*)+/g)].map((m) => m[0]);
  const hops = paths.map((p) => Math.ceil((p.match(/\//g)?.length ?? 0) / 2));

  const directAttributes = new Set<string>();
  for (const match of source.matchAll(/(^|[[(\s])([A-Za-z_]\w*)\s*(?:!=|<=|>=|=|<|>)/g)) {
    const name = match[2];
    if (name !== undefined && !KEYWORDS.has(name.toLowerCase())) directAttributes.add(name);
  }
  for (const match of source.matchAll(/(?:contains|starts-with|ends-with)\s*\(\s*([A-Za-z_]\w*)\s*,/g)) {
    const name = match[1];
    if (name !== undefined) directAttributes.add(name);
  }

  return {
    wellFormed: isWellFormed(source),
    maxAssociationHops: hops.length === 0 ? 0 : Math.max(...hops),
    paths,
    usesNot: /\bnot\s*\(/i.test(source),
    notEqualsOnPath: /[A-Za-z_][\w.]*(?:\/[A-Za-z_][\w.]*)+\s*!=/.test(source),
    usesContains: /\bcontains\s*\(/i.test(source),
    orAcrossPaths: /\bor\b/i.test(source) && paths.length > 0,
    directAttributes: [...directAttributes],
  };
}

function isWellFormed(source: string): boolean {
  if (!source.startsWith('[') || !source.endsWith(']')) return false;
  const stack: string[] = [];
  const pairs: Readonly<Record<string, string>> = { ']': '[', ')': '(' };
  for (const ch of source) {
    if (ch === '[' || ch === '(') stack.push(ch);
    else if (ch === ']' || ch === ')') {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.length === 0 && /\[\s*[^\]\s]/.test(source);
}
