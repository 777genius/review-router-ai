# Unified OCR plan review record

This records independent review, not implementation or live qualification.
Product implementation begins only after three completed rounds and closure of
blocking findings. Main plan: `2026-10-26-unified-ocr-review.md`.

## Round 1 — plan v1

Three independent critics reviewed architecture/transports, budget/recovery, and
activation/UX. All returned NO-GO until concrete corrections. No production code
had been changed.

| Finding | Resolution in v2 |
| --- | --- |
| Hosted lacked a concrete V2 authority join | Bind original binding/version/lease plus repository/run/head at admission; release unjoined grant without inference; one publisher; old runtime boundary explicit |
| Claude subscription wire not established by installed CLI | Versioned fixed endpoint/header/auth descriptor, synthetic versus live receipts, separate non-default production qualification |
| Anthropic incomplete terminal output could appear complete | Native non-streaming Messages; strict tool/final terminal validation, actual model/usage/byte limits and actual wire hash; new managed OCR version |
| Managed API-key credential source omitted | Matrix includes managed keys applied through existing repository-secret provisioning, no second adapter |
| Auth-helper cancellation/recovery underspecified | Separate pinned preparation capability, initialize/account-read only, process-group cleanup, no token logging, no old-refresh-token replay |
| Shared budget units unspecified | Captured maxRequests across all roles, per-request caps, permanent reservations, no cumulative dollar/token promise |
| Potential fresh authorization could reset budget | Source inspection confirms existing atomic source-run owner guard; reuse and regression-test it, no new table |
| V2 ordinal uniqueness / old claim bypass unspecified | Versioned ledger fields, deterministic scope/ordinal ID, changed-byte conflict, all roles use V2 for new authorization |
| Unknown-effect clearing/retention unspecified | Fully consumed protocol-valid terminal evidence only; one direct request at a time; no refunds or pruning before restore expiry |
| Missing witness could put connection into draining | Ensure prechecks qualification before invoking existing drain/activate; absence leaves legacy_open unchanged |
| Retirement receipt lacked current fleet binding | Purpose-separated existing witness extension, complete actual provider inventory/ingress, generation/digest/current deployment binding and rollback invalidation |
| Mutable candidate pin could look installed | Tri-state shared fact; only configured matching provisioning row proves installed candidate; old-drain authority distinct from new-feature compatibility |
| Historical comment copy confused deployment with cut | Earlier comments remain manual; dates come from actual connection cut; excluded comments never called verified |
| Visual matrix implied a nonexistent results page | Actual Next for setup/readiness; existing canonical GitHub comment/banner rendering for mixed results |

Round 2 rechecks these corrections against source and challenges failure/rollout
boundaries. A plan correction is not proof that its implementation passes.

## Round 2

Pending.

## Round 3

Pending.
