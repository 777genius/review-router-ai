# Skills catalog, checked import, and bounded scanning

Status: implementation plan v2 accepted after two independent critique rounds; implementation in progress.
Owner: ReviewRouter Skills. Date: 2026-10-27.

## 1. Outcome and acceptance boundary

A signed-in user who can create workspace Skills can find a skill in the UAP catalog, read its actual instructions, run NVIDIA SkillSpector, and add the exact checked text to the existing library. The existing repository-assignment flow follows import. Static checks work independently; a separately configured, explicitly selected AI-assisted check is optional. The product never labels a skill as guaranteed safe.

This is an additive feature, not a replacement Skills editor, installation system, generic security platform, or redesign of application authorization. Implementation follows this plan, two critique-and-correction rounds, focused commits/pushes, independent code review, real integration/browser checks, and guarded merges after mandatory CI. Production deployment and release/tag promotion are separate operations.

### In scope

- UAP's existing search/browse API as the catalog source, called from the ReviewRouter backend.
- A small authenticated UAP resolve/preview endpoint reusing its existing exported Go source-resolution core.
- Text-only import through the existing portable Skills parser and existing create/assignment application APIs.
- Immutable, workspace-owned import candidates and durable asynchronous scan jobs/results.
- SkillSpector static analysis plus a disabled-by-default, bounded OpenAI-compatible LLM profile.
- Reusable request/new-job quotas through the existing PostgreSQL rate-limit feature; explicit job concurrency and per-execution bounds.
- One catalog dialog in the current library; understandable progress/results and warning acknowledgement.
- Focused unit/contract tests, real PostgreSQL and Git fixtures, actual static scanner execution, real Next/session/worker browser tests, desktop/mobile visual review.

### Explicitly out of scope

- Installing or executing scripts, binaries, archives, hooks, dependencies, or complete skill bundles.
- Private repositories, arbitrary source URLs/hosts, local source paths, user-supplied scanner flags, YARA rules, provider credentials, model selectors, or baselines.
- Editing instructions inside catalog preview; editing remains in the existing library editor. No persistent green safety badge on an edited library skill.
- Rewriting UAP's catalog provider, UAP landing pages or its parallel LintAI/SkillSpector project.
- Redis, another broker, a generic policy DSL, plugin provider framework, universal authorization gateway, or application-wide limiter migration.
- Autonomous paid model tests, new production secrets, production rollout, changed mandatory CI gates, release tags, or cleanup of other agents' work.

## 2. Baselines and concurrent work

- ReviewRouter Skills PR #704: `7ba41d4083ee6dc2e93a1e978f8e16510aab03f0`; browser acceptance 169 portable tests, 24 browser cases, 34 reviewed images. Its required Linux CI remains queued; this is not a passing merge gate.
- ReviewRouter main: `88c78df8ba6c2b9546e74852f518ef4c24fdf2f5`. New work is isolated on `feat/skills-catalog-security-20261027`, includes #704 and current main, and does not rewrite #704's branch.
- UAP main: `4c58737f1bc26d64f7ee591ab05b058839944c8a`. No published SkillSpector/resolve PR was found at initial inspection. Recheck before editing/merging because other agents are active.
- SkillSpector release v2.13.1: `f3b25697d76256998ca9d42c198d256258d4c035`; pin source revision and runtime dependency lock/image identity. Floating main currently has different version metadata and is not an execution identity.
- Keep a separate UAP resolver PR and a ReviewRouter PR. Initially target the ReviewRouter feature PR at the #704 branch to make the incremental change reviewable; retarget to main after #704 merges and reconcile the actual resulting tree. Do not merge through a blocked prerequisite.

## 3. User experience

Add **Browse catalog** next to the existing Create skill action, subject to existing create authority. Reuse `SkillsDialog`, shared controls, the existing library cache and assignment handoff. One dialog contains a results view and a preview view with Back; no nested modal or multi-step wizard.

The results view has one search box, a short source attribution, loading/error/empty states and a simple list. Empty or short search browses popular items; a one-character query explicitly says “Type at least two characters to search.” Debounce interactive search, preserve selection/query on errors and Back, and show another page only when the actual browse contract supports it. UAP search is limited and does not provide an exhaustive total; never invent one.

