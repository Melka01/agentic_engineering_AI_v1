/**
 * Mendix best-practice rule catalogue.
 *
 *  MX-DM-*   domain model vs. view model separation
 *  MX-RT-*   client/server round trips (nanoflows first)
 *  MX-MF-*   microflow complexity and data access in flows
 *  MX-XP-*   XPath optimisation
 *  MX-OFF-*  offline-first constraints
 *  MX-INT-*  model integrity (dangling references)
 */
import type { UserStory } from '../../shared/domain.js';
import type { MendixDesign, MendixEntity, MendixMicroflow, MendixNanoflow, MendixPage } from '../../shared/mendix.js';
import { bareName } from '../engine.js';
import type { FindingDraft, RuleDefinition } from '../types.js';
import { MENDIX_FLOW_PREFIXES, type MendixThresholds } from './thresholds.js';
import { analyzeXPath } from './xpath.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Located<T> {
  readonly item: T;
  readonly module: string;
}

export interface XPathUse {
  readonly xpath: string;
  readonly entity: string;
  readonly owner: { readonly kind: 'microflow' | 'page'; readonly id: string };
  readonly storyRefs: readonly string[];
}

export interface MendixContext {
  readonly design: MendixDesign;
  readonly stories: readonly UserStory[];
  readonly thresholds: MendixThresholds;
  readonly entities: ReadonlyMap<string, Located<MendixEntity>>;
  readonly microflows: ReadonlyMap<string, Located<MendixMicroflow>>;
  readonly nanoflows: ReadonlyMap<string, Located<MendixNanoflow>>;
  readonly pages: readonly Located<MendixPage>[];
  readonly xpathUses: readonly XPathUse[];
}

export function buildMendixContext(
  design: MendixDesign,
  stories: readonly UserStory[],
  thresholds: MendixThresholds,
): MendixContext {
  const entities = new Map<string, Located<MendixEntity>>();
  const microflows = new Map<string, Located<MendixMicroflow>>();
  const nanoflows = new Map<string, Located<MendixNanoflow>>();
  const pages: Located<MendixPage>[] = [];
  const xpathUses: XPathUse[] = [];

  for (const module of design.modules) {
    for (const item of module.entities) entities.set(bareName(item.name), { item, module: module.name });
    for (const item of module.microflows) microflows.set(bareName(item.name), { item, module: module.name });
    for (const item of module.nanoflows) nanoflows.set(bareName(item.name), { item, module: module.name });
    for (const item of module.pages) pages.push({ item, module: module.name });
  }
  for (const { item: flow } of microflows.values()) {
    for (const r of flow.retrieves) {
      if (r.source === 'database' && r.xpath !== null && r.xpath.trim().length > 0) {
        xpathUses.push({
          xpath: r.xpath,
          entity: r.entity,
          owner: { kind: 'microflow', id: flow.name },
          storyRefs: flow.storyRefs,
        });
      }
    }
  }
  for (const { item: page } of pages) {
    for (const ds of page.dataSources) {
      if (ds.kind === 'database' && ds.xpath !== null && ds.xpath.trim().length > 0) {
        xpathUses.push({
          xpath: ds.xpath,
          entity: ds.entity,
          owner: { kind: 'page', id: page.name },
          storyRefs: page.storyRefs,
        });
      }
    }
  }
  return { design, stories, thresholds, entities, microflows, nanoflows, pages, xpathUses };
}

const entityOf = (ctx: MendixContext, name: string): MendixEntity | undefined => ctx.entities.get(bareName(name))?.item;
const isPersistable = (ctx: MendixContext, name: string): boolean => entityOf(ctx, name)?.persistable === true;

const UI_STATE_ATTRIBUTE =
  /^(?:(?:Is)?(?:Selected|Expanded|Collapsed|Checked|Highlighted)|(?:Search|Filter|Temp|Tmp|UI|Ui|Wizard|Display|Show|Hide|Toggle)(?:[A-Z_].*)?)$/;

const SYSTEM_ATTRIBUTES = new Set(['createdDate', 'changedDate', 'owner', 'changedBy']);

