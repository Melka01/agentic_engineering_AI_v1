/**
 * Human-facing descriptors for the two supported low-code paradigms.
 * Shared by the API (`GET /api/paradigms`) and the web UI's paradigm selector.
 * Kept dependency-free (types only) so it can be bundled into the browser.
 */
import type { Paradigm } from './domain.js';

export interface ParadigmPrinciple {
  readonly title: string;
  readonly detail: string;
}

export interface ParadigmDescriptor {
  readonly id: Paradigm;
  readonly name: string;
  readonly tagline: string;
  readonly principles: readonly ParadigmPrinciple[];
}

export const PARADIGM_DESCRIPTORS: Readonly<Record<Paradigm, ParadigmDescriptor>> = {
  mendix: {
    id: 'mendix',
    name: 'Mendix',
    tagline: 'Model-driven apps with microflows, nanoflows and a strict domain model.',
    principles: [
      {
        title: 'Domain model ≠ view model',
        detail: 'UI and search state live in non-persistable view entities, never on persisted domain entities.',
      },
      {
        title: 'Minimise round trips with nanoflows',
        detail:
          'Client-only logic (validation, navigation, UI state) runs in nanoflows; one server call per user action.',
      },
      {
        title: 'Split complex microflows',
        detail: 'Microflows stay small (activity, decision and loop-nesting limits) and delegate to SUB_ microflows.',
      },
      {
        title: 'Optimised XPath',
        detail:
          'Short association paths, indexed constrained attributes, no not()/contains() on large tables, no retrieves or commits in loops.',
      },
    ],
  },
  outsystems: {
    id: 'outsystems',
    name: 'OutSystems',
    tagline: 'Architecture Canvas driven apps with encapsulated, layered modules.',
    principles: [
      {
        title: '3-layer Architecture Canvas',
        detail: 'End-User → Core (Business Processes _BL, Core Entities _CS) → Foundation (Connectors _IS, libraries).',
      },
      {
        title: 'Module encapsulation',
        detail: 'Core entities are exposed read-only with CRUD wrapper actions; connectors hide external APIs.',
      },
      {
        title: 'No circular, upward or side references',
        detail: 'The module dependency graph is acyclic and only points down the canvas.',
      },
      {
        title: 'Aggregates over custom SQL',
        detail:
          'Aggregates by default; advanced SQL only with justification, parameterised, never Expand Inline on input.',
      },
    ],
  },
};

export const PARADIGM_LIST: readonly ParadigmDescriptor[] = [
  PARADIGM_DESCRIPTORS.mendix,
  PARADIGM_DESCRIPTORS.outsystems,
];
