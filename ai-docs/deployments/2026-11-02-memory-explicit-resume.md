# Explicit locked Memory resume

- Goal: recover a completed standalone Memory installation after an explicit
  stop or reboot without recreating native state or weakening physical Forget.
- Affected targets: Memory operator API/store, all Router command writers,
  standalone native bootstrap/setup and stock self-hosted lifecycle acceptance.
- Source: resume implementation through `657f80b6a`; Docker entrypoint
  compatibility fix `b53b79d4ce518beb1ad2e40553ec2ca9d9116ecf` in
  [PR #785](https://github.com/777genius/review-router-ai/pull/785).
  No production release/image assigned to this successor.
- Dependencies: [Memory startup](2026-11-01-memory-production-startup.md),
  [cleanup inventory](2026-11-01-memory-bootstrap-cleanup.md),
  [conversation delivery](2026-10-29-conversational-memory.md) and the existing
  [release process](../operations/07-environments-and-release-management.md).

| Environment | Status    | Actual version                                                                                | Remaining work                                                                                   |
| ----------- | --------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| production  | `pending` | Core `57cc1513` / image `3550f3c7` unchanged; resume not activated                            | Coherent normal release and applicable operator acceptance.                                      |
| self-hosted | `pending` | Retained test sandbox: application `657f80b6a`, host helper `b53b79d4c`; fully decommissioned | Continuous stock CI and normal distribution/update remain; bounded real acceptance below passed. |

## Contract and compatibility

Native API, worker and dedicated PostgreSQL retain `restart=no`, the same exact
IDs/images, environment, pinned models, volumes and installed provenance. Compose
continues to own only Router services. There is no daemon, reconciler, migration,
new feature flag, credential rotation or fresh provenance in recovery. This is
an explicit command; unattended cold-boot recovery is not implemented.

The trusted Router owner reserves startup under the existing delivery fence. A
strict UUID and normalized provider-binding digest are persisted in its existing
maintenance actor; callers cannot supply an actor or claim no cleanup debt.
Begin/finish serialize all-generation Forget admission with the same global-first
lock order. Begin pauses and drains native submissions; finish atomically checks
the same reservation, epoch and no retained cleanup debt before unpausing. Generic
maintenance cannot unpause a live startup reservation. Existing logical Forget
admission while paused is preserved, including failed/unknown and older-generation
debt. Accepted historical cleanup receipts remain authoritative.

All Router roles that admit Forget must run the new shared barrier before resume
is used; a new API beside old command writers is unsupported. An old API without
the new operator routes cannot grant recovery. The ordinary first-install path
remains separate and may precede Router startup; completed resume requires a
healthy, reachable actual Router API origin and its saved operator credential.
No model-quality source file or qualification digest changes in this batch.

## Ordered delivery and acceptance

1. Freeze and review the complete API/store/bootstrap/setup plus lifecycle-test
   source. Run strict types, existing operator and Node contracts, real PostgreSQL
   races and the stock self-hosted E2E remotely or in CI. Source review alone is
   not execution evidence. No heavy local checks are authorized.
2. Through the normal protected release process, deploy compatible Router code
   coherently to every relevant command writer. Reconcile the installed schema,
   native profile and exact saved state; this batch adds no migration. Preserve
   production containers, credentials, generation and all unresolved operations.
3. In a fresh disposable installation, before creating any Forget debt, keep the
   Router API running and stop only its exact owned native API/worker/PG under
   the existing deployment lock. Invoke the supported
   [explicit resume command](../../deploy/hindsight/BOOTSTRAP.md#explicit-completed-deployment-resume).
   Verify PG-first recovery, existing read-only provenance, exact unchanged state,
   actual readiness, then real Save/read/recall and the existing Forget semantics.
4. Exercise real store/API contention: transport drain, competing owners, logical
   Forget during startup, old-generation/failed unreceipted debt, stale binding or
   epoch, finish idempotence and paused abort handoff. Confirm unknown finish
   cannot trigger a fresh attempt or a false retained-pause claim. No provider
   calls or fabricated signed cleanup receipts are needed for these tests.
5. Distribute the tested implementation through normal self-hosted installation/
   update and record actual source/image plus durable lifecycle receipts here.
   Production use needs its own applicable verification; do not reboot production
   merely to manufacture acceptance evidence.

## Failure and recovery

The host holds the existing whole deployment flock, inspects the complete bounded
Docker census and exclusive owned-volume users, and starts only the saved IDs.
It verifies existing PostgreSQL provenance before any native writer start. A new
logical Forget can still arrive during launch; finish then refuses to unpause,
stops only its own-started writers and aborts ownership while preserving the pause
for normal cleanup. The host lock prevents physical Forget completion during
launch; it does not assert that a writer can never briefly start after logical
Forget.

A private attempt journal records intents before start effects. Exact durable
completed-marker readback can settle a lost finish response; an ambiguous outcome
retains the journal and actual state for explicit reconciliation. Do not blindly
restart, delete a journal, reset a generation, reinstall provenance or relabel
unknown work. Existing signed cleanup still owns physical completion. Reverting
to old Router writers while a startup reservation is active is unsupported;
reconcile/handoff its pause before any normal code rollback.

## Evidence

Independent source review addressed binding, lock-order, debt, lost-finish and
foreign-volume-user gaps. Remote PostgreSQL/operator and source checks passed;
these do not establish production deployment or automatic-learning quality.

On `2026-11-02`, the real stock self-hosted run at `657f80b6a` completed native
first installation and idempotent reuse, built the normal application image and
started healthy stock Compose services. Actual web/API/worker Memory settings
matched the installed tuple. It then failed `startup-preflight`: the host INPUT
policy blocked the owned Compose bridge from the private native endpoint. This
stock run remains **FAILED**, not a continuous acceptance PASS.

A reviewed, exact three-rule temporary private ingress cycle made health checks
from all three roles and the real zero-entry/zero-command preflight pass. The
first resume continuation cleanly stopped the three owned native containers,
then refused before creating a resume journal. Actual Docker metadata used
`null` for each native container's absent entrypoint and omitted that field from
the image; the strict comparison rejected these equivalent representations.
That failed attempt and its evidence were retained, and the temporary rules were
removed with live kernel readback. No Save or Forget had been attempted.

Commit `b53b79d4c` normalizes only nullish entrypoints, retaining exact comparison
of nonempty arguments. Remote bootstrap tests passed **11/11 with zero skips**,
including both null/absent representations and refusal of a changed nonempty
entrypoint. Strict self-hosted/helper types, scoped lint and formatting passed.
The real recovery then used the normal low-level
`bootstrap('resume', savedConfig, ownedLoopbackApi)` from the known stopped state.
It completed at maintenance epoch **2** while the real Compose API retained its
original lifetime. Native IDs, images, saved bindings and existing state were
preserved; neither installation nor the application image build was repeated.

After positive finish, a fresh reviewed cycle of the same three private rules
allowed the real storage proof: Save published, read and recall succeeded, and a
foreign user was denied. Forget returned **`cleanup_pending`**. The native current
document was still present, while product read and subsequent recall excluded it,
proving logical fencing of pending native content. This is **not signed physical
Forget completion**. The exact temporary rules were then removed once, and the
normal ownership-checked sandbox decommission removed the three native
containers, both native volumes and every owned Compose container, volume and
network. Fresh read-only verification confirmed their absence, zero owned rules
and zero live rule matches; the other ten IPv4 rules and IPv6 rules were
preserved, with no reload or default-policy change.

This is a **retained-sandbox continuation PASS**, with application source
`657f80b6a69b8adf58dfddfd9002b1d24839867a`, application image
`sha256:cfb60317d806e71a188529dc4c39e6bc7dbc323c241ba763d44cffd898aa5ccf`
and committed host helper `b53b79d4ce518beb1ad2e40553ec2ca9d9116ecf`.
It does not relabel the failed stock run or verify production recovery. The
high-level `resumeMemory` configured-URL derivation was **not runtime exercised**;
the fixture used the supported explicit owned-loopback API interface. Sandbox
volume disposal is separate from a signed product entry-erasure receipt.
Conversation qualification remained absent; no paid model call or automatic
production activation was part of this acceptance.

Durable acceptance record: [sanitized source/image, hosted-job and evidence-hash manifest](evidence/2026-11-03-memory-selfhost-continuation.json).
The [private evidence archive](ssh://workers-fsn1-01-jump/srv/platform/artifacts/review-router/evidence/selfhost-recovery-b53-20261103.tar)
is retained in the operator artifact store with owner SSH access and root-only
permissions; archive SHA256 is
`22912f09ba544b48e368aef2503cdf9a069a377b2c587c3823569250a7d73a03`.
These hosted managed-job IDs are not GitHub workflow runs, so no Actions URL is
claimed for them. The manifest records every job and hashes the exact outputs.
The local receipt `tmp/memory-production/stock-selfhost-657f80/recovery-b53-receipt.json`
(SHA256 `6597201c1a240b34a94064702860a5e446f7b60b9246a299830bac94a6101e25`)
is supplemental. The [implementation PR](https://github.com/777genius/review-router-ai/pull/787)
tracks normal protected CI and rollout separately; self-hosted distribution
still requires exact-source completion.

## Continuous configured-URL acceptance seam

The stock runner now exports one inert, single-invocation lifecycle. Its default
CLI stays unchanged. An optional owned test-infrastructure callback runs after
real Compose health and before the first native preflight; it receives only
validated runtime identities and returns the owner's cached rollback operation.
Rollback is awaited before native, Compose or temporary-directory teardown.
Uncertain rollback retains the sandbox and fails acceptance.

A declared real HTTPS origin is installed in both normal API URL settings before
readiness, setup and Compose. The configured branch exercises actual
`resumeMemory`, which derives its URL and saved provider tuple from the env file.
No TLS bypass, DNS mapping or production flag is added. Remote helper/import
contracts pass 18/18 with strict types, lint and format. This source check does
not establish a continuous runtime PASS; actual TLS/ingress ownership and a
normal complete stock lifecycle remain pending.

A definite `/begin` refusal (HTTP 400/403/409) now settles as `aborted` only
when the existing fresh readback proves no owner, no pause and the unchanged
initial epoch, with no native start intent. A later normal invocation may archive
that terminal journal and try normally. Transport loss, changed epoch, another
owner or a paused state remain unresolved and cannot buy a new attempt. Two
source reviews approved this boundary. Remote bootstrap/stock contracts passed
49 cases; the conditional privileged cleanup case was not available inside that
QA container and retains its separate actual-server proof. All 46 evaluation
risk cases and the five distinct merged workflow-gate cases passed. Normal
release, installed behavior and continuous configured-URL acceptance are still
pending.
