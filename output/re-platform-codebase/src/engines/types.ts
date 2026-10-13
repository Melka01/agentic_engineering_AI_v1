import type {
  Finding,
  FindingTarget,
  NonFunctionalRequirement,
  Paradigm,
  Severity,
  UserStory,
  ValidationReport,
} from '../shared/domain.js';
import type { Design } from '../shared/session.js';

/** What a rule reports; the engine stamps rule id, title, category and default severity. */
export interface FindingDraft {
  readonly message: string;
  readonly target: FindingTarget;
  readonly remediation: string;
  readonly storyRefs?: readonly string[];
  /** Overrides the rule's default severity (e.g. warning vs. error thresholds). */
  readonly severity?: Severity;
}

export interface RuleDefinition<C> {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly severity: Severity;
  /** Why the rule exists — the best practice it encodes. Shown to users and to the AI. */
  readonly rationale: string;
  evaluate(context: C): readonly FindingDraft[];
}

export interface ValidationInput {
  readonly stories: readonly UserStory[];
  readonly nfrs: readonly NonFunctionalRequirement[];
  readonly design: Design | null;
}

export interface RuleCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly severity: Severity;
  readonly rationale: string;
  readonly scope: 'story' | 'nfr' | 'design';
}

/** A platform-specific validation engine (Mendix or OutSystems). */
export interface ParadigmEngine {
  readonly paradigm: Paradigm;
  readonly name: string;
  readonly version: string;
  /** Full rule catalogue (common + platform rules). */
  readonly catalog: readonly RuleCatalogEntry[];
  /** Modelling guidance rendered into AI prompts (derived from the configured thresholds). */
  designGuidance(): readonly string[];
  validate(input: ValidationInput): ValidationReport;
}

export type { Finding };
