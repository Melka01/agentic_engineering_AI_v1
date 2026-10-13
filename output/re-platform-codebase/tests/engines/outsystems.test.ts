import { describe, expect, it } from 'vitest';
import { findCycles, OUTSYSTEMS_RULES, validateOutSystemsDesign } from '../../src/engines/outsystems/index.js';
import type { OsModule, OutSystemsDesign } from '../../src/shared/outsystems.js';
import { story } from '../fixtures/mendix.js';
import { compliantOutSystemsDesign, osModule, osQuery } from '../fixtures/outsystems.js';

const stories = [story('US-001'), story('US-002', { goal: 'search my expense claims' })];

function mutate(fn: (modules: Map<string, OsModule>, design: OutSystemsDesign) => void): OutSystemsDesign {
  const design = structuredClone(compliantOutSystemsDesign());
  fn(new Map(design.modules.map((m) => [m.name, m])), design);
  return design;
}

const get = (modules: Map<string, OsModule>, name: string): OsModule => {
  const m = modules.get(name);
  if (m === undefined) throw new Error(`missing module ${name}`);
  return m;
};

const findingsFor = (design: OutSystemsDesign, ruleId: string, s = stories) =>
  validateOutSystemsDesign(design, s).findings.filter((f) => f.ruleId === ruleId);

