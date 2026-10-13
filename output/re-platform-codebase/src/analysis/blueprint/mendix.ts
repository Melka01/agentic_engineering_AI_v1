/**
 * Deterministic Mendix blueprint synthesis — the fallback of the blueprint
 * agent. Compliant by construction: every structural choice maps to a rule in
 * the Mendix engine (asserted by tests/analysis/blueprint.test.ts).
 */
import type { MendixBlueprintDraft } from '../../agents/schemas.js';
import type { UserStory } from '../../shared/domain.js';
import type { MendixEntity, MendixMicroflow, MendixModule, MendixNanoflow, MendixPage } from '../../shared/mendix.js';
import type { ArchitectureDecision } from '../../shared/session.js';
import { type Concept, deriveConcepts } from '../concepts.js';
import type { VerbClass } from '../lexicon.js';
import { pascalCase } from '../text.js';

export interface SynthesisInput {
  readonly projectName: string;
  readonly stories: readonly UserStory[];
}

const uniq = (...lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flat())];

export function appName(projectName: string): string {
  const name = pascalCase(projectName).slice(0, 30);
  if (name.length === 0) return 'App';
  return /^\d/.test(name) ? `App${name}` : name;
}

function idsFor(concept: Concept, ...verbs: VerbClass[]): string[] {
  return uniq(...verbs.map((v) => concept.storiesByVerb.get(v) ?? []));
}

function taggedStories(stories: readonly UserStory[], concept: Concept, predicate: (tag: string) => boolean): string[] {
  return stories
    .filter((s) => concept.storyIds.includes(s.id) && s.tags.some((t) => predicate(t.toLowerCase())))
    .map((s) => s.id);
}

function microflow(
  partial: Partial<MendixMicroflow> & Pick<MendixMicroflow, 'name' | 'calledFrom' | 'storyRefs'>,
): MendixMicroflow {
  return {
    activityCount: 8,
    decisionCount: 1,
    loopCount: 0,
    maxLoopNesting: 0,
    retrieves: [],
    commitCount: 0,
    commitsInLoop: false,
    integrationCalls: 0,
    hasErrorHandling: true,
    subMicroflows: [],
    ...partial,
  };
}

function nanoflow(name: string, storyRefs: string[], microflowCalls: string[] = []): MendixNanoflow {
  return { name, activityCount: 5, microflowCalls, databaseRetrieves: 0, calledFrom: 'page', storyRefs };
}

