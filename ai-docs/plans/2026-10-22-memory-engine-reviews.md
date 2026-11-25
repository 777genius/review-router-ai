# Memory engine plan and implementation reviews

## Plan round 1 — revision 1

Three independent critics examined architecture/composition, product/testing/
Foundation and the actual released Infinity SDK. Changes requested and accepted:

| Finding                                                                    | Disposition in revision 2                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Exact stale cleanup not expressible by existing item-wide delete           | Define exact-revision and all-revision deletion targets in the neutral port                            |
| New backend misses existing memories and partial results suppress fallback | Bounded operator backfill through existing outbox, exact receipt coverage before search                |
| Rotating backend loses cleanup access                                      | Bind backend identity, reject rotation with debt, executable drain after writers stop                  |
| SDK lifecycle leaks into application model                                 | Receipt repository remains infrastructure-owned                                                        |
| Foundation negative fixtures lack an actual required gate                  | Name qualify-boundaries.ts / foundation:qualify-memory and run sequentially in architecture:check      |
| Alternate preview/mode paths retain controls                               | Shared static notice, remove dead production branch, pause preview and stale actions                   |
| ADR-025 active layout conflicts with requested pause                       | Record explicit owner-directed temporary override; preserve accepted ADR/PNGs and update design README |
| UI ingress/export behavior ambiguous                                       | Cover all twelve mutation exports; keep protected backend export for recovery without UI               |
| Claimed E2E not tied to an observable final state                          | Specify real Router PG/auth/outbox/SDK/bundle flow, edit/delete/restart and visible debt               |
| Forbidden scopes can consume fallback limit                                | Apply trusted allowed scopes before external IO and canonical take                                     |
| Infinity topology and scopes unspecified                                   | Require pre-provisioned canonical native IDs; hard-filter trusted logical collections                  |
| Accepted ingestion confused with indexed visibility                        | Exact reconciliation required; keep unknown sends pending                                              |
| SDK0.2.4 absent response rejects optional generation filters               | Generation-bound external identity; omit optional filters for discovery and validate found records     |
| Native and Router identities could be conflated                            | Validate native document_key against exact receipt; never reuse native canonical_version               |
| Default unknown classification excludes documents                          | Explicit internal classification and complete bounded projection metadata                              |

No implementation was started before this round. Package/toolchain preparation
and source inspection were performed in the isolated checkout.

## Plan round 2 — revision 2

All three critics confirmed the first-round fixes. Accepted remaining changes:

| Finding                                                  | Disposition in revision 3                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Startup-only backend guard races across processes        | Serialize backend admission/reservation/send in PostgreSQL; test two independent connections        |
| Cancelled never-sent receipt can dispatch late           | Conditional reserved-to-sent transition checks delete intent and current canonical revision         |
| Cascade/pruning can remove original cleanup events       | Noncascading receipt metadata and bounded existing-worker reconciliation of orphan/terminal exports |
| Permanent unknown receipt can starve cleanup             | Due-time ordering/backoff across bounded batches                                                    |
| Immediate backend switch overpromised                    | Explicit drain restriction and service-disable rollback; startup requires no Infinity HTTP          |
| Prisma default lacks the same new contract qualification | Small parameterized consumer tests for both adapters                                                |
| Error privacy rule not observed by tests                 | Unique provider-error sentinels must stay out of metadata, logs and surfaced errors                 |
| Retry fingerprint can change                             | Stable whole ingest payload and fresh projection generation after drain                             |

No new platform, generic job runner or automatic topology provisioning is added.

## Plan round 3 — revision 3

All three independent critics re-read revision 3 after the second correction
checkpoint. Architecture/composition, product/Foundation and Infinity lifecycle
reviews each reported no remaining P1/P2 plan blockers and cleared implementation.
The implementation starts after this record; later findings will be recorded
separately rather than rewriting the three planning rounds as implementation proof.

## Implementation review — 2026-10-22

The completed implementation received a separate independent review of the
Infinity SDK/lifecycle, application/composition/recovery, and dashboard/Foundation
boundaries. These findings were accepted and corrected:

