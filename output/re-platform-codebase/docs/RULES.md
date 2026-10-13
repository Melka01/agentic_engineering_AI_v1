# Rule catalogue

Generated from the rule engines (engine version 1.0.0) by `npm run docs:rules` — do not edit by hand.

## Mendix (29 platform rules)

| Id | Severity | Category | Rule | Rationale |
|----|----------|----------|------|-----------|
| MX-DM-001 | error | domain-model | View-model entities must be non-persistable | UI and view state belongs in non-persistable entities; persisting it pollutes the database and couples the UI to the domain model. |
| MX-DM-002 | error | domain-model | No UI state on persistable domain entities | Attributes such as IsSelected, ShowDetails or SearchText on persisted entities mix view state into the domain model and cause needless writes. |
| MX-DM-003 | error | domain-model | Search and filter widgets bind to view entities | Binding search/filter input to a persistable entity either creates throw-away database rows or mutates domain data; use a non-persistable search view model. |
| MX-DM-004 | error | domain-model | Persistable entities must not own associations to non-persistable entities | Mendix does not allow a persistable entity to own an association to a non-persistable entity; the view entity must own the association. |
| MX-DM-005 | warning | domain-model | Keep entities focused | Very wide entities are expensive to retrieve and usually hide several concepts; split them with associations. |
| MX-DM-006 | warning | domain-model | Complex forms stage input in a view model | Editing many domain entities on one page spreads validation and commit logic over widgets; a view model keeps the domain consistent and saves in one transaction. |
| MX-RT-001 | error | round-trips | Client-only logic must be a nanoflow | A microflow triggered from a page always costs a server round trip. Logic without database or integration work runs on the client as a nanoflow. |
| MX-RT-002 | warning | round-trips | One server call per user action | Every microflow call from a nanoflow is a round trip; chained calls multiply latency. |
| MX-RT-003 | warning | round-trips | Limit database retrieves in nanoflows | In online apps each database retrieve from a nanoflow is a separate round trip. |
| MX-MF-001 | warning | microflow-complexity | Split large microflows | Large microflows are hard to read, test and reuse; extract cohesive steps into SUB_ microflows. |
| MX-MF-002 | warning | microflow-complexity | Limit decision complexity | Many decisions in one microflow raise cyclomatic complexity; move branches into sub-microflows or rules. |
| MX-MF-003 | warning | microflow-complexity | Avoid nested loops | Nested loops grow quadratically with data volume and usually hide an in-memory join. |
| MX-MF-004 | error | microflow-complexity | No commits inside loops | Committing per iteration issues one database transaction step per object; collect changed objects in a list and commit the list after the loop. |
| MX-MF-005 | error | microflow-complexity | No database retrieves inside loops | A database retrieve per iteration is the N+1 query anti-pattern. |
| MX-MF-006 | warning | microflow-complexity | Integration calls need error handling | External calls fail; without custom error handling the user sees a generic error and transactions roll back unpredictably. |
| MX-MF-007 | info | microflow-complexity | Flows follow the prefix naming convention | Purpose prefixes (ACT_, SUB_, DS_, VAL_, …) make the role and call site of a flow obvious. |
| MX-MF-008 | warning | microflow-complexity | Constrain "retrieve all" database retrieves | Retrieving all objects without a constraint loads the whole table into memory and degrades with growth. |
| MX-XP-000 | error | xpath | XPath constraints must be well-formed | A malformed constraint fails at runtime or silently matches nothing. |
| MX-XP-001 | warning | xpath | Keep XPath association paths short | Every association hop adds a join or subquery; deep paths are a top cause of slow retrieves. |
| MX-XP-002 | warning | xpath | Avoid negations in XPath | not() and != on association paths compile to NOT EXISTS / outer-join subqueries that cannot use indexes efficiently. |
| MX-XP-003 | warning | xpath | Index attributes used in XPath constraints | Constraints on non-indexed attributes force full table scans as data grows. |
| MX-XP-004 | warning | xpath | Avoid contains() on large tables | contains() translates to LIKE '%x%', which cannot use an index. |
| MX-XP-005 | warning | xpath | Avoid OR across association paths | OR conditions that mix association paths prevent index use and generate complex subqueries. |
| MX-XP-006 | error | xpath | XPath attributes must exist on the entity | A constraint on a non-existent attribute fails model consistency checks. |
| MX-OFF-001 | error | offline | Offline pages use local data sources | Offline-first profiles read from the device database; microflow data sources need the server and break offline. |
| MX-OFF-002 | warning | offline | Offline pages call microflows only through nanoflows | Direct microflow actions on offline pages fail without connectivity; a nanoflow can check the network and handle errors. |
| MX-OFF-003 | error | offline | Offline stories are realised by offline-capable pages | A story that requires offline use cannot be delivered by responsive web pages, which need a live server connection. |
| MX-ASYNC-001 | warning | async-processing | Bulk work runs in scheduled events or task queues | Bulk imports and batch updates in page-triggered microflows block the user and risk request timeouts. |
| MX-INT-001 | error | model-integrity | Model references must resolve | Dangling references to flows or entities make the model inconsistent and fail in Studio Pro. |