Preview shows the name, description, source repository link derived from validated owner/repo, and instructions rendered as inert text using existing primitives. It introduces no Markdown/HTML renderer. Ambiguous source resolution presents actual discovered names for selection. Unsupported companion content explains that this skill cannot be added as text; it is never silently discarded. Omitted metadata follows the existing explicit acknowledgement policy.

Primary action: **Check skill**. When an operator has fully configured AI-assisted checks, offer one optional checkbox with a short disclosure that the instructions are sent to the configured analysis service. No technical provider settings appear here. The default is static analysis. Changing the selected profile selects a different result identity and disables import until that profile has an eligible check; a static success never appears as an AI-assisted result.

| State                           | User message and action                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Not checked                     | Check this skill before adding it.                                                        |
| Queued/running                  | Checking…; closing remains allowed and reopening resumes status.                          |
| Complete, no blocking findings  | No issues found; Add to library available.                                                |
| Lower-severity findings/caution | Review warnings; concise details and explicit acknowledgement before adding.              |
| High/critical risk              | Risk found; adding is unavailable.                                                        |
| Incomplete/error/timeout        | Could not complete check; retry without losing the selection.                             |
| Rate limited                    | Too many checks. Try again in …; retain the preview.                                      |
| Expired check                   | Check this skill again before adding it.                                                  |
| Successful import               | Close catalog, refresh library, continue with the existing known-skill assignment dialog. |

The library retains selected candidate/job and immutable submitted operation ID/profile/payload across same-page close/reopen and unknown responses; React Query owns fetched results, keyed by viewer/workspace/candidate/profile/job. Closing does not clear an outstanding attempt. Retry an unknown outcome with the same ID and payload; allocate a new ID only for explicitly requested new work or retry of a known terminal incomplete job. A possibly committed import is “Result not confirmed”, never a confirmed failure. V1 promises same-page reopen, not navigation/refresh restoration or a scan-history screen.

Do not show scores, hashes, claim IDs, version numbers, raw scanner JSON, stack traces or technical error bodies in normal product UI. Details show sanitized finding summaries, locations and practical explanations. Do not claim that popularity, installation count or a completed check proves trustworthiness.

## 4. Clean Architecture and ownership

Keep the new candidate/scanning application service inside the existing `packages/features/review-skills` feature. It is one cohesive use case owned by Skills, with a small public API; do not enlarge the existing CRUD dispatcher into an external-fetch/process controller.

| Layer            | Responsibility                                                                                                       | Must not know                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Domain           | Candidate identity, report normalization/verdict, job states, import eligibility                                     | Prisma, HTTP, Next, Python, process environment   |
| Application      | Search, resolve/stage, request/read scan, import checked candidate                                                   | Concrete stores, network clients, SQL, React      |
| Ports            | Catalog source, candidate/job persistence, admission, scanner execution, existing Skills create/access, clock/digest | Specific SDKs or another feature's infrastructure |
| Infrastructure   | Bounded UAP HTTP adapter, Prisma candidate/job store, scanner HTTP adapter, portable serialization                   | UI state                                          |
| Composition      | Bind existing Skills access, rate limiter, outbox, database and configured scanner                                   | User-supplied execution configuration             |
| Web interface    | Session actor injection, typed errors, React Query adapter, simple dialog                                            | Database/scanner credentials, subprocesses        |
| Worker interface | Existing outbox event handler, bounded execution and fenced result publication                                       | Browser state                                     |

Domain/application import only their own feature and shared contracts. Cross-feature interactions go through public APIs/ports, wired at the host composition root. The rate limiter remains a separate reusable feature. No scanner adapter imports another feature's Prisma implementation or writes its tables.

Move the existing portable parser/serializer to a browser-safe public feature entrypoint, preserving a compatibility re-export at its current web path. Preserve all existing parser tests and exact body semantics. YAML parsing remains an adapter concern; the application consumes a normalization port. Do not fork the 169-test parser or write another Markdown companion-resource detector.

Use the existing modular composition conventions where the feature already uses them. Add only contracts needed for actual adapters, not an abstraction per function or future vendor.