/** True when the microflow (or any sub-microflow it calls) touches the database or an integration. */
function doesServerWork(ctx: MendixContext, mf: MendixMicroflow, visited: Set<string>): boolean {
  if (mf.commitCount > 0 || mf.integrationCalls > 0 || mf.retrieves.some((r) => r.source === 'database')) return true;
  visited.add(bareName(mf.name));
  return mf.subMicroflows.some((name) => {
    if (visited.has(bareName(name))) return false;
    const sub = ctx.microflows.get(bareName(name))?.item;
    // Unresolved references are reported by MX-INT-001; assume server work to avoid a double finding.
    return sub === undefined || doesServerWork(ctx, sub, visited);
  });
}

// ---------------------------------------------------------------------------
// Domain model vs. view model
// ---------------------------------------------------------------------------

const viewEntitiesNonPersistable: RuleDefinition<MendixContext> = {
  id: 'MX-DM-001',
  title: 'View-model entities must be non-persistable',
  category: 'domain-model',
  severity: 'error',
  rationale:
    'UI and view state belongs in non-persistable entities; persisting it pollutes the database and couples the UI to the domain model.',
  evaluate: (ctx) =>
    [...ctx.entities.values()]
      .filter(({ item }) => item.role === 'view' && item.persistable)
      .map(({ item, module }) => ({
        message: `Entity ${module}.${item.name} has role "view" but is persistable.`,
        target: { kind: 'entity', id: `${module}.${item.name}` },
        remediation:
          'Make the entity non-persistable (NPE) and map it to domain entities in an ACT_ microflow on save.',
        storyRefs: item.storyRefs,
      })),
};

const noUiStateOnDomainEntities: RuleDefinition<MendixContext> = {
  id: 'MX-DM-002',
  title: 'No UI state on persistable domain entities',
  category: 'domain-model',
  severity: 'error',
  rationale:
    'Attributes such as IsSelected, ShowDetails or SearchText on persisted entities mix view state into the domain model and cause needless writes.',
  evaluate: (ctx) =>
    [...ctx.entities.values()]
      .filter(({ item }) => item.persistable)
      .flatMap(({ item, module }) =>
        item.attributes
          .filter((a) => UI_STATE_ATTRIBUTE.test(a.name))
          .map((a) => ({
            message: `Attribute ${module}.${item.name}.${a.name} looks like UI/view state on a persistable entity.`,
            target: { kind: 'attribute' as const, id: `${module}.${item.name}.${a.name}` },
            remediation: `Move ${a.name} to a non-persistable view entity (e.g. ${item.name}VM) associated with ${item.name}.`,
            storyRefs: item.storyRefs,
          })),
      ),
};

const filtersBindToViewEntities: RuleDefinition<MendixContext> = {
  id: 'MX-DM-003',
  title: 'Search and filter widgets bind to view entities',
  category: 'domain-model',
  severity: 'error',
  rationale:
    'Binding search/filter input to a persistable entity either creates throw-away database rows or mutates domain data; use a non-persistable search view model.',
  evaluate: (ctx) =>
    ctx.pages.flatMap(({ item: page, module }) =>
      page.filterEntities
        .filter((name) => isPersistable(ctx, name))
        .map((name) => ({
          message: `Page ${module}.${page.name} binds search/filter widgets to persistable entity ${name}.`,
          target: { kind: 'page' as const, id: `${module}.${page.name}` },
          remediation: `Introduce a non-persistable ${bareName(name)}SearchVM and constrain the list from it.`,
          storyRefs: page.storyRefs,
        })),
    ),
};

const noPersistableToNonPersistableAssociation: RuleDefinition<MendixContext> = {
  id: 'MX-DM-004',
  title: 'Persistable entities must not own associations to non-persistable entities',
  category: 'domain-model',
  severity: 'error',
  rationale:
    'Mendix does not allow a persistable entity to own an association to a non-persistable entity; the view entity must own the association.',
  evaluate: (ctx) =>
    [...ctx.entities.values()]
      .filter(({ item }) => item.persistable)
      .flatMap(({ item, module }) =>
        item.associations
          .filter((assoc) => {
            const target = entityOf(ctx, assoc.target);
            return target !== undefined && !target.persistable;
          })
          .map((assoc) => ({
            message: `Persistable entity ${module}.${item.name} owns association ${assoc.name} to non-persistable ${assoc.target}.`,
            target: { kind: 'association' as const, id: `${module}.${assoc.name}` },
            remediation: `Reverse the ownership: let ${bareName(assoc.target)} own the association to ${item.name}.`,
            storyRefs: item.storyRefs,
          })),
      ),
};

