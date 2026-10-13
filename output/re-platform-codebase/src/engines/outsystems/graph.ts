/**
 * Module dependency graph utilities. Cycle detection uses Tarjan's strongly
 * connected components algorithm (O(V + E)); every SCC with more than one
 * module, or a module referencing itself, is a circular reference.
 */

export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
}

export function findCycles(nodes: readonly string[], edges: readonly DependencyEdge[]): string[][] {
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const { from, to } of edges) {
    if (adjacency.has(from) && adjacency.has(to)) adjacency.get(from)?.push(to);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const strongConnect = (node: string): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(next) ?? 0));
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      const selfLoop = component.length === 1 && (adjacency.get(node) ?? []).includes(node);
      if (component.length > 1 || selfLoop) cycles.push(component.sort());
    }
  };

  for (const node of nodes) if (!indices.has(node)) strongConnect(node);
  return cycles.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}