function synthesizeConcept(concept: Concept, stories: readonly UserStory[]) {
  const n = concept.name;
  const entities: MendixEntity[] = [];
  const microflows: MendixMicroflow[] = [];
  const nanoflows: MendixNanoflow[] = [];
  const pages: MendixPage[] = [];

  const createIds = idsFor(concept, 'create', 'update', 'other');
  const approveIds = idsFor(concept, 'approve');
  const viewIds = idsFor(concept, 'view');
  const exportIds = idsFor(concept, 'export');
  const notifyIds = idsFor(concept, 'notify');
  const importIds = idsFor(concept, 'import');
  const deleteIds = idsFor(concept, 'delete');
  const offlineIds = taggedStories(stories, concept, (t) => t === 'offline');
  const bulkIds = taggedStories(stories, concept, (t) => t === 'bulk');
  const integrationStories = (system: string) =>
    taggedStories(stories, concept, (t) => t.startsWith('integration:') && pascalCase(t.slice(12)) === system);

  const needsEdit =
    createIds.length > 0 ||
    deleteIds.length > 0 ||
    (approveIds.length === 0 && viewIds.length === 0 && exportIds.length === 0);
  const needsSearch = viewIds.length > 0 || exportIds.length > 0 || !needsEdit;
  const searchVm = `${n}SearchVM`;

  // --- Domain model (persisted) and view models (non-persistable) ---------
  entities.push({
    name: n,
    persistable: true,
    role: 'domain',
    attributes: [
      { name: 'Reference', type: 'AutoNumber', indexed: false },
      { name: 'Name', type: 'String', indexed: true },
      { name: 'Description', type: 'String', indexed: false },
      { name: 'Status', type: 'Enumeration', indexed: true },
      { name: 'SubmittedOn', type: 'DateTime', indexed: true },
    ],
    associations: [],
    storyRefs: concept.storyIds,
  });
  if (needsSearch) {
    entities.push({
      name: searchVm,
      persistable: false,
      role: 'view',
      attributes: [
        { name: 'SearchText', type: 'String', indexed: false },
        { name: 'StatusFilter', type: 'Enumeration', indexed: false },
        { name: 'FromDate', type: 'DateTime', indexed: false },
      ],
      associations: [],
      storyRefs: uniq(viewIds, exportIds),
    });
  }
  if (concept.integrations.size > 0) {
    entities.push({
      name: `${n}SyncMessage`,
      persistable: false,
      role: 'integration',
      attributes: [
        { name: 'ExternalId', type: 'String', indexed: false },
        { name: 'Payload', type: 'String', indexed: false },
      ],
      associations: [],
      storyRefs: [...concept.integrations].flatMap(integrationStories),
    });
  }

  // --- Notifications -------------------------------------------------------
  const notifySub = `SUB_${n}_Notify`;
  if (notifyIds.length > 0 || approveIds.length > 0) {
    microflows.push(
      microflow({
        name: notifySub,
        calledFrom: 'microflow',
        activityCount: 6,
        integrationCalls: 1,
        storyRefs: uniq(notifyIds, approveIds),
      }),
    );
  }
  if (notifyIds.length > 0) {
    microflows.push(
      microflow({
        name: `SCE_${n}_SendReminders`,
        calledFrom: 'scheduled-event',
        loopCount: 1,
        maxLoopNesting: 1,
        retrieves: [
          {
            entity: n,
            source: 'database',
            xpath: "[Status = 'Submitted'][SubmittedOn < '[%BeginOfCurrentDay%]']",
            insideLoop: false,
            range: 'all',
          },
        ],
        subMicroflows: [notifySub],
        storyRefs: notifyIds,
      }),
    );
  }

  // --- Create / update / delete -------------------------------------------
  if (needsEdit) {
    const commit = `ACT_${n}_Commit`;
    microflows.push(
      microflow({
        name: commit,
        calledFrom: 'nanoflow',
        activityCount: 9,
        decisionCount: 2,
        commitCount: 1,
        storyRefs: createIds,
      }),
    );
    nanoflows.push(nanoflow(`VAL_${n}_Validate`, createIds), nanoflow(`ACT_${n}_Save`, createIds, [commit]));
    const actions: MendixPage['actions'] = [
      { trigger: 'Validate on change', kind: 'nanoflow', target: `VAL_${n}_Validate` },
      { trigger: 'Save', kind: 'nanoflow', target: `ACT_${n}_Save` },
    ];
    if (deleteIds.length > 0) {
      microflows.push(
        microflow({
          name: `ACT_${n}_Delete`,
          calledFrom: 'nanoflow',
          activityCount: 5,
          commitCount: 1,
          storyRefs: deleteIds,
        }),
      );
      nanoflows.push(nanoflow(`ACT_${n}_ConfirmDelete`, deleteIds, [`ACT_${n}_Delete`]));
      actions.push({ trigger: 'Delete', kind: 'nanoflow', target: `ACT_${n}_ConfirmDelete` });
    }
    pages.push({
      name: `${n}_NewEdit`,
      profile: 'responsive',
      dataSources: [{ entity: n, kind: 'context', xpath: null }],
      actions,
      editsEntities: [n],
      filterEntities: [],
      storyRefs: uniq(createIds, deleteIds),
    });
  }

  // --- Overview / search / export -----------------------------------------
  if (needsSearch) {
    const ds = `DS_${n}_Search`;
    const searchXPath = `[Status = $${searchVm}/StatusFilter][starts-with(Name, $${searchVm}/SearchText)]`;
    microflows.push(
      microflow({
        name: ds,
        calledFrom: 'page',
        activityCount: 5,
        retrieves: [{ entity: n, source: 'database', xpath: searchXPath, insideLoop: false, range: 'all' }],
        storyRefs: uniq(viewIds, exportIds),
      }),
    );
    const actions: MendixPage['actions'] = [];
    const localExports = exportIds.filter(
      (id) => !stories.find((s) => s.id === id)?.tags.some((t) => t.startsWith('integration:')),
    );
    if (localExports.length > 0) {
      microflows.push(
        microflow({
          name: `ACT_${n}_Export`,
          calledFrom: 'page',
          activityCount: 7,
          retrieves: [
            {
              entity: n,
              source: 'database',
              xpath: `[Status = $${searchVm}/StatusFilter]`,
              insideLoop: false,
              range: 'all',
            },
          ],
          storyRefs: localExports,
        }),
      );
      actions.push({ trigger: 'Export', kind: 'microflow', target: `ACT_${n}_Export` });
    }
    pages.push({
      name: `${n}_Overview`,
      profile: 'responsive',
      dataSources: [
        { entity: searchVm, kind: 'context', xpath: null },
        { entity: n, kind: 'microflow', xpath: null },
      ],
      actions,
      editsEntities: [searchVm],
      filterEntities: [searchVm],
      storyRefs: uniq(viewIds, exportIds),
    });
  }

  // --- Approval -------------------------------------------------------------
  if (approveIds.length > 0) {
    const process = `ACT_${n}_ProcessDecision`;
    microflows.push(
      microflow({
        name: process,
        calledFrom: 'nanoflow',
        activityCount: 10,
        decisionCount: 3,
        commitCount: 1,
        subMicroflows: [notifySub],
        storyRefs: approveIds,
      }),
    );
    nanoflows.push(nanoflow(`ACT_${n}_Decide`, approveIds, [process]));
    pages.push({
      name: `${n}_Review`,
      profile: 'responsive',
      dataSources: [{ entity: n, kind: 'context', xpath: null }],
      actions: [
        { trigger: 'Approve', kind: 'nanoflow', target: `ACT_${n}_Decide` },
        { trigger: 'Reject', kind: 'nanoflow', target: `ACT_${n}_Decide` },
      ],
      editsEntities: [],
      filterEntities: [],
      storyRefs: approveIds,
    });
  }

  // --- Offline-first --------------------------------------------------------
  if (offlineIds.length > 0) {
    nanoflows.push(nanoflow(`ACT_${n}_SaveOffline`, offlineIds));
    pages.push({
      name: `${n}_Mobile`,
      profile: 'native-mobile',
      dataSources: [{ entity: n, kind: 'database', xpath: "[Status = 'Draft']" }],
      actions: [{ trigger: 'Save', kind: 'nanoflow', target: `ACT_${n}_SaveOffline` }],
      editsEntities: [n],
      filterEntities: [],
      storyRefs: offlineIds,
    });
  }

  // --- Integrations, imports and bulk work (asynchronous) -------------------
  const scheduled = new Set<string>();
  for (const system of concept.integrations) {
    const refs = uniq(
      integrationStories(system),
      bulkIds.filter((id) => integrationStories(system).includes(id)),
    );
    microflows.push(
      microflow({
        name: `SCE_${n}_SyncTo${system}`,
        calledFrom: 'scheduled-event',
        activityCount: 12,
        loopCount: 1,
        maxLoopNesting: 1,
        retrieves: [{ entity: n, source: 'database', xpath: "[Status = 'Approved']", insideLoop: false, range: 'all' }],
        commitCount: 1,
        integrationCalls: 1,
        storyRefs: refs,
      }),
    );
    for (const id of refs) scheduled.add(id);
  }
  if (importIds.length > 0) {
    microflows.push(
      microflow({
        name: `SCE_${n}_Import`,
        calledFrom: 'scheduled-event',
        activityCount: 10,
        loopCount: 1,
        maxLoopNesting: 1,
        commitCount: 1,
        storyRefs: importIds,
      }),
    );
    for (const id of importIds) scheduled.add(id);
  }
  const unscheduledBulk = bulkIds.filter((id) => !scheduled.has(id));
  if (unscheduledBulk.length > 0) {
    microflows.push(
      microflow({
        name: `SCE_${n}_ProcessBatch`,
        calledFrom: 'scheduled-event',
        activityCount: 10,
        loopCount: 1,
        maxLoopNesting: 1,
        retrieves: [
          { entity: n, source: 'database', xpath: "[Status = 'Submitted']", insideLoop: false, range: 'custom' },
        ],
        commitCount: 1,
        storyRefs: unscheduledBulk,
      }),
    );
  }

  return { entities, microflows, nanoflows, pages };
}

