# Memory engine plan and implementation reviews

## Plan round 1 — revision 1

Three independent critics examined architecture/composition, product/testing/
Foundation and the actual released Infinity SDK. Changes requested and accepted:

| Finding | Disposition in revision 2 |
| --- | --- |
| Exact stale cleanup not expressible by existing item-wide delete | Define exact-revision and all-revision deletion targets in the neutral port |
| New backend misses existing memories and partial results suppress fallback | Bounded operator backfill through existing outbox, exact receipt coverage before search |
| Rotating backend loses cleanup access | Bind backend identity, reject rotation with debt, executable drain after writers stop |
| SDK lifecycle leaks into application model | Receipt repository remains infrastructure-owned |
| Foundation negative fixtures lack an actual required gate | Name qualify-boundaries.ts / foundation:qualify-memory and run sequentially in architecture:check |
| Alternate preview/mode paths retain controls | Shared static notice, remove dead production branch, pause preview and stale actions |
| ADR-025 active layout conflicts with requested pause | Record explicit owner-directed temporary override; preserve accepted ADR/PNGs and update design README |
| UI ingress/export behavior ambiguous | Cover all twelve mutation exports; keep protected backend export for recovery without UI |
| Claimed E2E not tied to an observable final state | Specify real Router PG/auth/outbox/SDK/bundle flow, edit/delete/restart and visible debt |
| Forbidden scopes can consume fallback limit | Apply trusted allowed scopes before external IO and canonical take |
| Infinity topology and scopes unspecified | Require pre-provisioned canonical native IDs; hard-filter trusted logical collections |
| Accepted ingestion confused with indexed visibility | Exact reconciliation required; keep unknown sends pending |
| SDK0.2.4 absent response rejects optional generation filters | Generation-bound external identity; omit optional filters for discovery and validate found records |
| Native and Router identities could be conflated | Validate native document_key against exact receipt; never reuse native canonical_version |
| Default unknown classification excludes documents | Explicit internal classification and complete bounded projection metadata |

No implementation was started before this round. Package/toolchain preparation
and source inspection were performed in the isolated checkout.

## Plan round 2 — revision 2

All three critics confirmed the first-round fixes. Accepted remaining changes:

| Finding | Disposition in revision 3 |
| --- | --- |
| Startup-only backend guard races across processes | Serialize backend admission/reservation/send in PostgreSQL; test two independent connections |
| Cancelled never-sent receipt can dispatch late | Conditional reserved-to-sent transition checks delete intent and current canonical revision |
| Cascade/pruning can remove original cleanup events | Noncascading receipt metadata and bounded existing-worker reconciliation of orphan/terminal exports |
| Permanent unknown receipt can starve cleanup | Due-time ordering/backoff across bounded batches |
| Immediate backend switch overpromised | Explicit drain restriction and service-disable rollback; startup requires no Infinity HTTP |
| Prisma default lacks the same new contract qualification | Small parameterized consumer tests for both adapters |
| Error privacy rule not observed by tests | Unique provider-error sentinels must stay out of metadata, logs and surfaced errors |
| Retry fingerprint can change | Stable whole ingest payload and fresh projection generation after drain |

No new platform, generic job runner or automatic topology provisioning is added.