describe('OutSystems rule engine — baseline', () => {
  it('reports no findings for the compliant 3-layer reference canvas', () => {
    const result = validateOutSystemsDesign(compliantOutSystemsDesign(), stories);
    expect(result.findings).toEqual([]);
    expect(result.evaluated).toBe(OUTSYSTEMS_RULES.length);
  });

  it('has unique rule ids', () => {
    const ids = OUTSYSTEMS_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('OutSystems — 3-layer Architecture Canvas', () => {
  it('OS-ARCH-001 rejects Foundation → Core references', () => {
    const design = mutate((m) => get(m, 'Sap_IS').references.push('Expenses_CS'));
    const [finding] = findingsFor(design, 'OS-ARCH-001');
    expect(finding?.severity).toBe('error');
    expect(finding?.target.id).toBe('Sap_IS->Expenses_CS');
  });

  it('OS-ARCH-001 rejects Core Entities → Business Process references', () => {
    const design = mutate((m) => get(m, 'Expenses_CS').references.push('Expenses_BL'));
    expect(findingsFor(design, 'OS-ARCH-001').map((f) => f.target.id)).toContain('Expenses_CS->Expenses_BL');
  });

  it('OS-ARCH-001 rejects Core → End-User references', () => {
    const design = mutate((m) => get(m, 'Expenses_BL').references.push('Expenses'));
    expect(findingsFor(design, 'OS-ARCH-001').map((f) => f.target.id)).toContain('Expenses_BL->Expenses');
  });

  it('OS-ARCH-002 rejects side references between end-user modules', () => {
    const design = mutate((m, d) => {
      d.modules.push(osModule({ name: 'Approvals', kind: 'end-user', references: ['Expenses'] }));
      void m;
    });
    expect(findingsFor(design, 'OS-ARCH-002')).toHaveLength(1);
  });

  it('allows downward and same-layer foundation references', () => {
    const design = mutate((m) => get(m, 'Sap_IS').references.push('Expenses_Th'));
    expect(validateOutSystemsDesign(design, stories).findings).toEqual([]);
  });

  it('OS-ARCH-004 enforces kind suffixes', () => {
    const design = mutate((m, d) => {
      d.modules.push(
        osModule({ name: 'Payments', kind: 'connector' }),
        osModule({ name: 'Portal_CS', kind: 'end-user' }),
      );
      void m;
    });
    expect(findingsFor(design, 'OS-ARCH-004').map((f) => f.target.id)).toEqual(['Payments', 'Portal_CS']);
  });
});

describe('OutSystems — circular references (dependency graph)', () => {
  it('OS-ARCH-003 detects direct cycles', () => {
    const design = mutate((m) => {
      m.get('Expenses_CS')?.references.push('Sap_IS');
      m.get('Sap_IS')?.references.push('Expenses_CS');
    });
    const cycles = findingsFor(design, 'OS-ARCH-003');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.message).toContain('Expenses_CS ↔ Sap_IS');
  });

  it('OS-ARCH-003 detects indirect cycles across three modules', () => {
    const design = mutate((m, d) => {
      d.modules.push(osModule({ name: 'Orders_CS', kind: 'core-entities', references: ['Customers_CS'] }));
      d.modules.push(osModule({ name: 'Customers_CS', kind: 'core-entities', references: ['Invoices_CS'] }));
      d.modules.push(osModule({ name: 'Invoices_CS', kind: 'core-entities', references: ['Orders_CS'] }));
      void m;
    });
    expect(findingsFor(design, 'OS-ARCH-003')[0]?.target.id).toBe('Customers_CS<->Invoices_CS<->Orders_CS');
  });

  it('findCycles handles self loops, multiple components and acyclic graphs', () => {
    expect(findCycles(['A'], [{ from: 'A', to: 'A' }])).toEqual([['A']]);
    expect(
      findCycles(
        ['A', 'B', 'C', 'D'],
        [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' },
          { from: 'C', to: 'D' },
          { from: 'D', to: 'C' },
        ],
      ),
    ).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(
      findCycles(
        ['A', 'B', 'C'],
        [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      ),
    ).toEqual([]);
  });
});

describe('OutSystems — module encapsulation', () => {
  it('OS-ENC-001 requires read-only exposure of public core entities', () => {
    const design = mutate((m) => {
      const entity = get(m, 'Expenses_CS').entities[0];
      if (entity) entity.exposeReadOnly = false;
    });
    expect(findingsFor(design, 'OS-ENC-001')[0]?.severity).toBe('error');
  });

  it('OS-ENC-002 requires CRUD wrapper actions', () => {
    const design = mutate((m) => {
      get(m, 'Expenses_CS').actions = [];
    });
    expect(findingsFor(design, 'OS-ENC-002')).toHaveLength(1);
  });

  it('OS-ENC-003 rejects business entities outside core modules but allows local storage entities', () => {
    const design = mutate((m) => {
      get(m, 'Expenses').entities.push(
        { name: 'Claim', isPublic: true, exposeReadOnly: true, isStatic: false, attributeCount: 4, storyRefs: [] },
        {
          name: 'LocalClaim',
          isPublic: false,
          exposeReadOnly: false,
          isStatic: false,
          attributeCount: 4,
          storyRefs: [],
        },
      );
    });
    const findings = findingsFor(design, 'OS-ENC-003');
    expect(findings.map((f) => f.target.id)).toEqual(['Expenses.Claim']);
    expect(findings[0]?.severity).toBe('error');
  });

  it('OS-ENC-004 flags public actions in end-user modules', () => {
    const design = mutate((m) =>
      get(m, 'Expenses').actions.push({ name: 'Helper', isPublic: true, kind: 'server', storyRefs: [] }),
    );
    expect(findingsFor(design, 'OS-ENC-004')).toHaveLength(1);
  });

  it('OS-ENC-005 flags business entities exposed by connectors', () => {
    const design = mutate((m) =>
      get(m, 'Sap_IS').entities.push({
        name: 'SapInvoice',
        isPublic: true,
        exposeReadOnly: true,
        isStatic: false,
        attributeCount: 9,
        storyRefs: [],
      }),
    );
    expect(findingsFor(design, 'OS-ENC-005')).toHaveLength(1);
  });

  it('OS-ENC-006 keeps screens out of core modules', () => {
    const design = mutate((m) => get(m, 'Expenses_BL').screens.push({ name: 'AdminScreen', storyRefs: [] }));
    expect(findingsFor(design, 'OS-ENC-006')[0]?.severity).toBe('error');
  });

  it('OS-ENC-007 flags modules with an oversized public surface', () => {
    const design = mutate((m) => {
      get(m, 'Expenses_BL').actions.push(
        ...Array.from({ length: 31 }, (_, i) => ({
          name: `Op${i}`,
          isPublic: true,
          kind: 'server' as const,
          storyRefs: [],
        })),
      );
    });
    expect(findingsFor(design, 'OS-ENC-007')).toHaveLength(1);
  });
});

describe('OutSystems — Aggregates over custom SQL and data access', () => {
  it('OS-DATA-001 rejects unjustified advanced SQL but accepts justified SQL', () => {
    const design = mutate((m) => {
      get(m, 'Expenses_BL').queries.push(
        osQuery({ name: 'SqlUnjustified', kind: 'advanced-sql', fetch: 'server-action' }),
        osQuery({
          name: 'SqlBulkUpdate',
          kind: 'advanced-sql',
          fetch: 'server-action',
          sqlJustification: 'bulk-operation',
        }),
      );
    });
    expect(findingsFor(design, 'OS-DATA-001').map((f) => f.target.id)).toEqual(['Expenses_BL.SqlUnjustified']);
  });

  it('OS-DATA-002 rejects Expand Inline parameters', () => {
    const design = mutate((m) =>
      get(m, 'Expenses_BL').queries.push(
        osQuery({
          name: 'Search',
          kind: 'advanced-sql',
          sqlJustification: 'unsupported-construct',
          usesExpandInline: true,
          fetch: 'server-action',
        }),
      ),
    );
    expect(findingsFor(design, 'OS-DATA-002')[0]?.severity).toBe('error');
  });

  it('OS-DATA-003 rejects queries inside loops', () => {
    const design = mutate((m) =>
      get(m, 'Expenses_BL').queries.push(osQuery({ name: 'PerItem', insideLoop: true, fetch: 'server-action' })),
    );
    expect(findingsFor(design, 'OS-DATA-003')).toHaveLength(1);
  });

  it('OS-DATA-004 requires pagination on screen lists', () => {
    const design = mutate((m) => {
      const q = get(m, 'Expenses').queries[0];
      if (q) q.maxRecords = null;
    });
    expect(findingsFor(design, 'OS-DATA-004')).toHaveLength(1);
  });

  it('OS-DATA-005 / OS-DATA-006 limit aggregate sources and at-start queries', () => {
    const design = mutate((m) => {
      const ui = get(m, 'Expenses');
      ui.queries.push(
        osQuery({ name: 'Wide', sources: 7, screen: 'ExpenseClaims' }),
        osQuery({ name: 'Q3', screen: 'ExpenseClaims' }),
        osQuery({ name: 'Q4', screen: 'ExpenseClaims' }),
        osQuery({ name: 'Q5', screen: 'ExpenseClaims' }),
      );
    });
    expect(findingsFor(design, 'OS-DATA-005')).toHaveLength(1);
    expect(findingsFor(design, 'OS-DATA-006')[0]?.target.id).toBe('Expenses.ExpenseClaims');
  });

  it('OS-DATA-007 keeps SQL out of end-user modules', () => {
    const design = mutate((m) =>
      get(m, 'Expenses').queries.push(
        osQuery({ name: 'Report', kind: 'advanced-sql', sqlJustification: 'reporting-view', screen: 'ExpenseClaims' }),
      ),
    );
    expect(findingsFor(design, 'OS-DATA-007')).toHaveLength(1);
  });
});

describe('OutSystems — async processing and integrity', () => {
  it('OS-ASYNC-001 requires timers for bulk stories', () => {
    const bulk = [story('US-001'), story('US-002', { tags: ['bulk'] })];
    expect(findingsFor(compliantOutSystemsDesign(), 'OS-ASYNC-001', bulk)[0]?.target.id).toBe('US-002');
  });

  it('OS-INT-001 / OS-INT-002 report dangling references', () => {
    const design = mutate((m) => {
      get(m, 'Expenses').references.push('Ghost_CS');
      get(m, 'Expenses').queries.push(osQuery({ name: 'Orphan', screen: 'NoSuchScreen' }));
    });
    expect(findingsFor(design, 'OS-INT-001')).toHaveLength(1);
    expect(findingsFor(design, 'OS-INT-002')).toHaveLength(1);
  });
});