**Modelling guidance injected into the blueprint agent prompt:**

- entities.role "domain" = persisted business data (persistable: true). "view" = UI, search, filter or wizard state (persistable: false, name ends with "VM"). "integration" = API/import message structures (persistable: false).
- Never put UI state (IsSelected, Show*, Search*, Filter*, Temp*, Wizard*) on persistable entities; search/filter widgets bind to non-persistable view entities (filterEntities must reference view entities).
- Persistable entities must not own associations to non-persistable entities (the view entity owns the association).
- Pages that edit more than 2 persistable entities stage the input in a view model.
- microflows.calledFrom "page" only when the logic needs the server (database retrieve/commit, integration). Validation, navigation and UI logic are nanoflows (VAL_, NAV_, ACT_ prefixes).
- Each nanoflow calls at most 1 microflow and performs at most 1 database retrieve (one round trip per user action).
- Microflows: at most 25 activities (hard limit 40), 8 decisions and loop nesting 1; extract SUB_ microflows otherwise.
- Never commit or retrieve from the database inside a loop: retrieve once, change objects in memory, commit the list after the loop.
- Microflows with integration calls have custom error handling (hasErrorHandling: true).
- XPath: at most 2 association hops; mark attributes used in XPath constraints as indexed; avoid not(), != on association paths, contains() and OR across association paths; constrain database retrieves with range "all".
- Offline profiles (offline-pwa, native-mobile) use database/nanoflow data sources only and call microflows only through nanoflows.
- Flow names use a purpose prefix: ACT_, SUB_, DS_, VAL_, NAV_, OCH_, OEN_, OLE_, SCE_, BCO_, ACO_, BDE_ …
- All references (page actions, nanoflow microflowCalls, subMicroflows, associations, data sources) must resolve to elements in the design.

## OutSystems (21 platform rules)

