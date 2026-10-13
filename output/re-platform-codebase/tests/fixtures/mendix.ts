import type { UserStory } from '../../src/shared/domain.js';
import type {
  MendixDesign,
  MendixEntity,
  MendixMicroflow,
  MendixNanoflow,
  MendixPage,
} from '../../src/shared/mendix.js';

export function story(id: string, overrides: Partial<UserStory> = {}): UserStory {
  return {
    id,
    title: `Story ${id}`,
    role: 'employee',
    goal: 'submit an expense claim with receipts',
    benefit: 'I get reimbursed within the agreed payment cycle',
    acceptanceCriteria: [
      { given: 'a draft claim with one receipt', when: 'I submit it', then: 'its status becomes Submitted' },
      { given: 'a claim without receipts', when: 'I submit it', then: 'I see a validation message' },
    ],
    priority: 'must',
    storyPoints: 3,
    nfrRefs: [],
    tags: [],
    ...overrides,
  };
}

export const entity = (overrides: Partial<MendixEntity> & { name: string }): MendixEntity => ({
  persistable: true,
  role: 'domain',
  attributes: [],
  associations: [],
  storyRefs: [],
  ...overrides,
});

export const microflow = (overrides: Partial<MendixMicroflow> & { name: string }): MendixMicroflow => ({
  activityCount: 8,
  decisionCount: 1,
  loopCount: 0,
  maxLoopNesting: 0,
  retrieves: [],
  commitCount: 1,
  commitsInLoop: false,
  integrationCalls: 0,
  hasErrorHandling: true,
  calledFrom: 'nanoflow',
  subMicroflows: [],
  storyRefs: [],
  ...overrides,
});

export const nanoflow = (overrides: Partial<MendixNanoflow> & { name: string }): MendixNanoflow => ({
  activityCount: 4,
  microflowCalls: [],
  databaseRetrieves: 0,
  calledFrom: 'page',
  storyRefs: [],
  ...overrides,
});

export const page = (overrides: Partial<MendixPage> & { name: string }): MendixPage => ({
  profile: 'responsive',
  dataSources: [],
  actions: [],
  editsEntities: [],
  filterEntities: [],
  storyRefs: [],
  ...overrides,
});

/** A small, fully compliant Mendix design for an expense-claim app. */
export function compliantMendixDesign(): MendixDesign {
  return {
    paradigm: 'mendix',
    userRoles: ['Employee', 'Manager'],
    modules: [
      {
        name: 'Expenses',
        entities: [
          entity({
            name: 'ExpenseClaim',
            attributes: [
              { name: 'Title', type: 'String', indexed: false },
              { name: 'Amount', type: 'Decimal', indexed: false },
              { name: 'Status', type: 'Enumeration', indexed: true },
              { name: 'SubmittedDate', type: 'DateTime', indexed: true },
            ],
            associations: [{ name: 'ExpenseClaim_Employee', target: 'Expenses.Employee', type: 'reference' }],
            storyRefs: ['US-001'],
          }),
          entity({
            name: 'Employee',
            attributes: [
              { name: 'Name', type: 'String', indexed: true },
              { name: 'Email', type: 'String', indexed: false },
            ],
            storyRefs: ['US-001'],
          }),
          entity({
            name: 'ExpenseClaimSearchVM',
            persistable: false,
            role: 'view',
            attributes: [
              { name: 'SearchText', type: 'String', indexed: false },
              { name: 'StatusFilter', type: 'Enumeration', indexed: false },
            ],
            associations: [{ name: 'ExpenseClaimSearchVM_Employee', target: 'Employee', type: 'reference' }],
            storyRefs: ['US-002'],
          }),
        ],
        microflows: [
          microflow({
            name: 'ACT_ExpenseClaim_Submit',
            activityCount: 12,
            decisionCount: 2,
            retrieves: [
              { entity: 'Employee', source: 'database', xpath: "[Name = 'x']", insideLoop: false, range: 'first' },
            ],
            commitCount: 1,
            calledFrom: 'nanoflow',
            subMicroflows: ['SUB_ExpenseClaim_Notify'],
            storyRefs: ['US-001'],
          }),
          microflow({
            name: 'SUB_ExpenseClaim_Notify',
            activityCount: 5,
            commitCount: 0,
            integrationCalls: 1,
            hasErrorHandling: true,
            calledFrom: 'microflow',
            storyRefs: ['US-001'],
          }),
          microflow({
            name: 'DS_ExpenseClaim_Search',
            activityCount: 6,
            commitCount: 0,
            retrieves: [
              {
                entity: 'ExpenseClaim',
                source: 'database',
                xpath: "[Status = 'Submitted'][SubmittedDate >= '[%BeginOfCurrentMonth%]']",
                insideLoop: false,
                range: 'all',
              },
            ],
            calledFrom: 'page',
            storyRefs: ['US-002'],
          }),
          microflow({
            name: 'SCE_ExpenseClaim_Reminders',
            activityCount: 10,
            loopCount: 1,
            maxLoopNesting: 1,
            retrieves: [
              {
                entity: 'ExpenseClaim',
                source: 'database',
                xpath: "[Status = 'Submitted' and SubmittedDate < '[%BeginOfCurrentDay%]']",
                insideLoop: false,
                range: 'all',
              },
            ],
            commitCount: 1,
            calledFrom: 'scheduled-event',
            storyRefs: ['US-001'],
          }),
        ],
        nanoflows: [
          nanoflow({ name: 'VAL_ExpenseClaim_Validate', storyRefs: ['US-001'] }),
          nanoflow({
            name: 'ACT_ExpenseClaim_Save',
            microflowCalls: ['ACT_ExpenseClaim_Submit'],
            storyRefs: ['US-001'],
          }),
        ],
        pages: [
          page({
            name: 'ExpenseClaim_Overview',
            dataSources: [
              { entity: 'ExpenseClaimSearchVM', kind: 'context', xpath: null },
              { entity: 'ExpenseClaim', kind: 'microflow', xpath: null },
            ],
            editsEntities: ['ExpenseClaimSearchVM'],
            filterEntities: ['ExpenseClaimSearchVM'],
            storyRefs: ['US-002'],
          }),
          page({
            name: 'ExpenseClaim_NewEdit',
            dataSources: [
              { entity: 'ExpenseClaim', kind: 'context', xpath: null },
              { entity: 'Employee', kind: 'database', xpath: "[Name = 'x']" },
            ],
            actions: [
              { trigger: 'Validate', kind: 'nanoflow', target: 'VAL_ExpenseClaim_Validate' },
              { trigger: 'Submit', kind: 'nanoflow', target: 'ACT_ExpenseClaim_Save' },
            ],
            editsEntities: ['ExpenseClaim'],
            storyRefs: ['US-001'],
          }),
        ],
      },
    ],
  };
}
