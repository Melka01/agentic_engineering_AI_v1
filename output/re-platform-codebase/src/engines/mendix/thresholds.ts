/**
 * Tunable limits for the Mendix rule engine. Defaults reflect common Mendix
 * best-practice guidance; they are configuration, not code, so teams can align
 * them with their own quality gates (see docs/SOURCES.md for provenance).
 */
export interface MendixThresholds {
  readonly microflowActivityWarning: number;
  readonly microflowActivityError: number;
  readonly microflowDecisionWarning: number;
  readonly maxLoopNesting: number;
  readonly nanoflowMaxMicroflowCalls: number;
  readonly nanoflowMaxDatabaseRetrieves: number;
  readonly xpathMaxAssociationHops: number;
  readonly entityMaxAttributes: number;
  readonly pageMaxEditedDomainEntities: number;
}

export const DEFAULT_MENDIX_THRESHOLDS: MendixThresholds = {
  microflowActivityWarning: 25,
  microflowActivityError: 40,
  microflowDecisionWarning: 8,
  maxLoopNesting: 1,
  nanoflowMaxMicroflowCalls: 1,
  nanoflowMaxDatabaseRetrieves: 1,
  xpathMaxAssociationHops: 2,
  entityMaxAttributes: 40,
  pageMaxEditedDomainEntities: 2,
};

export const MENDIX_FLOW_PREFIXES = [
  'ACT',
  'SUB',
  'DS',
  'VAL',
  'NAV',
  'OCH',
  'OEN',
  'OLE',
  'SCE',
  'BCO',
  'ACO',
  'BDE',
  'ADE',
  'BRO',
  'ARO',
  'BCR',
  'ACR',
  'CAL',
  'IVK',
  'WS',
  'REST',
  'PWS',
  'ASU',
  'BSD',
  'SYN',
  'TRN',
  'QUE',
] as const;

export function mendixGuidance(t: MendixThresholds): string[] {
  return [
    'entities.role "domain" = persisted business data (persistable: true). "view" = UI, search, filter or wizard state ' +
      '(persistable: false, name ends with "VM"). "integration" = API/import message structures (persistable: false).',
    'Never put UI state (IsSelected, Show*, Search*, Filter*, Temp*, Wizard*) on persistable entities; search/filter ' +
      'widgets bind to non-persistable view entities (filterEntities must reference view entities).',
    'Persistable entities must not own associations to non-persistable entities (the view entity owns the association).',
    `Pages that edit more than ${t.pageMaxEditedDomainEntities} persistable entities stage the input in a view model.`,
    'microflows.calledFrom "page" only when the logic needs the server (database retrieve/commit, integration). ' +
      'Validation, navigation and UI logic are nanoflows (VAL_, NAV_, ACT_ prefixes).',
    `Each nanoflow calls at most ${t.nanoflowMaxMicroflowCalls} microflow and performs at most ` +
      `${t.nanoflowMaxDatabaseRetrieves} database retrieve (one round trip per user action).`,
    `Microflows: at most ${t.microflowActivityWarning} activities (hard limit ${t.microflowActivityError}), ` +
      `${t.microflowDecisionWarning} decisions and loop nesting ${t.maxLoopNesting}; extract SUB_ microflows otherwise.`,
    'Never commit or retrieve from the database inside a loop: retrieve once, change objects in memory, commit the list after the loop.',
    'Microflows with integration calls have custom error handling (hasErrorHandling: true).',
    `XPath: at most ${t.xpathMaxAssociationHops} association hops; mark attributes used in XPath constraints as ` +
      'indexed; avoid not(), != on association paths, contains() and OR across association paths; constrain ' +
      'database retrieves with range "all".',
    'Offline profiles (offline-pwa, native-mobile) use database/nanoflow data sources only and call microflows only through nanoflows.',
    `Flow names use a purpose prefix: ${MENDIX_FLOW_PREFIXES.slice(0, 12).join('_, ')}_ …`,
    'All references (page actions, nanoflow microflowCalls, subMicroflows, associations, data sources) must resolve to elements in the design.',
  ];
}
