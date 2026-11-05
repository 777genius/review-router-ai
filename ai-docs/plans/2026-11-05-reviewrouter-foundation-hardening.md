# ReviewRouter foundation hardening — bounded architectural debt plan

Date: 2026-11-05  
Baseline: `main` at `f40a92f07fb06555c11e753348a12ec80118457a`  
State: **Draft plan; three source-based critical review passes recorded below; no implementation or successful-code-E2E claim**  
Target for the *eventual implementation in this same Draft PR*: **10,000–20,000 useful changed lines (additions + deletions, including honest moves and tests), not 10,000–20,000 net-new lines**. Do not add code solely to hit a number.

## Outcome and decision

Protect the foundation rather than introducing another foundation. Prior merged PRs [#747](https://github.com/777genius/review-router-ai/pull/747), [#798](https://github.com/777genius/review-router-ai/pull/798), [#810](https://github.com/777genius/review-router-ai/pull/810), and [#815](https://github.com/777genius/review-router-ai/pull/815) already addressed outbox and identity state, dashboard reads, workflow/setup/publication ownership, and Action transport/process boundaries. **Do not redo them.** Open memory PR [#806](https://github.com/777genius/review-router-ai/pull/806) stays untouched.

Select **three** remaining architectural risk factors, each with a concrete owner and falsifiable acceptance criteria:

| Priority | Critical factor | Observed signal | Architectural failure mode | Severity / confidence |
|---|---|---|---|---|
| P0 | Review v2 API authority/composition boundary | `apps/api/src/review-action-v2-production-composition.ts` has 3,218 LOC; transaction-bound review safety uses `new Proxy(prisma, …)` to masquerade as a narrowly selected client | A security-sensitive authorization check is coupled to a large composition function and a dynamic DB delegate shim. Changes can accidentally escape a transaction or change lock/read order | 9/10; high that the coupling exists, medium that it will cause an incident |
| P1 | Review investigation persistence has too many responsibilities | `PrismaInvestigationStore` has 3,438 LOC and implements **four** ports: aggregate, private material, pruning, lease | Cross-cutting edit radius for authorization, retention, leases and data access. The four ports may be a deliberate single transaction authority; splitting them is **not automatically an SRP win** | 8/10; high for coupling, no correctness bug demonstrated |
| P1 | Dashboard workflow mutation boundary and architectural drift | `apps/web/app/dashboard/actions.ts` is 4,007 LOC, with setup PR creation around lines 1,195–1,712 and merge confirmation around 1,713–2,702; existing architecture checker has bounded owner coverage | Server Action host mixes adapter authorization, workflow policy/verification, external GitHub effects, audit and navigation; source-text-bound tests impede safe extraction | 8/10; high for responsibility mixing |

The rule is **trace one authority / one owner / one observable contract**, not “make all files small.” Architectural checks are the common acceptance guard across these three slices.

## Evidence collected from the exact main tree

1. `scripts/check-architecture-boundaries.mjs` (897 LOC) prohibits framework imports from feature domain/application and performs a strict review-context ratchet; `scripts/lib/application-composition-boundaries.ts` explicitly limits composition checks to `workflow-provisioning`, `provider-setup`, `review-config` and `audit-log`. This is a **coverage gap**, not proof of existing violations elsewhere.
2. `apps/api/src/review-action-v2-production-composition.ts` lines ~1,250–1,375 performs guarded checkout and policy checks in one Prisma transaction; around ~1,295 it constructs a `Proxy` of root Prisma whose only permitted delegate names are the three safety tables. The outer repository constructor currently requires full `PrismaClient`, although the operation needs transaction-scoped read delegates. The source explicitly promises no HTTP in that lock scope.
3. The same API composer also binds gateway relay, model dispatch, hosted route, tools and memory; `review-action-v2-context-attestation-composition.ts` (~3,941 LOC) and `review-action-v2-execution-evidence-composition.ts` (~3,290 LOC) are separate large neighbours. Their size is a risk indicator, **not** a license to rewrite protocols.
4. `packages/features/review-investigations/src/infrastructure/prisma/prisma-investigation-store.ts` contains one class implementing `InvestigationStorePort`, `InvestigationPrivateMaterialStorePort`, `InvestigationPrunerPort` and `InvestigationLeaseStorePort`. The file contains command restoration, aggregate hydration, obligation/material persistence, certificate persistence, lease transitions and retention/pruning. Preserve shared identity/version/fencing conditions.
5. `packages/features/review-executions/src/infrastructure/prisma/prisma-review-execution-store.ts` (~2,803 LOC), `action-control-plane/src/infrastructure/prisma/prisma-codex-rotating-oauth-repository.ts` (~2,831 LOC) and `review-publishing/src/v2/infrastructure/prisma/prisma-review-publication-repository.ts` (~2,380 LOC) are similar concentration candidates. **Observe first**, do not split them automatically.
6. Dashboard `actions.ts` exposes many server actions but also has long private mutations. `createSetupPullRequestMutation` gets Prisma, validates repository and actor, checks entitlement and rate limit, selects managed/Gateway transport, invokes GitHub effects and writes audit. `confirmSetupPullRequestMergedMutation` re-reads persisted provisioning and live workflow identity before activation. These are real security-sensitive sequences.
7. `apps/web/app/dashboard/actions-codex-rotating-contract.test.ts` currently reads `actions.ts` and slices string ranges between named functions to assert security checks. If implementation is moved, change the relevant tests to assert **behavior and authority**, not just preserve source layout.
8. `packages/features/codex-oauth-rotating/src/action/github-action.ts` is still large (~3,860 LOC), but PR #815 has already extracted four major responsibilities. **Do not restart that refactor.**
9. `packages/features/workflow-provisioning/src/domain/workflow-template.ts` (~2,391 LOC) has several workflow schema renderers/readers. PR #810 already changed ownership. Defer workflow grammar consolidation unless a specific mismatch or duplicate invariant is proven.
10. `apps/web/app/dashboard/dashboard-workspace-page.tsx` (~3,399 LOC) combines page data/load/sections and UI. After #798's read-boundary work, a broad UI rewrite is lower priority than review authorization and persistence; defer.
11. `apps/api/src/review-run-gateway-relay.ts` (~2,500 LOC) mixes capacity/session/stream handling but has explicit boundedness and cancellation contracts. Do not expand the current scope into upstream relay semantics absent a red regression.
12. Current `AGENTS.md` forbids new feature flags by default, requires explicit rollout registry and keeping existing App-first/OIDC/workflow authority. No DB schema or deployment should be bundled with this structural PR.
13. API and worker each validate capability key-ring JSON, base64 secrets and expiration timestamps (API `readCapabilityKeyRingFromEnv` / `parseCapabilityKey`; worker `readCapabilityKeyRing` / `parseCapabilityKey`). This is concrete DRY drift potential, **but errors and env names differ**; do not extract a shared parser without behavioral parity tests, and leave it outside this three-slice PR.

All LOC figures refer to the current checked-in source line count; changed-line forecasts below are rough and exclude generated `action-dist`/lockfile churn. They will be recalculated from actual PR diff.

## Slice A — Review v2 authority reads and composition ownership (P0)

**Touched production entrypoint:** `apps/api/src/review-action-v2-production-composition.ts`.  
**Existing owner of safety decisions:** `packages/features/review-run-control`; do **not** move domain safety policy into the API.

1. Characterize the protected `confirmAccountGatewayAuthority` path (valid token; exact original runtime snapshot; selected identity/installation/repository; scope locks; row share; safety policy; producer release; live checkout; expired or superseded work). The observed lock order is: **repository scope guard → installation row → checkout repository row → provider connection/binding (when selected) → authorization row share → current safety/release reads**; preserve that relative ordering and `ReadCommitted` re-reads. Record this as a regression checklist; source comments are not sufficient evidence.
2. Replace the dynamic `new Proxy(prisma, …)` read shim **only after a red/green regression** with an explicit *transaction-bound, read-only* adapter owned by existing review-run-control infrastructure. `PrismaReviewSafetyControlRepository` currently implements **five read/write/inspection ports** and expects a full `PrismaClient`: **do not pass the transaction to that mutable class or cast it to a full client**. Instead provide the exact two policy/emergency *query* interfaces required by `ResolveReviewSafetyPolicy`; share the canonical persistence mappers/query builder with the existing class, preserve policy/selector ordering, and accept only the active `Prisma.TransactionClient`. No nested/root transaction, no command port, no extra policy implementation.
3. Extract **only** the local authority-confirmation composition and its immediate transaction-read prerequisites into one cohesive API-local module *if* this separates a real owner. Preserve `composeReviewActionV2ProductionRoutes` and the existing dependency graph/return type. Do not also recompose the gateway/model relay just to reduce LOC; that is a different behavior-sensitive task.
4. Ensure no network access while transaction locks are held; keep lock ordering, exact `ReadCommitted` freshness and fail-closed error results. Do not change business semantics, error/status strings, timeouts, quota or capability issuance.
5. Verify with existing API snapshot/publication and gateway-relay tests plus focused injected-transaction tests for stale identity, revoked authorization, emergency disable and target mismatch. Add a transaction-negative test that rejects root-client/nested-transaction access and a test that deliberately changes the current repository/authorization while waiting for the outer scope lock; the transaction must reread the fresh row. Preserve the existing resolver's `Promise.all`: both safety queries must use the **same active interactive-transaction client** (Prisma ORM 7 executes them sequentially on one transaction connection). Prohibit root-client reads, new/nested transactions and HTTP while locks are held; preserve `unreadable` fail-closed on either read failure. Test **both** reviewer tool and shared memory authorization callers of this guard, not only gateway checkout.

**Done means:** same public API and immutable protocol, no masked client, transaction-scoped query owner enforced, focused and integrated tests green, architecture gate accepts only the intended import graph.

**No-go:** new auth service, policy duplicate, reusable generic transaction framework, DB migration, unsafe casting of `Prisma.TransactionClient` to `PrismaClient`, or silently broadening live gateway access.

## Slice B — Review investigation persistence cohesion (P1)

**Touched owner:** `packages/features/review-investigations/src/infrastructure/prisma/prisma-investigation-store.ts`.

1. Record the existing four port contracts, all callers, shared `PrismaClient`/transaction use, command idempotency, lock acquisition order and certificate/private-material retention rules before moving lines.
2. Keep `PrismaInvestigationStore` as the **unchanged public constructor and transaction authority**. Extract one cohesive *private* responsibility at a time (first: private-material pruning; second only if useful: lease claim/renew/revoke/read). Keep aggregate hydration and commit persistence together unless an actual independent owner is proven. Prefer local functions / collaborators in the same package, not extra exported ports or a forwarding facade hierarchy. If movement only changes filenames, leave it in place.
3. Preserve the original transaction in each command. Do **not** dispatch a critical multi-write transition into separate transactions or change eligibility/retention, isolation, DB now, hashes, key custody or repository identity.
4. Convert directly affected tests to import stable port behavior rather than private implementation positions. Focus on lease racing, idempotent replay, batch prune partial failure, orphan detection, expiration, restoration and PostgreSQL-specific lock behavior.
5. Use `PrismaReviewExecutionStore` only as a **bounded follow-on** if the first extraction reveals an actual shared invariant/duplication that needs one owner and can be qualified in the planned budget. Otherwise leave that 2,803-LOC store for a separate task.

**Done means:** one persistence authority with narrower edit surfaces, unchanged public exports/transaction ownership/SQL behavior and focused tests under real PostgreSQL plus standard feature tests. File count by itself is not an acceptance metric.

**No-go:** repository pattern rewrite, introducing an ORM abstraction, new DB tables, moving data policy into API/worker or changing the investigation protocol.

## Slice C — Dashboard workflow write/admission boundary (P1)

**Touched host:** `apps/web/app/dashboard/actions.ts`.  
**Existing core owner:** `packages/features/workflow-provisioning` and existing web/server setup/activation modules.

1. Characterize `createSetupPullRequestMutation` and `confirmSetupPullRequestMergedMutation`, including actor/workspace/repository authorization **before** external GitHub effects, per-repo rate/entitlement guards, exact workflow SHA, installed namespace witness, audit result semantics and idempotent retry.
2. Keep Next.js `use server` actions, form parsing, redirects and navigational result mapping at the existing entrypoint. **Prefer the merge-confirmation/activation path** as the one owned operation; extract only decision/side-effect orchestration that `#810` did not already move. Creation path stays as-is unless a concrete duplicated rule is found. Use an existing server-side owner or one purpose-named web/server module, never a new general-purpose controller/service/DI framework.
3. Do not duplicate provisioning policy already moved by #810. Use existing feature use cases and adapters; move only orchestration that still lives at the wrong boundary. If no non-host logic remains after examining #810 changes, drop this extraction and strengthen behavior-based tests instead (do **not** manufacture a 10k-line refactor).
4. Replace only the source-slice tests impacted by the move with behavior-focused tests against fake GitHub/DB adapters and a real auth-scoping test. Verify no GitHub request before access rejection; stale head, mismatched namespace, **installation transfer/removal, archived or unselected repo, stale provisioning attempt, changed default branch and unknown remote read outcome** must not publish false readiness. On unknown effects, reconcile the existing attempt rather than blindly creating another setup PR. Keep GitHub writes and DB activation fenced to the current saved source.
5. Keep public server action exports, visible dashboard flow, error strings and provisioning records compatible.

**Done means:** no duplicated business rule, authorization still precedes side effects, setup status/audit/redirect unchanged and existing web/UI behavior still works.

**No-go:** routing rewrite, new UI kit/state manager, rewriting OAuth flows, refactoring #798 read path or touching unrelated provider account UI.

## Anti-regression architecture ratchet (part of each slice, not a fourth mega-project)

- Extend **existing** `scripts/check-architecture-boundaries.mjs` and its tests with *specific* rules for the new review safety transaction adapter, investigation infrastructure ownership and host/action imports. Prefer direct import-graph/typed contract assertions; avoid another sweeping regex that treats strings/comments as code.
- Keep the established strict contexts and bounded checks. Do not declare every feature “Clean Architecture certified” from this change.
- Add one negative fixture for each newly asserted rule (must fail on old-style reverse dependency) and one valid fixture. Run `pnpm architecture:check` through CI.
- Any new import boundary must be paired with a relevant test and explicit owner; merely moving a file without enforcement does not finish the work.

## Scope ledger and disposition of additional debt

| Candidate | Status in this PR | Why |
|---|---|---|
| API `confirmAccountGatewayAuthority` dynamic Prisma proxy | **IN A** | Concrete type/transaction authority seam |
| API review-v2 high-coupling production composer | **IN A (bounded extraction)** | High edit radius around authorization |
| Investigation four-port Prisma store | **IN B** | Proven SRP concentration |
| Investigation private-material pruning and lease state | **IN B** | Independent responsibilities inside same adapter |
| Dashboard setup PR create / merge confirmation | **IN C if owner separation is real** | Security-sensitive external effects and host policy |
| Guard/test coverage for newly created boundaries | **IN A/B/C** | Prevent debt re-growth |
| Review-executions Prisma store | **CONDITIONAL**, one small invariant only | Do not split on LOC alone |
| Review-publishing Prisma repository | OUT | Existing #810 and high-risk publication correctness |
| Codex rotating OAuth Prisma repository | OUT | Credential/migration sensitivity; avoid collision |
| Action transport/process runtime | OUT | Already delivered in #815 |
| Workflow provisioning grammar | OUT | Prior #810; no specific mismatch yet |
| Dashboard read composition | OUT | Already delivered in #798 |
| Dashboard React page decomposition | OUT | Lower production risk than authority writes |
| Context-attestation/execution-evidence handlers | OUT | Large but independently protected protocol boundaries; evidence not enough for blanket split |
| Gateway relay retries/capacity protocol | OUT | Behavior and policy change not proven necessary |
| API/worker capability-key parsing duplicate | OUT (candidate follow-up) | Error strings and producer/consumer security policy must be compared before DRY consolidation |
| Memory learning/evidence changes | OUT | Active #806 owns this |
| New flags, service framework, generic repositories, DB migrations | **PROHIBITED** | Complexity without proven value |

## Implementation checkpoints (push each coherent step, do not wait for a monolithic final commit)

1. **Plan / review gate (now):** publish this plan in Draft PR before code, run three adversarial passes for owner boundaries, transaction/concurrency safety, and test/evidence/size scope; commit revisions and record each critique in PR comments. Do not claim independent reviewers or green CI when none ran.
2. **A1 characterization:** add tests that expose current behavior, annotate safety-reader call chain and known invariants.
3. **A2 typed transaction seam:** implement the smallest explicit read adapter, remove the runtime proxy, keep same transaction and compatibility; push, test and review.
4. **A3 limited API wiring extraction:** reduce conflicting edit responsibility only where owner/callers are confirmed; push, test and review.
5. **B1 four-port characterization:** map callers/transactions before edits; add contention, replay, pruning regressions.
6. **B2 cohesive investigation adapter extraction:** retain public facade and one transaction; push and verify PostgreSQL behavior.
7. **C1 scoped workflow mutation extraction, only if justified after inspecting #810:** tests for admission and readiness, then move the remaining operation; push and verify.
8. **Guard + integrated:** add focused negative architecture fixtures; run the repository-pinned typecheck, lint, formatting, `pnpm architecture:check`, affected feature/API/web/worker tests, real PostgreSQL integration, and a disposable-repository E2E of the workflow and authorized review path where behavior has changed. Use exact PR HEAD and record URLs/results; explicitly identify any policy-skipped CI jobs (a skipped PostgreSQL release rehearsal is **not** a success). Fix findings in separate pushed commits.
9. **Go/no-go after each slice:** A cannot proceed to B before transaction tests are green; B cannot proceed to C before real-Postgres lease/prune/restore semantics are verified. C is optional and must be dropped if it duplicates #810 or expands beyond its owner. Keep PR Draft until implementation + complete gating. Do **not** merge/deploy automatically as part of writing this plan.

### Estimated changed lines, difficulty, reliability

These estimates are a **change budget**, not an instruction to split more code when a smaller correction suffices.

| Slice | Estimated additions + deletions | Complexity (10 = hardest) | Expected reliability after qualification (10 = strongest) | Planning confidence |
|---|---:|---:|---:|---:|
| A — typed safety read + limited API composer | 3,000–5,000 | 8/10 | 8/10 | 0.70 |
| B — investigation store private cohorts + tests | 4,500–7,000 | 8/10 | 8/10 | 0.70 |
| C — workflow write boundary + behavioral tests | 2,000–4,000 | 7/10 | 8/10 | 0.60 (conditional) |
| Targeted architecture fixtures + adjustments | 400–900 | 4/10 | 9/10 | 0.85 |
| **Potential total** | **9,900–16,900** | **8/10** | **8/10** | **0.65 overall** |

The lower bound can fall below 10k if correct minimal changes require less; **ship the smaller safer diff**. Lines moved in Git show as additions + deletions and are not new product functionality. The 10–20k request is a **soft range of meaningful total changed lines, not an acceptance test**; adding filler to meet 10k is forbidden. If the scope would exceed **20k** or needs a new fault domain, stop and split into a separate PR rather than reducing review quality. No generated bundle regeneration is counted unless a changed production Action contract actually requires it.

## Qualification / acceptance matrix

| Boundary | Negative / adversarial case | Success gate |
|---|---|---|
| API safety | Stale/revoked token, current scope reassignment **while lock is contended**, changed repository/installation, unsafe emergency policy, token/DB time divergence, reviewer vs shared-memory caller | Fail closed; ordered locks and `ReadCommitted` rereads preserved; no root/nested DB transaction or HTTP inside protected transaction; the resolver's same-client `Promise.all` is allowed |
| API compatibility | Same permitted authorization, model dispatch/relay/checkout, production route shape | Same result/type/schema/error contract and same externally observed effects |
| Investigation persistence | Two lease claimants, expired/material batch races, failed commit retry, mismatched command hash, missing certificate, archive/prune continuation | Atomicity and idempotency preserved on real PostgreSQL; retention remains the same |
| Dashboard setup | Unauthorized actor, provider mismatch, unselected repo, stale merge SHA, invalid namespace, partially failed GitHub call, repeated form submit | No unauthorized GitHub writes, no false completed readiness; audit and UI mapping unchanged |
| Architecture | One deliberately bad import/transaction shim fixture per selected owner | Checker fails with path and actionable reason; clean fixture passes |
| Regression | Source/type lint; focused suites; existing Action and workflow compatibility; real PostgreSQL; E2E in disposable repo where behavior changed | All applicable exact-head checks green, skipped jobs disclosed, and explicit reviewer findings resolved before considering Ready |

**Evidence policy:** No local E2E claim from the current GitHub-connector-only environment. Source audits are not test passes. Record exact workflow run, commit and eligible jobs when hosted CI becomes available. Maintain `AGENTS.md` deploy registry discipline; merger ≠ deployment.

## Critics' review checklist (recorded in the revisions below)

- **Round 1 — architecture/SOLID/DRY:** Challenge whether each proposed extraction has one owner, whether it introduces new abstractions or duplicates #810/#815, and whether `PrismaInvestigationStore` should stay a facade.
- **Round 2 — security/concurrency:** Challenge lock order, transaction-scoped safety data, GitHub side effects, idempotency, lease fencing and source witness after moved code.
- **Round 3 — E2E/scope/cost:** Challenge coverage of realistic failures, generated artifacts, total churn, overlap with open work and any code written just to hit 10k.
- Mark every unresolved risk with an owner and verification gate. A reviewer objection must result in a changed plan or an explicit reason to reject it.

## Adversarial review round 1 — architecture and DRY (2026-11-05)

**Method:** source-based critique against `main` `f40a92f` and historical merged diffs, not a claim of separate autonomous critic agents.

1. **Challenge: “four ports” does not automatically mean four repositories.** The investigation store is also the transaction/idempotency authority. **Accepted.** Reduce severity from 9 to 8 for an architectural edit-radius risk, keep one transaction owner, and limit extraction to private pruning/lease code when behavior-based tests justify it. No extra public façade/DI graph.
2. **Challenge: PR #810 already changed `apps/web/app/dashboard/actions.ts` and moved provisioning policy into feature use cases.** **Accepted.** Narrow C to remaining merge-confirmation/activation orchestration; do not move previously extracted rules back or change both creation and confirmation by default.
3. **Challenge: giant API file may be an intentional composition root.** **Accepted.** Only the concrete transaction-read `Proxy` seam is mandatory to characterize. Extraction of unrelated gateway/model wiring based on line count is rejected.
4. **Challenge: repeated capability-key parsing looks DRY-worthy but may have different compatibility error semantics.** **Deferred.** Logged as a candidate but not part of this PR without direct fault demonstration and exact behavior tests.
5. **Challenge: architecture checks are not absent globally.** **Accepted.** Existing strict review-context checks are substantial; the gap is *selective adoption* in composition ownership. Only add specific negative fixtures for the changed edges.

**Result:** Three factors retained, scope narrowed. Round 2 must prove the new safety reader cannot accidentally widen authority or leave the existing transaction.

## Adversarial review round 2 — authority, security and concurrency (2026-11-05)

**Source recheck:** `PrismaReviewSafetyControlRepository` currently implements five read/write/inspection ports and its constructor takes `PrismaClient`; the API wraps a root Prisma client in a runtime `Proxy` exposing only three table delegates under the protected `ReadCommitted` checkout. The proxy is a **runtime guard**, not only a typing hack. Removing it naively could reduce security.

1. **Critical finding: the first plan could imply passing `Prisma.TransactionClient` into an existing mutable repository.** **Accepted and corrected.** Require a query-only type and *runtime* capability surface; preserve the existing 3-delegate restriction, reuse selectors/mappers, prohibit writer methods, and explicitly test that root/nested transaction access fails.
2. **Critical finding: transaction lock order is behavior, not an implementation detail.** **Accepted.** Pin the observed scope → installation → checkout repository → optional binding → authorization row → safety/release reads order. Preserve `ReadCommitted` and fresh post-lock reads. Never execute HTTP or parallel Prisma operations while holding these locks.
3. **Critical finding: the protected helper also gates context tools and shared run memory.** **Accepted.** Both authorization routes need tests; gateway-only coverage is insufficient. Audit the snapshot-v4 reviewer/allocation selection in those paths.
4. **Critical finding: workflow activation depends on a live installation and an exact saved provisioning attempt.** **Accepted.** Add negative cases for transferred/archived repository, changed default branch, stale expected attempt, unknown probe outcome, and duplicate remote effect prevention. Red/green behavior tests precede moves.
5. **Rejected extra scope:** no attempt to change relay timeout/quota behavior, Action OIDC/publication protocol or worker execution lifecycle during this refactor. Those are distinct fault domains.

**Result:** The safety adapter is *strictly narrower than* the current mutable repository, not just a different place for the same client. Security/concurrency acceptance is now explicit. Round 3 challenges the realism of the size forecast and CI/E2E proof.

## Adversarial review round 3 — acceptance evidence, cost and scope (2026-11-05)

**Independent external review status (updated):** An explicit manual CodeRabbit review **completed** on `c9894c1b` with one actionable wording correction about `Promise.all` inside the current Prisma transaction. That correction is accepted below. The documentation-only CI success cannot certify proposed production changes.

1. **Challenge: the requested 10–20k diff is not itself quality evidence.** **Accepted.** Marked the range soft; moving a file counts in both additions and deletions. Prefer a smaller patch when behavior is safe and measurable. Above 20k, split another fault domain into a future PR; no churn, generated files, or cosmetic splits to hit a number.
2. **Challenge: a three-slice single PR could create too large a review surface and mix unrelated operational risks.** **Accepted with gates.** Implement A then establish green transaction/fail-closed regressions, implement B then qualify with real PostgreSQL, and only then consider C. C can be deferred entirely if the post-#810 code does not justify moving. Never force a third extraction to reach a line target.
3. **Challenge: passing unit/source-text tests could still miss the live infrastructure contract.** **Accepted.** Required applicable exact-HEAD CI plus PostgreSQL concurrency/idempotency and a disposable-repository E2E for changed workflow/GitHub effects. Existing tests that slice source text must not be blindly updated merely to keep them passing; replace affected ones with observable behavior and equivalent negative cases.
4. **Challenge: “CI green” can mask an inapplicable or policy-skipped live migration/rehearsal.** **Accepted.** Record actual job names/conclusions and state skipped gates openly. The `Dedicated Release Authority PG17 contract` and general quality gates cannot substitute for targeted Postgres and external-effect evidence where required. No deployment or release.
5. **Challenge: base main can move during work, and another PR can land on the same ownership surface.** **Accepted.** Recheck `main`, PR #806 and relevant commits before every implementation slice; record exact HEAD for each test. No blanket rebases or overwriting concurrent changes.
6. **Challenge: reliability and LOC values look deceptively precise.** **Accepted.** They are comparative planning forecasts only, not measured defect probabilities or proven post-refactor reliability. Update estimates after each actual diff and retain test evidence instead of claiming a score proves success.

**Round 3 disposition:** Plan accepted for a *staged implementation attempt*, not accepted as verified production code. Three review rounds are documented in commits and PR conversation. Required implementation, full reviews of its code, E2E and merge remain **not done**.

### Handoff contract for implementers

- Work only in this Draft PR branch, inspect the latest `main` and open PRs, and preserve all existing Action, OIDC, workflow and persistence contracts.
- Commit and push meaningful checkpoints immediately with clear evidence (tests run, pass/fail/skipped, exact SHA). Add concise PR comments with the reviewed invariant and decision; never manufacture independent review claims.
- At every code checkpoint ask: **Does this actually reduce the authority/change radius? Does a negative regression prove it? Does it retain the existing single owner?** If not, revert the extraction instead of introducing a new abstraction.
- Gate Ready on integrated qualification and code review; a green docs-only check proves only that the plan file is syntactically acceptable.


## Detailed implementation blueprint — A: current-transaction review authority

### Exact call path and separation rule

The current implementation lives in `apps/api/src/review-action-v2-production-composition.ts`, within `composeReviewActionV2ProductionRoutes`. It creates `confirmAccountGatewayAuthority` and wires the same confirmation into gateway checkout, context tools and shared run memory; reviewer allocations have additional snapshot-v4 constraints. This code is **application composition** and is allowed to depend on adapters. Its *business decision* remains owned by `ResolveReviewSafetyPolicy`, not a new API policy service.

The current check runs inside `prisma.$transaction(..., { isolationLevel: "ReadCommitted" })` after verifying the signed token. It locks current scope, repository/installation and authorization rows, uses only the three safety delegates through a temporary `Proxy`, then reads authorization, mutation authority and producer release. The resolver calls `Promise.all` on safety policy and emergency-control query ports. Official Prisma 7 documentation confirms queries on the same interactive-transaction connection run serially: https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#using-transaction-within-promiseall .

**Required invariant:** all affected reads must remain on the *same transaction object*, with no Prisma root-client escape, new transaction, HTTP call, or deferred async use after the transaction closes. Avoid changing the resolver's `Promise.all`: rejecting it would require unnecessary business-logic churn. Preserve its current fail-closed `controlReadState = "unreadable"` when either query throws.

### Chosen design and rejected alternatives

| Candidate | Correctness (10) | Complexity (10 = low effort) | Architecture (10) | Decision |
|---|---:|---:|---:|---|
| A0. Retain dynamic `Proxy` and add tests only | 7 | 9 | 5 | Baseline/fallback if a replacement cannot preserve runtime confinement |
| **A1. Existing feature owns a narrow safety-read adapter; API composes active `tx`** | **9** | **7** | **9** | **Chosen**, subject to equivalence proofs |
| A2. Cast `Prisma.TransactionClient` to `PrismaClient` for the existing mutable repository | 3 | 9 | 2 | Rejected: hides write methods and transaction/root ownership |
| A3. New shared transaction framework, context-wide policy abstraction or RPC service | 6 | 2 | 4 | Rejected: larger fault domain, no proven new capability |

The feature's current `PrismaReviewSafetyControlRepository` is a multiport adapter implementing policy query, policy command, emergency query, emergency command and inspection. Its constructor takes full `PrismaClient`; do not retrofit write operations into the new path. **Preferred minimum:** one small transaction-only query factory in the existing `review-run-control` infrastructure, returning just the two existing read-port shapes and consuming a compile-time narrowed `Pick` of `Prisma.TransactionClient`'s three safety delegates. Reuse existing `applicableScopePredicates`, `safetyCapabilityToPersistence` and Prisma-domain mappers by moving or reusing small pure helpers inside the same folder. Do not fork the SQL/policy algorithm or issue extra queries.

**Runtime confinement nuance:** a TypeScript `Pick` alone is not a security sandbox. Pass an object literal holding only the actual `tx` delegates to the factory, not the full Prisma root; make sure the factory exposes no `$transaction`/`$queryRaw`/mutation command. Preserve/strengthen the existing negative test against additional delegate names. Do not make promises about compile-time types enforcing authorization at runtime.

### A — bounded work packets (complete only in order)

| ID | Exact required change | Guard/owner | Planned changed lines |
|---|---|---|---:|
| A0 | Characterize authorization route with current fixtures; enumerate all production callsites and map exact lock/read order | API test + existing run-control use case | 450–750 |
| A1 | Factor *shared existing* safety read mappings; add active-tx narrow policy+emergency reader; remove `Proxy` only after equivalent behavior | `review-run-control` infrastructure; API retains composition | 900–1,400 |
| A2 | If actual edit radius drops, move protected confirmation closure and its directly bound source readers to **one** API-local module; keep public export and existing exact result | `apps/api/src`; no new feature package | 1,000–1,500 |
| A3 | Exact authority, race, memory/tools and regression tests; prohibit root-client escapes and unexpected write methods | Existing API + feature test directories | 850–1,250 |
| **A subtotal** | **All useful additions + deletions** | | **3,200–4,900** |

**Stop/extract gate:** if A2 requires passing more than the existing local context, creates circular imports or changes relay/model lifecycle, leave the composition in place and stop at A1 + test improvements. The target line budget then becomes a forecast, not a mandate to invent another A2.

### A — distinct negative cases and expected outcome

| Case | Injection/fixture | What must not occur |
|---|---|---|
| A-N1 revoked/superseded token | Token refers to revoked/expired authorization or changed version; exercise `ReadCommitted` after a lock wait | No run/tool/memory authorization and no stale allow |
| A-N2 scope moved | Change repository's workspace/installation/selected/archived identity while checkout waits | No access on formerly authorized repository |
| A-N3 producer retired | Release transitions away from `Registered` or authority epoch differs | No execution or publication authority |
| A-N4 emergency stopped/DB read fails | Switch emergency control to stopped; make policy/selector reader fail | `effectAllowed` false; no permissive default |
| A-N5 broken projection | Run snapshot does not match authorization; v4 reviewer/allocation not live | No reviewer tool or shared-memory grant |
| A-N6 transaction escape | Fake root client's safety delegate / `$transaction` throws; query adapter given only `tx` delegates | No root query, nested transaction or after-commit use |
| A-N7 ordering drift | Instrument lock acquisition + row-share/safety reads; block concurrent writers | Same order, post-lock freshness; no hang from inverted order |
| A-P1 valid path | Same token, policy, release, scope and snapshot as existing baseline | Same safety-decision hash, allowed decision and checkout behavior |

For A-N6, do not require modifications to `ResolveReviewSafetyPolicy` just to make a fake test work. Its two Promise-returning queries are permitted in `Promise.all` because both delegate calls bind to `tx`. Explicitly test the **failure of one of the two** so the resolver stays fail-closed.

### A — objective implementation acceptance

- Same route registration, accepted protocol version, response mapping and exact public errors; no changed capabilities or new environment keys.
- No extra DB connection inside protected policy resolution. Keep current `ReadCommitted`; don't secretly promote to `Serializable` or add a retry loop.
- No broad import of feature's Prisma write adapter into the narrow reader; exported types are the already existing two query ports.
- Evidence: focused red-before/green-after test, targeted GitHub checkout + reviewer tool + memory tests, architecture check, full affected API test groups, exact-head CI link.
- Rollback: revert only new adapter/extraction commit(s), never disable safety gates or keep a partial migration. No schema change means rollback is a source revert.
 
## Detailed critic pass 4 — external review correction and strict authority (2026-11-05)

**External CodeRabbit finding:** the old plan said “Do not parallelize Prisma queries within the transaction,” but the existing `ResolveReviewSafetyPolicy` explicitly performs `Promise.all` for two queries. Prisma 7 documents sequential execution through the same connection, so the old instruction would force unnecessary refactoring, potentially changing failure behavior.

**Decision — ACCEPT.** The restriction now targets the actual risk (queries on root/outside `tx`, nested transactions, HTTP and non-fail-closed handling), not the harmless syntax of `Promise.all`. This simultaneously respects DRY, avoids scope creep and prevents a false regression in the resolver. Source verified in `resolve-review-safety-policy.ts` and `prisma-review-safety-control-repository.ts`. No implemented code is claimed.

**Further adversarial question:** Is a compile-time narrow type *really* safer than the current runtime `Proxy`? Not by itself. The plan now requires an explicit three-delegate object from `tx` and negative tests for runtime confinement. If this cannot be demonstrated, preserve the current proxy as the safer baseline instead of doing a cosmetic replacement.


## Detailed implementation blueprint — B: investigation persistence without transaction drift

### Current ownership map (rechecked at original `main`)

`PrismaInvestigationStore` (3,438 lines) is both a compatibility entrypoint and a single source of database consistency. Its methods do **not** all share one transaction; each command owns its explicit boundary. Never replace this with “one giant transaction” or a networked service. Current code units:

| Region | Observed responsibility | Contract to preserve |
|---|---|---|
| ~216–318 | Command receipts, aggregate loading/replay search, expired-turn candidates | Command hash/version, repository/revision identity, expiry/read isolation |
| ~319–550 | `findLease`, `acquireLease`, `renewLease`, `releaseLease`; renew/release delegate to `transitionLease` | Optional `inputAdmission.lock` before investigation row; idempotent `Restored/Conflict`; `Busy`; fencing token; row-lock order |
| ~550–768 | `adopt` and aggregate `commit` | Execution authority verdict inside existing lock, optimistic version/CAS and command receipt identity |
| ~769–819 | Private material save/read | Ciphertext only, exact active/expiry identity, duplicate and conflict outcomes |
| ~820–1027 | `reconcileExpiredPrivateMaterial` | **Two-level transaction**: checkpoint/page selection followed by a separate transaction per investigation group; aggregate is reconciled before material delete; partial batch failure is observable |
| ~1028–1179 | `pruneRetainedInvestigations` | Terminal states only; SQL `NOT EXISTS` prevents deleting live receipt, certificate, checkpoint, private material, turn or lease references |
| ~1180–1974 | Aggregate create/update, loads, transitions, obligations/certificate/checkpoint writes | Shared optimistic version, canonical policy, custody, material retention, persist ordering |
| ~1975–3438 | Domain ↔ Prisma mapping, normalization, group/cursor, lock and lease helpers | Canonical hashes, enums, error mappings, DB clock and stable saved representation |

**Risk correction:** the 820–1027 expiry path deliberately persists an `Inconclusive` domain transition, revokes stale leases and writes a command receipt **inside the same per-group transaction** as the removal. Calling a helper after that transaction commits would be wrong. Partial failure for one investigation must not erase successful groups nor lose the known removed count.

### Chosen design and rejected alternatives

| Candidate | Atomicity (10) | Complexity (10 = low effort) | Separation (10) | Decision |
|---|---:|---:|---:|---|
| B0. Leave entire file and add tests | 9 | 10 | 4 | Acceptable fallback if extraction has high coupling |
| **B1. Keep the existing class as sole transaction owner; extract pure mappings + private cohesive operations** | **9** | **7** | **9** | **Chosen**, gated on acyclic dependencies |
| B2. Split into four public repositories / new service packages, each starting transactions | 3 | 2 | 6 | Reject: breaks shared locks, no added value |
| B3. Generic repository/transaction-unit-of-work framework | 5 | 2 | 4 | Reject: introduces abstractions and production behavior risk |

**Implementation preference:** first move *pure* Prisma-domain mapping and cursor normalization functions into narrow `infrastructure/prisma` files with no new exports at package root; their direction is infrastructure → domain. Only then isolate expiry or lease operation behind **one internal function** with a small bounded input (current Prisma + existing options/collaborator), while leaving the original public method call and transaction control in the class **or** moving the complete intact transaction callback. Never split a transaction *across* module ownership, never invoke a callback after a connection has been released.

If the extraction requires a “bag of 20 dependencies”, barrel indirection or a circular import back into `prisma-investigation-store.ts`, **reject the extraction**. Improving SRP means reducing which invariants must be edited together, not hiding the same monolith behind forwarding files.

### B — concrete work packets

| ID | Exact useful work | Gate | Expected changed lines |
|---|---|---|---:|
| B0 | Write a one-page mapping of four ports and active callsites; capture lease/prune/restore fault behavior on baseline | Real-PG existing tests green | 700–1,100 |
| B1 | Move coherent pure Prisma mappers, timestamps and canonical enum converters to internal infra files; keep import direction, return representations and hashes | No behavior change; real-PG regression unchanged | 1,300–1,700 |
| B2 | Isolate expired-private-material group/prune logic as one internal owner **only if** checkpoint + per-group transaction structure remains identical | Checkpoint resume, SKIP LOCKED, partial success/error tests | 1,300–1,700 |
| B3 | Isolate lease claim/transition mapping with no new port/transaction and no extra state; retain order and existing admission hooks | 2 concurrent claimants, stale fence, renewal/release replay | 800–1,100 |
| B4 | Add direct regression evidence, architecture negative fixtures and targeted existing-test adjustments from moved private functions | Changed source contract tests replaced, SQL proof on actual PG | 700–1,000 |
| **B subtotal** | **Additions + deletions, mostly meaningful movement and tests** | | **4,800–6,600** |

B2/B3 can be omitted if profiling import graph reveals excessive callbacks. The previous code's behavior tests are more important than a file-size target. Never turn a previously successful private-material expiry into a single all-or-nothing batch.

### B — adversarial test matrix and rollback

| Case | Setup | Must be true after change |
|---|---|---|
| B-N1 simultaneous lease claim | Two workers choose same investigation + turn, different request identities | At most one active unexpired lease; loser gets `Busy`; no duplicate fence |
| B-N2 idempotent replay | Same `acquireRequestIdHash` and identical candidate vs same ID with changed candidate | Exact `Restored` / `IdempotencyConflict`; no accidental new lease |
| B-N3 stale aggregate during renewal | Change scope/revision or aggregate after initial lease lookup, before locks | Binding-stale revocation; cannot renew outdated lease |
| B-N4 active memory admission | Candidate contains memory bundle; reject `inputAdmission` after row lock | Fail-closed `BindingStale` without creating a lease |
| B-N5 cursor wraps | Expire more material than batch limit, resume after checkpoint and wrap around | Fair progression without duplicate/lost processed groups; monotonic known result |
| B-N6 partial group failure | One parent missing/incompatible/raced, another valid | Other group remains successful; exact `removedCount` and first error cause survive |
| B-N7 active turn and certificate | Same investigation has active turn or unexpired certificate/receipt/checkpoint | No unsafe prune; retained evidence remains intact |
| B-N8 command crash/retry | Simulate failure just before/after command receipt, rerun same command | Atomic rollback or exact restored result, no half-persisted state |
| B-N9 mixed expiry/renewal | Competing expiry prune and lease renew in separate connections | Existing lock order, no deadlock or deleted active evidence |
| B-P1 representative roundtrip | Previously persisted aggregate/lease/certificate + rehydrate | Identical canonical domain and storage shape, status and version |

**Verification files known to exist:** `packages/features/review-investigations/src/tests/prisma-investigation-store-real.test.ts`, `prisma-investigation-retention.test.ts`, `investigation-lease.test.ts`, `investigation-private-material-lifecycle.test.ts` and `in-memory-investigation-store-contract.test.ts`. Add cases to these rather than making a second overlapping harness. SQL-containing regressions require a real PostgreSQL runtime; unit fakes alone are not acceptance.

**Rollback:** a structural revert must not delete audit/command receipts or try to reverse a migration (none is permitted). If a new helper changes ordering/hash/retention, revert the helper extraction and retain the new discriminating regression test.

## Detailed implementation blueprint — C: dashboard setup confirmation (conditional final slice)

### Proven boundaries in the web host

`apps/web/app/dashboard/actions.ts` is a `"use server"` module. The public actions parse form input, call mutations, revalidate/redirect or return client params. The private `confirmSetupPullRequestMergedMutation` (roughly lines 1,713–2,702) is the actual candidate: it reads a saved attempt and live GitHub workflow evidence, validates active repository/installation, resolves managed Gateway/provider API/rotating/Claude/hosted paths, invokes existing provisioning/activation use cases, checks the current source again and only then records success.

There are multiple *intentionally repeated* calls to `assertCurrentSetup`, `assertCurrentBinding` and `assertCurrentGatewaySource` before distinct write paths. **Do not DRY them into one early check**: the rereads prevent a stale source/writer race. The existing `provisionGatewayReviewV2Repository`, `PrismaWorkflowProvisioningStatusAuthority` and `createInstalledGatewayReviewConfirmation` already own substantive writes. PRs #787 and #810 touched this path; their implementation must not be recreated.

### Options and decision

| Candidate | Safety (10) | Simplicity (10) | Ownership (10) | Decision |
|---|---:|---:|---:|---|
| C0. Keep host mutations and only strengthen tests | 9 | 9 | 5 | Accept if post-#810 orchestration is already minimal |
| **C1. Extract one bounded confirmation coordinator using existing feature adapters** | **9** | **7** | **9** | **Preferred**, conditional on proven non-host responsibility |
| C2. Split all web actions and all transport modes into new services/strategies | 6 | 2 | 5 | Reject; unrelated surface and extra indirection |
| C3. Collapse repeated readiness/current-source checks into cached result | 2 | 8 | 4 | Reject; TOCTOU and false success risk |

The permitted output is **one purpose-named internal web/server function/module** coordinating existing reads/writes, plus unchanged server-action façades. It can accept the existing repository/actor facts and concrete factories; do not introduce a new generic dependency injection layer, a routing rewrite or a second provisioning authority. Keep `createSetupPullRequestMutation` untouched unless review discovers one actually duplicated ownership check that existing #810 logic does not cover.

### C — work packets

| ID | Delivery | Guard | Expected changed lines |
|---|---|---|---:|
| C0 | Record the original action's authorization, transport modes, exact GitHub source evidence, audit/redirect/error variants; pin #787/#810 overlap | Plan/test baseline | 500–800 |
| C1 | Move only remaining confirmation side-effect orchestration to one owned server helper; keep every mutation's current freshness rereads and existing feature writers | No duplicate policy, no extra API/feature module | 1,100–1,600 |
| C2 | Replace impacted `actions-codex-rotating-contract.test.ts` source-location checks with behavior tests **before** removing them; retain other static contract coverage | Idempotency + access + source identity tested | 700–1,100 |
| C3 | Add one real DB/scoped-GitHub E2E + targeted rendering/status smoke without changing visible UI | Discriminating before/after outcome; inspect screenshots only if UI changed | 700–900 |
| **C subtotal** | **Additions + deletions** | | **3,000–4,400** |

**Go/no-go for C1:** if the existing feature use cases already completely own the write and the host only maps form/auth/navigation, do **C0 + C2 only if tests are independently valuable**, and mark C extraction not needed. This may reduce the PR below 10k. Do not reverse the decision just to satisfy LOC.

### C — exact failure modes

| Case | Evidence to perturb | Must not happen |
|---|---|---|
| C-N1 no access | Wrong actor, repository/workspace mismatch, repo-manager scope or entitlement failure | No GitHub read/write with privileged installation token and no state advance |
| C-N2 stale setup | Change `attemptId/revision` or stored head after initial read | No activation of replaced request |
| C-N3 changed installation | Transfer/remove installation, unselect/archive repo, change default branch | No readiness using old authorization |
| C-N4 mismatched workflow | Wrong caller path, SHA/action ref, namespace witness, runtime schema or old workflow still installed | No false configured status or secret activation |
| C-N5 provisional/unknown response | Rate limit, network error, GitHub 404/5xx, not-yet-merged PR | Preserve known state; no speculative success; unknown create outcome reconciled by existing attempt |
| C-N6 redundant submit | Same form submitted twice or writer restarts | Idempotent result or explicit conflict; no second setup PR or duplicate activation |
| C-N7 switching transports | Gateway, direct provider API, rotating Codex, Claude subscription, hosted fallback | Same exact route-specific checks, errors and audit semantics |
| C-P1 valid merged PR | Verified installed source matches persisted attempt and active identity | Configured status, correct audit `workflow.setup_pr_merged_confirmed` and existing dashboard notice |

**Verification files known to exist:** `apps/web/app/dashboard/actions-workflow-provisioning-recovery.test.ts`, `actions-hosted-workflow-recovery.test.ts`, `actions-codex-rotating-contract.test.ts`, and `packages/features/workflow-provisioning/src/tests/*`. Preserve meaningful static checks that capture writer callsites not touched; move only a check whose original anchored function legitimately moved. Gate a real-GitHub disposable-repository path if C changes external effects.

**Rollback:** revert the moved coordinator, preserving existing persisted attempt records. Do not install, uninstall or replace workflow files automatically as a “rollback” of the source refactor.

## Detailed critic pass 5 — transactional ownership vs DRY and TOCTOU (2026-11-05)

1. **Prune split as ordinary file move?** Rejected. `reconcileExpiredPrivateMaterial` has checkpoint selection and per-group transactions, partial success and a domain transition; splitting the callback would change consistency. The plan now requires preserving both tiers and testing its observable failure result.
2. **Four ports imply four repos?** Rejected. The original class coordinates one persistence authority; use private functions only after a real boundary can be traced.
3. **Lease extraction risks weaker input admission and fencing.** Accepted. Pin `inputAdmission.lock`, investigation-then-lease locking, `Restored/Busy/BindingStale` outcomes and concurrent-writer real-PG tests before any move.
4. **Dashboard repeated current-source checks are duplicated code.** Rejected as a DRY refactor target: they prevent stale-write races after async GitHub reads. Keep every recheck at the same side-effect boundary.
5. **Source-slice tests can be brittle, but replacing them blindly loses protocol coverage.** Accepted. Record what each source marker protects; replace only moved callsites with observable behavior tests while retaining untouched writer-location coverage.
6. **Potential scope collision with #787/#810 and open #806.** Accepted. Confirmation may be conditional or dropped. No Memory path, provider UI or Action runtime changes.

**Result:** B and C now have explicit transaction/side-effect boundaries, narrow implementation options, failure tests and stop conditions. No prod code changed.