## 5. UAP resolve/preview contract

Keep anonymous `GET /v1/skills` behavior unchanged. Add one bounded, service-authenticated `POST /v1/skills/resolve`. A missing configured service token disables this route. ReviewRouter owns end-user/workspace authorization; the UAP token grants only this source-resolution capability.

Input is a strict size-bounded JSON object: `repository` (`owner/repo`), optional `skillNameHint`, or the paired `commit` (full lowercase SHA) and actual `path` for selection. Reject unknown/duplicate fields, malformed identifiers, traversal, URLs and control characters. Authenticate and apply admission before Git work.

Initial resolution uses existing `skillsource.Acquirer.Resolve`, `Open` and `Session.Scan`. Resolve a moving branch once, then use its immutable commit. Auto-select only after complete discovery produces one unambiguous available match. A catalog slug is a hint, not a filesystem path. Ambiguity returns bounded candidate names/paths; incomplete discovery is explicit and does not auto-select.

Selection supplies the returned commit and path, then uses `CandidateAt`/`Preview` at that exact commit. Never resolve the default branch again during selection/import. Return a versioned discriminated result: `resolved`, `selection_required`, `not_found` or `incomplete`, repository/commit identity, and either candidates or the selected skill's raw UTF-8 content, actual path and raw SHA-256. Validate the original bytes with utf8.Valid before hashing or JSON encoding; invalid UTF-8 is unsupported, never silently replaced. A limited resource-presence summary is advisory inventory, not a verified bundle manifest. Text-only eligibility uses the existing portable parser for referenced dependencies; additionally, the selected skill subtree must report symlink/gitlink/unknown entries as unsupported rather than silently filter them. Ordinary unreferenced companion resources are not imported and their omission is disclosed; an empty filtered inventory is never proof of completeness.

Limits start at one active resolver per service process, burst 2 with one request token per 5 seconds, 30-second overall deadline and 35-second HTTP write deadline; 20,000 tree entries, depth 32, 128 candidates, 4 MiB metadata, 64 KiB per document, 2 MiB total document bytes, 256 KiB encoded response. Exhaustion returns an explicit incomplete/busy result. Reuse the core's filtered, no-checkout Git tree and credential isolation; hosted Git uses HTTPS only, disables redirect following and never enables native credentials. Deployment uses a private 256 MiB temporary filesystem, 512 MiB memory and 64-task limit with one resolver replica initially; test disk exhaustion and kill/cancellation/cleanup. Time/disk bounds do not constitute an unimplemented total Git network-byte counter. The endpoint fails unavailable if its required runtime envelope is not configured. Reject unsafe entry kinds and never execute repository content. Always clean private temporary work.

Update OpenAPI, existing operations documentation and the systemd/container runtime recipe for Git, immutable source access, resource bounds and the Go workspace module dependency. Verify a reproducible root binary build, not only workspace-specific compilation. Do not edit the UAP landing UI or replace its existing scanner work.

## 6. Candidate and scan persistence

Use two feature-owned models and one additive migration:

1. **Import candidate**: server UUID, workspace, creator, immutable normalized name/description/instructions, canonical scan text and digest, source repository/commit/path/raw digest, omitted-field acknowledgements required, creation/expiry time. Candidate lifetime starts at 24 hours. Source digest and final imported-text digest are distinct.
2. **Scan job**: UUID/operation identity, candidate/workspace/requesting actor, profile/build/policy fingerprint, queued/running/completed/incomplete status, bounded normalized report, created/started/completed/expiry times, execution fence/lease, conservative budget reservation and outcome metadata. A completed valid job is the cache; no extra cache/result/event-sourcing tables. A lightweight request receipt may occupy the same Scan model with reuseOfScanId pointing directly to a physical job: unique workspace/actor/operation identity and immutable payload, no event or reservation. Only physical rows count as queued/running. This records new operation IDs that reuse cached/in-flight work without unbounded alias maps.

Canonical scan text serializes only the actual imported name, description and exact instruction body with deterministic escaping. Scan this text, persist it, and import the corresponding persisted fields. The source may contain omitted fields; record its raw digest separately and require the existing omission acknowledgement. Never accept client-provided final text, `scanPassed`, source hash, verdict or content hash as authority.

