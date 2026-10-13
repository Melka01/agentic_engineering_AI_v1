/**
 * Core domain model of the Requirements Engineering platform.
 *
 * Every schema here is a zod schema so the same definition is used for:
 *  - runtime validation of HTTP input,
 *  - runtime validation of AI agent output (agents are never trusted blindly),
 *  - static TypeScript types (via z.infer).
 *
 * Schemas that are produced by AI agents deliberately avoid regexes and numeric
 * bounds: those quality constraints are enforced by the deterministic rule
 * engines, which report a finding instead of rejecting the whole payload.
 */
import { z } from 'zod';

export const PARADIGMS = ['mendix', 'outsystems'] as const;
export const ParadigmSchema = z.enum(PARADIGMS);
export type Paradigm = z.infer<typeof ParadigmSchema>;

export const SeveritySchema = z.enum(['error', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

/** MoSCoW prioritisation. */
export const PrioritySchema = z.enum(['must', 'should', 'could', 'wont']);
export type Priority = z.infer<typeof PrioritySchema>;

// ---------------------------------------------------------------------------
// User stories
// ---------------------------------------------------------------------------

export const AcceptanceCriterionSchema = z.object({
  given: z.string(),
  when: z.string(),
  then: z.string(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const UserStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  role: z.string(),
  goal: z.string(),
  benefit: z.string(),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema),
  priority: PrioritySchema,
  /** Fibonacci estimate; null when not estimated yet. */
  storyPoints: z.number().nullable(),
  nfrRefs: z.array(z.string()),
  tags: z.array(z.string()),
});
export type UserStory = z.infer<typeof UserStorySchema>;

// ---------------------------------------------------------------------------
// Non-functional requirements
// ---------------------------------------------------------------------------

export const NFR_CATEGORIES = [
  'performance',
  'scalability',
  'availability',
  'reliability',
  'security',
  'usability',
  'maintainability',
  'compliance',
  'interoperability',
] as const;
export const NfrCategorySchema = z.enum(NFR_CATEGORIES);
export type NfrCategory = z.infer<typeof NfrCategorySchema>;

export const ComparatorSchema = z.enum(['<=', '>=', '<', '>', '=']);
export type Comparator = z.infer<typeof ComparatorSchema>;

export const NfrMetricSchema = z.object({
  name: z.string(),
  comparator: ComparatorSchema,
  target: z.number(),
  unit: z.string(),
});
export type NfrMetric = z.infer<typeof NfrMetricSchema>;

export const VerificationMethodSchema = z.enum(['test', 'analysis', 'inspection', 'demonstration']);

export const NonFunctionalRequirementSchema = z.object({
  id: z.string(),
  category: NfrCategorySchema,
  statement: z.string(),
  metric: NfrMetricSchema.nullable(),
  verificationMethod: VerificationMethodSchema.nullable(),
  priority: PrioritySchema,
});
export type NonFunctionalRequirement = z.infer<typeof NonFunctionalRequirementSchema>;

// ---------------------------------------------------------------------------
// Validation findings
// ---------------------------------------------------------------------------

export const FINDING_TARGET_KINDS = [
  'project',
  'story',
  'nfr',
  'module',
  'entity',
  'attribute',
  'association',
  'microflow',
  'nanoflow',
  'page',
  'query',
  'screen',
  'action',
  'dependency',
] as const;
export const FindingTargetSchema = z.object({
  kind: z.enum(FINDING_TARGET_KINDS),
  id: z.string(),
});
export type FindingTarget = z.infer<typeof FindingTargetSchema>;

export const FindingSchema = z.object({
  ruleId: z.string(),
  ruleTitle: z.string(),
  severity: SeveritySchema,
  category: z.string(),
  message: z.string(),
  target: FindingTargetSchema,
  remediation: z.string(),
  storyRefs: z.array(z.string()),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ValidationSummarySchema = z.object({
  errors: z.number(),
  warnings: z.number(),
  infos: z.number(),
  /** 0–100 compliance score. */
  score: z.number(),
  /** true when there are no `error` findings. */
  passed: z.boolean(),
  rulesEvaluated: z.number(),
});
export type ValidationSummary = z.infer<typeof ValidationSummarySchema>;

export const StoryComplianceSchema = z.object({
  storyId: z.string(),
  errors: z.number(),
  warnings: z.number(),
  status: z.enum(['compliant', 'needs-attention', 'non-compliant']),
});
export type StoryCompliance = z.infer<typeof StoryComplianceSchema>;

export const ValidationReportSchema = z.object({
  paradigm: ParadigmSchema,
  engine: z.string(),
  engineVersion: z.string(),
  findings: z.array(FindingSchema),
  summary: ValidationSummarySchema,
  storyCompliance: z.array(StoryComplianceSchema),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

// ---------------------------------------------------------------------------
// Risk register
// ---------------------------------------------------------------------------

export const RISK_CATEGORIES = [
  'architecture',
  'performance',
  'security',
  'delivery',
  'integration',
  'compliance',
  'quality',
  'data',
] as const;
export const RiskCategorySchema = z.enum(RISK_CATEGORIES);
export type RiskCategory = z.infer<typeof RiskCategorySchema>;

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const RiskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: RiskCategorySchema,
  /** 1 (rare) – 5 (almost certain) */
  likelihood: z.number(),
  /** 1 (negligible) – 5 (severe) */
  impact: z.number(),
  score: z.number(),
  level: RiskLevelSchema,
  mitigation: z.string(),
  sourceRefs: z.array(z.string()),
  origin: z.enum(['rule-engine', 'nfr-analysis', 'story-analysis', 'agent']),
});
export type Risk = z.infer<typeof RiskSchema>;

// ---------------------------------------------------------------------------
// Agent run telemetry
// ---------------------------------------------------------------------------

export const AttemptOutcomeSchema = z.enum([
  'success',
  'retryable-error',
  'fatal-error',
  'invalid-output',
  'refusal',
  'truncated',
  'timeout',
  'circuit-open',
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

export const AgentAttemptSchema = z.object({
  provider: z.string(),
  model: z.string(),
  attempt: z.number(),
  outcome: AttemptOutcomeSchema,
  latencyMs: z.number(),
  error: z.string().nullable(),
});
export type AgentAttempt = z.infer<typeof AgentAttemptSchema>;

export const AgentRunTraceSchema = z.object({
  agent: z.string(),
  correlationId: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  attempts: z.array(AgentAttemptSchema),
  /** "<provider>:<model>" or "deterministic-fallback". */
  servedBy: z.string(),
  degraded: z.boolean(),
  repairRounds: z.number(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  note: z.string().nullable(),
});
export type AgentRunTrace = z.infer<typeof AgentRunTraceSchema>;
