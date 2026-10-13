# RE Studio — Requirements Engineering for Mendix & OutSystems

RE Studio turns stakeholder requirements into a delivery-ready backlog and a low-code
architecture blueprint, then validates the result against strict platform best practices.
When you start a session you choose the paradigm, **Mendix** or **OutSystems**. That choice decides
which rule engine, thresholds and AI prompt guidance apply. You can switch the paradigm of a live
session at any time; the backlog stays as it is, and the blueprint is rebuilt and validated again
for the other platform.

| Capability | How it works |
|---|---|
| User-story generation | Claude agent with structured JSON output; falls back to a deterministic extractor that produces INVEST-shaped stories with Given/When/Then criteria |
| NFR validation | 9 rules: measurability, verification method, coverage, conflicting targets, platform feasibility (SLA ceiling, sub-second targets) |
| Platform rule engines | **Mendix**: 29 rules (domain vs. view model, nanoflow round trips, microflow complexity, XPath, offline, async, integrity). **OutSystems**: 21 rules (3-layer canvas, cycle detection, encapsulation, Aggregates over SQL, async, integrity). Plus 14 common story and traceability rules. See [docs/RULES.md](docs/RULES.md) |
| Blueprint synthesis | Claude agent builds a platform design model. Rule-engine errors go back to the agent for repair, and a design that still fails is replaced by the deterministic blueprint, which is compliant by construction |
| Risk assessment | Risk register built from findings, NFR gaps and backlog shape, plus agent-identified risks (deduplicated, likelihood × impact clamped to 1–5) |
| Resilience | Provider chain (Opus 5.5 → Sonnet 5.5), exponential backoff with jitter, deadline on each attempt, circuit breaker, schema validation plus repair round, deterministic fallback, structured error logs with correlation ids |

## Quick start

```bash
npm ci
npm run build          # server → dist/, web UI → web/dist/
npm start              # http://localhost:3000 (serves API + UI)
```

Development, with hot reload in two terminals:

```bash
npm run dev:server     # API on :3000
npm run dev:web        # UI on :5173, proxies /api to :3000
```

### AI configuration

Copy `.env.example` to `.env` (or export the variables):

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude credentials. If no key is set, the platform runs in **offline mode** (deterministic agents only) |
| `RE_AI_MODE` | auto | `anthropic` or `offline` |
| `RE_PRIMARY_MODEL` | `claude-opus-5-5` | Primary agent model |
| `RE_FALLBACK_MODEL` | `claude-sonnet-5-5` | Secondary provider, used only when the primary fails or its circuit is open (`none` disables it) |
| `RE_SERVER_FALLBACKS` | `default` | Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Set to `off` to disable |
| `RE_AGENT_TIMEOUT_MS` / `RE_AGENT_MAX_RETRIES` / `RE_AGENT_REPAIR_ROUNDS` | 120000 / 2 / 1 | Deadline per attempt, transient retries, schema repair rounds |
| `RE_DESIGN_REPAIR_ROUNDS` | 1 | Rounds that feed rule-engine errors back to the blueprint agent |
| `RE_CIRCUIT_FAILURE_THRESHOLD` / `RE_CIRCUIT_COOLDOWN_MS` | 3 / 30000 | Circuit breaker per provider |

To check the real Claude integration end to end (this needs credentials and turns off the deterministic fallback):

```bash
ANTHROPIC_API_KEY=... npm run smoke:live -- outsystems
```

## Architecture

```
web/ (React)  ──HTTP──►  src/server (Fastify, zod-validated routes)
                              │
                              ▼
                      src/services/pipeline.ts ── orchestrates ──┐
        ┌─────────────────────┬──────────────────────────────────┤
        ▼                     ▼                                  ▼
 src/agents (AI layer)   src/engines (rule engines)        src/analysis (deterministic)
 LlmProvider ◄─ AnthropicProvider (SDK, structured output)  story extractor, concepts,
 AgentRunner: chain, retry, deadline, breaker,              blueprint synthesisers,
   schema+semantic validation, repair, fallback, logs       risk register, normaliser
 prompts built from the rule catalogue  ◄────────────────── registry: paradigm → engine
```

Design invariants: AI output is never trusted until the deterministic engines have judged it;
every agent has a deterministic fallback; rule engines never throw. Details are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## HTTP API

| Method & path | Description |
|---|---|
| `GET /api/health` | Status, AI mode, provider chain, circuit-breaker states |
| `GET /api/paradigms` | Paradigm descriptors with their enforced principles and rule counts |
| `GET /api/paradigms/:paradigm/rules` | Full rule catalogue and the prompt guidance for one paradigm |
| `POST /api/sessions` | `{projectName, paradigm, requirementsText, domainContext?}` → full session (stories, NFRs, blueprint, validation, risks, agent trace) |
| `GET /api/sessions` / `GET /api/sessions/:id` | List sessions / read one session |
| `PUT /api/sessions/:id/paradigm` | `{paradigm}` → switches the paradigm, re-synthesises and re-validates |
| `POST /api/validate` | Stateless validation of supplied stories/NFRs/design (for CI gates) |

Errors: `400 validation_error` (with issue paths), `404 not_found`, `499` when the client disconnects
(agent work is cancelled), and `500 internal_error` (logged with the request id).

## Verification

```bash
npm run verify   # typecheck + lint + tests + build + live HTTP smoke → reports/verification-report.md
npm test         # Vitest projects: node (engines, agents, services, API) + web (jsdom UI)
```

## Project layout

```
src/shared     zod domain model (stories, NFRs, findings, risks, Mendix/OutSystems designs, sessions)
src/agents     provider abstraction, Claude provider, resilient runner, prompts, agent definitions
src/engines    rule runtime, Mendix + OutSystems engines, story/NFR/traceability rules, registry
src/analysis   deterministic extractor, concept model, blueprint synthesisers, risk assessment
src/services   pipeline orchestration and session lifecycle
src/server     config, composition root, HTTP routes, entry point
web/           React UI (paradigm selector, results panels)
tests/         unit, integration, end-to-end with mocked agents, and UI tests
scripts/       verify.mjs, live-smoke.ts, generate-rules-doc.ts
docs/          ARCHITECTURE.md, RULES.md (generated), HARNESS.md, SOURCES.md
```

## Production notes and known limitations

- **Persistence:** sessions live in a bounded in-memory repository. To persist them, implement
  `SessionRepository` against a database.
- **Edge concerns:** there is no authentication or rate limiting in the app. Deploy it behind your
  API gateway or identity proxy.
- **Thresholds:** numeric limits (for example 25/40 microflow activities) are configurable defaults.
  The primary Mendix documentation could not be fetched while building this (see
  [docs/SOURCES.md](docs/SOURCES.md)).
- **Live AI path:** the Claude provider is tested against a mocked SDK client. A real API call needs
  credentials (`npm run smoke:live`).