| Finding                                                                                                                                                          | Correction and regression evidence                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A recovered indexed receipt could still be rejected because canonical diagnostic index flags remained pending or were overwritten by a concurrent same-body edit | Queryability belongs to the selected reader. Keep canonical authorization, scope, status, fresh expiry and exact version/hash checks. A real PostgreSQL regression proves accepted ingestion → restarted maintenance → healthy bundle without replaying an outbox event, including stale diagnostic overwrite. |
| Transaction time could admit a revision whose TTL elapsed while waiting for an advisory or canonical row lock                                                    | Receipt admission locks the canonical row first, then checks expiry using a fresh `clock_timestamp()` query. Two PostgreSQL regressions observe the lock wait and cross the TTL before releasing it. This post-lock guarantee applies to receipt reserve/admit/mark-indexed admission.                         |
| Repeating backfill silently skipped an idempotent event that had exhausted its retry budget                                                                      | Backfill reports bounded `deadLetterEventIds`; the real CLI exits 2 with a fixed error code. Recovery explicitly uses the existing workspace Outbox retry. API/PG/SDK/CLI E2E verifies the event stays dead-lettered until that retry and subsequently reaches indexed state.                                  |
| Reconciliation-supplied native document IDs did not have the ingest acknowledgement's validation before DELETE                                                   | Validate both sources before binding or issuing a request; the SDK wire regression injects a hostile path ID and observes zero DELETE requests.                                                                                                                                                                |

The final read-only SDK/lifecycle critic and composition/recovery critic reported
no remaining actionable P1/P2 in their reviewed scopes after these corrections.
The dashboard/Foundation critic also independently checked the SDK boundary.
These are independent implementation critiques, not a claim of human GitHub
approval or of a live Infinity deployment.

### Focused evidence

- Neutral application/core plus real receipt PostgreSQL regressions: 67 passed
  (50 core and 17 PostgreSQL cases), including the shared Prisma/Infinity consumer
  contract and the readiness/expiry regressions above.
- Released SDK over actual loopback HTTP: 30 passed, covering ingestion,
  capability validation, queryable revisions, reconciliation, deletion and error
  redaction. The remote service is a deterministic protocol fixture.
- Authenticated API → actual canonical PostgreSQL/outbox → released SDK → action
  bundle plus restart/edit/delete/backfill/CLI recovery: 4 passed.
- Operator/composition/maintenance checks after recovery correction: 28 passed;
  worker typecheck and focused lint/format passed.
- Dashboard/pause/preview tests: 102 passed. Actual Next/Chromium qualification:
  15 route/viewport cases passed; six screenshots visually reviewed. The app
  role had no privileges on any Memory table. See the
  [browser evidence limits and reproduction](../../scripts/memory-e2e/browser-README.md).
- Three separate disposable Router PostgreSQL databases were used. Preparation
  creates the current Prisma schema and applies the actual affected projection
  and outbox-fencing SQL. This does not claim a full historical migration replay.

