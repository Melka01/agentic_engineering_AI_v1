/**
 * Output contracts of the AI agents. These are the schemas sent to the model as
 * structured-output formats and used to validate whatever comes back.
 */
import { z } from 'zod';
import { NonFunctionalRequirementSchema, RiskCategorySchema, UserStorySchema } from '../shared/domain.js';
import { MendixDesignSchema } from '../shared/mendix.js';
import { OutSystemsDesignSchema } from '../shared/outsystems.js';
import { ArchitectureDecisionSchema } from '../shared/session.js';

export const StoryGenerationOutputSchema = z.object({
  stories: z.array(UserStorySchema),
  nfrs: z.array(NonFunctionalRequirementSchema),
});
export type StoryGenerationOutput = z.infer<typeof StoryGenerationOutputSchema>;

export const MendixBlueprintDraftSchema = z.object({
  summary: z.string(),
  design: MendixDesignSchema,
  decisions: z.array(ArchitectureDecisionSchema),
});
export const OutSystemsBlueprintDraftSchema = z.object({
  summary: z.string(),
  design: OutSystemsDesignSchema,
  decisions: z.array(ArchitectureDecisionSchema),
});
export type MendixBlueprintDraft = z.infer<typeof MendixBlueprintDraftSchema>;
export type OutSystemsBlueprintDraft = z.infer<typeof OutSystemsBlueprintDraftSchema>;
export type BlueprintDraft = MendixBlueprintDraft | OutSystemsBlueprintDraft;

export const RiskDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: RiskCategorySchema,
  likelihood: z.number(),
  impact: z.number(),
  mitigation: z.string(),
  sourceRefs: z.array(z.string()),
});
export const RiskAssessmentOutputSchema = z.object({ risks: z.array(RiskDraftSchema) });
export type RiskDraft = z.infer<typeof RiskDraftSchema>;
export type RiskAssessmentOutput = z.infer<typeof RiskAssessmentOutputSchema>;
