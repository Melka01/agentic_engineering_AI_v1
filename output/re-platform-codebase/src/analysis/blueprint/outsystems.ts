/**
 * Deterministic OutSystems blueprint synthesis — the fallback of the blueprint
 * agent. Produces a 3-layer Architecture Canvas (End-User → Core [_BL, _CS] →
 * Foundation [_IS, _Th]) with downward-only, acyclic references.
 */
import type { OutSystemsBlueprintDraft } from '../../agents/schemas.js';
import type { OsAction, OsDataQuery, OsModule, OsScreen } from '../../shared/outsystems.js';
import type { ArchitectureDecision } from '../../shared/session.js';
import { type Concept, deriveConcepts } from '../concepts.js';
import type { VerbClass } from '../lexicon.js';
import { pascalCase } from '../text.js';
import { appName, type SynthesisInput } from './mendix.js';

const uniq = (...lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flat())];
const idsFor = (c: Concept, ...verbs: VerbClass[]) => uniq(...verbs.map((v) => c.storiesByVerb.get(v) ?? []));

function query(partial: Partial<OsDataQuery> & Pick<OsDataQuery, 'name' | 'storyRefs'>): OsDataQuery {
  return {
    kind: 'aggregate',
    sources: 1,
    maxRecords: 50,
    returnsList: true,
    fetch: 'at-start',
    insideLoop: false,
    sqlJustification: 'none',
    usesExpandInline: false,
    screen: null,
    ...partial,
  };
}

const action = (name: string, kind: OsAction['kind'], storyRefs: string[], isPublic = true): OsAction => ({
  name,
  kind,
  isPublic,
  storyRefs,
});

