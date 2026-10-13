/**
 * Architecture Canvas layer constants. Kept free of runtime dependencies (no
 * zod) so the browser bundle can import them.
 */
export const OS_MODULE_KINDS = ['end-user', 'business-process', 'core-entities', 'connector', 'library'] as const;
export type OsModuleKindName = (typeof OS_MODULE_KINDS)[number];

export type OsLayer = 'end-user' | 'core' | 'foundation';

export const OS_LAYER_OF_KIND: Readonly<Record<OsModuleKindName, OsLayer>> = {
  'end-user': 'end-user',
  'business-process': 'core',
  'core-entities': 'core',
  connector: 'foundation',
  library: 'foundation',
};

/**
 * Strict rank used for dependency direction checks. A module may only reference
 * modules with a strictly lower rank, except core-entities ↔ core-entities and
 * business-process → business-process (same kind, acyclic) which are allowed.
 */
export const OS_RANK_OF_KIND: Readonly<Record<OsModuleKindName, number>> = {
  'end-user': 4,
  'business-process': 3,
  'core-entities': 2,
  connector: 1,
  library: 1,
};
