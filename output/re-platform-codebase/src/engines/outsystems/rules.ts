/**
 * OutSystems best-practice rule catalogue.
 *
 *  OS-ARCH-*  Architecture Canvas layering and dependency graph
 *  OS-ENC-*   module encapsulation
 *  OS-DATA-*  data access (Aggregates over SQL, pagination, N+1)
 *  OS-ASYNC-* asynchronous processing for bulk work
 *  OS-INT-*   model integrity
 */
import type { UserStory } from '../../shared/domain.js';
import {
  OS_LAYER_OF_KIND,
  OS_RANK_OF_KIND,
  type OsModule,
  type OsModuleKind,
  type OutSystemsDesign,
} from '../../shared/outsystems.js';
import type { FindingDraft, RuleDefinition } from '../types.js';
import { type DependencyEdge, findCycles } from './graph.js';
import { OS_SUFFIXES, type OutSystemsThresholds } from './thresholds.js';

export interface OutSystemsContext {
  readonly design: OutSystemsDesign;
  readonly stories: readonly UserStory[];
  readonly thresholds: OutSystemsThresholds;
  readonly modules: ReadonlyMap<string, OsModule>;
  /** Edges between modules that exist in the design. */
  readonly edges: readonly DependencyEdge[];
}

export function buildOutSystemsContext(
  design: OutSystemsDesign,
  stories: readonly UserStory[],
  thresholds: OutSystemsThresholds,
): OutSystemsContext {
  const modules = new Map(design.modules.map((m) => [m.name, m]));
  const edges = design.modules.flatMap((m) =>
    [...new Set(m.references)].filter((to) => modules.has(to)).map((to) => ({ from: m.name, to })),
  );
  return { design, stories, thresholds, modules, edges };
}

const LAYER_LABEL: Readonly<Record<OsModuleKind, string>> = {
  'end-user': 'End-User',
  'business-process': 'Core (Business Process)',
  'core-entities': 'Core (Core Entities)',
  connector: 'Foundation (Connector)',
  library: 'Foundation (Library)',
};

const moduleTarget = (name: string) => ({ kind: 'module' as const, id: name });
const storyRefsOf = (m: OsModule): string[] => [
  ...new Set([
    ...m.entities.flatMap((e) => e.storyRefs),
    ...m.actions.flatMap((a) => a.storyRefs),
    ...m.queries.flatMap((q) => q.storyRefs),
    ...m.screens.flatMap((s) => s.storyRefs),
  ]),
];

function edgesWithModules(ctx: OutSystemsContext): { from: OsModule; to: OsModule }[] {
  return ctx.edges.flatMap(({ from, to }) => {
    const a = ctx.modules.get(from);
    const b = ctx.modules.get(to);
    return a !== undefined && b !== undefined ? [{ from: a, to: b }] : [];
  });
}

// ---------------------------------------------------------------------------
// Architecture Canvas
// ---------------------------------------------------------------------------

const noUpwardReferences: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ARCH-001',
  title: 'No upward references',
  category: 'architecture-layers',
  severity: 'error',
  rationale:
    'Lower canvas layers must not consume higher ones (Foundation → Core, Core → End-User, Core Entities → Business Processes); upward references couple reusable services to consumers.',
  evaluate: (ctx) =>
    edgesWithModules(ctx)
      .filter(({ from, to }) => OS_RANK_OF_KIND[from.kind] < OS_RANK_OF_KIND[to.kind])
      .map(({ from, to }) => ({
        message: `${from.name} [${LAYER_LABEL[from.kind]}] references ${to.name} [${LAYER_LABEL[to.kind]}] — an upward reference.`,
        target: { kind: 'dependency', id: `${from.name}->${to.name}` },
        remediation: `Invert the dependency: move the shared element from ${to.name} down into ${from.name}'s layer or below, or orchestrate from a higher module.`,
        storyRefs: storyRefsOf(from),
      })),
};

const noSideReferencesBetweenEndUserModules: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ARCH-002',
  title: 'No side references between end-user modules',
  category: 'architecture-layers',
  severity: 'error',
  rationale:
    'End-user modules are independent consumers; sharing logic between them belongs in Core or Foundation modules.',
  evaluate: (ctx) =>
    edgesWithModules(ctx)
      .filter(({ from, to }) => from.kind === 'end-user' && to.kind === 'end-user')
      .map(({ from, to }) => ({
        message: `End-user module ${from.name} references end-user module ${to.name}.`,
        target: { kind: 'dependency', id: `${from.name}->${to.name}` },
        remediation: 'Move the shared screens/blocks to a library module or the shared logic to a _BL/_CS module.',
        storyRefs: storyRefsOf(from),
      })),
};

