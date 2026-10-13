/** Tunable limits for the OutSystems rule engine (see docs/SOURCES.md). */
export interface OutSystemsThresholds {
  readonly aggregateMaxSources: number;
  readonly screenMaxAtStartQueries: number;
  readonly modulePublicActionWarning: number;
}

export const DEFAULT_OUTSYSTEMS_THRESHOLDS: OutSystemsThresholds = {
  aggregateMaxSources: 5,
  screenMaxAtStartQueries: 4,
  modulePublicActionWarning: 30,
};

/** Expected module-name suffix per module kind (Architecture Canvas naming). */
export const OS_SUFFIXES = {
  'core-entities': ['_CS'],
  'business-process': ['_BL'],
  connector: ['_IS'],
  library: ['_Lib', '_Th', '_Pat'],
} as const;

export function outsystemsGuidance(t: OutSystemsThresholds): string[] {
  return [
    'Module kinds and Architecture Canvas layers: end-user (End-User layer: screens only, no suffix); ' +
      'business-process (Core layer, suffix _BL: processes, orchestration, timers); core-entities (Core layer, ' +
      'suffix _CS: core entities and their CRUD wrapper actions); connector (Foundation layer, suffix _IS: wraps one ' +
      'external system); library (Foundation layer, suffix _Lib/_Th/_Pat: business-agnostic reusable assets).',
    'references only point down the canvas: end-user → business-process/core-entities/connector/library; ' +
      'business-process → core-entities/connector/library; core-entities → connector/library; foundation → foundation only.',
    'No references between end-user modules, no circular references (including indirect cycles), and every reference ' +
      'must name a module in the design.',
    'Public core entities are exposed read-only (isPublic: true, exposeReadOnly: true); writes go through public server ' +
      'actions named <Entity>_Create, <Entity>_CreateOrUpdate, <Entity>_Update or <Entity>_Delete.',
    'Screens live only in end-user modules; end-user modules hold no public entities or public actions; connectors hold ' +
      'no business entities.',
    `Keep each module focused: at most ${t.modulePublicActionWarning} public actions.`,
    `Data access: aggregates by default (≤ ${t.aggregateMaxSources} sources each). Screen list queries set maxRecords ` +
      `(pagination); at most ${t.screenMaxAtStartQueries} "at-start" queries per screen, the rest "on-demand". Never ` +
      'query inside a loop.',
    'advanced-sql only when an aggregate cannot express the query (sqlJustification: bulk-operation, ' +
      'unsupported-construct or reporting-view), always parameterised (usesExpandInline: false), and inside Core ' +
      'modules rather than end-user modules.',
    'Bulk or batch stories run asynchronously in a timer (actions.kind "timer") in a _BL module.',
  ];
}