Cache reuse is workspace-scoped and requires exact content, scanner build, static/LLM profile, model/bounds where applicable, policy and non-expired complete result. Static and AI-assisted results cannot substitute for each other. Authorization runs before cache lookup. No global cache reveals another workspace's skill existence or findings.

Same operation ID plus same payload returns the existing job/import result without charging again; same ID with a different payload conflicts. Concurrent requests for the same eligible work converge under a short transaction lock and unique operation identity. A cache hit or in-flight deduplication does not spend a new-job quota. A retry of an incomplete check uses a new explicit operation ID.

Import first checks current authority and a durable existing import receipt; an authorized replay returns the committed skill even after candidate/check expiry. For a new import it rechecks candidate expiry, matching eligible scan, scope/profile/digest and acknowledgements on the server. Call existing Skills creation with a stable candidate-derived operation UUID so a response lost after commit cannot duplicate a skill. Extract/reuse existing creation internals so candidate import receipt and creation commit in one same-feature transaction, or recover by an explicit stable creation-operation lookup; do not duplicate CRUD. Use existing validation and authority again at the write boundary. No source refetch occurs during import. Editing the imported library content does not carry forward a safety badge.

Keep terminal execution/receipt evidence for 7 days; preserve referenced physical scans and import receipts for their retry horizon. Prune only expired terminal scan/candidate rows in small batches after retention and without breaking in-flight jobs or idempotent import receipts. Never clean global caches/worktrees as part of this feature.

## 7. Rate limits and execution admission

Extend the existing `packages/features/rate-limits` only for genuinely reused needs: typed retry timing and weighted fixed-window consumption if budget units require it. Default amount remains one, preserving all current callers. Do not replace its PostgreSQL atomic UPSERT with an in-memory map. Budget units are maximum upstream-call attempts reserved once per physical job (including failed/retried calls); daily user/workspace/global unit ceilings are separate from job counts. Byte caps and output-token requests bound each attempt but are not exact token accounting or a monetary ledger.

Keep separate policies for search, resolution, scan requests/status polling, new jobs and import. Server identity selects keys; user quota is independent of workspace, workspace aggregate prevents member fan-out, and a deployment-wide key bounds expensive work. Configuration lives in one policy/composition module, not copied into route handlers and UI.

Request quotas run after authentication and before expensive work. New-job/budget quotas are consumed only after authorization/cache/idempotency checks, in the same short PostgreSQL transaction as job/outbox creation. Acquire multiple scope locks in deterministic order and roll back all admission changes on rejection. Rate-limit failure returns a typed result with retry seconds; infrastructure failure is unavailable, not a fabricated 429 or unrestricted execution.

Initial conservative defaults are configurable and tested: catalog search 30/min/user, source resolve 6/min/user and 20/min/workspace, static new scans 10/hour/user and 30/hour/workspace, AI-assisted new scans 3/day/user and 10/day/workspace. Also enforce deployment ceilings, bounded queued jobs, one active scan per user/workspace and a small global active count. Status polling has its own ample quota and stops on terminal results. These are abuse-control starting values, not billing promises.

Rate limits, queue depth, running concurrency, CPU/RSS/disk/deadlines, model token/call budgets and financial reservations are distinct controls. Fixed windows permit boundary bursts; do not document them as rolling windows. Add a concurrent real-PostgreSQL test for multi-scope admission and duplicate requests. Avoid unrelated limiter cleanup/refactors unless a new test proves a required defect.

## 8. Worker and scanner runtime

Reuse the existing outbox with an explicit Skills scan event/version and handler. Job admission and event publication are atomic. Extract a narrow public transaction-compatible outbox writer using conflict-safe insertion and immutable-payload comparison; the existing repository delegates to it. Do not recover a PostgreSQL unique violation by querying inside the now-aborted transaction or cast a TransactionClient to PrismaClient. Keep this workload in a configured scan-only worker lane, claiming one event at a time initially; long scans never block the generic control-plane handler batch. Missing scanner/lane configuration makes admission unavailable rather than queueing unserviceable jobs. Database admission/claim rules bound deployment-wide concurrency; a one-event batch alone does not bound replicas.