const noCircularReferences: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ARCH-003',
  title: 'No circular references',
  category: 'dependencies',
  severity: 'error',
  rationale: 'Cycles make modules impossible to deploy independently and force all of them to be published together.',
  evaluate: (ctx) =>
    findCycles([...ctx.modules.keys()], ctx.edges).map((cycle) => ({
      message: `Circular reference between ${cycle.join(' ↔ ')}.`,
      target: { kind: 'dependency', id: cycle.join('<->') },
      remediation: 'Break the cycle by extracting the shared elements into a lower-layer module that both consume.',
      storyRefs: cycle.flatMap((name) => {
        const m = ctx.modules.get(name);
        return m === undefined ? [] : storyRefsOf(m);
      }),
    })),
};

const namingMatchesKind: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ARCH-004',
  title: 'Module names reveal their canvas role',
  category: 'architecture-layers',
  severity: 'warning',
  rationale:
    'Suffixes (_CS, _BL, _IS, _Lib/_Th) make layer violations visible in reviews and in the dependency viewer.',
  evaluate: (ctx) =>
    ctx.design.modules.flatMap((m): FindingDraft[] => {
      const all = Object.values(OS_SUFFIXES).flat() as string[];
      if (m.kind === 'end-user') {
        const wrong = all.find((s) => m.name.endsWith(s));
        return wrong === undefined
          ? []
          : [
              {
                message: `End-user module ${m.name} carries the ${wrong} suffix of another module kind.`,
                target: moduleTarget(m.name),
                remediation: 'Rename the module or reclassify it.',
              },
            ];
      }
      const expected: readonly string[] = OS_SUFFIXES[m.kind];
      return expected.some((s) => m.name.endsWith(s))
        ? []
        : [
            {
              message: `${LAYER_LABEL[m.kind]} module ${m.name} should end with ${expected.join(' or ')}.`,
              target: moduleTarget(m.name),
              remediation: `Rename to ${m.name}${expected[0] ?? ''}.`,
            },
          ];
    }),
};

// ---------------------------------------------------------------------------
// Encapsulation
// ---------------------------------------------------------------------------

const readOnlyCoreEntities: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ENC-001',
  title: 'Expose core entities read-only',
  category: 'encapsulation',
  severity: 'error',
  rationale:
    'Writable public entities let every consumer bypass validation and auditing; consumers must write through the CRUD wrapper actions.',
  evaluate: (ctx) =>
    ctx.design.modules.flatMap((m) =>
      m.entities
        .filter((e) => e.isPublic && !e.exposeReadOnly && !e.isStatic)
        .map((e) => ({
          message: `Public entity ${m.name}.${e.name} is not exposed read-only.`,
          target: { kind: 'entity' as const, id: `${m.name}.${e.name}` },
          remediation: `Set "Expose Read Only" = Yes and add public ${e.name}_CreateOrUpdate / ${e.name}_Delete server actions.`,
          storyRefs: e.storyRefs,
        })),
    ),
};

const crudWrappers: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ENC-002',
  title: 'Core entities have CRUD wrapper actions',
  category: 'encapsulation',
  severity: 'warning',
  rationale: 'Read-only entities need public wrapper actions so consumers can write in a controlled way.',
  evaluate: (ctx) =>
    ctx.design.modules
      .filter((m) => m.kind === 'core-entities')
      .flatMap((m) =>
        m.entities
          .filter((e) => e.isPublic && !e.isStatic)
          .filter((e) => {
            const wrappers = new Set(['Create', 'CreateOrUpdate', 'Update', 'Delete'].map((op) => `${e.name}_${op}`));
            return !m.actions.some((a) => a.isPublic && wrappers.has(a.name));
          })
          .map((e) => ({
            message: `Core entity ${m.name}.${e.name} has no public CRUD wrapper action.`,
            target: { kind: 'entity' as const, id: `${m.name}.${e.name}` },
            remediation: `Add public server actions ${e.name}_CreateOrUpdate and ${e.name}_Delete in ${m.name}.`,
            storyRefs: e.storyRefs,
          })),
      ),
};