const entityWidth: RuleDefinition<MendixContext> = {
  id: 'MX-DM-005',
  title: 'Keep entities focused',
  category: 'domain-model',
  severity: 'warning',
  rationale:
    'Very wide entities are expensive to retrieve and usually hide several concepts; split them with associations.',
  evaluate: (ctx) =>
    [...ctx.entities.values()]
      .filter(({ item }) => item.attributes.length > ctx.thresholds.entityMaxAttributes)
      .map(({ item, module }) => ({
        message: `Entity ${module}.${item.name} has ${item.attributes.length} attributes (limit ${ctx.thresholds.entityMaxAttributes}).`,
        target: { kind: 'entity', id: `${module}.${item.name}` },
        remediation: 'Split rarely used or 1-to-1 attribute groups into separate associated entities.',
        storyRefs: item.storyRefs,
      })),
};

const multiEntityFormsUseViewModel: RuleDefinition<MendixContext> = {
  id: 'MX-DM-006',
  title: 'Complex forms stage input in a view model',
  category: 'domain-model',
  severity: 'warning',
  rationale:
    'Editing many domain entities on one page spreads validation and commit logic over widgets; a view model keeps the domain consistent and saves in one transaction.',
  evaluate: (ctx) =>
    ctx.pages.flatMap(({ item: page, module }) => {
      const domain = [...new Set(page.editsEntities.map(bareName))].filter((name) => isPersistable(ctx, name));
      if (domain.length <= ctx.thresholds.pageMaxEditedDomainEntities) return [];
      return [
        {
          message: `Page ${module}.${page.name} edits ${domain.length} persistable entities directly (${domain.join(', ')}).`,
          target: { kind: 'page' as const, id: `${module}.${page.name}` },
          remediation:
            'Bind the form to a non-persistable view model and map it to the domain in one ACT_ save microflow.',
          storyRefs: page.storyRefs,
        },
      ];
    }),
};

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

const clientLogicInNanoflows: RuleDefinition<MendixContext> = {
  id: 'MX-RT-001',
  title: 'Client-only logic must be a nanoflow',
  category: 'round-trips',
  severity: 'error',
  rationale:
    'A microflow triggered from a page always costs a server round trip. Logic without database or integration work runs on the client as a nanoflow.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()]
      .filter(({ item: mf }) => mf.calledFrom === 'page' && !doesServerWork(ctx, mf, new Set()))
      .map(({ item: mf, module }) => ({
        message: `Microflow ${module}.${mf.name} is called from a page but performs no database or integration work.`,
        target: { kind: 'microflow', id: `${module}.${mf.name}` },
        remediation: 'Re-implement it as a nanoflow so it runs on the client without a server round trip.',
        storyRefs: mf.storyRefs,
      })),
};

const nanoflowMicroflowCalls: RuleDefinition<MendixContext> = {
  id: 'MX-RT-002',
  title: 'One server call per user action',
  category: 'round-trips',
  severity: 'warning',
  rationale: 'Every microflow call from a nanoflow is a round trip; chained calls multiply latency.',
  evaluate: (ctx) =>
    [...ctx.nanoflows.values()]
      .filter(({ item }) => item.microflowCalls.length > ctx.thresholds.nanoflowMaxMicroflowCalls)
      .map(({ item, module }) => ({
        message: `Nanoflow ${module}.${item.name} calls ${item.microflowCalls.length} microflows (${item.microflowCalls.join(', ')}).`,
        target: { kind: 'nanoflow', id: `${module}.${item.name}` },
        remediation: 'Combine the server work into a single ACT_ microflow and call it once.',
        storyRefs: item.storyRefs,
      })),
};