Claims are fenced. Immediately before execution, recheck workspace activity and the requester's current membership/create authority before sending any text. Mark a job running once with a fixed execution deadline and attempt identity. Start only when remaining claim duration exceeds the scanner hard deadline plus termination margin (initial static 90 s, AI 180 s, termination 10 s, claim 240 s). Hold the active slot until confirmed process exit or deadline plus margin after worker loss; a stale attempt cannot release another attempt's slot. Commit a report only while the matching claim/lease remains valid. A crash, stale lease or unknown execution becomes an incomplete terminal result. Do not automatically repeat an uncertain paid/model execution or claim exactly-once external calls. User-requested retry is a new bounded attempt; previous reservation remains charged when usage is unknown.

Run SkillSpector in a dedicated execution container/service with no database, Git, SSH, Docker socket or host-directory credentials. Worker sends only bounded canonical text, server-owned job/profile identity and a capability-scoped service token. No user paths, URLs, arguments or environment enter the request. The service has one operation: scan this text under a configured profile; it has no durable queue or product database.

Runtime: pinned Python/SkillSpector dependencies and source revision; unprivileged user; read-only image; private size-bounded temporary filesystem; CPU/memory/PID limits; fixed local `SKILL.md`; process-group kill on timeout/cancellation; bounded request, stdout/report and logs; cleanup on every outcome. The normal app never runs the scanner in its credential-bearing process. Container/runtime isolation must be verified, not inferred from a sanitized environment.

Static uses `--no-llm`; this does not imply no network because OSV dependency checks can use `api.osv.dev`. Document/limit allowed OSV egress or truthfully report resulting incomplete coverage. Disable external reference traversal, tracing and ambient agent CLI providers. No scanned instructions are executed.

### Optional AI-assisted profile

Enabled only with complete explicit server configuration. The UI requires affirmative selection and content-sharing disclosure. Use a fixed allowlisted HTTPS OpenAI-compatible upstream and fixed model; never inherit ambient API keys/provider CLIs.

A narrow per-execution relay inside the scanner runtime enforces the limits missing from upstream SkillSpector: only the supported completion endpoint, no arbitrary paths or streaming, maximum request/input bytes, maximum output tokens, maximum total upstream calls including retries/failures, overall deadline and fixed model. Every attempted upstream call consumes its reservation before transmission. Exhaustion produces incomplete analysis, not a partial green result. The relay is not a new general model gateway.

The application reserves the configured maximum upstream-call-attempt units for the bounded profile with job creation. Initial AI profile: at most 4 attempted upstream calls, at most 128 KiB input JSON per call, at most 2,048 requested output tokens per call, all within 180 seconds; effective lower limits are part of the profile fingerprint. Retain the full reservation when usage is missing/uncertain; record reported usage separately. Call-count and request-byte ceilings are hard local controls; output-token ceilings are enforced request parameters, not a promise about provider billing or tokenizer behavior. Any currency estimate uses explicit configured price ceilings and must not be described as a guarantee about an external provider's billing. Never count missing usage as free. Tests use a loopback model provider and real relay; no paid model calls are required or authorized by this plan.

## 9. Report policy and error projection

Parse the bounded JSON report against the pinned supported contract. Require execution success, expected completeness fields and a complete analysis, expected scanner identity, exact input/profile binding and required model participation for an AI-assisted request. Missing/malformed/partial/degraded/wrong-identity output is incomplete. CLI exit zero and coverage percentage are insufficient evidence.

Own policy, versioned with the adapter:

- Any active HIGH/CRITICAL finding or `DO_NOT_INSTALL` blocks catalog import, even if aggregate score is low.
- A complete lower-risk/caution report requires explicit warning acknowledgement.
- A complete report without blocking/warning findings permits import; label **No issues found**, not **Safe**.
- Missing required analyzer coverage, execution failure, timeout, budget exhaustion and unsupported report versions cannot yield an eligible result. Expected profile exclusions (such as static mode without LLM), native documented exemptions and suppressed findings are not automatically incomplete; gate on active findings and strict native completeness for the selected profile.