| Id | Severity | Category | Rule | Rationale |
|----|----------|----------|------|-----------|
| OS-ARCH-001 | error | architecture-layers | No upward references | Lower canvas layers must not consume higher ones (Foundation → Core, Core → End-User, Core Entities → Business Processes); upward references couple reusable services to consumers. |
| OS-ARCH-002 | error | architecture-layers | No side references between end-user modules | End-user modules are independent consumers; sharing logic between them belongs in Core or Foundation modules. |
| OS-ARCH-003 | error | dependencies | No circular references | Cycles make modules impossible to deploy independently and force all of them to be published together. |
| OS-ARCH-004 | warning | architecture-layers | Module names reveal their canvas role | Suffixes (_CS, _BL, _IS, _Lib/_Th) make layer violations visible in reviews and in the dependency viewer. |
| OS-ENC-001 | error | encapsulation | Expose core entities read-only | Writable public entities let every consumer bypass validation and auditing; consumers must write through the CRUD wrapper actions. |
| OS-ENC-002 | warning | encapsulation | Core entities have CRUD wrapper actions | Read-only entities need public wrapper actions so consumers can write in a controlled way. |
| OS-ENC-003 | error | encapsulation | Business entities live in Core Entities modules | Entities defined in end-user or business-process modules cannot be reused without breaking the canvas. |
| OS-ENC-004 | warning | encapsulation | End-user modules expose no public actions | End-user modules must not be producers; public actions there invite side references. |
| OS-ENC-005 | warning | encapsulation | Connectors wrap integrations, not business data | Integration services (_IS) should translate external APIs; persisting business data there couples the domain to a vendor. |
| OS-ENC-006 | error | encapsulation | Screens only in end-user modules | Core and Foundation modules must stay UI-free so they can serve any consumer. |
| OS-ENC-007 | warning | encapsulation | Keep module public surfaces focused | Modules with very large public surfaces become monoliths with many consumers and slow, risky deployments. |
| OS-DATA-001 | error | data-access | Prefer Aggregates over custom SQL | Aggregates are optimised by the platform, database-independent and refactor-safe; advanced SQL is only for what aggregates cannot express. |
| OS-DATA-002 | error | data-access | No Expand Inline parameters in SQL | Expand Inline concatenates values into SQL text and opens the door to SQL injection. |
| OS-DATA-003 | error | data-access | No queries inside loops | Running an aggregate or SQL query per iteration is the N+1 query anti-pattern. |
| OS-DATA-004 | warning | data-access | Paginate screen list queries | Unbounded list queries fetch every row to the client; set Max Records and paginate. |
| OS-DATA-005 | warning | data-access | Limit sources per aggregate | Aggregates joining many sources become slow and hard to optimise; denormalise or split. |
| OS-DATA-006 | warning | data-access | Limit at-start queries per screen | Every at-start aggregate delays screen rendering; fetch secondary data only on demand. |
| OS-DATA-007 | warning | data-access | Advanced SQL belongs in Core modules | SQL in end-user modules duplicates data logic in consumers; centralise it in a _CS/_BL server action. |
| OS-ASYNC-001 | warning | async-processing | Bulk work runs asynchronously | Bulk imports and batch updates in screen actions hit request timeouts; run them in Timers or light BPT. |
| OS-INT-001 | error | model-integrity | Module references must resolve | References to modules that do not exist make the dependency analysis incomplete. |
| OS-INT-002 | error | model-integrity | Screen queries bind to screens of their module | A screen aggregate must belong to an existing screen in the same module. |

**Modelling guidance injected into the blueprint agent prompt:**

- Module kinds and Architecture Canvas layers: end-user (End-User layer: screens only, no suffix); business-process (Core layer, suffix _BL: processes, orchestration, timers); core-entities (Core layer, suffix _CS: core entities and their CRUD wrapper actions); connector (Foundation layer, suffix _IS: wraps one external system); library (Foundation layer, suffix _Lib/_Th/_Pat: business-agnostic reusable assets).
- references only point down the canvas: end-user → business-process/core-entities/connector/library; business-process → core-entities/connector/library; core-entities → connector/library; foundation → foundation only.
- No references between end-user modules, no circular references (including indirect cycles), and every reference must name a module in the design.
- Public core entities are exposed read-only (isPublic: true, exposeReadOnly: true); writes go through public server actions named <Entity>_Create, <Entity>_CreateOrUpdate, <Entity>_Update or <Entity>_Delete.
- Screens live only in end-user modules; end-user modules hold no public entities or public actions; connectors hold no business entities.
- Keep each module focused: at most 30 public actions.
- Data access: aggregates by default (≤ 5 sources each). Screen list queries set maxRecords (pagination); at most 4 "at-start" queries per screen, the rest "on-demand". Never query inside a loop.
- advanced-sql only when an aggregate cannot express the query (sqlJustification: bulk-operation, unsupported-construct or reporting-view), always parameterised (usesExpandInline: false), and inside Core modules rather than end-user modules.
- Bulk or batch stories run asynchronously in a timer (actions.kind "timer") in a _BL module.