const nanoflowDatabaseRetrieves: RuleDefinition<MendixContext> = {
  id: 'MX-RT-003',
  title: 'Limit database retrieves in nanoflows',
  category: 'round-trips',
  severity: 'warning',
  rationale: 'In online apps each database retrieve from a nanoflow is a separate round trip.',
  evaluate: (ctx) =>
    [...ctx.nanoflows.values()]
      .filter(({ item }) => item.databaseRetrieves > ctx.thresholds.nanoflowMaxDatabaseRetrieves)
      .map(({ item, module }) => ({
        message: `Nanoflow ${module}.${item.name} performs ${item.databaseRetrieves} database retrieves.`,
        target: { kind: 'nanoflow', id: `${module}.${item.name}` },
        remediation:
          'Retrieve over associations from objects already on the client, or fetch everything in one DS_ microflow.',
        storyRefs: item.storyRefs,
      })),
};

// ---------------------------------------------------------------------------
// Microflow complexity & data access
// ---------------------------------------------------------------------------

const microflowSize: RuleDefinition<MendixContext> = {
  id: 'MX-MF-001',
  title: 'Split large microflows',
  category: 'microflow-complexity',
  severity: 'warning',
  rationale: 'Large microflows are hard to read, test and reuse; extract cohesive steps into SUB_ microflows.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()]
      .filter(({ item }) => item.activityCount > ctx.thresholds.microflowActivityWarning)
      .map(({ item, module }) => {
        const hard = item.activityCount > ctx.thresholds.microflowActivityError;
        return {
          message: `Microflow ${module}.${item.name} has ${item.activityCount} activities (limit ${
            hard ? ctx.thresholds.microflowActivityError : ctx.thresholds.microflowActivityWarning
          }).`,
          target: { kind: 'microflow' as const, id: `${module}.${item.name}` },
          remediation: 'Extract validation, data preparation and persistence into separate SUB_ microflows.',
          storyRefs: item.storyRefs,
          severity: hard ? ('error' as const) : ('warning' as const),
        };
      }),
};

const microflowDecisions: RuleDefinition<MendixContext> = {
  id: 'MX-MF-002',
  title: 'Limit decision complexity',
  category: 'microflow-complexity',
  severity: 'warning',
  rationale: 'Many decisions in one microflow raise cyclomatic complexity; move branches into sub-microflows or rules.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()]
      .filter(({ item }) => item.decisionCount > ctx.thresholds.microflowDecisionWarning)
      .map(({ item, module }) => ({
        message: `Microflow ${module}.${item.name} has ${item.decisionCount} decisions (limit ${ctx.thresholds.microflowDecisionWarning}).`,
        target: { kind: 'microflow', id: `${module}.${item.name}` },
        remediation:
          'Split per scenario into SUB_ microflows or replace decision chains with an enumeration-driven split.',
        storyRefs: item.storyRefs,
      })),
};

const loopNesting: RuleDefinition<MendixContext> = {
  id: 'MX-MF-003',
  title: 'Avoid nested loops',
  category: 'microflow-complexity',
  severity: 'warning',
  rationale: 'Nested loops grow quadratically with data volume and usually hide an in-memory join.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()]
      .filter(({ item }) => item.maxLoopNesting > ctx.thresholds.maxLoopNesting)
      .map(({ item, module }) => ({
        message: `Microflow ${module}.${item.name} nests loops ${item.maxLoopNesting} deep.`,
        target: { kind: 'microflow', id: `${module}.${item.name}` },
        remediation:
          'Retrieve the inner data once (association or XPath) and process the inner loop in a SUB_ microflow.',
        storyRefs: item.storyRefs,
      })),
};

const commitsInLoops: RuleDefinition<MendixContext> = {
  id: 'MX-MF-004',
  title: 'No commits inside loops',
  category: 'microflow-complexity',
  severity: 'error',
  rationale:
    'Committing per iteration issues one database transaction step per object; collect changed objects in a list and commit the list after the loop.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()]
      .filter(({ item }) => item.commitsInLoop)
      .map(({ item, module }) => ({
        message: `Microflow ${module}.${item.name} commits inside a loop.`,
        target: { kind: 'microflow', id: `${module}.${item.name}` },
        remediation:
          'Disable commit on the change activities, add objects to a list and commit the list once after the loop.',
        storyRefs: item.storyRefs,
      })),
};

