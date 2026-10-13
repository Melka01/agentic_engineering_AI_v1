# checks.md — Completion checklist & review verdicts

> Written **before execution** (Layer 7) and filled in during the distinct review pass (Layer 5).
> Verdicts: `pass` · `fail` · `unresolved`. Every row must point to observable evidence.

| # | Requirement | Verdict | Evidence | Correction |
|---|-------------|---------|----------|------------|
| C1 | Requested output exists at `output/re-platform-codebase/` and can be opened | unresolved | — | — |
| C2 | Automated unit tests pass | unresolved | — | — |
| C3 | Strict type safety (tsc strict, server + web) passes | unresolved | — | — |
| C4 | Lint / format check passes | unresolved | — | — |
| C5 | Paradigm selector (Mendix vs OutSystems) works in the UI | unresolved | — | — |
| C6 | Paradigm switch on an existing session re-synthesises + re-validates for the new platform | unresolved | — | — |
| C7 | Mendix engine enforces domain/view-model separation | unresolved | — | — |
| C8 | Mendix engine enforces nanoflow use to minimise round trips | unresolved | — | — |
| C9 | Mendix engine enforces microflow complexity limits / splitting | unresolved | — | — |
| C10 | Mendix engine enforces XPath optimisation rules | unresolved | — | — |
| C11 | OutSystems engine enforces 3-layer canvas (no upward / side references) | unresolved | — | — |
| C12 | OutSystems engine detects circular references (dependency graph) | unresolved | — | — |
| C13 | OutSystems engine enforces module encapsulation | unresolved | — | — |
| C14 | OutSystems engine favours Aggregates over custom SQL | unresolved | — | — |
| C15 | User-story generation via structured AI agent call | unresolved | — | — |
| C16 | NFR validation | unresolved | — | — |
| C17 | Risk assessment | unresolved | — | — |
| C18 | Low-code architectural blueprint synthesis | unresolved | — | — |
| C19 | AI calls are modular behind an abstraction layer (provider interface) | unresolved | — | — |
| C20 | Fallback mechanisms (retry, provider chain, deterministic fallback) | unresolved | — | — |
| C21 | Error logging for agent failures | unresolved | — | — |
| C22 | API agent mocks execute successfully | unresolved | — | — |
| C23 | Real Anthropic API call executes | unresolved | — | — |
| C24 | Production build (server + web) succeeds | unresolved | — | — |
| C25 | Running server smoke test (both paradigms over HTTP) | unresolved | — | — |
| C26 | Verification report generated | unresolved | — | — |
| C27 | progress.md matches files left in the workspace | unresolved | — | — |
