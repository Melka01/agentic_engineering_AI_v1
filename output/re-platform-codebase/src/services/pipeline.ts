/**
 * RequirementsPipeline — orchestrates the agents and the deterministic engines.
 *
 *   requirements ──► story agent ──► normalise ─────────────┐
 *                                                          ▼
 *   paradigm ──► engine ──► blueprint agent ──► validate ──► (repair with findings)*
 *                                     │                      │
 *                                     └─ still non-compliant ─► deterministic compliant blueprint
 *                                                          ▼
 *                              deterministic risks + risk agent ──► risk register
 */
import { createBlueprintAgent, createRiskAgent, createStoryAgent } from '../agents/agents.js';
import type { Logger } from '../agents/logger.js';
import type { AgentRunner } from '../agents/runner.js';
import { synthesizeBlueprint, toBlueprint } from '../analysis/blueprint/index.js';
import { normalizeBacklog } from '../analysis/normalize.js';
import { assessRisks, finaliseRisks, mergeAgentRisks } from '../analysis/risk.js';
import { extractBacklog } from '../analysis/story-extractor.js';
import { createEngine, designRuleBriefs, type EngineOptions } from '../engines/registry.js';
import type {
  AgentRunTrace,
  Finding,
  NonFunctionalRequirement,
  Paradigm,
  Risk,
  UserStory,
  ValidationReport,
} from '../shared/domain.js';
import type { Blueprint, SessionInput } from '../shared/session.js';

export interface PipelineOptions {
  readonly runner: AgentRunner;
  readonly logger: Logger;
  readonly engineOptions?: EngineOptions;
  /** Rounds in which rule-engine errors are fed back to the blueprint agent. */
  readonly designRepairRounds?: number;
}

export interface BacklogResult {
  readonly stories: UserStory[];
  readonly nfrs: NonFunctionalRequirement[];
  readonly trace: AgentRunTrace;
}

export interface DesignResult {
  readonly blueprint: Blueprint;
  readonly validation: ValidationReport;
  readonly risks: Risk[];
  readonly traces: AgentRunTrace[];
}

export interface DesignRequest {
  readonly paradigm: Paradigm;
  readonly projectName: string;
  readonly stories: readonly UserStory[];
  readonly nfrs: readonly NonFunctionalRequirement[];
}

/** Errors attributable to the blueprint (story/NFR quality is the backlog's concern). */
export function designErrors(report: ValidationReport): Finding[] {
  return report.findings.filter(
    (f) => f.severity === 'error' && !f.ruleId.startsWith('RE-US-') && !f.ruleId.startsWith('RE-NFR-'),
  );
}

const describeFinding = (f: Finding) =>
  `[${f.ruleId}] ${f.message} Fix: ${f.remediation}${f.storyRefs.length > 0 ? ` (stories: ${f.storyRefs.join(', ')})` : ''}`;

export class RequirementsPipeline {
  private readonly runner: AgentRunner;
  private readonly logger: Logger;
  private readonly engineOptions: EngineOptions;
  private readonly designRepairRounds: number;

  constructor(options: PipelineOptions) {
    this.runner = options.runner;
    this.logger = options.logger;
    this.engineOptions = options.engineOptions ?? {};
    this.designRepairRounds = options.designRepairRounds ?? 1;
  }

  async generateBacklog(input: SessionInput, signal?: AbortSignal): Promise<BacklogResult> {
    const agent = createStoryAgent((i) => extractBacklog(i));
    const run = await this.runner.run(
      agent,
      {
        paradigm: input.paradigm,
        projectName: input.projectName,
        requirementsText: input.requirementsText,
        domainContext: input.domainContext,
      },
      signal === undefined ? {} : { signal },
    );
    const backlog = normalizeBacklog(run.output);
    return { ...backlog, trace: run.trace };
  }

