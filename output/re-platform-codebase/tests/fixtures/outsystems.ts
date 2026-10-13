import type { OsDataQuery, OsModule, OutSystemsDesign } from '../../src/shared/outsystems.js';

export const osModule = (overrides: Partial<OsModule> & Pick<OsModule, 'name' | 'kind'>): OsModule => ({
  references: [],
  entities: [],
  actions: [],
  queries: [],
  screens: [],
  ...overrides,
});

export const osQuery = (overrides: Partial<OsDataQuery> & { name: string }): OsDataQuery => ({
  kind: 'aggregate',
  sources: 1,
  maxRecords: 50,
  returnsList: true,
  fetch: 'at-start',
  insideLoop: false,
  sqlJustification: 'none',
  usesExpandInline: false,
  screen: null,
  storyRefs: [],
  ...overrides,
});

/** A compliant 3-layer OutSystems canvas for an expense-claim app. */
export function compliantOutSystemsDesign(): OutSystemsDesign {
  return {
    paradigm: 'outsystems',
    userRoles: ['Employee', 'Manager'],
    modules: [
      osModule({
        name: 'Expenses',
        kind: 'end-user',
        references: ['Expenses_BL', 'Expenses_CS', 'Expenses_Th'],
        screens: [
          { name: 'ExpenseClaims', storyRefs: ['US-002'] },
          { name: 'ExpenseClaimDetail', storyRefs: ['US-001'] },
        ],
        queries: [
          osQuery({ name: 'GetExpenseClaims', sources: 2, screen: 'ExpenseClaims', storyRefs: ['US-002'] }),
          osQuery({
            name: 'GetExpenseClaimById',
            maxRecords: 1,
            returnsList: false,
            screen: 'ExpenseClaimDetail',
            storyRefs: ['US-001'],
          }),
        ],
      }),
      osModule({
        name: 'Expenses_BL',
        kind: 'business-process',
        references: ['Expenses_CS', 'Sap_IS'],
        actions: [
          { name: 'ExpenseClaim_Submit', isPublic: true, kind: 'server', storyRefs: ['US-001'] },
          { name: 'ExpenseClaim_SyncToSap', isPublic: false, kind: 'timer', storyRefs: ['US-001'] },
        ],
        queries: [
          osQuery({ name: 'GetClaimsToSync', maxRecords: 1000, fetch: 'server-action', storyRefs: ['US-001'] }),
        ],
      }),
      osModule({
        name: 'Expenses_CS',
        kind: 'core-entities',
        entities: [
          {
            name: 'ExpenseClaim',
            isPublic: true,
            exposeReadOnly: true,
            isStatic: false,
            attributeCount: 8,
            storyRefs: ['US-001'],
          },
          {
            name: 'ExpenseClaimStatus',
            isPublic: true,
            exposeReadOnly: true,
            isStatic: true,
            attributeCount: 3,
            storyRefs: [],
          },
        ],
        actions: [
          { name: 'ExpenseClaim_CreateOrUpdate', isPublic: true, kind: 'server', storyRefs: ['US-001'] },
          { name: 'ExpenseClaim_Delete', isPublic: true, kind: 'server', storyRefs: [] },
        ],
      }),
      osModule({
        name: 'Sap_IS',
        kind: 'connector',
        actions: [{ name: 'Sap_PostDocument', isPublic: true, kind: 'rest-consume', storyRefs: ['US-001'] }],
      }),
      osModule({ name: 'Expenses_Th', kind: 'library' }),
    ],
  };
}
