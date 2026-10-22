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

Repository-wide gates and GitHub CI are recorded below when complete. The PR
remains unmerged and no deployment or Infinity production activation is part of
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
