import { z } from 'zod';
import {
  AgentRunTraceSchema,
  NonFunctionalRequirementSchema,
  ParadigmSchema,
  RiskSchema,
  UserStorySchema,
  ValidationReportSchema,
} from './domain.js';
import { MendixDesignSchema } from './mendix.js';
import { OutSystemsDesignSchema } from './outsystems.js';

export const ArchitectureDecisionSchema = z.object({
  id: z.string(),
  title: z.string(),
  decision: z.string(),
  rationale: z.string(),
  /** Rule ids this decision satisfies, e.g. ["MX-DM-001"]. */
  ruleRefs: z.array(z.string()),
});
export type ArchitectureDecision = z.infer<typeof ArchitectureDecisionSchema>;

const BlueprintMeta = {
  summary: z.string(),
  decisions: z.array(ArchitectureDecisionSchema),
  origin: z.enum(['agent', 'deterministic']),
};

export const MendixBlueprintSchema = z.object({
  paradigm: z.literal('mendix'),
  design: MendixDesignSchema,
  ...BlueprintMeta,
});
export const OutSystemsBlueprintSchema = z.object({
  paradigm: z.literal('outsystems'),
  design: OutSystemsDesignSchema,
  ...BlueprintMeta,
});
export const BlueprintSchema = z.discriminatedUnion('paradigm', [MendixBlueprintSchema, OutSystemsBlueprintSchema]);
export type Blueprint = z.infer<typeof BlueprintSchema>;
export type MendixBlueprint = z.infer<typeof MendixBlueprintSchema>;
export type OutSystemsBlueprint = z.infer<typeof OutSystemsBlueprintSchema>;
export type Design = Blueprint['design'];

export const SessionInputSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  paradigm: ParadigmSchema,
  requirementsText: z.string().trim().min(20, 'requirementsText must contain at least 20 characters').max(50_000),
  domainContext: z.string().trim().max(10_000).default(''),
});
export type SessionInput = z.infer<typeof SessionInputSchema>;
export type SessionInputDraft = z.input<typeof SessionInputSchema>;

export const SessionEventSchema = z.object({
  at: z.string(),
  type: z.enum(['created', 'paradigm-switched', 'revalidated']),
  paradigm: ParadigmSchema,
  detail: z.string(),
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  projectName: z.string(),
  paradigm: ParadigmSchema,
  input: SessionInputSchema,
  stories: z.array(UserStorySchema),
  nfrs: z.array(NonFunctionalRequirementSchema),
  blueprint: BlueprintSchema,
  validation: ValidationReportSchema,
  risks: z.array(RiskSchema),
  agentTrace: z.array(AgentRunTraceSchema),
  history: z.array(SessionEventSchema),
});
export type Session = z.infer<typeof SessionSchema>;
