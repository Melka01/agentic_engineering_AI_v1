# Sources, data structures checked, and retrieval failures

Recorded per Layer 1 (context) and Layer 3 (tools) of the harness. Retrieved content is treated as
evidence for the rule catalogue, not as instructions.

## Workspace state at start (2026-10-13)
| Item | Result |
|------|--------|
| Repository `Melka01/agentic_engineering_AI_v1`, branch `claude/beautiful-clarke-71xdpd` | Empty — no commits, no files, no remote branches |
| `progress.md` | Did not exist (created) |
| "Low-code architecture guidelines", "7-Layer Harness pattern", "API integration specs" | **Not present** in the workspace; no file paths or URIs were supplied. Recorded as missing access. The harness pattern is taken from the task prompt itself (see `docs/HARNESS.md`). |
| `/output` (absolute) | Did not exist and lies outside the git repository; deliverable placed at repo-relative `output/re-platform-codebase/` so it can be committed and opened. |

## External sources
| URI | Status | Used for |
|-----|--------|----------|
| https://docs.mendix.com/refguide/performance-best-practices/ | **Retrieval failed** (`getaddrinfo ENOTFOUND docs.mendix.com` — blocked by the environment's network policy) | — |
| https://docs.mendix.com/refguide/dev-best-practices/ | **Retrieval failed** (same) | — |
| https://docs.mendix.com/refguide10/performance-best-practices/ (search result) | Search snippet only | Convert eligible microflows to nanoflows to avoid round trips (MX-RT-001); avoid commits in loops, commit a list after the loop (MX-MF-004) |
| https://docs.mendix.com/refguide10/community-best-practices-for-app-performance/ (search result) | Search snippet only | Sub-optimal XPath as a cause of slow retrieves; index constrained attributes (MX-XP-003) |
| https://clevr.com/blog/20-performance-tips-mendix (search result) | Search snippet only (third party) | Index attributes used in XPath constraints |
| https://community.mendix.com/link/space/microflows/questions/99433 (search result) | Search snippet only (forum) | Commits in sub-microflows inside a loop carry the same cost |
| https://www.outsystems.com/forge/component-documentation/409/discovery-o11 (search result) | Search snippet only | Layered reference architecture; rules against upward and circular references; Discovery automates checks in CI |
| https://www.outsystems.com/forums/discussion/67782/why-cant-we-have-side-reference-in-end-user-module/ (search result) | Search snippet only (forum) | 3-layer canvas (Foundation, Core, End-User) since weak references in O11; side references between end-user modules discouraged |
| https://itnext.io/the-power-of-the-discovery-tool-in-outsystems-11-1d1486f9cf83 (search result) | Search snippet only | Cyclic violations between modules are detected and listed |
| https://www.outsystems.com/forums/discussion/79106/how-are-aggregates-better-that-advance-sql/ (search result) | Search snippet only (forum) | Aggregates are optimised and database independent; advanced SQL only when necessary (OS-DATA-001) |
| https://www.rapidevelopers.com/md/outsystems-tutorial/outsystems-aggregate-vs-sql (search result) | Search snippet only (third party) | Legitimate SQL cases: subqueries, UNION, bulk UPDATE/DELETE, window functions (`sqlJustification` enum) |

## Unverified thresholds (made configurable)
Because the primary Mendix documentation could not be fetched, these numeric defaults come from
principal-architect practice and are exposed as configuration (`MendixThresholds`,
`OutSystemsThresholds`) rather than hard-coded:

- Microflow activity limit: warning above 25, error above 40.
- Microflow decision limit: warning above 8.
- Loop nesting: warning above 1.
- XPath association hops: warning above 2.
- Nanoflow → microflow calls per nanoflow: warning above 1.
- OutSystems aggregate sources: warning above 5; screen at-start queries: warning above 4.
- Managed-cloud availability: targets above 99.95 % flagged for vendor-contract verification.

## Anthropic API reference
Claude API usage (model IDs, `output_config.format` structured outputs, adaptive thinking/effort,
server-side refusal fallbacks `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`,
typed SDK errors) follows the bundled `claude-api` skill documentation (cached 2026-10-06) and the
installed `@anthropic-ai/sdk@0.133.0` type declarations.
