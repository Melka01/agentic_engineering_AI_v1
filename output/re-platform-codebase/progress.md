# progress.md — handoff log

## Task
Build a production-ready Requirements Engineering (RE) platform powered by AI agent API calls, with a
session-level paradigm switch between **Mendix** and **OutSystems**, each backed by a strict
best-practice rule engine. Features: user-story generation, NFR validation, risk assessment,
low-code architectural blueprint synthesis.

Active constraints:
- Scope: `output/re-platform-codebase/` (repo-relative; the requested `/output/re-platform-codebase/`
  lives inside the git repository so it can be committed, pushed and opened from the app).
- Run limit: 5 execution loops before review.
- Do not publish/externalise data without asking (no PR, no artifact publish).

## Outputs
- `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `biome.json`, `.env.example`, `.gitignore`
- `CLAUDE.md` (project instructions), `checks.md` (completion checklist), `docs/SOURCES.md`
- `src/shared/{domain,mendix,outsystems,session,paradigms}.ts`
- `tests/shared/schemas.test.ts`
- `src/agents/{errors,logger,provider,resilience,anthropic-provider,mock-provider,runner,schemas,prompts,agents}.ts`
- `tests/agents/{runner,anthropic-provider}.test.ts`
- `src/engines/{types,engine}.ts`, `src/engines/mendix/{index,rules,thresholds,xpath}.ts`
- `tests/engines/mendix.test.ts`, `tests/fixtures/mendix.ts`
- `src/engines/{story-rules,nfr-rules,coverage,registry}.ts`, `src/engines/outsystems/{index,rules,graph,thresholds}.ts`
- `src/analysis/{text,lexicon,concepts,story-extractor,normalize,risk}.ts`, `src/analysis/blueprint/{index,mendix,outsystems}.ts`
- `tests/engines/{outsystems,common-rules,registry}.test.ts`, `tests/fixtures/outsystems.ts`, `tests/analysis/analysis.test.ts`

## Completed
- **Session settings (Layer 6):** `get_session` → model `claude-opus-5-5`, effort `xhigh`, permission mode `auto`. Prompt text does not change runtime effort.
- **Loop 1 — scaffold:** dependencies pinned (TypeScript 7.0.2, Vitest 5.0.4, Vite 8.3.4, zod 4.6.7, Fastify 5.12.7, React 19.3.0, @anthropic-ai/sdk 0.133.0; jsdom pinned to 29.1.1 because 30.x requires Node ≥ 22.22.2 and the container runs 22.22.0).
  Checks: `tsc -p tsconfig.json` → 0 errors; `vitest run --project node` → 3/3 passed; Biome → clean after `--write`.
- Retrieval: docs.mendix.com blocked (ENOTFOUND); evidence from search snippets recorded in `docs/SOURCES.md`. No `ANTHROPIC_API_KEY` in the container.

- **Loop 2 — AI agent layer:** `LlmProvider` abstraction; `AnthropicProvider` (official SDK, `output_config.format` from zod, explicit effort, server-side refusal fallback `fallbacks: "default"`, typed-error classification, SDK retries disabled); `AgentRunner` (provider chain, exponential backoff + jitter, per-attempt deadline, circuit breaker, zod + semantic validation, repair round, deterministic fallback, structured error logging with correlation ids); story/blueprint/risk agent definitions with injected fallbacks; prompts with fenced untrusted input.
  Checks: `vitest run --project node` → 28/28 passed; `tsc` → 0 errors; Biome clean.

- **Loop 3 — Mendix engine:** fault-tolerant rule runtime (crashing rule → `ENGINE-001`), scoring, per-story compliance; 28 Mendix rules: domain/view-model separation (MX-DM-001…006), nanoflow round trips (MX-RT-001…003), microflow complexity & loop data access (MX-MF-001…008), XPath analyser + rules (MX-XP-000…006), offline (MX-OFF-001…003), integrity (MX-INT-001). Thresholds configurable.
  Checks: `vitest run --project node` → 60/60 passed (32 Mendix); `tsc` → 0 errors; Biome clean (`noThenProperty` disabled for Gherkin `then`).

- **Loop 4 — OutSystems engine + analysis:** 21 OutSystems rules (canvas layering OS-ARCH-001/002/004, Tarjan cycle detection OS-ARCH-003, encapsulation OS-ENC-001…007, data access OS-DATA-001…007, async OS-ASYNC-001, integrity OS-INT-001/002); 12 INVEST story rules, 9 NFR rules (measurability, coverage, conflicts, platform feasibility), 2 traceability rules; paradigm engine registry; deterministic backlog extractor, concept model, Mendix/OutSystems blueprint synthesisers (compliant by construction), risk register (findings + NFR + backlog shape, agent-risk merge).
  Checks: `vitest run --project node` → 125/125 passed; invariant "deterministic blueprint has zero design findings" holds for 4 samples × 2 paradigms; `tsc` → 0 errors; Biome clean.

## Next action
Loop 5 — pipeline/session service, Fastify API, React UI with paradigm selector, verify script + verification report, then review pass (checks.md).