const retrievesInLoops: RuleDefinition<MendixContext> = {
  id: 'MX-MF-005',
  title: 'No database retrieves inside loops',
  category: 'microflow-complexity',
  severity: 'error',
  rationale: 'A database retrieve per iteration is the N+1 query anti-pattern.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()].flatMap(({ item, module }) =>
      item.retrieves
        .filter((r) => r.insideLoop && r.source === 'database')
        .map((r) => ({
          message: `Microflow ${module}.${item.name} retrieves ${r.entity} from the database inside a loop.`,
          target: { kind: 'microflow' as const, id: `${module}.${item.name}` },
          remediation: 'Retrieve the full set once before the loop and use list operations (Find/Filter) inside it.',
          storyRefs: item.storyRefs,
        })),
    ),
};

const integrationErrorHandling: RuleDefinition<MendixContext> = {
  id: 'MX-MF-006',
  title: 'Integration calls need error handling',
  category: 'microflow-complexity',
  severity: 'warning',
  rationale:
    'External calls fail; without custom error handling the user sees a generic error and transactions roll back unpredictably.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()]
      .filter(({ item }) => item.integrationCalls > 0 && !item.hasErrorHandling)
      .map(({ item, module }) => ({
        message: `Microflow ${module}.${item.name} makes ${item.integrationCalls} integration call(s) without error handling.`,
        target: { kind: 'microflow', id: `${module}.${item.name}` },
        remediation:
          'Add custom error handling (with rollback or continue), log the error and show a meaningful message.',
        storyRefs: item.storyRefs,
      })),
};

const flowNaming: RuleDefinition<MendixContext> = {
  id: 'MX-MF-007',
  title: 'Flows follow the prefix naming convention',
  category: 'microflow-complexity',
  severity: 'info',
  rationale: 'Purpose prefixes (ACT_, SUB_, DS_, VAL_, …) make the role and call site of a flow obvious.',
  evaluate: (ctx) => {
    const valid = new Set<string>(MENDIX_FLOW_PREFIXES);
    const flows: { name: string; module: string; kind: 'microflow' | 'nanoflow'; storyRefs: readonly string[] }[] = [
      ...[...ctx.microflows.values()].map(({ item, module }) => ({
        name: item.name,
        module,
        kind: 'microflow' as const,
        storyRefs: item.storyRefs,
      })),
      ...[...ctx.nanoflows.values()].map(({ item, module }) => ({
        name: item.name,
        module,
        kind: 'nanoflow' as const,
        storyRefs: item.storyRefs,
      })),
    ];
    return flows
      .filter((f) => !valid.has(bareName(f.name).split('_')[0] ?? '') || !bareName(f.name).includes('_'))
      .map((f) => ({
        message: `${f.kind === 'microflow' ? 'Microflow' : 'Nanoflow'} ${f.module}.${f.name} has no recognised purpose prefix.`,
        target: { kind: f.kind, id: `${f.module}.${f.name}` },
        remediation: `Rename with a prefix such as ACT_, SUB_, DS_, VAL_ or NAV_.`,
        storyRefs: f.storyRefs,
      }));
  },
};

const unboundedRetrieves: RuleDefinition<MendixContext> = {
  id: 'MX-MF-008',
  title: 'Constrain "retrieve all" database retrieves',
  category: 'microflow-complexity',
  severity: 'warning',
  rationale: 'Retrieving all objects without a constraint loads the whole table into memory and degrades with growth.',
  evaluate: (ctx) =>
    [...ctx.microflows.values()].flatMap(({ item, module }) =>
      item.retrieves
        .filter((r) => r.source === 'database' && r.range === 'all' && (r.xpath === null || r.xpath.trim() === ''))
        .map((r) => ({
          message: `Microflow ${module}.${item.name} retrieves all ${r.entity} objects without an XPath constraint.`,
          target: { kind: 'microflow' as const, id: `${module}.${item.name}` },
          remediation: 'Add an XPath constraint and, for batch jobs, process in pages using limit/offset.',
          storyRefs: item.storyRefs,
        })),
    ),
};