const endUserModulesHoldNoCoreEntities: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ENC-003',
  title: 'Business entities live in Core Entities modules',
  category: 'encapsulation',
  severity: 'error',
  rationale: 'Entities defined in end-user or business-process modules cannot be reused without breaking the canvas.',
  evaluate: (ctx) =>
    ctx.design.modules
      .filter((m) => m.kind === 'end-user' || m.kind === 'business-process')
      .flatMap((m) =>
        m.entities
          // Local storage entities ("Local*") of mobile end-user modules are the documented exception.
          .filter((e) => !e.isStatic && !(m.kind === 'end-user' && /^Local[A-Z]/.test(e.name) && !e.isPublic))
          .map((e) => ({
            message: `${LAYER_LABEL[m.kind]} module ${m.name} defines business entity ${e.name}.`,
            target: { kind: 'entity' as const, id: `${m.name}.${e.name}` },
            remediation: `Move ${e.name} to a _CS module and consume it read-only.`,
            storyRefs: e.storyRefs,
            severity: e.isPublic ? ('error' as const) : ('warning' as const),
          })),
      ),
};

const endUserModulesArePureConsumers: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ENC-004',
  title: 'End-user modules expose no public actions',
  category: 'encapsulation',
  severity: 'warning',
  rationale: 'End-user modules must not be producers; public actions there invite side references.',
  evaluate: (ctx) =>
    ctx.design.modules
      .filter((m) => m.kind === 'end-user')
      .flatMap((m) =>
        m.actions
          .filter((a) => a.isPublic)
          .map((a) => ({
            message: `End-user module ${m.name} exposes public action ${a.name}.`,
            target: { kind: 'action' as const, id: `${m.name}.${a.name}` },
            remediation: 'Make the action private or move reusable logic to a _BL module.',
            storyRefs: a.storyRefs,
          })),
      ),
};

const connectorsHoldNoBusinessEntities: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ENC-005',
  title: 'Connectors wrap integrations, not business data',
  category: 'encapsulation',
  severity: 'warning',
  rationale:
    'Integration services (_IS) should translate external APIs; persisting business data there couples the domain to a vendor.',
  evaluate: (ctx) =>
    ctx.design.modules
      .filter((m) => m.kind === 'connector' || m.kind === 'library')
      .flatMap((m) =>
        m.entities
          .filter((e) => e.isPublic && !e.isStatic)
          .map((e) => ({
            message: `${LAYER_LABEL[m.kind]} module ${m.name} exposes entity ${e.name}.`,
            target: { kind: 'entity' as const, id: `${m.name}.${e.name}` },
            remediation: 'Expose structures from the connector and persist business data in a _CS module.',
            storyRefs: e.storyRefs,
          })),
      ),
};

const screensOnlyInEndUserModules: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ENC-006',
  title: 'Screens only in end-user modules',
  category: 'encapsulation',
  severity: 'error',
  rationale: 'Core and Foundation modules must stay UI-free so they can serve any consumer.',
  evaluate: (ctx) =>
    ctx.design.modules
      .filter((m) => m.kind !== 'end-user' && m.screens.length > 0)
      .map((m) => ({
        message: `${LAYER_LABEL[m.kind]} module ${m.name} contains ${m.screens.length} screen(s).`,
        target: moduleTarget(m.name),
        remediation: 'Move the screens to an end-user module (reusable UI belongs in blocks of a library module).',
        storyRefs: m.screens.flatMap((s) => s.storyRefs),
      })),
};

const focusedModules: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ENC-007',
  title: 'Keep module public surfaces focused',
  category: 'encapsulation',
  severity: 'warning',
  rationale:
    'Modules with very large public surfaces become monoliths with many consumers and slow, risky deployments.',
  evaluate: (ctx) =>
    ctx.design.modules
      .filter((m) => m.actions.filter((a) => a.isPublic).length > ctx.thresholds.modulePublicActionWarning)
      .map((m) => ({
        message: `Module ${m.name} exposes ${m.actions.filter((a) => a.isPublic).length} public actions (limit ${ctx.thresholds.modulePublicActionWarning}).`,
        target: moduleTarget(m.name),
        remediation: 'Split the module by business concept so consumers only depend on what they use.',
      })),
};

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

const allQueries = (ctx: OutSystemsContext) =>
  ctx.design.modules.flatMap((m) => m.queries.map((q) => ({ module: m, query: q })));

