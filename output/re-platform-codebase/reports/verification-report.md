# Verification report

- Generated: 2026-10-13T21:42:30.417Z
- Node: v22.22.0 (linux-x64)
- Commit (HEAD at run time): a21eee1
- **Overall: PASS**

## Steps

| Step | Result | Duration | Command |
|------|--------|----------|---------|
| Type check (server + web, strict) | pass | 2379 ms | `npm run typecheck` |
| Lint & format (Biome) | pass | 349 ms | `npm run lint` |
| Unit, integration & UI tests (Vitest) | pass | 4590 ms | `npx vitest run --reporter=default --reporter=json --outputFile=reports/test-results.json` |
| Production build (tsc + Vite) | pass | 2254 ms | `npm run build` |
| Live HTTP smoke test (built server, offline agents) | pass | 694 ms | `node dist/server/index.js (PORT=3917, RE_AI_MODE=offline)` |

## Tests

155/155 tests passed, 0 failed.

| File | Status | Tests | Failed |
|------|--------|-------|--------|
| tests/web/App.test.tsx | passed | 4 | 0 |
| tests/web/ParadigmSelector.test.tsx | passed | 5 | 0 |
| tests/agents/anthropic-provider.test.ts | passed | 7 | 0 |
| tests/agents/runner.test.ts | passed | 18 | 0 |
| tests/analysis/analysis.test.ts | passed | 19 | 0 |
| tests/engines/common-rules.test.ts | passed | 15 | 0 |
| tests/engines/mendix.test.ts | passed | 32 | 0 |
| tests/engines/outsystems.test.ts | passed | 26 | 0 |
| tests/engines/registry.test.ts | passed | 6 | 0 |
| tests/server/app.test.ts | passed | 14 | 0 |
| tests/services/pipeline.test.ts | passed | 6 | 0 |
| tests/shared/schemas.test.ts | passed | 3 | 0 |

## Live smoke test

| Check | Result | Detail |
|-------|--------|--------|
| server starts and reports healthy | pass | http://127.0.0.1:3917 |
| GET /api/health | pass | aiMode=offline |
| security headers | pass |  |
| GET /api/paradigms lists Mendix and OutSystems | pass | mendix:52 rules, outsystems:44 rules |
| POST /api/sessions (Mendix) | pass | stories=4 nfrs=5 score=100 passed=true risks=3 |
| POST /api/sessions (OutSystems, 3-layer canvas) | pass | modules=ExpensePortal, ExpensePortal_BL, ExpensePortal_CS, Sap_IS, ExpensePortal_Th score=100 |
| PUT /api/sessions/:id/paradigm (Mendix → OutSystems) | pass | history=created → paradigm-switched |
| OutSystems engine rejects cycle, upward ref and unsafe SQL | pass | OS-ARCH-001, OS-ARCH-003, OS-DATA-001, OS-DATA-002, OS-DATA-003, RE-NFR-004 |
| Mendix engine rejects persisted view model, UI state, page-only microflow, oversized microflow | pass | MX-DM-001, MX-DM-002, MX-MF-001, MX-RT-001, RE-NFR-004 |
| invalid input → 400 validation_error | pass |  |
| GET / serves the web UI | pass | 527 bytes |

## Step output (tail)

### Type check (server + web, strict)

```text
> re-platform@1.0.0 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p web/tsconfig.json --noEmit
```

### Lint & format (Biome)

```text
> re-platform@1.0.0 lint
> biome check .

Checked 79 files in 107ms. No fixes applied.
```

### Unit, integration & UI tests (Vitest)

```text
 ✓ |node| tests/analysis/analysis.test.ts (19 tests) 99ms
 ✓ |node| tests/engines/registry.test.ts (6 tests) 43ms
 ✓ |node| tests/engines/mendix.test.ts (32 tests) 68ms
 ✓ |node| tests/engines/common-rules.test.ts (15 tests) 45ms
 ✓ |node| tests/engines/outsystems.test.ts (26 tests) 41ms
 ✓ |node| tests/shared/schemas.test.ts (3 tests) 7ms
 ✓ |web| tests/web/ParadigmSelector.test.tsx (5 tests) 426ms
 ✓ |web| tests/web/App.test.tsx (4 tests) 767ms
   ✓ App — paradigm-driven requirements session (2)
     ✓ creates an OutSystems session from the selector, then switches to Mendix 707ms

 Test Files  12 passed (12)
      Tests  155 passed (155)
   Start at  21:42:23
   Duration  3.60s (tests 32%, environment 28%, import 28%, transform 6%, setup 4%, worker 1%)

    Isolate  12 workers spawned · ~314ms startup each (spawn + environment, per file)
             at least ~942ms faster with isolate: false — reuses workers across files instead of one per file

JSON report written to /home/user/agentic_engineering_AI_v1/output/re-platform-codebase/reports/test-results.json
```

### Production build (tsc + Vite)

```text
> npm run build:server && npm run build:web


> re-platform@1.0.0 build:server
> tsc -p tsconfig.build.json


> re-platform@1.0.0 build:web
> vite build --config web/vite.config.ts

vite v8.3.4 building client environment for production...
transforming...
✓ 23 modules transformed.
rendering chunks...
computing gzip size...
web/dist/index.html                   0.52 kB │ gzip:  0.33 kB
web/dist/assets/index-Bb5KNKC8.css    9.10 kB │ gzip:  2.61 kB
web/dist/assets/index-BBwAb_gX.js   241.49 kB │ gzip: 75.07 kB │ map: 1,108.66 kB

✓ built in 615ms
```

### Live HTTP smoke test (built server, offline agents)

```text
ok  server starts and reports healthy — http://127.0.0.1:3917
ok  GET /api/health — aiMode=offline
ok  security headers
ok  GET /api/paradigms lists Mendix and OutSystems — mendix:52 rules, outsystems:44 rules
ok  POST /api/sessions (Mendix) — stories=4 nfrs=5 score=100 passed=true risks=3
ok  POST /api/sessions (OutSystems, 3-layer canvas) — modules=ExpensePortal, ExpensePortal_BL, ExpensePortal_CS, Sap_IS, ExpensePortal_Th score=100
ok  PUT /api/sessions/:id/paradigm (Mendix → OutSystems) — history=created → paradigm-switched
ok  OutSystems engine rejects cycle, upward ref and unsafe SQL — OS-ARCH-001, OS-ARCH-003, OS-DATA-001, OS-DATA-002, OS-DATA-003, RE-NFR-004
ok  Mendix engine rejects persisted view model, UI state, page-only microflow, oversized microflow — MX-DM-001, MX-DM-002, MX-MF-001, MX-RT-001, RE-NFR-004
ok  invalid input → 400 validation_error
ok  GET / serves the web UI — 527 bytes
```