Sanitize and bound findings, filenames and messages before returning them. Render as text, not trusted HTML; never show raw provider responses/secrets or arbitrary report URLs. Product errors are typed `forbidden`, `invalid_input`, `not_found`, `unsupported`, `conflict`, `rate_limited`, `unavailable`, `incomplete`, with retry timing where meaningful. Existing Server Action transports carry this envelope; HTTP routes use appropriate status/Retry-After. Fail closed for expensive execution if persistence/admission is unavailable.

## 10. Implementation sequence and ownership

1. Commit/push this plan; critic round 1 (architecture/admission, UAP/source integrity, UX/integration); correct it. Critic round 2 reviews the corrected document and resolves material findings before implementation.
2. UAP resolver slice: Go application/adapter/HTTP contract, bounded runtime recipe, real Git fixtures; separate draft PR. Avoid landing/parallel scanner files.
3. ReviewRouter domain/ports/store/migration/admission/worker contracts; portable parser reuse; focused concurrency and policy tests. Update release ACL projection for new tables: web may stage/read/request/record import; worker may read execution input and update only execution/result fields/perform bounded pruning. Immutable content, provenance and request/profile identity cannot be updated; existing Skills table grants stay unchanged. Qualify actual web/worker roles, not only schema-owner tests.
4. Dedicated scanner service and bounded relay, HTTP adapter, reproducible runtime packaging and real static/scanner-boundary tests.
5. Catalog actions/client/dialog wired to the actual application service; re-use existing library/assignment flow.
6. Integration and E2E: real database/session/outbox/scanner execution, loopback external boundaries, then desktop/mobile screenshot review and corrections.
7. Independent code/security/UX review, repair findings, qualify exact pushed heads, update PR evidence. Merge dependency order only after required/material checks. Verify resulting main CI and applicable standard sync, without new release/tag/deploy operations.

Target approximately 3,000–5,500 production lines across both repositories plus focused tests; treat this as a scope alarm, not a reason to omit required boundaries. If implementation grows, first remove unnecessary abstraction/UI surface. Do not silently cut scanner isolation, source identity, authority, atomic admission or meaningful tests to meet a line count.

## 11. Verification and definition of done

### Source and contract checks

- Existing portable parser suite stays green after reuse/move. Canonical serialization and digest match exact persisted import fields, including Unicode/line endings.
- UAP request auth/strict validation before Git; complete unique/ambiguous/incomplete discovery; explicit immutable selection; wrong-kind/symlink/oversize inputs; cancellation/busy/cleanup; original anonymous search/CORS unchanged.
- Table-driven scanner fixtures: clear, low score with high issue, caution, malformed report, missing completeness, partial/degraded, model requested-but-unavailable, wrong binding, timeout/output cap.
- Real static SkillSpector on benign and adversarial local fixtures. Real relay tests prove caps, failed-call charging, fixed destination/model, blocked streaming/paths and no call after exhausted budget.
- Existing architecture boundary/lint/typecheck checks include new code; no feature application imports infrastructure/frameworks.

### Real PostgreSQL integration

- Fresh migration and existing data compatibility; actual deployed web/worker role grants and closed-gate revocation; two simultaneous requests yield one physical job/event/charge plus bounded request receipts.
- Multi-scope quotas roll back together; fixed-window boundaries and weighted bounds; storage failure blocks work.
- Same operation/same payload replays; changed payload conflicts; cache is exact and workspace-scoped.
- Membership revoked before scan/import/read; cross-workspace candidate/job access denied.
- Claim race, global running cap, worker death while the scanner service continues, deadline/termination-slot retention, stale completion fencing; no automatic duplicate LLM execution; revoked queued requester causes no text transmission.
- Successful import plus lost response retries returns the same skill even after check expiry; scanned candidate text equals stored content. Expiry/warnings/blocking cannot be bypassed by request fields.

### Browser and visual acceptance

Extend the existing `scripts/accounts-reference-e2e` harness rather than create a second fake dashboard. Use real Next, authenticated sessions, fresh PostgreSQL, new migration and actual worker/scanner static execution; external UAP/model endpoints may be bounded loopback fixtures. Document that boundary, do not call it a live production provider test.

