import { describe, expect, it } from 'vitest';
import { MemoryLogger } from '../../src/agents/logger.js';
import { runRules } from '../../src/engines/engine.js';
import {
  analyzeXPath,
  DEFAULT_MENDIX_THRESHOLDS,
  MENDIX_RULES,
  validateMendixDesign,
} from '../../src/engines/mendix/index.js';
import type { MendixDesign, MendixModule } from '../../src/shared/mendix.js';
import { compliantMendixDesign, entity, microflow, nanoflow, page, story } from '../fixtures/mendix.js';

const stories = [story('US-001'), story('US-002', { goal: 'search my expense claims' })];

function mutate(fn: (module: MendixModule, design: MendixDesign) => void): MendixDesign {
  const design = structuredClone(compliantMendixDesign());
  const module = design.modules[0];
  if (module === undefined) throw new Error('fixture has no module');
  fn(module, design);
  return design;
}

function ruleIds(design: MendixDesign, s = stories): string[] {
  return validateMendixDesign(design, s).findings.map((f) => f.ruleId);
}

function findingsFor(design: MendixDesign, ruleId: string) {
  return validateMendixDesign(design, stories).findings.filter((f) => f.ruleId === ruleId);
}

describe('Mendix rule engine — baseline', () => {
  it('reports no findings for the compliant reference design', () => {
    const result = validateMendixDesign(compliantMendixDesign(), stories);
    expect(result.findings).toEqual([]);
    expect(result.evaluated).toBe(MENDIX_RULES.length);
  });

  it('has unique rule ids', () => {
    const ids = MENDIX_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Mendix — domain model vs. view model separation', () => {
  it('MX-DM-001 rejects persistable view entities', () => {
    const design = mutate((m) => {
      const vm = m.entities.find((e) => e.name === 'ExpenseClaimSearchVM');
      if (vm) vm.persistable = true;
    });
    const [finding] = findingsFor(design, 'MX-DM-001');
    expect(finding?.severity).toBe('error');
    expect(finding?.target.id).toBe('Expenses.ExpenseClaimSearchVM');
  });

  it('MX-DM-002 rejects UI-state attributes on persistable entities but allows business flags', () => {
    const design = mutate((m) => {
      m.entities[0]?.attributes.push(
        { name: 'IsSelected', type: 'Boolean', indexed: false },
        { name: 'SearchText', type: 'String', indexed: false },
        { name: 'IsActive', type: 'Boolean', indexed: false },
        { name: 'Display', type: 'Boolean', indexed: false },
      );
    });
    const flagged = findingsFor(design, 'MX-DM-002').map((f) => f.target.id);
    expect(flagged).toEqual([
      'Expenses.ExpenseClaim.IsSelected',
      'Expenses.ExpenseClaim.SearchText',
      'Expenses.ExpenseClaim.Display',
    ]);
  });

  it('MX-DM-003 rejects search widgets bound to persistable entities', () => {
    const design = mutate((m) => {
      const overview = m.pages.find((p) => p.name === 'ExpenseClaim_Overview');
      if (overview) overview.filterEntities = ['ExpenseClaim'];
    });
    const [finding] = findingsFor(design, 'MX-DM-003');
    expect(finding?.remediation).toContain('ExpenseClaimSearchVM');
    expect(finding?.storyRefs).toEqual(['US-002']);
  });

  it('MX-DM-004 rejects persistable → non-persistable association ownership', () => {
    const design = mutate((m) => {
      m.entities[0]?.associations.push({ name: 'Claim_VM', target: 'ExpenseClaimSearchVM', type: 'reference' });
    });
    expect(findingsFor(design, 'MX-DM-004')).toHaveLength(1);
  });

  it('MX-DM-005 warns about very wide entities', () => {
    const design = mutate((m) => {
      const wide = m.entities[1];
      if (wide)
        wide.attributes = Array.from({ length: 41 }, (_, i) => ({
          name: `A${i}`,
          type: 'String' as const,
          indexed: false,
        }));
    });
    expect(findingsFor(design, 'MX-DM-005')[0]?.severity).toBe('warning');
  });

  it('MX-DM-006 asks for a view model when a page edits many domain entities', () => {
    const design = mutate((m) => {
      m.entities.push(entity({ name: 'Receipt' }));
      const edit = m.pages.find((p) => p.name === 'ExpenseClaim_NewEdit');
      if (edit) edit.editsEntities = ['ExpenseClaim', 'Employee', 'Receipt'];
    });
    expect(findingsFor(design, 'MX-DM-006')).toHaveLength(1);
  });
});

describe('Mendix — minimising round trips with nanoflows', () => {
  it('MX-RT-001 rejects page-triggered microflows that do no server work', () => {
    const design = mutate((m) => {
      m.microflows.push(
        microflow({ name: 'ACT_ToggleDetails', commitCount: 0, calledFrom: 'page', storyRefs: ['US-002'] }),
      );
    });
    const [finding] = findingsFor(design, 'MX-RT-001');
    expect(finding?.severity).toBe('error');
    expect(finding?.remediation).toContain('nanoflow');
  });

  it('MX-RT-001 accepts page microflows whose sub-microflows do the server work', () => {
    const design = mutate((m) => {
      m.microflows.push(
        microflow({ name: 'ACT_Approve', commitCount: 0, calledFrom: 'page', subMicroflows: ['SUB_Approve_Commit'] }),
        microflow({ name: 'SUB_Approve_Commit', commitCount: 1, calledFrom: 'microflow' }),
      );
    });
    expect(findingsFor(design, 'MX-RT-001')).toHaveLength(0);
  });

  it('MX-RT-002 flags nanoflows chaining several microflow calls', () => {
    const design = mutate((m) => {
      m.nanoflows.push(
        nanoflow({ name: 'ACT_Chain', microflowCalls: ['ACT_ExpenseClaim_Submit', 'DS_ExpenseClaim_Search'] }),
      );
    });
    expect(findingsFor(design, 'MX-RT-002')).toHaveLength(1);
  });

  it('MX-RT-003 flags nanoflows with several database retrieves', () => {
    const design = mutate((m) => {
      m.nanoflows.push(nanoflow({ name: 'ACT_Load', databaseRetrieves: 3 }));
    });
    expect(findingsFor(design, 'MX-RT-003')).toHaveLength(1);
  });
});

describe('Mendix — microflow complexity', () => {
  it('MX-MF-001 warns above the soft limit and errors above the hard limit', () => {
    const design = mutate((m) => {
      m.microflows.push(
        microflow({ name: 'SUB_Medium', activityCount: 30, calledFrom: 'microflow' }),
        microflow({ name: 'SUB_Huge', activityCount: 55, calledFrom: 'microflow' }),
      );
    });
    const severities = Object.fromEntries(findingsFor(design, 'MX-MF-001').map((f) => [f.target.id, f.severity]));
    expect(severities).toEqual({ 'Expenses.SUB_Medium': 'warning', 'Expenses.SUB_Huge': 'error' });
  });

  it('respects custom thresholds', () => {
    const design = mutate((m) => {
      m.microflows.push(microflow({ name: 'SUB_Twenty', activityCount: 20, calledFrom: 'microflow' }));
    });
    const strict = validateMendixDesign(design, stories, {
      ...DEFAULT_MENDIX_THRESHOLDS,
      microflowActivityWarning: 15,
    });
    expect(strict.findings.map((f) => f.ruleId)).toContain('MX-MF-001');
  });

  it('MX-MF-002 / MX-MF-003 flag decision-heavy and nested-loop microflows', () => {
    const design = mutate((m) => {
      m.microflows.push(
        microflow({ name: 'SUB_Branchy', decisionCount: 12, maxLoopNesting: 2, calledFrom: 'microflow' }),
      );
    });
    expect(ruleIds(design)).toEqual(expect.arrayContaining(['MX-MF-002', 'MX-MF-003']));
  });

  it('MX-MF-004 / MX-MF-005 reject commits and database retrieves inside loops', () => {
    const design = mutate((m) => {
      m.microflows.push(
        microflow({
          name: 'SCE_Recalculate',
          calledFrom: 'scheduled-event',
          commitsInLoop: true,
          retrieves: [
            { entity: 'Employee', source: 'database', xpath: "[Name = 'x']", insideLoop: true, range: 'first' },
          ],
        }),
      );
    });
    const errors = validateMendixDesign(design, stories)
      .findings.filter((f) => f.severity === 'error')
      .map((f) => f.ruleId);
    expect(errors).toEqual(expect.arrayContaining(['MX-MF-004', 'MX-MF-005']));
  });

  it('MX-MF-006 requires error handling around integration calls', () => {
    const design = mutate((m) => {
      m.microflows.push(
        microflow({ name: 'SUB_CallErp', integrationCalls: 2, hasErrorHandling: false, calledFrom: 'microflow' }),
      );
    });
    expect(findingsFor(design, 'MX-MF-006')).toHaveLength(1);
  });

  it('MX-MF-007 reports flows without a purpose prefix', () => {
    const design = mutate((m) => {
      m.microflows.push(microflow({ name: 'DoStuff', calledFrom: 'microflow' }));
      m.nanoflows.push(nanoflow({ name: 'XYZ_Thing' }));
    });
    expect(findingsFor(design, 'MX-MF-007').map((f) => f.target.id)).toEqual([
      'Expenses.DoStuff',
      'Expenses.XYZ_Thing',
    ]);
  });

  it('MX-MF-008 flags unconstrained retrieve-all', () => {
    const design = mutate((m) => {
      m.microflows.push(
        microflow({
          name: 'SUB_LoadAll',
          calledFrom: 'microflow',
          retrieves: [{ entity: 'ExpenseClaim', source: 'database', xpath: null, insideLoop: false, range: 'all' }],
        }),
      );
    });
    expect(findingsFor(design, 'MX-MF-008')).toHaveLength(1);
  });
});

describe('Mendix — XPath optimisation', () => {
  const withXPath = (xpath: string) =>
    mutate((m) => {
      m.microflows.push(
        microflow({
          name: 'DS_Probe',
          calledFrom: 'page',
          commitCount: 0,
          retrieves: [{ entity: 'ExpenseClaim', source: 'database', xpath, insideLoop: false, range: 'all' }],
        }),
      );
    });

  it('MX-XP-000 rejects malformed constraints', () => {
    expect(ruleIds(withXPath("[Status = 'Open'"))).toContain('MX-XP-000');
    expect(ruleIds(withXPath('Status = 1'))).toContain('MX-XP-000');
  });

  it('MX-XP-001 flags deep association paths', () => {
    const ids = ruleIds(
      withXPath(
        "[Expenses.ExpenseClaim_Employee/Expenses.Employee/Expenses.Employee_Dept/Expenses.Dept/Expenses.Dept_Org/Expenses.Org/Name = 'x']",
      ),
    );
    expect(ids).toContain('MX-XP-001');
  });

  it('MX-XP-002 flags not() and != on association paths', () => {
    expect(ruleIds(withXPath('[not(Expenses.ExpenseClaim_Employee/Expenses.Employee)]'))).toContain('MX-XP-002');
    expect(ruleIds(withXPath("[Expenses.ExpenseClaim_Employee/Expenses.Employee/Name != 'x']"))).toContain('MX-XP-002');
    expect(ruleIds(withXPath("[Status != 'Closed']"))).not.toContain('MX-XP-002');
  });

  it('MX-XP-003 asks for indexes on constrained attributes', () => {
    const [finding] = findingsFor(withXPath("[Title = 'Taxi' and Status = 'Open']"), 'MX-XP-003');
    expect(finding?.message).toContain('Title');
    expect(finding?.message).not.toContain('Status');
  });

  it('MX-XP-004 flags contains()', () => {
    expect(ruleIds(withXPath("[contains(Title, 'taxi')]"))).toContain('MX-XP-004');
  });

  it('MX-XP-005 flags OR across association paths but not plain OR', () => {
    expect(
      ruleIds(withXPath("[Status = 'Open' or Expenses.ExpenseClaim_Employee/Expenses.Employee/Name = 'x']")),
    ).toContain('MX-XP-005');
    expect(ruleIds(withXPath("[Status = 'Open' or Status = 'Submitted']"))).not.toContain('MX-XP-005');
  });

  it('MX-XP-006 rejects unknown attributes but accepts system members and tokens', () => {
    expect(ruleIds(withXPath("[Colour = 'red']"))).toContain('MX-XP-006');
    expect(ruleIds(withXPath("[createdDate > '[%BeginOfCurrentDay%]' and id = $Claim]"))).not.toContain('MX-XP-006');
  });

  it('applies XPath rules to page database data sources too', () => {
    const design = mutate((m) => {
      const overview = m.pages.find((p) => p.name === 'ExpenseClaim_Overview');
      overview?.dataSources.push({ entity: 'ExpenseClaim', kind: 'database', xpath: "[contains(Title, 'x')]" });
    });
    expect(findingsFor(design, 'MX-XP-004')[0]?.target).toEqual({ kind: 'page', id: 'ExpenseClaim_Overview' });
  });

  it('analyzeXPath ignores syntax inside string literals', () => {
    const analysis = analyzeXPath("[Title = 'not(a/b/c/d/e/f) or contains(']");
    expect(analysis.usesNot).toBe(false);
    expect(analysis.usesContains).toBe(false);
    expect(analysis.maxAssociationHops).toBe(0);
    expect(analysis.wellFormed).toBe(true);
  });
});

describe('Mendix — offline and integrity', () => {
  it('MX-OFF-001 / MX-OFF-002 constrain offline pages', () => {
    const design = mutate((m) => {
      m.pages.push(
        page({
          name: 'Claim_Mobile',
          profile: 'native-mobile',
          dataSources: [{ entity: 'ExpenseClaim', kind: 'microflow', xpath: null }],
          actions: [{ trigger: 'Sync', kind: 'microflow', target: 'ACT_ExpenseClaim_Submit' }],
        }),
      );
    });
    expect(findingsFor(design, 'MX-OFF-001')[0]?.severity).toBe('error');
    expect(findingsFor(design, 'MX-OFF-002')[0]?.severity).toBe('warning');
  });

  it('MX-OFF-003 requires offline stories to be realised by offline pages', () => {
    const offlineStories = [story('US-001', { tags: ['offline'] }), story('US-002')];
    expect(ruleIds(compliantMendixDesign(), offlineStories)).toContain('MX-OFF-003');
  });

  it('MX-INT-001 reports dangling references', () => {
    const design = mutate((m) => {
      m.nanoflows.push(nanoflow({ name: 'ACT_Broken', microflowCalls: ['ACT_DoesNotExist'] }));
      m.entities[0]?.associations.push({ name: 'Claim_Ghost', target: 'Ghost', type: 'reference' });
    });
    expect(findingsFor(design, 'MX-INT-001').map((f) => f.message)).toEqual([
      'Expenses.ACT_Broken references unknown microflow ACT_DoesNotExist.',
      'Expenses.ExpenseClaim references unknown entity Ghost.',
    ]);
  });

  it('turns a crashing rule into an ENGINE-001 finding and logs it', () => {
    const logger = new MemoryLogger();
    const result = runRules(
      [
        {
          id: 'X-1',
          title: 'boom',
          category: 'test',
          severity: 'warning',
          rationale: 'r',
          evaluate: () => {
            throw new Error('kaput');
          },
        },
      ],
      {},
      logger,
    );
    expect(result.findings[0]).toMatchObject({ ruleId: 'ENGINE-001', severity: 'error' });
    expect(logger.at('error')[0]?.fields.ruleId).toBe('X-1');
  });
});
