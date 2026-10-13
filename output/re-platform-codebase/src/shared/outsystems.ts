/**
 * OutSystems implementation-design model.
 *
 * Modules are classified with the module kinds the platform enforces and are
 * mapped onto the OutSystems Architecture Canvas layers:
 *
 *   End-User layer   ← end-user          (UI / screens, no reusable logic)
 *   Core layer       ← business-process  (_BL: processes, orchestrations, workflows)
 *                    ← core-entities     (_CS: core entities + CRUD wrapper actions)
 *   Foundation layer ← connector         (_IS: integration services wrapping external systems)
 *                    ← library           (_Lib / _Th: business-agnostic reusable assets)
 *
 * The dependency rules (no upward references, no side references between
 * end-user modules, no cycles) are evaluated on this model.
 */
import { z } from 'zod';
import { OS_MODULE_KINDS } from './outsystems-layers.js';

export { OS_LAYER_OF_KIND, OS_MODULE_KINDS, OS_RANK_OF_KIND, type OsLayer } from './outsystems-layers.js';
export const OsModuleKindSchema = z.enum(OS_MODULE_KINDS);
export type OsModuleKind = z.infer<typeof OsModuleKindSchema>;

export const OsEntitySchema = z.object({
  name: z.string(),
  isPublic: z.boolean(),
  /** "Expose Read Only" — public core entities must be read-only for consumers. */
  exposeReadOnly: z.boolean(),
  isStatic: z.boolean(),
  attributeCount: z.number(),
  storyRefs: z.array(z.string()),
});
export type OsEntity = z.infer<typeof OsEntitySchema>;

export const OsActionSchema = z.object({
  name: z.string(),
  isPublic: z.boolean(),
  kind: z.enum(['server', 'client', 'service', 'rest-consume', 'rest-expose', 'timer']),
  storyRefs: z.array(z.string()),
});
export type OsAction = z.infer<typeof OsActionSchema>;

export const SQL_JUSTIFICATIONS = ['none', 'bulk-operation', 'unsupported-construct', 'reporting-view'] as const;

export const OsDataQuerySchema = z.object({
  name: z.string(),
  kind: z.enum(['aggregate', 'advanced-sql']),
  /** Number of entity sources joined. */
  sources: z.number(),
  /** Max Records for list queries; null = unbounded. */
  maxRecords: z.number().nullable(),
  returnsList: z.boolean(),
  fetch: z.enum(['at-start', 'on-demand', 'server-action']),
  insideLoop: z.boolean(),
  /** Why advanced SQL was chosen over an aggregate. */
  sqlJustification: z.enum(SQL_JUSTIFICATIONS),
  /** Uses "Expand Inline" parameters (string concatenation into SQL). */
  usesExpandInline: z.boolean(),
  /** Screen that consumes the query, or null for server-side logic. */
  screen: z.string().nullable(),
  storyRefs: z.array(z.string()),
});
export type OsDataQuery = z.infer<typeof OsDataQuerySchema>;

export const OsScreenSchema = z.object({
  name: z.string(),
  storyRefs: z.array(z.string()),
});
export type OsScreen = z.infer<typeof OsScreenSchema>;

export const OsModuleSchema = z.object({
  name: z.string(),
  kind: OsModuleKindSchema,
  /** Names of producer modules this module consumes. */
  references: z.array(z.string()),
  entities: z.array(OsEntitySchema),
  actions: z.array(OsActionSchema),
  queries: z.array(OsDataQuerySchema),
  screens: z.array(OsScreenSchema),
});
export type OsModule = z.infer<typeof OsModuleSchema>;

export const OutSystemsDesignSchema = z.object({
  paradigm: z.literal('outsystems'),
  modules: z.array(OsModuleSchema),
  userRoles: z.array(z.string()),
});
export type OutSystemsDesign = z.infer<typeof OutSystemsDesignSchema>;