// ---------------------------------------------------------------------------
// XPath
// ---------------------------------------------------------------------------

function xpathRule(
  id: string,
  title: string,
  severity: 'error' | 'warning',
  rationale: string,
  check: (use: XPathUse, ctx: MendixContext) => { message: string; remediation: string } | null,
): RuleDefinition<MendixContext> {
  return {
    id,
    title,
    category: 'xpath',
    severity,
    rationale,
    evaluate: (ctx) =>
      ctx.xpathUses.flatMap((use): FindingDraft[] => {
        const hit = check(use, ctx);
        return hit === null
          ? []
          : [{ ...hit, target: { kind: use.owner.kind, id: use.owner.id }, storyRefs: use.storyRefs }];
      }),
  };
}

const xpathMalformed = xpathRule(
  'MX-XP-000',
  'XPath constraints must be well-formed',
  'error',
  'A malformed constraint fails at runtime or silently matches nothing.',
  (use) =>
    analyzeXPath(use.xpath).wellFormed
      ? null
      : {
          message: `XPath "${use.xpath}" on ${use.entity} is malformed (unbalanced brackets or empty constraint).`,
          remediation: 'Write the constraint as [condition] with balanced brackets and parentheses.',
        },
);

const xpathPathDepth = xpathRule(
  'MX-XP-001',
  'Keep XPath association paths short',
  'warning',
  'Every association hop adds a join or subquery; deep paths are a top cause of slow retrieves.',
  (use, ctx) => {
    const hops = analyzeXPath(use.xpath).maxAssociationHops;
    return hops > ctx.thresholds.xpathMaxAssociationHops
      ? {
          message: `XPath on ${use.entity} traverses ${hops} associations (limit ${ctx.thresholds.xpathMaxAssociationHops}): ${use.xpath}`,
          remediation: 'Retrieve from a closer starting object, denormalise a key attribute, or split the retrieve.',
        }
      : null;
  },
);

const xpathNegation = xpathRule(
  'MX-XP-002',
  'Avoid negations in XPath',
  'warning',
  'not() and != on association paths compile to NOT EXISTS / outer-join subqueries that cannot use indexes efficiently.',
  (use) => {
    const a = analyzeXPath(use.xpath);
    return a.usesNot || a.notEqualsOnPath
      ? {
          message: `XPath on ${use.entity} uses a negation (${a.usesNot ? 'not()' : '!= on an association path'}): ${use.xpath}`,
          remediation:
            'Express the positive condition (e.g. an enumeration value or boolean flag) instead of negating.',
        }
      : null;
  },
);

const xpathIndexes = xpathRule(
  'MX-XP-003',
  'Index attributes used in XPath constraints',
  'warning',
  'Constraints on non-indexed attributes force full table scans as data grows.',
  (use, ctx) => {
    const entity = entityOf(ctx, use.entity);
    if (entity === undefined || !entity.persistable) return null;
    const missing = analyzeXPath(use.xpath).directAttributes.filter((name) => {
      const attribute = entity.attributes.find((a) => a.name === name);
      return attribute !== undefined && !attribute.indexed;
    });
    return missing.length > 0
      ? {
          message: `XPath on ${entity.name} constrains non-indexed attribute(s): ${missing.join(', ')}.`,
          remediation: `Add database indexes on ${missing.join(', ')} (in the same order as the constraint for composite filters).`,
        }
      : null;
  },
);

const xpathContains = xpathRule(
  'MX-XP-004',
  'Avoid contains() on large tables',
  'warning',
  "contains() translates to LIKE '%x%', which cannot use an index.",
  (use) =>
    analyzeXPath(use.xpath).usesContains
      ? {
          message: `XPath on ${use.entity} uses contains(): ${use.xpath}`,
          remediation: 'Use starts-with() on an indexed attribute, or a dedicated search attribute/index.',
        }
      : null,
);