  async synthesizeAndValidate(request: DesignRequest, signal?: AbortSignal): Promise<DesignResult> {
    const runOptions = signal === undefined ? {} : { signal };
    const engine = createEngine(request.paradigm, { ...this.engineOptions, logger: this.logger });
    const promptInput = {
      paradigm: request.paradigm,
      projectName: request.projectName,
      stories: request.stories,
      nfrs: request.nfrs,
      rules: designRuleBriefs(engine),
      guidance: engine.designGuidance(),
    };
    const agent = createBlueprintAgent(request.paradigm, (i) =>
      synthesizeBlueprint(request.paradigm, { projectName: i.projectName, stories: i.stories }),
    );
    const validate = (bp: Blueprint) =>
      engine.validate({ stories: request.stories, nfrs: request.nfrs, design: bp.design });
    const traces: AgentRunTrace[] = [];

    let run = await this.runner.run(agent, promptInput, runOptions);
    traces.push(run.trace);
    let blueprint = toBlueprint(
      run.output,
      run.trace.servedBy === 'deterministic-fallback' ? 'deterministic' : 'agent',
    );
    let validation = validate(blueprint);

    // Design repair: feed rule-engine errors back to the agent.
    for (let round = 1; round <= this.designRepairRounds; round += 1) {
      const errors = designErrors(validation);
      if (blueprint.origin !== 'agent' || errors.length === 0) break;
      this.logger.warn(
        { paradigm: request.paradigm, round, errors: errors.length, rules: [...new Set(errors.map((e) => e.ruleId))] },
        'pipeline.design.repair',
      );
      run = await this.runner.run(
        agent,
        { ...promptInput, previousFindings: errors.slice(0, 40).map(describeFinding) },
        runOptions,
      );
      traces.push({ ...run.trace, agent: `${run.trace.agent}#repair-${round}` });
      blueprint = toBlueprint(run.output, run.trace.servedBy === 'deterministic-fallback' ? 'deterministic' : 'agent');
      validation = validate(blueprint);
    }

    // Strict enforcement: never hand over a blueprint that violates error-level platform rules.
    const remaining = designErrors(validation);
    if (blueprint.origin === 'agent' && remaining.length > 0) {
      this.logger.warn(
        { paradigm: request.paradigm, errors: remaining.length, rules: [...new Set(remaining.map((e) => e.ruleId))] },
        'pipeline.design.enforced_deterministic',
      );
      blueprint = toBlueprint(
        synthesizeBlueprint(request.paradigm, { projectName: request.projectName, stories: request.stories }),
        'deterministic',
      );
      validation = validate(blueprint);
      const last = traces.pop();
      if (last !== undefined) {
        traces.push({
          ...last,
          degraded: true,
          note: `Agent blueprint still violated ${remaining.length} error-level rule(s) (${[
            ...new Set(remaining.map((e) => e.ruleId)),
          ].join(
            ', ',
          )}) after ${this.designRepairRounds} repair round(s); replaced by the deterministic compliant blueprint.`,
        });
      }
    }

    // Risk register: deterministic analysis enriched by the risk agent.
    const base = assessRisks({
      paradigm: request.paradigm,
      stories: request.stories,
      nfrs: request.nfrs,
      findings: validation.findings,
    });
    const riskAgent = createRiskAgent(() => ({ risks: [] }));
    const riskRun = await this.runner.run(
      riskAgent,
      {
        paradigm: request.paradigm,
        projectName: request.projectName,
        stories: request.stories,
        nfrs: request.nfrs,
        findingSummary: validation.findings
          .filter((f) => f.severity !== 'info')
          .slice(0, 40)
          .map((f) => `${f.severity} ${f.ruleId}: ${f.message}`),
        existingRisks: finaliseRisks(base),
      },
      runOptions,
    );
    traces.push(riskRun.trace);
    const risks = finaliseRisks(mergeAgentRisks(base, riskRun.output.risks));

    return { blueprint, validation, risks, traces };
  }
}
