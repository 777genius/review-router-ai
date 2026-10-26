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

Three independent critics rechecked v2. Round-1 corrections were confirmed;
remaining bounded findings are addressed in v3 and sent for final recheck.

| Finding | Resolution in v3 |
| --- | --- |
| Multiple retained OCR profiles break implicit single-candidate selection | Explicit trusted route-to-default-profile mapping; old refs retained only for explicit policy/restore |
| Saved supplied-diff mode could silently gain repository tools | Preserve agenticContext=false as the explicit supported Codex alternative using shared verifier/route; incompatible explicit OCR fails before inference |
| Auth fresh now may expire during review | Verified credentialValidUntil covers original deadline + 60 seconds; Hosted bound by original grant expiry; no model dispatch after boundary |
| Discovery evidence gate ignored new model receipt ledger | Extend existing acceptance/reuse gate for complete source invocation receipt set and original authorization; final individual receipt alone is insufficient |
| Revoking retirement receipt does not invalidate already guarded history | Monotonic deployment gate plus fail-closed existing fresh-resolution authority, retaining exact readback reconciliation and original cut |
| Old admitted resolution overlap underspecified | Entered pre-drain legacy effects settle; new legacy resolves skip; issued canonical operations reconcile without reissue |
| Gateway neutral ABI is not a direct immutable SHA | Transport-appropriate canonical readiness facts; shared compatibility also guards old healthy shortcut |

No product implementation occurred during these reviews. The transport/recovery
and activation critics perform a third complete pass on v3 before implementation.

## Round 3

Pending.
