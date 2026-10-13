# 7-layer harness: where each layer is satisfied

The task prompt defined a 7-layer harness. No separate harness specification file was supplied
(see `docs/SOURCES.md`), so this mapping follows the prompt text.

| Layer | Requirement | Evidence in this workspace |
|---|---|---|
| 1. Context | Read rules, structure and progress; keep durable facts; record sources | `CLAUDE.md` (durable project facts), `progress.md`, `docs/SOURCES.md` (URIs, data structures checked, retrieval failures) |
| 2. Procedure | Five steps, each with an observable output | Loops 1–5 in `progress.md`, one checkpoint commit per loop (`git log`), plus test files for each step |
| 3. Tools | Confirm sources are readable; record failures | `docs/SOURCES.md`: docs.mendix.com ENOTFOUND, search snippets used, no API key present |
| 4. Permissions | Stay in scope; keep recoverable versions; ask before externalising | All changes stay under `output/re-platform-codebase/`. A local commit was made before each risky step. Pushes go only to the designated branch. No PR was opened and nothing was published |
| 5. Review | A distinct review pass and `checks.md` with requirement \| verdict \| evidence \| correction | `checks.md` and `reports/verification-report.md` |
| 6. Effort | Inspect the actual model and effort settings | `progress.md` records the `get_session` output (model `claude-opus-5-5`, effort `xhigh`). The prompt text does not change runtime effort |
| 7. Completion | Write the checklist before execution, with observable evidence for each item | `checks.md` rows C1–C27 were written before Loop 1 and filled in during the review |