export function synthesizeMendixBlueprint(input: SynthesisInput): MendixBlueprintDraft {
  const model = deriveConcepts(input.stories);
  const module: MendixModule = {
    name: appName(input.projectName),
    entities: [],
    microflows: [],
    nanoflows: [],
    pages: [],
  };
  for (const concept of model.concepts) {
    const part = synthesizeConcept(concept, input.stories);
    module.entities.push(...part.entities);
    module.microflows.push(...part.microflows);
    module.nanoflows.push(...part.nanoflows);
    module.pages.push(...part.pages);
  }

  const hasAsync = module.microflows.some((m) => m.calledFrom === 'scheduled-event');
  const hasOffline = module.pages.some((p) => p.profile === 'native-mobile');
  const decisions: ArchitectureDecision[] = [
    {
      id: 'ADR-001',
      title: 'Separate domain model from view models',
      decision:
        'Persisted entities hold business data only; search, filter and UI state live in non-persistable *SearchVM entities.',
      rationale: 'Keeps the domain model clean and avoids database writes for UI state.',
      ruleRefs: ['MX-DM-001', 'MX-DM-002', 'MX-DM-003'],
    },
    {
      id: 'ADR-002',
      title: 'Nanoflow-first interaction',
      decision:
        'Validation and UI logic run in VAL_/ACT_ nanoflows; each user action makes at most one microflow call.',
      rationale: 'Minimises client–server round trips and keeps pages responsive.',
      ruleRefs: ['MX-RT-001', 'MX-RT-002'],
    },
    {
      id: 'ADR-003',
      title: 'Small, loop-safe microflows',
      decision:
        'Microflows stay below the activity limits, delegate to SUB_ microflows and never commit or retrieve inside loops.',
      rationale: 'Readable, testable flows without N+1 database access.',
      ruleRefs: ['MX-MF-001', 'MX-MF-004', 'MX-MF-005'],
    },
    {
      id: 'ADR-004',
      title: 'Indexed, shallow XPath',
      decision:
        'Constraints use indexed attributes (Name, Status, SubmittedOn), starts-with() instead of contains(), and at most one association hop.',
      rationale: 'Retrieves stay index-driven as data volumes grow.',
      ruleRefs: ['MX-XP-001', 'MX-XP-003', 'MX-XP-004'],
    },
  ];
  if (hasAsync) {
    decisions.push({
      id: 'ADR-005',
      title: 'Asynchronous integration and batch processing',
      decision:
        'Integrations, imports, reminders and bulk work run in SCE_ scheduled-event microflows with error handling.',
      rationale: 'Users are not blocked by long-running or failure-prone work.',
      ruleRefs: ['MX-ASYNC-001', 'MX-MF-006'],
    });
  }
  if (hasOffline) {
    decisions.push({
      id: 'ADR-006',
      title: 'Offline-first mobile profile',
      decision:
        'Offline stories are delivered in a native-mobile profile over synchronised data with nanoflow-only logic.',
      rationale: 'Works without connectivity; synchronisation handles server updates.',
      ruleRefs: ['MX-OFF-001', 'MX-OFF-002', 'MX-OFF-003'],
    });
  }

  const persistent = module.entities.filter((e) => e.persistable).length;
  return {
    summary:
      `Mendix module ${module.name}: ${persistent} persistent entities, ${module.entities.length - persistent} view/integration ` +
      `entities, ${module.microflows.length} microflows, ${module.nanoflows.length} nanoflows and ${module.pages.length} pages ` +
      `realising ${input.stories.length} stories.`,
    design: {
      paradigm: 'mendix',
      modules: [module],
      userRoles: model.roles.filter((r) => r !== 'System'),
    },
    decisions,
  };
}
