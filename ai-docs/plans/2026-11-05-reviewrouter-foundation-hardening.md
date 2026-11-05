# ReviewRouter foundation hardening — bounded architectural debt plan

Date: 2026-11-05  
Baseline: `main` at `f40a92f07fb06555c11e753348a12ec80118457a`  
State: **Draft; audit and review plan only, not an implementation or test-success claim**  
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
5. Verify with existing API snapshot/publication and gateway-relay tests plus focused injected-transaction tests for stale identity, revoked authorization, emergency disable and target mismatch. Add a transaction-negative test that rejects root-client/nested-transaction access and a test that deliberately changes the current repository/authorization while waiting for the outer scope lock; the transaction must reread the fresh row. Do not parallelize Prisma queries within the transaction. Test **both** reviewer tool and shared memory authorization callers of this guard, not only gateway checkout.

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
8. **Guard + integrated:** add focused negative architecture fixtures; run typecheck, lint, formatting, architecture, feature/API/web/worker tests, SQL integration and appropriate real E2E. Use exact PR HEAD and record URLs/results. Fix review findings in separate pushed commits.
9. Keep PR Draft until implementation + complete gating. Do **not** merge/deploy automatically as part of writing this plan.

### Estimated changed lines, difficulty, reliability

These estimates are a **change budget**, not an instruction to split more code when a smaller correction suffices.

| Slice | Estimated additions + deletions | Complexity (10 = hardest) | Expected reliability after qualification (10 = strongest) | Planning confidence |
|---|---:|---:|---:|---:|
| A — typed safety read + limited API composer | 3,000–5,000 | 8/10 | 8/10 | 0.70 |
| B — investigation store private cohorts + tests | 4,500–7,000 | 8/10 | 8/10 | 0.70 |
| C — workflow write boundary + behavioral tests | 2,000–4,000 | 7/10 | 8/10 | 0.60 (conditional) |
| Targeted architecture fixtures + adjustments | 400–900 | 4/10 | 9/10 | 0.85 |
| **Potential total** | **9,900–16,900** | **8/10** | **8/10** | **0.65 overall** |

The lower bound can fall below 10k if correct minimal changes require less; **ship the smaller safer diff**. Lines moved in Git show as additions + deletions and are not new product functionality. No generated bundle regeneration is counted unless a changed production Action contract actually requires it.

## Qualification / acceptance matrix

| Boundary | Negative / adversarial case | Success gate |
|---|---|---|
| API safety | Stale/revoked token, current scope reassignment **while lock is contended**, changed repository/installation, unsafe emergency policy, token/DB time divergence, reviewer vs shared-memory caller | Fail closed; ordered locks and `ReadCommitted` rereads preserved; no root/nested DB transaction, parallel query or HTTP inside protected transaction |
| API compatibility | Same permitted authorization, model dispatch/relay/checkout, production route shape | Same result/type/schema/error contract and same externally observed effects |
| Investigation persistence | Two lease claimants, expired/material batch races, failed commit retry, mismatched command hash, missing certificate, archive/prune continuation | Atomicity and idempotency preserved on real PostgreSQL; retention remains the same |
| Dashboard setup | Unauthorized actor, provider mismatch, unselected repo, stale merge SHA, invalid namespace, partially failed GitHub call, repeated form submit | No unauthorized GitHub writes, no false completed readiness; audit and UI mapping unchanged |
| Architecture | One deliberately bad import/transaction shim fixture per selected owner | Checker fails with path and actionable reason; clean fixture passes |
| Regression | Source/type lint; focused suites; existing Action and workflow compatibility; E2E in disposable repo where needed | All required exact-head checks green and explicit reviewer findings resolved before considering Ready |

**Evidence policy:** No local E2E claim from the current GitHub-connector-only environment. Source audits are not test passes. Record exact workflow run, commit and eligible jobs when hosted CI becomes available. Maintain `AGENTS.md` deploy registry discipline; merger ≠ deployment.

## Critics' review checklist (to be filled with revisions)

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