const aggregatesOverSql: RuleDefinition<OutSystemsContext> = {
  id: 'OS-DATA-001',
  title: 'Prefer Aggregates over custom SQL',
  category: 'data-access',
  severity: 'error',
  rationale:
    'Aggregates are optimised by the platform, database-independent and refactor-safe; advanced SQL is only for what aggregates cannot express.',
  evaluate: (ctx) =>
    allQueries(ctx)
      .filter(({ query }) => query.kind === 'advanced-sql' && query.sqlJustification === 'none')
      .map(({ module, query }) => ({
        message: `Query ${module.name}.${query.name} uses advanced SQL without a justification.`,
        target: { kind: 'query' as const, id: `${module.name}.${query.name}` },
        remediation:
          'Rewrite it as an Aggregate, or document why SQL is required (bulk operation, unsupported construct, reporting view).',
        storyRefs: query.storyRefs,
      })),
};

const noExpandInline: RuleDefinition<OutSystemsContext> = {
  id: 'OS-DATA-002',
  title: 'No Expand Inline parameters in SQL',
  category: 'data-access',
  severity: 'error',
  rationale: 'Expand Inline concatenates values into SQL text and opens the door to SQL injection.',
  evaluate: (ctx) =>
    allQueries(ctx)
      .filter(({ query }) => query.kind === 'advanced-sql' && query.usesExpandInline)
      .map(({ module, query }) => ({
        message: `SQL query ${module.name}.${query.name} uses Expand Inline parameters.`,
        target: { kind: 'query' as const, id: `${module.name}.${query.name}` },
        remediation: 'Use regular (bound) parameters; for dynamic IN lists use BuildSafe_InClause helpers.',
        storyRefs: query.storyRefs,
      })),
};

const noQueriesInLoops: RuleDefinition<OutSystemsContext> = {
  id: 'OS-DATA-003',
  title: 'No queries inside loops',
  category: 'data-access',
  severity: 'error',
  rationale: 'Running an aggregate or SQL query per iteration is the N+1 query anti-pattern.',
  evaluate: (ctx) =>
    allQueries(ctx)
      .filter(({ query }) => query.insideLoop)
      .map(({ module, query }) => ({
        message: `Query ${module.name}.${query.name} runs inside a loop.`,
        target: { kind: 'query' as const, id: `${module.name}.${query.name}` },
        remediation: 'Fetch the full set once with a join/filter before the loop and look up records in memory.',
        storyRefs: query.storyRefs,
      })),
};

const paginatedScreenLists: RuleDefinition<OutSystemsContext> = {
  id: 'OS-DATA-004',
  title: 'Paginate screen list queries',
  category: 'data-access',
  severity: 'warning',
  rationale: 'Unbounded list queries fetch every row to the client; set Max Records and paginate.',
  evaluate: (ctx) =>
    allQueries(ctx)
      .filter(({ query }) => query.screen !== null && query.returnsList && query.maxRecords === null)
      .map(({ module, query }) => ({
        message: `Screen query ${module.name}.${query.name} returns an unbounded list.`,
        target: { kind: 'query' as const, id: `${module.name}.${query.name}` },
        remediation: 'Set Max Records (e.g. 50) and use the Pagination pattern with Start Index.',
        storyRefs: query.storyRefs,
      })),
};

const aggregateSources: RuleDefinition<OutSystemsContext> = {
  id: 'OS-DATA-005',
  title: 'Limit sources per aggregate',
  category: 'data-access',
  severity: 'warning',
  rationale: 'Aggregates joining many sources become slow and hard to optimise; denormalise or split.',
  evaluate: (ctx) =>
    allQueries(ctx)
      .filter(({ query }) => query.kind === 'aggregate' && query.sources > ctx.thresholds.aggregateMaxSources)
      .map(({ module, query }) => ({
        message: `Aggregate ${module.name}.${query.name} joins ${query.sources} sources (limit ${ctx.thresholds.aggregateMaxSources}).`,
        target: { kind: 'query' as const, id: `${module.name}.${query.name}` },
        remediation: 'Split the aggregate, fetch secondary data on demand, or introduce a reporting entity.',
        storyRefs: query.storyRefs,
      })),
};

const screenAtStartQueries: RuleDefinition<OutSystemsContext> = {
  id: 'OS-DATA-006',
  title: 'Limit at-start queries per screen',
  category: 'data-access',
  severity: 'warning',
  rationale: 'Every at-start aggregate delays screen rendering; fetch secondary data only on demand.',
  evaluate: (ctx) =>
    ctx.design.modules.flatMap((m) =>
      m.screens.flatMap((screen) => {
        const atStart = m.queries.filter((q) => q.screen === screen.name && q.fetch === 'at-start');
        return atStart.length > ctx.thresholds.screenMaxAtStartQueries
          ? [
              {
                message: `Screen ${m.name}.${screen.name} runs ${atStart.length} queries at start (limit ${ctx.thresholds.screenMaxAtStartQueries}).`,
                target: { kind: 'screen' as const, id: `${m.name}.${screen.name}` },
                remediation: 'Switch secondary aggregates to "Only on demand" or combine them in a Data Action.',
                storyRefs: screen.storyRefs,
              },
            ]
          : [];
      }),
    ),
};

