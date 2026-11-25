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

Planning envelope: about 80–130 changed runtime/checker lines, 700–1,000 regression
test lines using existing fixtures, and bounded plan/deployment evidence. These
are estimates, not a volume target. Implementation complexity is 4/10 and
regression risk 4/10 because the changes affect authority and idempotency.
Confidence in the reproduced diagnoses is 9/10; readiness confidence remains
conditional on PostgreSQL/E2E and exact-head CI, rather than a claim of no bugs.

## Review findings and intended repairs

1. Restore an exact fresh-observation attachment retry after the first attachment
   releases its lease. Preserve current authorization, capability, owner, scope,
   fence and new-attachment checks.
2. Decide the source result-report deadline atomically at the store's actual
   decision time, using a fresh API clock after asynchronous preparation.
   Preserve the inclusive deadline and restore already committed exact requests
   even when a concurrent retry finishes preparing after that deadline. Map a
   rejected expired new request to the existing HTTP 412 error.
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

## Current evidence

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
lock cycle. The initial delayed stage is under diagnosis; neither a timeout
increase nor a reset retry is being used to hide the failed run.
The source/Vitest E2E exercises the production routes, database and worker with a
fake GitHub transport; it is not a live production deployment or a compiled
release qualification. Evidence is retained under `tmp/deep-review-evidence/`.
Exact-head CI and merge remain pending.