const xpathOrAcrossPaths = xpathRule(
  'MX-XP-005',
  'Avoid OR across association paths',
  'warning',
  'OR conditions that mix association paths prevent index use and generate complex subqueries.',
  (use) =>
    analyzeXPath(use.xpath).orAcrossPaths
      ? {
          message: `XPath on ${use.entity} combines association paths with OR: ${use.xpath}`,
          remediation: 'Split into separate retrieves and union the results, or restructure the condition.',
        }
      : null,
);

const xpathUnknownAttributes = xpathRule(
  'MX-XP-006',
  'XPath attributes must exist on the entity',
  'error',
  'A constraint on a non-existent attribute fails model consistency checks.',
  (use, ctx) => {
    const entity = entityOf(ctx, use.entity);
    if (entity === undefined) return null;
    const unknown = analyzeXPath(use.xpath).directAttributes.filter(
      (name) => !SYSTEM_ATTRIBUTES.has(name) && !entity.attributes.some((a) => a.name === name),
    );
    return unknown.length > 0
      ? {
          message: `XPath on ${entity.name} references unknown attribute(s): ${unknown.join(', ')}.`,
          remediation: 'Correct the attribute names or add the attributes to the entity.',
        }
      : null;
  },
);

// ---------------------------------------------------------------------------
// Offline-first
// ---------------------------------------------------------------------------

const OFFLINE_PROFILES = new Set(['offline-pwa', 'native-mobile']);

const offlineDataSources: RuleDefinition<MendixContext> = {
  id: 'MX-OFF-001',
  title: 'Offline pages use local data sources',
  category: 'offline',
  severity: 'error',
  rationale:
    'Offline-first profiles read from the device database; microflow data sources need the server and break offline.',
  evaluate: (ctx) =>
    ctx.pages
      .filter(({ item }) => OFFLINE_PROFILES.has(item.profile))
      .flatMap(({ item: page, module }) =>
        page.dataSources
          .filter((ds) => ds.kind === 'microflow')
          .map((ds) => ({
            message: `Offline page ${module}.${page.name} uses a microflow data source for ${ds.entity}.`,
            target: { kind: 'page' as const, id: `${module}.${page.name}` },
            remediation: 'Use a database or nanoflow data source over synchronised data.',
            storyRefs: page.storyRefs,
          })),
      ),
};

const offlineMicroflowActions: RuleDefinition<MendixContext> = {
  id: 'MX-OFF-002',
  title: 'Offline pages call microflows only through nanoflows',
  category: 'offline',
  severity: 'warning',
  rationale:
    'Direct microflow actions on offline pages fail without connectivity; a nanoflow can check the network and handle errors.',
  evaluate: (ctx) =>
    ctx.pages
      .filter(({ item }) => OFFLINE_PROFILES.has(item.profile))
      .flatMap(({ item: page, module }) =>
        page.actions
          .filter((a) => a.kind === 'microflow')
          .map((a) => ({
            message: `Offline page ${module}.${page.name} calls microflow ${a.target} directly ("${a.trigger}").`,
            target: { kind: 'page' as const, id: `${module}.${page.name}` },
            remediation:
              'Call a nanoflow that checks connectivity, then calls the microflow with error handling (or syncs).',
            storyRefs: page.storyRefs,
          })),
      ),
};

const offlineStoriesRealised: RuleDefinition<MendixContext> = {
  id: 'MX-OFF-003',
  title: 'Offline stories are realised by offline-capable pages',
  category: 'offline',
  severity: 'error',
  rationale:
    'A story that requires offline use cannot be delivered by responsive web pages, which need a live server connection.',
  evaluate: (ctx) =>
    ctx.stories
      .filter((s) => s.tags.some((t) => t.toLowerCase() === 'offline'))
      .filter((s) => {
        const pages = ctx.pages.filter(({ item }) => item.storyRefs.includes(s.id));
        return pages.length > 0 && !pages.some(({ item }) => OFFLINE_PROFILES.has(item.profile));
      })
      .map((s) => ({
        message: `Story ${s.id} requires offline use but none of its pages use an offline-capable profile.`,
        target: { kind: 'story' as const, id: s.id },
        remediation: 'Deliver the story in a native-mobile or offline-first PWA profile with synchronised data.',
        storyRefs: [s.id],
      })),
};