## Common rules — both paradigms (23)

| Id | Severity | Category | Rule | Rationale |
|----|----------|----------|------|-----------|
| RE-US-001 | error | story-quality | Story states role, goal and benefit | A story without a role, goal or benefit cannot be prioritised or validated against user value. |
| RE-US-002 | error | story-quality | Story has testable acceptance criteria | Acceptance criteria in Given/When/Then form make the story testable (INVEST: Testable). |
| RE-US-003 | warning | story-quality | Avoid ambiguous wording | Words like "fast" or "user-friendly" are untestable; quantify them as NFRs or acceptance criteria. |
| RE-US-004 | warning | story-quality | Stories are small | Stories above 8 points rarely fit a sprint and hide unknowns (INVEST: Small). |
| RE-US-005 | warning | story-quality | Limit acceptance criteria per story | More than eight acceptance criteria usually means the story covers several capabilities. |
| RE-US-006 | warning | story-quality | No duplicate stories | Duplicated stories break independence and double-count scope (INVEST: Independent). |
| RE-US-007 | error | story-quality | NFR references must resolve | A story that cites a non-existent NFR has an unverifiable quality constraint. |
| RE-US-008 | info | story-quality | Name a concrete persona | Generic roles ("user", "system") hide who benefits and which security role is needed. |
| RE-US-009 | warning | story-quality | Benefit expresses value | A benefit that repeats the goal or is a single word gives no basis for prioritisation (INVEST: Valuable). |
| RE-US-010 | error | story-quality | Story ids are unique | Duplicate ids break traceability from requirements to design and tests. |
| RE-US-011 | info | story-quality | Stories are estimated | Unestimated stories cannot be planned (INVEST: Estimable). |
| RE-US-012 | warning | story-quality | Stories describe needs, not low-code solutions | Naming microflows, aggregates, tables or SQL in a story fixes the solution too early (INVEST: Negotiable); keep design in the blueprint. |
| RE-NFR-001 | error | nfr-quality | Quality attributes are measurable | Performance, scalability, availability and reliability NFRs need a metric and target to be verifiable. |
| RE-NFR-002 | warning | nfr-quality | NFRs declare a verification method | Without a verification method nobody owns proving the requirement. |
| RE-NFR-003 | warning | nfr-quality | NFRs avoid ambiguous wording | Unquantified adjectives make NFRs impossible to accept or reject. |
| RE-NFR-004 | warning | nfr-quality | Core quality attributes are covered | Every production system needs explicit security, performance and availability requirements. |
| RE-NFR-005 | error | nfr-quality | NFRs do not conflict | Two targets for the same metric that cannot both hold make acceptance impossible. |
| RE-NFR-006 | warning | nfr-feasibility | Availability is feasible on the managed platform | Targets above the highest standard managed-cloud tier need a high-availability / multi-region setup and contract verification. |
| RE-NFR-007 | error | nfr-quality | Metric targets are plausible | Negative durations or percentages above 100 indicate a specification error. |
| RE-NFR-008 | info | nfr-feasibility | Tight response-time targets have a platform strategy | Sub-second targets are achievable on low-code platforms only with deliberate client/server design. |
| RE-NFR-009 | error | nfr-quality | NFR ids are unique | Duplicate NFR ids break traceability from stories to quality constraints. |
| RE-COV-001 | warning | traceability | Every story is realised in the blueprint | Stories without a design element are silently dropped from delivery. |
| RE-COV-002 | warning | traceability | Design elements trace to known stories | References to unknown stories indicate scope creep or stale traceability. |

Severity semantics: `error` blocks compliance (and triggers blueprint repair / deterministic replacement), `warning` lowers the score, `info` is advisory.

