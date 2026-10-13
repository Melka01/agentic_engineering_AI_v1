/**
 * Agent definitions. Each agent = prompt builders + output contract + semantic
 * checks + an injected deterministic fallback. Agents are pure data; the
 * AgentRunner executes them against whatever providers are configured.
 */
import type { Paradigm } from '../shared/domain.js';
import {
  type BlueprintPromptInput,
  blueprintSystemPrompt,
  blueprintUserPrompt,
  type RiskPromptInput,
  riskSystemPrompt,
  riskUserPrompt,
  type StoryPromptInput,
  storySystemPrompt,
  storyUserPrompt,
} from './prompts.js';
import type { AgentDefinition } from './runner.js';
import {
  type BlueprintDraft,
  MendixBlueprintDraftSchema,
  OutSystemsBlueprintDraftSchema,
  type RiskAssessmentOutput,
  RiskAssessmentOutputSchema,
  type StoryGenerationOutput,
  StoryGenerationOutputSchema,
} from './schemas.js';

/** Default output budget for non-streaming structured calls. */
const MAX_TOKENS = 16_000;

export interface StoryAgentInput extends StoryPromptInput {
  readonly paradigm: Paradigm;
}

export function createStoryAgent(
  fallback: (input: StoryAgentInput) => StoryGenerationOutput,
): AgentDefinition<StoryAgentInput, StoryGenerationOutput> {
  return {
    name: 'story-generator',
    schemaName: 'StoryGenerationOutput',
    schema: StoryGenerationOutputSchema,
    effort: 'medium',
    maxTokens: MAX_TOKENS,
    system: (input) => storySystemPrompt(input.paradigm),
    prompt: (input) => storyUserPrompt(input),
    check: (output) => {
      const issues: string[] = [];
      if (output.stories.length === 0) issues.push('stories: at least one user story is required');
      output.stories.forEach((story, i) => {
        if (story.goal.trim().length === 0) issues.push(`stories.${i}.goal: must not be empty`);
        if (story.role.trim().length === 0) issues.push(`stories.${i}.role: must not be empty`);
      });
      return issues;
    },
    fallback,
  };
}

export type BlueprintAgentInput = BlueprintPromptInput;

export function createBlueprintAgent(
  paradigm: Paradigm,
  fallback: (input: BlueprintAgentInput) => BlueprintDraft,
): AgentDefinition<BlueprintAgentInput, BlueprintDraft> {
  return {
    name: `blueprint-synthesizer:${paradigm}`,
    schemaName: paradigm === 'mendix' ? 'MendixBlueprintDraft' : 'OutSystemsBlueprintDraft',
    schema: paradigm === 'mendix' ? MendixBlueprintDraftSchema : OutSystemsBlueprintDraftSchema,
    effort: 'high',
    maxTokens: MAX_TOKENS,
    system: (input) => blueprintSystemPrompt(input),
    prompt: (input) => blueprintUserPrompt(input),
    check: (output) => (output.design.modules.length === 0 ? ['design.modules: at least one module is required'] : []),
    fallback,
  };
}

export function createRiskAgent(
  fallback: (input: RiskPromptInput) => RiskAssessmentOutput,
): AgentDefinition<RiskPromptInput, RiskAssessmentOutput> {
  return {
    name: 'risk-assessor',
    schemaName: 'RiskAssessmentOutput',
    schema: RiskAssessmentOutputSchema,
    effort: 'medium',
    maxTokens: MAX_TOKENS,
    system: (input) => riskSystemPrompt(input.paradigm),
    prompt: (input) => riskUserPrompt(input),
    check: (output) =>
      output.risks.flatMap((risk, i) =>
        [risk.likelihood, risk.impact].some((v) => !Number.isInteger(v) || v < 1 || v > 5)
          ? [`risks.${i}: likelihood and impact must be integers between 1 and 5`]
          : [],
      ),
    fallback,
  };
}
