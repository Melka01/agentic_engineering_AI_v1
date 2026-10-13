import type { Logger } from '../../agents/logger.js';
import type { UserStory } from '../../shared/domain.js';
import type { MendixDesign } from '../../shared/mendix.js';
import { type RuleRunResult, runRules } from '../engine.js';
import { buildMendixContext, MENDIX_RULES } from './rules.js';
import { DEFAULT_MENDIX_THRESHOLDS, type MendixThresholds } from './thresholds.js';

export { MENDIX_RULES } from './rules.js';
export { DEFAULT_MENDIX_THRESHOLDS, type MendixThresholds, mendixGuidance } from './thresholds.js';
export { analyzeXPath } from './xpath.js';

export function validateMendixDesign(
  design: MendixDesign,
  stories: readonly UserStory[],
  thresholds: MendixThresholds = DEFAULT_MENDIX_THRESHOLDS,
  logger?: Logger,
): RuleRunResult {
  return runRules(MENDIX_RULES, buildMendixContext(design, stories, thresholds), logger);
}