const sqlStaysInCore: RuleDefinition<OutSystemsContext> = {
  id: 'OS-DATA-007',
  title: 'Advanced SQL belongs in Core modules',
  category: 'data-access',
  severity: 'warning',
  rationale: 'SQL in end-user modules duplicates data logic in consumers; centralise it in a _CS/_BL server action.',
  evaluate: (ctx) =>
    allQueries(ctx)
      .filter(({ module, query }) => query.kind === 'advanced-sql' && OS_LAYER_OF_KIND[module.kind] === 'end-user')
      .map(({ module, query }) => ({
        message: `End-user module ${module.name} runs advanced SQL ${query.name}.`,
        target: { kind: 'query' as const, id: `${module.name}.${query.name}` },
        remediation: 'Move the query into a public server action of a Core module.',
        storyRefs: query.storyRefs,
      })),
};

// ---------------------------------------------------------------------------
// Asynchronous processing
// ---------------------------------------------------------------------------

const bulkStoriesUseTimers: RuleDefinition<OutSystemsContext> = {
  id: 'OS-ASYNC-001',
  title: 'Bulk work runs asynchronously',
  category: 'async-processing',
  severity: 'warning',
  rationale: 'Bulk imports and batch updates in screen actions hit request timeouts; run them in Timers or light BPT.',
  evaluate: (ctx) =>
    ctx.stories
      .filter((s) => s.tags.some((t) => t.toLowerCase() === 'bulk'))
      .filter(
        (s) => !ctx.design.modules.some((m) => m.actions.some((a) => a.kind === 'timer' && a.storyRefs.includes(s.id))),
      )
      .map((s) => ({
        message: `Bulk story ${s.id} is not realised by a Timer.`,
        target: { kind: 'story' as const, id: s.id },
        remediation: 'Add a timer action in a _BL module that processes the work in batches with checkpointing.',
        storyRefs: [s.id],
      })),
};

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

const referencesResolve: RuleDefinition<OutSystemsContext> = {
  id: 'OS-INT-001',
  title: 'Module references must resolve',
  category: 'model-integrity',
  severity: 'error',
  rationale: 'References to modules that do not exist make the dependency analysis incomplete.',
  evaluate: (ctx) =>
    ctx.design.modules.flatMap((m) =>
      m.references
        .filter((ref) => !ctx.modules.has(ref))
        .map((ref) => ({
          message: `Module ${m.name} references unknown module ${ref}.`,
          target: moduleTarget(m.name),
          remediation: `Add ${ref} to the design or remove the reference.`,
          storyRefs: storyRefsOf(m),
        })),
    ),
};

const queriesBindToScreens: RuleDefinition<OutSystemsContext> = {
  id: 'OS-INT-002',
  title: 'Screen queries bind to screens of their module',
  category: 'model-integrity',
  severity: 'error',
  rationale: 'A screen aggregate must belong to an existing screen in the same module.',
  evaluate: (ctx) =>
    allQueries(ctx)
      .filter(({ module, query }) => query.screen !== null && !module.screens.some((s) => s.name === query.screen))
      .map(({ module, query }) => ({
        message: `Query ${module.name}.${query.name} is bound to unknown screen ${query.screen ?? ''}.`,
        target: { kind: 'query' as const, id: `${module.name}.${query.name}` },
        remediation: 'Bind the query to a screen of the same module or make it a server-side query (screen: null).',
        storyRefs: query.storyRefs,
      })),
};

export const OUTSYSTEMS_RULES: readonly RuleDefinition<OutSystemsContext>[] = [
  noUpwardReferences,
  noSideReferencesBetweenEndUserModules,
  noCircularReferences,
  namingMatchesKind,
  readOnlyCoreEntities,
  crudWrappers,
  endUserModulesHoldNoCoreEntities,
  endUserModulesArePureConsumers,
  connectorsHoldNoBusinessEntities,
  screensOnlyInEndUserModules,
  focusedModules,
  aggregatesOverSql,
  noExpandInline,
  noQueriesInLoops,
  paginatedScreenLists,
  aggregateSources,
  screenAtStartQueries,
  sqlStaysInCore,
  bulkStoriesUseTimers,
  referencesResolve,
  queriesBindToScreens,
];