Cases cover search → exact preview → check → import → existing assignment; stale search/preview responses; ambiguity/unsupported/incomplete resolution; warning acknowledgement; blocked/incomplete/expired results; duplicate clicks/scan response lost after real admission and import response lost after real commit; exact replay after close/reopen; auth loss; quotas preserving selection; closing/reopening during scan; static/AI checkbox/result identity separation; short-query explanation; inert malicious preview text; exact imported bytes.

At 1280px desktop and 390px mobile, inspect original captures of list, preview, running, clear/warning/blocked/incomplete, and assignment continuation. Check no horizontal overflow, readable instructions, reachable close/actions, keyboard/focus behavior and no nested modal. Correct actual issues before acceptance. Keep screenshots, traces and receipts in ignored `tmp/` and CI artifacts.

Final evidence is bound to exact commit SHAs: commands/results, migration count, browser pass/fail/skip/retry counts, scanner build/profile, reviewed images and independent findings. No skipped required scenario is counted as a pass. Queued CI or absent runtime configuration is reported as pending/unavailable, never successful. Merge only after required and material lanes execute successfully; preserve #704's separate acceptance and dependency gate.

## 12. Critique record and implementation evidence

- Round 1 (v1, local c64c657 / published 9184b943 tree 7224a117): three independent critics reviewed the complete document. All requested changes; no redesign.
- Corrections after round 1: explicit client retry/reopen/profile state; inert preview and short-query copy; text-only eligibility, UTF-8 and hosted Git policy; numeric scratch/discovery bounds; transaction-safe outbox reuse; request receipts for deduplicated work; import replay after expiry; deployed-role ACLs; execution-time authority, lease/slot ordering and dedicated lane; precise upstream-call budget units; expected analyzer exemptions. All material findings incorporated in v2.
- Round 2 (corrected v2): all three critics reread the full plan and returned GO. No remaining material findings. Implementation notes retained: one-hop scan receipts; start UAP deadline before body read; leave process-termination margin; marshal/size-check responses before headers; preserve transport uncertainty separately from domain rejection.
- Final plan decision: GO. No source implementation occurred before the two completed critique rounds.
- Baseline update: a fresh GitHub read now confirms #704 merged as `818f8c83f69a8c5ec2fc0668b52607133210841a`; reconcile this main before implementation. Earlier queued CI statements above describe the initial inspection, not the current merge state. The new PR now targets main.
- Implementation is in [ReviewRouter #723](https://github.com/777genius/review-router-ai/pull/723) and [UAP #540](https://github.com/777genius/universal-agent-plugins/pull/540). The source slices retain two product tables, the existing portable parser, existing PostgreSQL limiter/outbox and one catalog dialog.
- Independent implementation criticism corrected: service process-group cleanup after an exited leader, in-flight model socket lifetime, poisoned admission after unconfirmed termination, absolute execution deadlines, hosted Git cleanup races, mixed-case repository identity and UTF-8 selector caps, unavailable/expired operation recovery, and rechecking after a scanner-profile change. Native-process, concurrency, contract and React regressions exercise the corrected behavior.
- Database review added initial-state guards: the web role cannot insert an already-completed scan or a prefilled import receipt. Only the worker can publish a result through its narrow update grants. Reported model counters are a bounded internal summary in the existing report JSON; unknown values remain unknown, reservations remain charged, and the user-facing DTO exposes neither usage nor budget internals.
- Two small prerequisite repairs were justified by reproduced failures: prepare every installed peer context of the existing exact-pinned subscription runtime, and align the canonical activation verifier with the already-approved six Skills table grants and repository-lock function. Neither repair broadens runtime authority or changes a dependency version. The existing worker sleep also now releases completed abort listeners so the dedicated polling process does not accumulate them.
- Verification remains split by evidence: actual-role PostgreSQL tests; the real Next/session/database/worker/static+AI browser harness with explicit loopback external dependencies; and a separate actual Docker runtime lane with native reports, process/socket termination, denied egress and real temporary-disk exhaustion. The PR evidence records exact pushed heads and final results. Earlier exploratory or previous-head passes never replace final acceptance.
