# Project instructions — RE Platform (Mendix / OutSystems)

Durable facts for anyone (human or agent) working in this directory.

## What this is
AI-agent powered Requirements Engineering platform. A session is initialised with a paradigm
(`mendix` | `outsystems`); requirements text is turned into user stories + NFRs, a platform
blueprint is synthesised, and deterministic rule engines validate everything against the selected
platform's best practices. A risk register is derived from the findings.

## Commands (run from this directory)
- `npm test` — all unit/integration/UI tests (Vitest projects `node` + `web`)
- `npm run typecheck` — strict tsc for server (`tsconfig.json`) and web (`web/tsconfig.json`)
- `npm run lint` — Biome lint + format check (`npm run lint:fix` to apply)
- `npm run build` — server to `dist/`, web to `web/dist/`
- `npm run verify` — typecheck + lint + tests + build + HTTP smoke test → `reports/verification-report.md`
- `npm run dev:server` / `npm run dev:web` — local development (web proxies `/api` to :3000)

## Architecture invariants
1. **AI proposes, rules dispose.** Agent output is parsed with zod and then judged by the
   deterministic rule engines. Never let agent output bypass `src/engines`.
2. **Every agent has a deterministic fallback.** The pipeline must complete with no API key
   (offline mode) — `servedBy: "deterministic-fallback"` and `degraded: true` in the trace.
3. **Provider-agnostic agents.** Agents talk to `LlmProvider` (`src/agents/provider.ts`) only;
   the Anthropic SDK is confined to `src/agents/anthropic-provider.ts`.
4. **Rule engines never throw.** A crashing rule becomes an `ENGINE-001` finding.
5. **Rule catalogue is the single source of truth** — prompts are built from the same rule
   definitions the engines execute (`src/agents/prompts.ts`).
6. The deterministic blueprint synthesiser must produce **zero error findings** for both paradigms
   (enforced by `tests/analysis/blueprint.test.ts`).

## Conventions
- ESM + `NodeNext`; relative imports use the `.js` extension.
- Strict TS (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); no `any`, no `!`.
- Rule ids: `RE-US-*` (stories), `RE-NFR-*` (NFRs), `MX-*` (Mendix), `OS-*` (OutSystems).
- Default model `claude-opus-5-5`, fallback provider `claude-sonnet-5-5`; both configurable via env.

## Where state lives
- `progress.md` — handoff log (task, outputs, completed, next action)
- `checks.md` — requirement | verdict | evidence | correction
- `docs/SOURCES.md` — source URIs consulted and retrieval failures
