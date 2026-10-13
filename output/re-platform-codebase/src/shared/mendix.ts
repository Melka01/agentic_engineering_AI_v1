/**
 * Mendix implementation-design model.
 *
 * This is a deliberately compact, analysable abstraction of a Mendix app model
 * (modules, domain model, microflows, nanoflows, pages). It carries exactly the
 * facts the Mendix best-practice rule engine needs to reason about:
 *  - domain model vs. view model separation (persistable vs. non-persistable entities),
 *  - client/server round trips (nanoflow vs. microflow placement),
 *  - microflow complexity (activities, decisions, loops, commits/retrieves in loops),
 *  - XPath constraints and attribute indexes.
 */
import { z } from 'zod';

export const MENDIX_ATTRIBUTE_TYPES = [
  'String',
  'Integer',
  'Long',
  'Decimal',
  'Boolean',
  'DateTime',
  'Enumeration',
  'AutoNumber',
  'HashedString',
  'Binary',
] as const;

export const MendixAttributeSchema = z.object({
  name: z.string(),
  type: z.enum(MENDIX_ATTRIBUTE_TYPES),
  /** Whether a database index exists for this attribute (persistable entities only). */
  indexed: z.boolean(),
});
export type MendixAttribute = z.infer<typeof MendixAttributeSchema>;

export const MendixAssociationSchema = z.object({
  name: z.string(),
  /** Target entity name (qualified "Module.Entity" or bare "Entity"). */
  target: z.string(),
  type: z.enum(['reference', 'referenceSet']),
});
export type MendixAssociation = z.infer<typeof MendixAssociationSchema>;

export const MendixEntitySchema = z.object({
  name: z.string(),
  persistable: z.boolean(),
  /**
   * domain      – persisted business data (the domain model)
   * view        – UI/view-model state (must be non-persistable)
   * integration – import/export or API message structures
   */
  role: z.enum(['domain', 'view', 'integration']),
  attributes: z.array(MendixAttributeSchema),
  associations: z.array(MendixAssociationSchema),
  storyRefs: z.array(z.string()),
});
export type MendixEntity = z.infer<typeof MendixEntitySchema>;

export const MendixRetrieveSchema = z.object({
  entity: z.string(),
  source: z.enum(['database', 'association']),
  /** XPath constraint for database retrieves, e.g. "[Status = 'Open']". */
  xpath: z.string().nullable(),
  insideLoop: z.boolean(),
  range: z.enum(['all', 'first', 'custom']),
});
export type MendixRetrieve = z.infer<typeof MendixRetrieveSchema>;

export const MendixMicroflowSchema = z.object({
  name: z.string(),
  activityCount: z.number(),
  decisionCount: z.number(),
  loopCount: z.number(),
  maxLoopNesting: z.number(),
  retrieves: z.array(MendixRetrieveSchema),
  commitCount: z.number(),
  commitsInLoop: z.boolean(),
  /** Calls to REST/SOAP/OData services or Java actions doing I/O. */
  integrationCalls: z.number(),
  hasErrorHandling: z.boolean(),
  calledFrom: z.enum(['page', 'nanoflow', 'microflow', 'scheduled-event', 'published-api', 'event-handler']),
  subMicroflows: z.array(z.string()),
  storyRefs: z.array(z.string()),
});
export type MendixMicroflow = z.infer<typeof MendixMicroflowSchema>;

export const MendixNanoflowSchema = z.object({
  name: z.string(),
  activityCount: z.number(),
  /** Names of microflows called from this nanoflow (each call is a server round trip). */
  microflowCalls: z.array(z.string()),
  /** Database retrieves executed from the nanoflow (each is a round trip in online apps). */
  databaseRetrieves: z.number(),
  calledFrom: z.enum(['page', 'nanoflow', 'widget-event']),
  storyRefs: z.array(z.string()),
});
export type MendixNanoflow = z.infer<typeof MendixNanoflowSchema>;

export const MendixDataSourceSchema = z.object({
  entity: z.string(),
  kind: z.enum(['database', 'microflow', 'nanoflow', 'association', 'context']),
  xpath: z.string().nullable(),
});
export type MendixDataSource = z.infer<typeof MendixDataSourceSchema>;

export const MendixPageActionSchema = z.object({
  trigger: z.string(),
  kind: z.enum(['microflow', 'nanoflow', 'built-in']),
  /** Microflow/nanoflow name, or the built-in action (e.g. "Save changes"). */
  target: z.string(),
});
export type MendixPageAction = z.infer<typeof MendixPageActionSchema>;

export const MendixPageSchema = z.object({
  name: z.string(),
  profile: z.enum(['responsive', 'phone-web', 'native-mobile', 'offline-pwa']),
  dataSources: z.array(MendixDataSourceSchema),
  actions: z.array(MendixPageActionSchema),
  /** Entities whose instances are edited by input widgets on this page. */
  editsEntities: z.array(z.string()),
  /** Search / filter widgets on the page bind to these entities. */
  filterEntities: z.array(z.string()),
  storyRefs: z.array(z.string()),
});
export type MendixPage = z.infer<typeof MendixPageSchema>;

export const MendixModuleSchema = z.object({
  name: z.string(),
  entities: z.array(MendixEntitySchema),
  microflows: z.array(MendixMicroflowSchema),
  nanoflows: z.array(MendixNanoflowSchema),
  pages: z.array(MendixPageSchema),
});
export type MendixModule = z.infer<typeof MendixModuleSchema>;

export const MendixDesignSchema = z.object({
  paradigm: z.literal('mendix'),
  modules: z.array(MendixModuleSchema),
  userRoles: z.array(z.string()),
});
export type MendixDesign = z.infer<typeof MendixDesignSchema>;