// ---------------------------------------------------------------------------
// Model integrity
// ---------------------------------------------------------------------------

const referencesResolve: RuleDefinition<MendixContext> = {
  id: 'MX-INT-001',
  title: 'Model references must resolve',
  category: 'model-integrity',
  severity: 'error',
  rationale: 'Dangling references to flows or entities make the model inconsistent and fail in Studio Pro.',
  evaluate: (ctx) => {
    const findings: FindingDraft[] = [];
    const missing = (
      kind: string,
      name: string,
      owner: string,
      ownerKind: 'page' | 'nanoflow' | 'microflow' | 'entity',
      storyRefs: readonly string[],
    ) =>
      findings.push({
        message: `${owner} references unknown ${kind} ${name}.`,
        target: { kind: ownerKind, id: owner },
        remediation: `Add ${kind} ${name} to the design or fix the reference.`,
        storyRefs,
      });

    for (const { item: page, module } of ctx.pages) {
      const owner = `${module}.${page.name}`;
      for (const action of page.actions) {
        if (action.kind === 'microflow' && !ctx.microflows.has(bareName(action.target)))
          missing('microflow', action.target, owner, 'page', page.storyRefs);
        if (action.kind === 'nanoflow' && !ctx.nanoflows.has(bareName(action.target)))
          missing('nanoflow', action.target, owner, 'page', page.storyRefs);
      }
      for (const ds of page.dataSources) {
        if (!ctx.entities.has(bareName(ds.entity))) missing('entity', ds.entity, owner, 'page', page.storyRefs);
      }
      for (const name of [...page.editsEntities, ...page.filterEntities]) {
        if (!ctx.entities.has(bareName(name))) missing('entity', name, owner, 'page', page.storyRefs);
      }
    }
    for (const { item: nf, module } of ctx.nanoflows.values()) {
      for (const call of nf.microflowCalls) {
        if (!ctx.microflows.has(bareName(call)))
          missing('microflow', call, `${module}.${nf.name}`, 'nanoflow', nf.storyRefs);
      }
    }
    for (const { item: mf, module } of ctx.microflows.values()) {
      for (const sub of mf.subMicroflows) {
        if (!ctx.microflows.has(bareName(sub)))
          missing('microflow', sub, `${module}.${mf.name}`, 'microflow', mf.storyRefs);
      }
      for (const r of mf.retrieves) {
        if (!ctx.entities.has(bareName(r.entity)))
          missing('entity', r.entity, `${module}.${mf.name}`, 'microflow', mf.storyRefs);
      }
    }
    for (const { item: entity, module } of ctx.entities.values()) {
      for (const assoc of entity.associations) {
        if (!ctx.entities.has(bareName(assoc.target)))
          missing('entity', assoc.target, `${module}.${entity.name}`, 'entity', entity.storyRefs);
      }
    }
    return findings;
  },
};

export const MENDIX_RULES: readonly RuleDefinition<MendixContext>[] = [
  viewEntitiesNonPersistable,
  noUiStateOnDomainEntities,
  filtersBindToViewEntities,
  noPersistableToNonPersistableAssociation,
  entityWidth,
  multiEntityFormsUseViewModel,
  clientLogicInNanoflows,
  nanoflowMicroflowCalls,
  nanoflowDatabaseRetrieves,
  microflowSize,
  microflowDecisions,
  loopNesting,
  commitsInLoops,
  retrievesInLoops,
  integrationErrorHandling,
  flowNaming,
  unboundedRetrieves,
  xpathMalformed,
  xpathPathDepth,
  xpathNegation,
  xpathIndexes,
  xpathContains,
  xpathOrAcrossPaths,
  xpathUnknownAttributes,
  offlineDataSources,
  offlineMicroflowActions,
  offlineStoriesRealised,
  referencesResolve,
];
