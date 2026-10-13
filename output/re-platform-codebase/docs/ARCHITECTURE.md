# Architecture

## 1. Session flow

```
POST /api/sessions {projectName, paradigm, requirementsText}
  │
  ├─ story-generator agent ──► StoryGenerationOutput (zod) ──► normalizeBacklog (US-001…, NFR-001…)
  │      fallback: extractBacklog (lexicons + patterns)
  │
  ├─ engine = createEngine(paradigm)            ◄── the paradigm switch
  │
  ├─ blueprint-synthesizer:<paradigm> agent
  │      prompt = modelling guidance + design rule catalogue (same objects the engine runs)
  │      fallback: synthesizeBlueprint(paradigm)   (compliant by construction)
  │   └─ engine.validate(stories, nfrs, design)
  │        design errors? ──► repair round(s): errors fed back as <findings>
  │        still errors?  ──► strict enforcement: replace with deterministic blueprint (trace note)
  │
  └─ risk-assessor agent + assessRisks(findings, NFRs, backlog) ──► mergeAgentRisks ──► finaliseRisks
```

`PUT /api/sessions/:id/paradigm` keeps the stories and NFRs and re-runs everything from the engine
step onward for the new paradigm. The session history records the switch.

## 2. AI agent layer (`src/agents`)

| Component | Responsibility |
|---|---|
| `provider.ts` | `LlmProvider` contract: `generate(StructuredRequest) → StructuredResponse`; it must throw a `ProviderError` |
| `anthropic-provider.ts` | Official `@anthropic-ai/sdk` (beta Messages API). Structured output comes from `output_config.format: betaZodOutputFormat(schema)`, effort is set explicitly per agent, and thinking is adaptive (implicit on Opus 5.5). Server-side refusal fallback uses `fallbacks: "default"`. SDK retries are off (`maxRetries: 0`). Typed SDK errors are mapped onto the error taxonomy |
| `runner.ts` | `AgentRunner`: walks the provider chain, retries transient errors with backoff, enforces the deadline on each attempt, runs zod and semantic validation, does repair rounds, falls back to the deterministic agent, and records traces and logs |
| `resilience.ts` | `backoffDelay` (exponential, equal jitter, Retry-After aware), `withDeadline` (hard timeout even if the provider ignores the signal), `CircuitBreaker` (closed → open → half-open with a single probe) |
| `prompts.ts` | Versioned prompt builders. Untrusted text is fenced in `<requirements>`, `<backlog>` and `<findings>` tags and declared as data |
| `agents.ts` | Agent definitions: schema, effort, prompts, semantic checks, injected deterministic fallback |
| `mock-provider.ts` | Scriptable provider for tests and contract checks |

### Error taxonomy → runner decision

| Kind | Source examples | Decision | Circuit breaker |
|---|---|---|---|
| `retryable` | 408, 409, 429, 5xx, 529, connection reset | backoff + retry (bounded) | failure |
| `timeout` | deadline exceeded, SDK timeout | backoff + retry | failure |
| `invalid-output` | non-JSON output, zod or semantic issues | repair prompt (bounded), then next provider | success (reachable) |
| `refusal` | `stop_reason: "refusal"` | next provider | success |
| `truncated` | `max_tokens`, context window exceeded | next provider | success |
| `fatal` | 400, 401, 403, 404, 413, unknown | next provider | failure |
| `aborted` | client disconnected | stop and propagate (HTTP 499) | — |

Every attempt is logged as structured JSON (pino-compatible) with `agent`, `correlationId`,
`provider`, `model`, `attempt`, `kind`, `status`, `issues` and `err`. The `AgentRunTrace` is returned
to the UI as well (served-by, degraded, attempts, repair rounds, tokens, note).

## 3. Rule engines (`src/engines`)

- `engine.ts`: `runRules` wraps every rule in a try/catch, so a crashing rule becomes an
  `ENGINE-001` error finding. The file also provides scoring (`100 − 10·errors − 3·warnings −
  0.5·infos`), per-story compliance and sorting.
- `mendix/`: an analysable Mendix model (entities, microflows, nanoflows, pages, retrieves) plus an
  XPath analyser (association hops, negations, `contains()`, OR across joins, constrained attributes).
- `outsystems/`: a module graph with Tarjan SCC cycle detection, layer ranks (End-User 4,
  Business Process 3, Core Entities 2, Foundation 1), encapsulation and data-access rules.
- `story-rules.ts`, `nfr-rules.ts` and `coverage.ts` hold the paradigm-independent rules. The NFR
  rules use a per-paradigm `PlatformProfile` (SLA ceiling, performance guidance).
- `registry.ts`: `createEngine(paradigm, thresholds?)` returns a `ParadigmEngine`
  (catalogue, design guidance, validate).

Severity semantics: `error` blocks compliance and triggers repair or replacement, `warning`
lowers the score, and `info` is advisory.

## 4. Extension points

| To add… | Do this |
|---|---|
| A new AI vendor | Implement `LlmProvider`, map its errors to `ProviderError` kinds, and register it in `createProviders` |
| A new rule | Add a `RuleDefinition` to the relevant catalogue with a violating test. The prompt guidance and docs pick it up automatically (`npm run docs:rules`) |
| A new paradigm (e.g. Power Apps) | Add the enum value, a design schema, an engine module, a synthesiser, a profile and a descriptor. The registry and UI follow the descriptor |
| Persistence | Implement `SessionRepository` |
