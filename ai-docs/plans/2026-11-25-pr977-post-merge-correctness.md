# PR 977: deeper review and bounded correctness repairs

## Scope and baseline

The user requested another deep review, fixes for reproduced defects, and the
normal PR/merge/check cycle. Review starts at current main
`c47d1c75742088e989f9c00a7f8d71724f51aa2f`, preserving the later changes in #991
and #994. PR #977 was merged as `319e98fd3ed47568436df3258417d92d942b492c`.
Before publication, the branch incorporated main
`919a5add21a40d9adee064bf23b2e4217bd7e040`, preserving #997 and the subsequent
activation-catalog Node ESM correction. The core repair checkpoint is
`ce0d75ff32e6f7a7f28ccb7ab23d48eade791081` in
[PR #1003](https://github.com/777genius/review-router-ai/pull/1003).
This follow-up does not repeat its broad refactoring or authorize an application
deployment.

Planning envelope: about 80–180 changed runtime/checker lines, 700–1,100 regression
test lines using existing fixtures, and bounded plan/deployment evidence. These
are estimates, not a volume target. Implementation complexity is 4/10 and
regression risk 4/10 because the changes affect authority and idempotency.
Confidence in the reproduced diagnoses is 9/10; readiness confidence remains
conditional on PostgreSQL/E2E and exact-head CI, rather than a claim of no bugs.
The later fixture-only scheduling correction adds a small test driver and its
regressions after a concrete premature-stall diagnostic; it does not expand the
production policy changes.

## Review findings and intended repairs

1. Restore an exact fresh-observation attachment retry after the first attachment
   releases its lease. Preserve current authorization, capability, owner, scope,
   fence and new-attachment checks.
2. Decide the source result-report deadline atomically at the store's actual
   decision time, using a fresh API clock after asynchronous preparation.
   Preserve the inclusive deadline and restore already committed exact requests
   even when a concurrent retry finishes preparing after that deadline. Map a
   distinct internal expired-window outcome to the existing HTTP 412 error;
   unrelated rejection must not be reclassified using the later API clock.
3. Recheck finalization time after asynchronous facts resolution, and preserve the
   absolute publication deadline when the PostgreSQL store acquires its locks.
   Preserve immutable artifact replay and internal reconciliation grace for
   permits that were already issued.
4. Restore concurrent identical adoption through the real API and store using
   only the exact persisted adoption intent; changed request
   bodies, owners or observation identity must continue to conflict.
5. Close two bounded check-oracle gaps: computed Prisma option overrides in the
   dedicated provider database fixture, and transaction bindings lost through a
   self-initializing `var` redeclaration.
6. Reset the three progress tables without foreign keys in the existing
   disposable E2E database reset. A runtime reproduction showed that old orphan
   publications survive `CASCADE` and consume the worker batch before the new
   fixture can publish. Keep production selection and rate limiting unchanged.
7. Before signing a transport publication permit, check the stored absolute
   deadline against fresh database time as well as fresh API time. This also
   applies when the store restores an immutable artifact. Keep transport
   `issuedAt`/`nbf` on the local verifier's clock and leave store replay and
   internal worker reconciliation unchanged.

Findings 1–3 and the provider fixture oracle existed before #977. The transaction
binding regression was introduced by its AST refactor. Finding 4 was reproduced
using a deterministic two-request barrier and the maintained store. A final
independent pass reproduced the late concurrent retry variant and moved expiry
authority fully into the atomic decision. No confirmed new Context Attestation
bug was found in an independent source/consumer review; that does not establish
the absence of all defects.

## Qualification

- Preserve failing-before-fix logs and execute the complete affected test files.
- Exercise real handlers with the maintained in-memory store, including changed
  replay intent, expired authority, deadline equality, and absence of extra effects.
- Run the maintained real PostgreSQL execution suite against the canonical
  through-079 catalog and production Review v2 E2E against current migrations.
- Use pinned Node 26.11.1, pnpm 11.28.7, TypeScript 7.0.2 and Oxc 0.159.0 with the
  native load guard. Run original strict configurations and applicable lint,
  format and architecture checks without weakening their scope.
- Publish a Draft PR, review the concrete final diff independently, qualify the
  exact ready head, merge through normal repository policy, and verify main and
  its automatic publication workflows. Record actual results separately from
  source review; no manual CI rerun merely to avoid waiting.

## Boundaries and risks

No schema, protocol shape, production configuration, provider implementation,
worker reconciliation policy, or public Action source change is intended.
Idempotency changes must preserve exact persisted identity and must not accept a
new effect through a released/expired lease. Deadline repairs must not extend an
authorization-bound absolute deadline, including while waiting for database
locks. Deployment remains an ordinary API rollout documented separately.

## First implementation qualification

Before production fixes, the complete API/domain regression run had 140 passing
tests and four expected failures for findings 1–2. Two additional targeted API
finalization regressions failed as expected. Concurrent adoption returned
`Applied + Conflict` before the fix; its changed-body negative control passed.
The final API/domain suites pass 150/150. The two tooling suites pass 205/205.
An expanded 18-file run passed 375 tests with one conditional paired Action test
skipped; that complete 46-test publication suite then passed with the actual
public Action checkout at `a79dd059e7adcf60895af29e3c91f670b9ee5d03`.
The architecture checker passes for 694 domain/application files; complete lint
and format checks passed. Original API, execution-owner and tooling strict
configurations passed again after the last API regression was added, using the
same native compiler with `GOMEMLIMIT=512MiB`. The original scope was retained;
one interrupted compiler attempt and a corrected readonly fixture typing error
are retained as failed attempts, not treated as success.
After the additional E2E fixture test, two full tooling compiler attempts ended
with `SIGKILL` and no TypeScript diagnostics, including a single-thread attempt
with a smaller Go memory target. Those attempts do not qualify the final tooling
tree; the original compiler scope remains required and has not been reduced.

Real PostgreSQL 17.12 qualification passed the complete 56-test execution suite
against 82 canonical migrations, including both previously failing absolute
publication deadline cases. Production source E2E passed 17/17 against all 165
migrations. The final rerun after the API-only late-retry adjustment passed 15/17
but failed two progress-publication eligibility assertions (`claimed: 0` where
publication was expected). That run remains failed. Runtime diagnosis found 30
owned orphan publications, including 24 pending/due rows, after the old reset.
Two consecutive fixtures each returned `claimed: 0, deferred: 10`; their progress,
publication and installation-budget records survived reset. Database and Node
clocks agreed within the query roundtrip. The scoped reset correction passed the
diagnostic A-to-B check, and the new maintained regression passed in both full
runs on the same database. The first complete run passed 18/18. The second passed
16/18: the existing discovery scenario timed out, and its still-running provider
account binding queries overlapped teardown, producing PostgreSQL `40P01` in
reset and the following setup. The new progress tables were not in the observed
lock cycle. The initial delay's cause is not established. A further isolated
diagnostic process terminated with `SIGKILL` during module loading, before
`beforeEach` or application SQL, after long event-loop pauses. It produced no
test report. Neither a timeout increase nor a reset retry hides these attempts.
That local process interruption remains recorded explicitly. Later successful
recovery qualification is recorded below; exact-head CI remains independently
required.
The source/Vitest E2E exercises the production routes, database and worker with a
fake GitHub transport; it is not a live production deployment or a compiled
release qualification. Evidence is retained under `tmp/deep-review-evidence/`.
A bounded [qualification record](../deployments/evidence/2026-11-25-pr977-observation-recovery.json)
binds the changed source bytes, passed suites, failed attempts and limitations.
Both disposable PostgreSQL instances are stopped and their recovery evidence is
retained. Independent production and fixture reviewers report no remaining
confirmed blocking findings in the corrected diff. Exact-head required CI,
merge readback and resulting main checks are tracked on
[PR #1003](https://github.com/777genius/review-router-ai/pull/1003); local receipts
do not substitute for those gates.

## Recovery and current-base integration

After the executor recovered, unchanged core checkpoint `3eac6374` passed the
original complete native tooling configuration and two consecutive complete
production-source E2E runs: 18/18 and 18/18, zero skips, on the same PostgreSQL
17.12/165-migration database. There was no manual cleanup between runs or change
to source, assertions, timeouts or compiler scope. These results supplement the
earlier failures; they do not relabel them as successes or establish the cause
of the earlier timeout.

The ordinary CI formatter gate exposed eight violations inherited from main.
Commit `70923853` corrected only their formatting; normalized Markdown/Oxc ASTs
were equal before and after every edit. Main subsequently received the identical
eight Git blobs in #1006. Integration commit
`bfbece593a64232d934115755a5fc42de72ab56b` preserves both histories and keeps the
entire reviewed tree identical to `70923853`, while updating the base to
`95201f4e0d63d3ab7c4d585a1e55a6317e84ca6b`. Both checkpoints passed CI Static
Checks, including all 56 workspace typecheck tasks and the original root
configurations, plus 63/63 installer cases on each of Ubuntu and macOS.
Those results qualify that tree, not subsequent source changes.

## Additional review findings

The [CodeRabbit review data](https://github.com/777genius/review-router-ai/pull/1003#issuecomment-7164210441)
for `bfbece59` preserved four proposed inline comments and one additional minor
comment when GitHub review publication timed out. Each was checked against the
actual implementation; the failed publication is not counted as approval.

1. An expired new adoption could receive HTTP 200 `Rejected` when API time lagged
   the store, while an unrelated `Ineligible` result could become HTTP 412 when
   API time advanced. Both cases were reproduced through the maintained store.
   `ReportWindowExpired` now travels through the domain and both store adapters;
   only this outcome maps to the existing expiry error. The original mutation
   checks remain fail closed, and exact replay stays ahead of expiry evaluation.
2. Exact artifact replay could sign a transport permit after its stored deadline
   according to PostgreSQL. The original absolute token expiry was not extended;
   no unauthorized SCM effect was demonstrated. The API now uses the existing
   database-backed server clock immediately before issuance, rejects expired
   deadlines with the existing HTTP 410, and fails closed with HTTP 503 if that
   clock is unavailable or invalid. Valid clock skew preserves local token
   timestamps and successful local verification.
3. The changed fresh-observation test now changes only the payload hash,
   recomputes the request hash and requires the exact authority-mismatch error,
   rather than accepting any client error.
4. The late concurrent-adoption test rejects its gates on an unexpected first
   store result or either request's early failure, bounds barrier waiting and
   joins both requests during cleanup. Existing result assertions and the
   suite's global timeout remain unchanged.
5. The PostgreSQL replay test is named for its actual immutable-artifact
   contract. A primitive validator assertion with hardcoded active-authority
   booleans was removed; it had not demonstrated production issued-permit grace.

The two API adoption cases and four publication-clock cases failed against their
previous handlers. The complete corrected API/domain suites then passed 158/158
with zero skips. One earlier publication-clock diagnostic attempt was killed
before producing a test report; it remains an interrupted attempt, not a pass.
The final real-PostgreSQL, E2E, strict and CI results are recorded in the
qualification record and PR. The source binding for this additional correction
is separate from the preserved first-checkpoint binding.

## Bounded E2E retry scheduling

The complete real-PostgreSQL suite passed 56/56 again after the clock/status
corrections. Two subsequent complete E2E attempts ended with `SIGKILL` without
final JSON. One had already recorded `publication_claim_fenced_before_mutation`
and a premature worker-stalled verdict: the remaining summary's stored
`nextEligibleAt` was still 874 ms in the future. The harness ran twelve immediate
maintenance passes even though production correctly excludes future retries.
This is a specific fixture defect; it does not establish why the first claim
was fenced or why the processes were killed.

The harness now waits between remaining passes for the earliest applicable
completion/publication deadline, with a total requested timer budget of 5000 ms.
It respects retained active completion and attempt identities, leaves same-owner
claim reuse to production, and cancels a pending timer when the fixture closes.
Single-pass fault probes do not read deadlines or wait. Production retry policy,
lease durations, reset behavior, result assertions and global test timeouts are
unchanged. Seven focused regressions cover deferred/due work, the shared budget,
single-pass behavior and cancellation. They pass with zero skips.

The timer budget does not bound the duration of database or maintenance calls,
and this change does not resolve the previously observed general async teardown
hazard. The diagnostic E2E repeat produced only the runner-start message and no
observed application SQL in the sampled sessions; its exact execution point and
the SIGKILL cause remain unknown. Full API and tooling compiler attempts on the
additional correction also ended with SIGKILL and no TypeScript diagnostics.
These interruptions remain separate from passing suites. Full original strict
and complete E2E qualification of the final corrected head are required from
ordinary CI before merge.

## Final publication-window review follow-up

The full ordinary CI and all four related workflows completed successfully for
`97be9156e4ca1b115b1d5f4bb34e3f39c80116c2`. CI run 45665988909 finished at
23:10:37 UTC on 2026-11-25 after one normal retry of an unexplained exit-137
Quality interruption. The retry passed the original complete command and later
steps; no worker, timeout, isolation or selection change was made. The original
interruption remains a failed attempt. These results qualify that source, not a
subsequent correction.

Main then advanced through documentation-only #1009. Normal integration
`61ec1cb63ffc7d949fa5e040490930048e272032` incorporates
`1912bb61b54de8af113e0dccd5d4a144382e19e2` and adds only eight Markdown lines
relative to `97be9156`. All application, tests, tooling and workflow inputs were
unchanged. Git's actual merge tree matched the published tree.

A fresh CodeRabbit review of `61ec1cb6` identified two further narrow gaps.
The finalization deadline test asserted only HTTP 410, so the publication guard
could conceal a missing authorization guard. It now requires the exact protocol
code and distinct authorization/publication issue while retaining assertions for
no finalization, no signature and unchanged persisted state.

The store already refused new finalization after the absolute publication
deadline, but database-time expiry used the same generic invariant error as
malformed retention or epoch input. A distinct internal
`PublicationWindowExpired` domain/port result now reaches the API as the existing
HTTP 410 `ResourceGone` / `publication_permit_expired`. Both adapters preserve
immutable replay and stale-version checks before the domain decision. Input and
scope validation still precede expiry; no execution, lease, artifact or outbox
write occurs for the expired outcome. No public protocol enum or schema changes.

Regressions cover equality and past-deadline requests through the maintained
store and API, an invalid-retention negative control, and exact immutable replay
versus changed-hash conflict after the deadline. The existing real PostgreSQL
closed-window case now accepts only the precise expired outcome and still
requires unchanged execution, zero artifacts and unchanged outbox count.

This follow-up was prepared while the local executor was unavailable. No new
local compiler, formatter or test result is claimed, and no legacy toolchain or
reduced configuration substitutes for the pinned tools. Independent review and
ordinary exact-head CI, including the complete native strict, PostgreSQL and E2E
lanes, are required before merge; final run links and dispositions are tracked in
[PR #1003](https://github.com/777genius/review-router-ai/pull/1003).