export function synthesizeOutSystemsBlueprint(input: SynthesisInput): OutSystemsBlueprintDraft {
  const model = deriveConcepts(input.stories);
  const app = appName(input.projectName);
  const tagged = (concept: Concept, predicate: (tag: string) => boolean) =>
    input.stories
      .filter((s) => concept.storyIds.includes(s.id) && s.tags.some((t) => predicate(t.toLowerCase())))
      .map((s) => s.id);

  const cs: OsModule = {
    name: `${app}_CS`,
    kind: 'core-entities',
    references: [],
    entities: [],
    actions: [],
    queries: [],
    screens: [],
  };
  const bl: OsModule = {
    name: `${app}_BL`,
    kind: 'business-process',
    references: [cs.name],
    entities: [],
    actions: [],
    queries: [],
    screens: [],
  };
  const theme: OsModule = {
    name: `${app}_Th`,
    kind: 'library',
    references: [],
    entities: [],
    actions: [],
    queries: [],
    screens: [],
  };
  const ui: OsModule = {
    name: app,
    kind: 'end-user',
    references: [cs.name, theme.name],
    entities: [],
    actions: [],
    queries: [],
    screens: [],
  };
  const connectors = new Map<string, OsModule>();

  for (const concept of model.concepts) {
    const n = concept.name;
    const createIds = idsFor(concept, 'create', 'update', 'other');
    const approveIds = idsFor(concept, 'approve');
    const viewIds = idsFor(concept, 'view');
    const exportIds = idsFor(concept, 'export');
    const notifyIds = idsFor(concept, 'notify');
    const importIds = idsFor(concept, 'import');
    const deleteIds = idsFor(concept, 'delete');
    const offlineIds = tagged(concept, (t) => t === 'offline');
    const bulkIds = tagged(concept, (t) => t === 'bulk');

    // Core Entities: read-only exposure + CRUD wrappers.
    cs.entities.push(
      {
        name: n,
        isPublic: true,
        exposeReadOnly: true,
        isStatic: false,
        attributeCount: 6,
        storyRefs: concept.storyIds,
      },
      { name: `${n}Status`, isPublic: true, exposeReadOnly: true, isStatic: true, attributeCount: 3, storyRefs: [] },
    );
    cs.actions.push(
      action(`${n}_CreateOrUpdate`, 'server', uniq(createIds, approveIds)),
      action(`${n}_Delete`, 'server', deleteIds),
    );

    // Business processes.
    if (approveIds.length > 0) {
      bl.actions.push(action(`${n}_Approve`, 'server', approveIds), action(`${n}_Reject`, 'server', approveIds));
    }
    if (notifyIds.length > 0 || approveIds.length > 0) {
      bl.actions.push(action(`${n}_Notify`, 'server', uniq(notifyIds, approveIds)));
    }
    if (notifyIds.length > 0) {
      bl.actions.push(action(`${n}_SendReminders`, 'timer', notifyIds, false));
      bl.queries.push(
        query({ name: `Get${n}sAwaitingAction`, maxRecords: 500, fetch: 'server-action', storyRefs: notifyIds }),
      );
    }
    const scheduled = new Set<string>();
    for (const system of concept.integrations) {
      const isName = `${system}_IS`;
      const refs = tagged(concept, (t) => t.startsWith('integration:') && pascalCase(t.slice(12)) === system);
      const connector = connectors.get(isName) ?? {
        name: isName,
        kind: 'connector' as const,
        references: [],
        entities: [],
        actions: [],
        queries: [],
        screens: [],
      };
      connector.actions.push(action(`${system}_Send${n}`, 'rest-consume', refs));
      connectors.set(isName, connector);
      if (!bl.references.includes(isName)) bl.references.push(isName);
      bl.actions.push(action(`${n}_SyncTo${system}`, 'timer', refs, false));
      bl.queries.push(
        query({ name: `Get${n}sToSyncTo${system}`, maxRecords: 1000, fetch: 'server-action', storyRefs: refs }),
      );
      for (const id of refs) scheduled.add(id);
    }
    if (importIds.length > 0) {
      bl.actions.push(action(`${n}_Import`, 'timer', importIds, false));
      for (const id of importIds) scheduled.add(id);
    }
    const unscheduledBulk = bulkIds.filter((id) => !scheduled.has(id));
    if (unscheduledBulk.length > 0) bl.actions.push(action(`${n}_ProcessBatch`, 'timer', unscheduledBulk, false));

    // End-user screens with paginated aggregates.
    const listScreen: OsScreen = { name: `${n}s`, storyRefs: uniq(viewIds, exportIds) };
    const detailScreen: OsScreen = { name: `${n}Detail`, storyRefs: uniq(createIds, deleteIds) };
    ui.screens.push(listScreen, detailScreen);
    ui.queries.push(
      query({ name: `Get${n}s`, sources: 2, screen: listScreen.name, storyRefs: listScreen.storyRefs }),
      query({
        name: `Get${n}ById`,
        maxRecords: 1,
        returnsList: false,
        screen: detailScreen.name,
        storyRefs: detailScreen.storyRefs,
      }),
    );
    if (exportIds.length > 0) {
      ui.queries.push(
        query({
          name: `Get${n}sForExport`,
          maxRecords: 5000,
          fetch: 'on-demand',
          screen: listScreen.name,
          storyRefs: exportIds,
        }),
      );
    }
    if (approveIds.length > 0) {
      ui.screens.push({ name: `${n}Review`, storyRefs: approveIds });
      ui.queries.push(
        query({
          name: `Get${n}ForReview`,
          sources: 2,
          maxRecords: 1,
          returnsList: false,
          screen: `${n}Review`,
          storyRefs: approveIds,
        }),
      );
    }
    if (offlineIds.length > 0) {
      ui.entities.push({
        name: `Local${n}`,
        isPublic: false,
        exposeReadOnly: false,
        isStatic: false,
        attributeCount: 6,
        storyRefs: offlineIds,
      });
      ui.screens.push({ name: `${n}Offline`, storyRefs: offlineIds });
      ui.queries.push(query({ name: `GetLocal${n}s`, screen: `${n}Offline`, storyRefs: offlineIds }));
    }
  }

  const modules: OsModule[] = [ui];
  if (bl.actions.length > 0 || bl.queries.length > 0) {
    ui.references.splice(1, 0, bl.name);
    modules.push(bl);
  }
  modules.push(cs, ...connectors.values(), theme);

  const decisions: ArchitectureDecision[] = [
    {
      id: 'ADR-001',
      title: '3-layer Architecture Canvas',
      decision: `End-user module ${app} consumes Core modules (${modules
        .filter((m) => m.kind === 'business-process' || m.kind === 'core-entities')
        .map((m) => m.name)
        .join(', ')}) which consume Foundation modules only.`,
      rationale: 'Each layer has a single responsibility and can evolve independently.',
      ruleRefs: ['OS-ARCH-001', 'OS-ARCH-002', 'OS-ARCH-004'],
    },
    {
      id: 'ADR-002',
      title: 'Acyclic module dependencies',
      decision: 'References only point down the canvas; no module references a consumer.',
      rationale: 'Modules can be published independently without cascading deployments.',
      ruleRefs: ['OS-ARCH-003'],
    },
    {
      id: 'ADR-003',
      title: 'Encapsulated core entities',
      decision: `Entities in ${cs.name} are exposed read-only; writes go through <Entity>_CreateOrUpdate / <Entity>_Delete.`,
      rationale: 'Validation, auditing and business rules cannot be bypassed by consumers.',
      ruleRefs: ['OS-ENC-001', 'OS-ENC-002', 'OS-ENC-003'],
    },
    {
      id: 'ADR-004',
      title: 'Aggregates with pagination',
      decision: 'All data access uses aggregates with Max Records; secondary data is fetched on demand.',
      rationale: 'Optimised, database-independent queries and fast screen rendering.',
      ruleRefs: ['OS-DATA-001', 'OS-DATA-004', 'OS-DATA-006'],
    },
  ];
  if (bl.actions.some((a) => a.kind === 'timer')) {
    decisions.push({
      id: 'ADR-005',
      title: 'Asynchronous processing in timers',
      decision: `Integrations, reminders, imports and bulk work run in timers in ${bl.name}.`,
      rationale: 'Long-running work does not hit screen-request timeouts.',
      ruleRefs: ['OS-ASYNC-001'],
    });
  }
  if (connectors.size > 0) {
    decisions.push({
      id: 'ADR-006',
      title: 'Integration services isolate external systems',
      decision: `Each external system is wrapped by its own connector (${[...connectors.keys()].join(', ')}).`,
      rationale: 'Vendor API changes stay contained in one Foundation module.',
      ruleRefs: ['OS-ENC-005'],
    });
  }

  return {
    summary: `OutSystems canvas with ${modules.length} modules: end-user ${app}; core ${modules
      .filter((m) => m.kind === 'business-process' || m.kind === 'core-entities')
      .map((m) => m.name)
      .join(', ')}; foundation ${modules
      .filter((m) => m.kind === 'connector' || m.kind === 'library')
      .map((m) => m.name)
      .join(', ')} — realising ${input.stories.length} stories.`,
    design: { paradigm: 'outsystems', modules, userRoles: model.roles.filter((r) => r !== 'System') },
    decisions,
  };
}
