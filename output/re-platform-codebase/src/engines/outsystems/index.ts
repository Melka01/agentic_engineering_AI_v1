import type { Logger } from '../../agents/logger.js';
import type { UserStory } from '../../shared/domain.js';
import type { OutSystemsDesign } from '../../shared/outsystems.js';
import { type RuleRunResult, runRules } from '../engine.js';
import { buildOutSystemsContext, OUTSYSTEMS_RULES } from './rules.js';
import { DEFAULT_OUTSYSTEMS_THRESHOLDS, type OutSystemsThresholds } from './thresholds.js';

export { findCycles } from './graph.js';
export { OUTSYSTEMS_RULES } from './rules.js';
export { DEFAULT_OUTSYSTEMS_THRESHOLDS, type OutSystemsThresholds, outsystemsGuidance } from './thresholds.js';

export function validateOutSystemsDesign(
  design: OutSystemsDesign,
  stories: readonly UserStory[],
  thresholds: OutSystemsThresholds = DEFAULT_OUTSYSTEMS_THRESHOLDS,
  logger?: Logger,
): RuleRunResult {
  return runRules(OUTSYSTEMS_RULES, buildOutSystemsContext(design, stories, thresholds), logger);
}
