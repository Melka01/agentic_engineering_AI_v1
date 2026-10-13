/**
 * Live check against the real Claude API (requires credentials):
 *
 *   ANTHROPIC_API_KEY=... npm run smoke:live -- [mendix|outsystems]
 *
 * Runs the full pipeline with the Anthropic provider chain and NO deterministic
 * fallback for the agents, so a pass proves the structured AI calls work end to end.
 */
import { MemoryLogger } from '../src/agents/logger.js';
import { CircuitBreakerRegistry } from '../src/agents/resilience.js';
import { AgentRunner } from '../src/agents/runner.js';
import { loadConfig } from '../src/server/config.js';
import { createProviders } from '../src/server/container.js';
import { RequirementsPipeline } from '../src/services/pipeline.js';
import { ParadigmSchema } from '../src/shared/domain.js';

const paradigm = ParadigmSchema.parse(process.argv[2] ?? 'mendix');
const config = loadConfig({ ...process.env, RE_AI_MODE: 'anthropic' });
const providers = createProviders(config);
const logger = new MemoryLogger();
const runner = new AgentRunner({
  providers,
  logger,
  circuits: new CircuitBreakerRegistry(),
  timeoutMs: config.agentTimeoutMs,
  allowFallback: false,
});
const pipeline = new RequirementsPipeline({ runner, logger, designRepairRounds: config.designRepairRounds });

const requirementsText = `Employees submit expense claims with receipt photos from their phone.
Managers approve or reject claims within 2 working days.
Approved claims are exported to SAP every night.
Search results appear within 2 seconds for 300 concurrent users. Access requires SSO with MFA.`;

const started = Date.now();
try {
  const backlog = await pipeline.generateBacklog({
    projectName: 'Expense Portal',
    paradigm,
    requirementsText,
    domainContext: '',
  });
  const design = await pipeline.synthesizeAndValidate({
    paradigm,
    projectName: 'Expense Portal',
    stories: backlog.stories,
    nfrs: backlog.nfrs,
  });
  const traces = [backlog.trace, ...design.traces];
  console.log(
    JSON.stringify(
      {
        ok: true,
        paradigm,
        durationMs: Date.now() - started,
        stories: backlog.stories.length,
        nfrs: backlog.nfrs.length,
        blueprintOrigin: design.blueprint.origin,
        validation: design.validation.summary,
        risks: design.risks.length,
        traces: traces.map((t) => ({
          agent: t.agent,
          servedBy: t.servedBy,
          attempts: t.attempts.length,
          repairRounds: t.repairRounds,
          usage: t.usage,
          note: t.note,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        log: logger.entries.filter((e) => e.level !== 'debug').slice(-10),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
