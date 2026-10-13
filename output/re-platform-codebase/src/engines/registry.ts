/**
 * Paradigm → engine resolution. This is the switch at the heart of the
 * platform: the session's paradigm selects which best-practice engine (and
 * therefore which rules, thresholds and prompt guidance) applies.
 */

import type { Logger } from '../agents/logger.js';
import type { RuleBrief } from '../agents/prompts.js';
import type { Finding, Paradigm, ValidationReport } from '../shared/domain.js';
import { COVERAGE_RULES } from './coverage.js';
import { runRules, sortFindings, storyCompliance, summarize, toCatalog } from './engine.js';
import {
  DEFAULT_MENDIX_THRESHOLDS,
  MENDIX_RULES,
  type MendixThresholds,
  mendixGuidance,
  validateMendixDesign,
} from './mendix/index.js';
import { NFR_RULES, PLATFORM_PROFILES } from './nfr-rules.js';
import {
  DEFAULT_OUTSYSTEMS_THRESHOLDS,
  OUTSYSTEMS_RULES,
  type OutSystemsThresholds,
  outsystemsGuidance,
  validateOutSystemsDesign,
} from './outsystems/index.js';
import { STORY_RULES } from './story-rules.js';
import type { ParadigmEngine, RuleCatalogEntry, ValidationInput } from './types.js';

export const ENGINE_VERSION = '1.0.0';

export interface EngineOptions {
  readonly mendix?: Partial<MendixThresholds>;
  readonly outsystems?: Partial<OutSystemsThresholds>;
  readonly logger?: Logger;
}

const ENGINE_NAMES: Readonly<Record<Paradigm, string>> = {
  mendix: 'mendix-best-practice-engine',
  outsystems: 'outsystems-best-practice-engine',
};

export function createEngine(paradigm: Paradigm, options: EngineOptions = {}): ParadigmEngine {
  const mendixThresholds = { ...DEFAULT_MENDIX_THRESHOLDS, ...options.mendix };
  const outsystemsThresholds = { ...DEFAULT_OUTSYSTEMS_THRESHOLDS, ...options.outsystems };
  const platformCatalog =
    paradigm === 'mendix' ? toCatalog(MENDIX_RULES, 'design') : toCatalog(OUTSYSTEMS_RULES, 'design');
  const catalog: RuleCatalogEntry[] = [
    ...toCatalog(STORY_RULES, 'story'),
    ...toCatalog(NFR_RULES, 'nfr'),
    ...toCatalog(COVERAGE_RULES, 'design'),
    ...platformCatalog,
  ];

  return {
    paradigm,
    name: ENGINE_NAMES[paradigm],
    version: ENGINE_VERSION,
    catalog,
    designGuidance: () =>
      paradigm === 'mendix' ? mendixGuidance(mendixThresholds) : outsystemsGuidance(outsystemsThresholds),
    validate(input: ValidationInput): ValidationReport {
      const findings: Finding[] = [];
      let evaluated = 0;
      const collect = (result: { findings: Finding[]; evaluated: number }) => {
        findings.push(...result.findings);
        evaluated += result.evaluated;
      };

      collect(runRules(STORY_RULES, { paradigm, stories: input.stories, nfrs: input.nfrs }, options.logger));
      collect(
        runRules(
          NFR_RULES,
          { paradigm, nfrs: input.nfrs, stories: input.stories, profile: PLATFORM_PROFILES[paradigm] },
          options.logger,
        ),
      );

      const design = input.design;
      if (design === null) {
        findings.push(
          engineFinding('RE-DES-002', 'info', 'No blueprint supplied; platform design rules were skipped.'),
        );
      } else if (design.paradigm !== paradigm) {
        findings.push(
          engineFinding(
            'RE-DES-001',
            'error',
            `The blueprint is a ${design.paradigm} design but the session paradigm is ${paradigm}.`,
          ),
        );
      } else {
        collect(runRules(COVERAGE_RULES, { stories: input.stories, design }, options.logger));
        collect(
          design.paradigm === 'mendix'
            ? validateMendixDesign(design, input.stories, mendixThresholds, options.logger)
            : validateOutSystemsDesign(design, input.stories, outsystemsThresholds, options.logger),
        );
      }

      const sorted = sortFindings(findings);
      return {
        paradigm,
        engine: ENGINE_NAMES[paradigm],
        engineVersion: ENGINE_VERSION,
        findings: sorted,
        summary: summarize(sorted, evaluated),
        storyCompliance: storyCompliance(input.stories, sorted),
      };
    },
  };
}

function engineFinding(ruleId: string, severity: Finding['severity'], message: string): Finding {
  return {
    ruleId,
    ruleTitle: ruleId === 'RE-DES-001' ? 'Blueprint matches the session paradigm' : 'Blueprint supplied',
    severity,
    category: 'traceability',
    message,
    target: { kind: 'project', id: 'blueprint' },
    remediation:
      ruleId === 'RE-DES-001'
        ? 'Re-synthesise the blueprint for the selected paradigm (switching paradigm does this automatically).'
        : 'Provide a design to validate platform best practices.',
    storyRefs: [],
  };
}

/** Design-scope rules rendered for AI prompts. */
export function designRuleBriefs(engine: ParadigmEngine): RuleBrief[] {
  return engine.catalog
    .filter((r) => r.scope === 'design')
    .map(({ id, title, severity, category, rationale }) => ({ id, title, severity, category, rationale }));
}
