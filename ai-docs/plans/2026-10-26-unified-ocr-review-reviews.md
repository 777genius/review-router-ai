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

All three independent critics reread v3 and returned GO for implementation:

- Transport/architecture: default profile mapping, supplied-diff policy,
  credential lifetime, Hosted authority join, native Claude terminal rules and
  explicit live gates accepted; no outstanding P1/P2.
- Budget/recovery: original source evidence scope, complete durable request
  receipt set, late settlement versus evidence, shared allowance and old-version
  compatibility accepted; no outstanding P1/P2.
- Activation/UX: post-activation fleet invalidation, ordinary activation,
  legacy effect overlap, transport-specific installed readiness, healthy shortcut
  and bounded visual surfaces accepted; no outstanding P1/P2.

Nine independent plan reviews were completed across the three rounds. These GO
verdicts authorize starting implementation and executable spikes. They are not
synthetic, browser, live-provider or deployment acceptance.

Initial unchanged-source baseline: lifecycle verification and runtime snapshot
capture suites passed 44/44 tests locally before product changes.


## Implementation spike correction — native Codex wire, 2026-10-26

The bounded S2 source check found an incompatible assumption before native-route
qualification: pinned Codex 0.147.0 does not send `max_output_tokens`, and the
existing direct-fork, Hosted and Gateway-probe sources intentionally omit it.
The source audit was checked by the transport reviewer, the corrected capability
and receipt semantics were agreed with the recovery reviewer, and the parent
implementation owner approved this correction. This is a recorded implementation
spike result following the three completed plan-review rounds.

The accepted change is a finite native codec, with no second streaming transport
or verifier. New route capture distinguishes `wireProtocol` and
`outputTokenLimit: upstream_request | terminal_acceptance`. Codex native/Hosted
use `codex-responses` and terminal acceptance; Gateway retains its outer Responses
wire with an explicit native-profile enforcement marker. Exact native bytes are
prepared before manifest/dispatch hashing, and the verifier's stricter acceptance
cap is carried separately by the parent. All V2 completions require observed
bounded output usage; missing/over-bound usage cannot clear the paid-effect fence.
The shared permanent per-run request allowance remains authoritative. Native
Codex is not represented as providing an upstream generated-token or spending
ceiling. The plan's S2, shared allowance and compatibility sections now state this
source-backed distinction explicitly.

The official auth-only executable already passed its loopback OAuth fixture.
The new managed OCR artifact remains a separate real-binary qualification gate:
local compilation hit the shared memory ceiling, so a PR-only pinned CI job
builds/tests the exact candidate and preserves its binary, checksum and manifest.
No immutable old artifact/profile is changed, and no release or deployment is
performed by that job.

### Post-spike Claude lifetime and alias correction

The transport audit confirmed that the current Secrets contract stores only
`CLAUDE_CODE_OAUTH_TOKEN`; it contains neither refresh material nor trustworthy
remaining expiry. Official [authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)
and [error](https://code.claude.com/docs/en/errors#oauth-token-revoked-or-expired)
documentation supports retaining the same setup-token and requiring user
replacement after rejection. A helper-presence check or a one-year issuance
policy cannot prove the remaining lifetime of an existing secret. Parent and
transport reviewer agreed to the explicit opaque lifetime mode described in S3:
provider validation on each ordinary budgeted request, original deadline, no
refresh/probe/fallback, and durable fencing after rejection or uncertainty.
Known-expiry credentials retain the original deadline-plus-margin rule.

The audit also found that current Claude UI choices are CLI aliases. Parent,
transport and recovery reviewers agreed to a trusted producer's finite frozen
alias map, with configured selection and exact native model captured separately
in the route. Runtime model identity remains strict; live qualification must
approve the map and honest native protocol before production activation. These
source-backed corrections refine the existing S3 spike outcome; they do not
introduce another review runner or change the completed three review rounds.