Repository-wide checkpoints are recorded below. The latest gate and GitHub CI
results are maintained in [PR #670](https://github.com/777genius/review-router-ai/pull/670).
At this checkpoint the PR was left open. The owner's subsequent merge request
is recorded below; deployment and Infinity production activation remain outside
this delivery.

### CI integration correction: exact migration inventory

The existing Account Gateway PostgreSQL CI exposed an exact-current-checkout
assertion that still expected 140 migrations. The additive projection table is
migration 141. The correction updates the current inventory and its admission
policy together: the exact new SQL checksum and full checkout141 manifest are
validated before reduction to the previously admitted checkout140. Historical
managed92 and historical96 inventories, hashes, roles, and SQL execution bounds
remain unchanged. The historical fixtures explicitly exclude the new
checkout-only migration.

Seven focused migration/admission test files passed all 332 unique cases.
The first run found two old filesystem-fixture assumptions; after their
correction, only that affected file was rerun (105/105). The other six files had
already passed 227/227. Negative cases retain rejection of altered, missing,
renamed, duplicated, reordered, and unexpected migrations. An independent
read-only critic verified all 11 changed files and recomputed both new hashes,
reporting no actionable P1/P2. This is an exact additive admission, not a change
to historical migration authority.

The dedicated [Memory PostgreSQL/API workflow](https://github.com/777genius/review-router-ai/actions/runs/39805372854)
passed 21/21 tests on commit `b46c3bf713df27ff5506bedae6c2a534ae560939`.
Its clean PostgreSQL service executes the checked-in preparation script for both
databases, then requires both suites to finish without skipped or todo cases.

### Repository-wide validation checkpoint

The full typecheck passed all 51 packages plus the spike, one-shot handoff and
tooling configurations. Repository ESLint, Prettier and architecture checks
passed; the architecture gate executed all ten positive/negative memory
Foundation qualification cases.

The full Vitest run completed with 11,174 passing, 24 failing and 605 skipped
tests. Investigation separated three stale test fixtures from missing local
prerequisites. The corrections preserve the existing strict assertions:

- The API action-session fixture models the two exact, transaction-bound memory
  startup ledger queries against an empty ledger. Production composition and
  denied-request query assertions remain exercised.
- The dashboard writer inventory uses the new paused-memory helper as its end
  anchor; the complete preceding activation body and exact writer counts remain
  covered.
- The architecture script expectation now requires the added memory Foundation
  qualifier alongside every existing gate.
- The documented `pnpm protocol:bootstrap` prerequisite builds the contract
  source modules used by three generated-protocol tests. No protocol source
  correction was required.

The affected four files then passed 138/138 tests, closing all 19 failures in
those files. The five remaining local failures are four existing CertifiedFork
PostgreSQL fixture files: the digest-pinned Docker base image is unavailable
(`managed_pg17_fixture_image:base_missing`; no Docker executable in this
environment). Their always-run requirements have not been skipped or weakened.
The normal GitHub CI provisions that image; this local run is therefore not
reported as a completely green full suite.

At commit `9742beb314ff7c01edf03ccd5984d09dab20083c`, the Memory projections,
Account Gateway S, Provider C1 and P115 GitHub workflows passed. Production
build, final browser qualification and the latest main CI results are tracked in
the PR validation section.

### External PR review and upstream synchronization

CodeRabbit completed its full review of 68 selected files at `9742beb3` and
posted one [minor diagnostic-code finding](https://github.com/777genius/review-router-ai/pull/670#discussion_r4350611398).
The outbox sanitizer discarded already-safe conflict, unknown-write and deadline
codes. The correction moves the adapter's existing nine-code allowlist into a
shared neutral helper: only an actual `MemoryIndexOperationError` with an allowed
code is preserved. SDK and outbox retain their distinct generic fallback codes,
and neither copies provider messages, causes or additional error properties.

The post-review run passed all 72 cases: 21 outbox, 30 SDK wire, 17 real
PostgreSQL receipt and four authenticated API/CLI tests, with no skipped cases.
The regressions exercise both reindex and delete failures, including arbitrary
codes, spoofed objects and body/query/token/cause sentinels. Focused ESLint and
Prettier passed. A separate read-only critic confirmed the closed allowlist,
privacy behavior and unchanged SDK failure semantics with no actionable findings.

The upstream account-limits change `b786d7a6` was merged in `059822bb`. Its single
Foundation root-list conflict was resolved by retaining both the account-limits
and memory roots, all five account-limits boundaries and all nine memory
boundaries. No memory restriction was removed. The locked dependency install and
complete architecture gate passed after the merge, including all ten memory
qualification cases. Final build/typecheck/browser evidence in the PR refers to
the resulting source, rather than the interrupted pre-merge build.

### Owner-requested deeper architecture and UX review

After the initial green PR delivery, the owner requested a further Clean
Architecture/SOLID/DRY audit, a clearer paused screen using shared UI, independent
criticism of the corrections, and merge after validation. Three reviewers
examined the public/core contracts, composition/lifecycle and product surface.
The resulting changes are limited to the confirmed seams:

- The core package entrypoint no longer re-exports concrete Prisma, entitlement
  or configuration adapters. Hosts import the explicit `./infrastructure`
  entrypoint. Foundation rejects concrete value **and type** re-exports through
  the core entrypoint.
- API retrieval accepts only `MemorySearchReaderPort`; its authenticated
  regression fixture has no write methods or index identity. Existing canonical
  policy and fallback assertions remain intact.
- The shared projection receipt contract belongs to neutral infrastructure,
  with `PrismaMemoryProjectionReceiptStore` implementing it. Generic Prisma
  infrastructure can no longer import the Infinity boundary. The move preserves
  all SQL, lock admission, fresh-expiry, deletion-debt and retirement semantics.
- Configuration diagnostics are owned and classified by the memory feature.
  Operator CLI no longer enumerates Infinity fields; unknown and spoofed errors
  retain a fixed fallback. Independent cross-review found a double property read
  in the new classifier. It now snapshots the code once, with a stateful-getter
  regression also covering private message/cause data.
- The shared paused screen uses the existing UI Badge, icon and theme tokens,
  one page heading, a short purpose statement and a clear availability message.
  It adds no memory controls, data access, client state or shared UI framework.

Both architecture cross-reviewers reported GO after the corrections; the UI
implementation also passed the independent semantic/component review. Accepted
ADRs were not edited, and the three original pre-implementation review rounds
remain distinct from this follow-up implementation review.

Foundation qualification now contains 15 cases, including the actual public
entrypoint and neutral projection boundaries. All 15 passed against an unchanged
complete workspace snapshot with the installed Foundation CLI; the snapshot
avoided a local workspace-sync race involving transient negative fixtures.
The normal CI runs the same strict qualifier directly in its checkout. Focused
configuration/composition/operator regressions passed 62/62. The latest combined
PostgreSQL/API, browser, build and CI evidence is recorded in PR #670.

### Follow-up visual and batch-budget corrections

The expanded browser matrix initially passed all 30 functional cases, but visual
review rejected both mobile light-theme screenshots: an existing mobile rule
forced a dark body and footer underneath light-theme text. Only those dark
palette selectors are now guarded by the active theme; mobile spacing and the
other page-specific rules are preserved. The browser qualifier records the
global stylesheet hash, verifies actual light surfaces, and measures the five
notice text samples against their composited backgrounds with native sRGB
Canvas. Footer base-color checks remain distinct from visual inspection of its
gradient. The simple shared notice adds no memory functionality.

A further [CodeRabbit finding](https://github.com/777genius/review-router-ai/pull/670#discussion_r4351127255)
identified that exhausted batch budgets deferred receipts that had not been
attempted. Giving every receipt a fresh five-second budget would let a
100-receipt pass block the shared worker loop for minutes. The correction retains
the single pass budget and stops before the next receipt when its minimum
reconciliation allowance is unavailable. Untouched receipts retain their
schedule and error state; counts distinguish started work from selected work
still pending. A successfully validated capability is reused only within that
pass, with discovery refreshed next time.

Independent criticism also confirmed that repeated item-wide deletion reset
every revision's retry schedule. The receipt-store move itself preserved the
SQL; this subsequent correction changes only deletion scheduling idempotency:
new intent becomes due immediately, while repeated intent preserves existing
backoff and ordering. Exact revision cleanup, durable unknown-write debt and
the final inventory check before generation retirement remain intact.

Both the visual source correction and the bounded-pass/scheduling correction
received independent read-only GO. New regressions cover untouched receipt
state, follow-up progress, one capability discovery per pass, incomplete drain
retirement refusal, and real PostgreSQL retry ordering after store restart.
The released-SDK HTTP suite passed 33/33 and the real PostgreSQL receipt suite
passed 18/18, including the four new cases. The earlier combined follow-up
regression passed 329/329 tests without skips. These overlapping counts are not
additive; final browser, build and current-head CI evidence is maintained in the
PR validation section.

The authenticated API/outbox follow-up passed another 25/25 cases, completing
76/76 focused checks for the batch-budget correction. CodeRabbit inspected
`84e2d8ff`, [accepted the bounded-pass alternative](https://github.com/777genius/review-router-ai/pull/670#discussion_r4351434468)
and resolved its thread. Both external inline findings are addressed.

Upstream `0e5e0f88` added a compact dashboard footer. After merging it without
conflicts, the browser qualifier selects that semantic footer and hashes its
source. The complete merged-source matrix passed 30/30 cases; all twelve
screenshots were reviewed independently and by the integrator. Light mobile
surfaces now match the applied tokens, and the minimum measured notice text
contrast is 7.2882:1. Fixture cleanup passed, with no memory API requests,
external browser requests or browser errors. The accepted historical manager
references remain unchanged.

Sequential typechecking passed all 51 workspace packages. The separate spike
configuration found one old relative import of concrete adapters through the
core barrel; it now imports the explicit infrastructure entrypoint. Spike,
one-shot handoff and tooling typechecks then passed, and an independent reviewer
confirmed this import-only correction. The earlier parallel compiler process
was terminated by the shared environment's memory limit; no gate was removed.
