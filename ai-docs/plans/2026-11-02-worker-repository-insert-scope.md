# Worker repository INSERT scope — bounded security correction

Date: 2026-11-02. Parent: [issue #761](https://github.com/777genius/review-router-ai/issues/761).
Baseline: `792afdc2031677e498d128af4c0594a857555726`.

## Invariant and ownership

The existing release first applies the canonical runtime ACL and then the narrowly
scoped, owner-authorized `deploy/hetzner/db-grants/worker-repository-sync.sql`.
That second step currently gives `reviewrouter_worker` column-level INSERT and
UPDATE on `RepositoryConnection`, but migration 000133 guards only UPDATE and
DELETE. A compromised worker can INSERT a connection whose workspace differs
from its GitHub installation's workspace. This is a cross-tenant integrity
violation; the PostgreSQL foreign keys independently validate each parent but
not their ownership relationship.

## Selected bounded fix

- In the existing post-ACL grant transaction, install an idempotent
  owner-controlled, SECURITY DEFINER, BEFORE INSERT ROW trigger on
  `RepositoryConnection`. For the real `reviewrouter_worker` LOGIN require:
  a GitHub row, a present GitHub installation, no GitLab installation/SCM
  identity, matching canonical GitHub IDs/source and an installation/workspace
  match checked under a row lock. Reject violations with SQLSTATE 42501.
- Fail closed if the installed trigger is disabled, altered or does not point
  to the expected owner-owned, search-path-pinned function. Do not grant INSERT
  before verifying it. Preserve existing migration-000133 first-binding guard,
  column-level permissions and activation advisory fence.
- Extend the **existing real PG17 LOGIN worker test**, not a mocked/superuser
  substitute: valid insert, wrong tenant/installation/provider/identity,
  missing parent, trigger tampering, idempotence and existing first-bind checks.
  Keep the existing CI job running this contract.
- Document the actual security boundary and the fact that the canonical ACL
  still revokes this grant on every release; the existing release script
  reapplies it after ACL. No production data, grants or replay by merging.

## Two critical design passes before implementation

**Pass 1 — privilege model and Clean Architecture.** Changing the accepted
canonical activation ACL and routine hashes would demand a separately
qualified re-provisioning of installed trust roots and broad PG17 security
contracts. Rejected that larger change for this task. Also rejected a generic
runtime query/analytics service and a new permission service. The fix belongs
at the existing database grant/trigger boundary, not inside Statistics or the
worker's business code.

**Pass 2 — adversarial integrity and rollout.** A foreign-key presence check
alone permits mismatched workspaces, while a SELECT without locking can race a
parent update. Require strict comparison of the parent installation's
workspace under `FOR SHARE` and fail-closed trigger metadata checks. Using
superuser or `SET ROLE` in tests would not exercise `session_user`; use a
real LOGIN worker. Avoid unconditional trigger DROP/recreate during grant;
a disabled or altered trigger must not be silently accepted. Restrict the
function's search path and PUBLIC EXECUTE. Include negative idempotent
re-application and tampering tests.

## Subsequent release-attestation compatibility

The rotating production writer capture enumerates all triggers on
`RepositoryConnection` and their functions. The new guard would otherwise be
rejected as an unrecognized object on the next release. The existing
receipt-bound catalog verifier now accepts precisely two staged inventories:
before the post-ACL worker guard exists, or with the **complete pinned**
operator-owned guard (binding, function-body SHA-256, owner, search path,
definer bit, trigger state and owner-only EXECUTE). Partial, disabled,
repointed or tampered versions remain fail-closed. No activation routine/trust
root hash or canonical read-only ACL acceptance is changed. Capture during the
canonical-ACL verification phase still expects runtime roles read-only; the
later post-ACL guarded worker grant is verified by its separate PG17 contract.

## Qualification and release boundary

1. Run the existing PG17 real-role worker repository-sync contract in CI.
   Require original 000133 first-binding, drift, grant and advisory-lock tests
   to remain green, plus new INSERT adversarial cases.
2. Require Static/Quality/DB and PG17 CI, self-hosted E2E and independent
   review on exact head. Inspect the last SHA and merge with GitHub branch
   protection, never a bypass.
3. Production/staging deployment remains separate and unverified. An
   authorized rollout must apply the post-ACL grant on the exact image,
   verify with the real worker role, inspect old dead letters (no automatic
   replay), then reconcile Statistics and repository inventory with upstream
   facts and record evidence.

**Explicit non-goals:** modifying accepted activation trust roots, shipping
new infrastructure/feature flags, changing analytics aggregation semantics,
claiming production completeness, or automatically replaying dead letters.
Issue #761 remains tracking the longer-term canonical ACL/routine decision,
even after this immediate INSERT hole is guarded.
