# Worker repository INSERT workspace fence — deployment

- Task ID: `2026-11-02-worker-repository-insert-scope`.
- Implementation: [PR #783](https://github.com/777genius/review-router-ai/pull/783).
- Tracking risk: [issue #761](https://github.com/777genius/review-router-ai/issues/761).
- Scope: owner-controlled post-ACL grant and BEFORE INSERT guard for the
  worker's GitHub `RepositoryConnection` creations. No application feature,
  schema migration, key rotation, new service or flag.
- Code-only merge does **not** enable the guard in an already-running database.
  The canonical ACL continues to revoke the worker's grants. Do not skip the
  ordered post-ACL grant step or treat this as a canonical ACL trust-root repair.

| Environment | Status    | Actual version            | Evidence                                                                    |
| ----------- | --------- | ------------------------- | --------------------------------------------------------------------------- |
| staging     | `pending` | Not verified              | No rollout                                                                  |
| production  | `pending` | Fleet remains `57cc15137` | Official226 grant attempt stopped after durable denial; guard not installed |

## Release attestation ordering

The rotating-writer catalog captures all `RepositoryConnection` triggers.
It now explicitly recognizes the installed worker INSERT guard only with its
exact operator-owned function/trigger/ACL signature, and still rejects unknown
objects and drift. An environment without this separately installed grant can
be attested in its canonical-ACL phase; this is **not** proof the post-ACL
worker INSERT is live. The release attestation's canonical read-only runtime
ACL and its pinned activation trust roots remain unchanged. Do not run the
canonical rotating catalog verifier against post-ACL worker-granted runtime
roles and mistake the intended read-only failure for a guard failure.

## Ordered qualification and rollout

1. Before changing a target database, verify the selected app revision/image,
   installed migrations, privileges, active 000133 referential guard, authorized
   operator, release backup and recovery/rollback plan. Reconcile the exact
   release tasks through the standard release runbook.
2. Require exact-head CI including the real PG17 `reviewrouter_worker` LOGIN
   grant/INSERT contract and no regressions to first SCM bind, canonical
   activation fence or worker claim behavior. A passing superuser-only test is
   insufficient.
3. In an authorized release, apply the normal canonical ACL first, then the
   unchanged-position `deploy/hetzner/db-grants/worker-repository-sync.sql`
   through the approved owner-controlled runner. It **commits revocation** of
   all worker table/column INSERT+UPDATE rights first, holding a session-level
   activation advisory lock across both transactions. The second transaction
   installs and verifies the owner-owned INSERT trigger **before** regranting
   worker INSERT. Absent, altered or disabled guard leaves writes revoked;
   explicit owner repair is needed before recovery. The same post-ACL denial
   makes `GitHubInstallation` immutable to the worker while preserving the
   API-owned webhook installation writer. Never bypass the guard.
   Initial creation uses the approved `reviewrouter_pg` session's existing
   superuser authority only while the fixed function is absent. The application
   object owner `reviewrouter` has no CREATE on `public`; no schema privilege or
   owner change is authorized. The transaction-local installer restores
   `reviewrouter` before existing exact owner/body/trigger checks and grants.
   Conflicting existing objects remain fail-closed and require separate repair.
4. Verify under the actual worker LOGIN: same-installation, same-workspace
   GitHub inventory INSERT succeeds; cross-workspace, foreign-installation
   and mismatched repository IDs yield SQLSTATE 42501. Confirm no broad table
   write grant, forbidden SCM identity insertion or retarget permission.
5. Observe one authorized `installation.sync_requested` event through worker
   completion, inspect newly introduced permission dead letters, reconcile
   repository inventory and Statistics/Usage counts. Do not automatically
   replay historical dead letters; verify source and idempotence before any
   separately approved redrive.
6. Record installed revision, migration/ACL+guard order, UTC verification,
   fleet health, protected database role and links to durable evidence in this
   record before marking `deployed`.

## Rollback and outstanding policy

Rollback must be planned with the approved release source of truth. For an
incomplete grant step, fail closed; never grant unguarded INSERT to restore
repository synchronization. Do not remove the guard or lower owner/runtime
boundaries to make a failed verification pass.

This PR protects the immediate worker INSERT tenant invariant but **does not**
change canonical activation routine hashes or the installed owner trust roots.
Resolve that separate design in issue #761 with full security/release qualification
rather than modifying accepted activation policy in this small patch.

## 2026-11-03 owner-installation compatibility failure

At approximately 04:01 UTC, the ordinary official226 operation using source
`6e6a0f07829c465202512f87fb6a3195412ca347` completed migration reconciliation
and canonical runtime ACL application. The guarded worker grant committed its
first durable denial, then the second transaction rolled back at CREATE FUNCTION
with permission denied on schema `public` under `SET LOCAL ROLE reviewrouter`.
No INSERT guard was installed; worker writes remain revoked. The application
fleet still runs source57, so the guarded post-ACL step is **not deployed**.

The old disposable fixture made `reviewrouter` the effective public schema owner
via database ownership, hiding its missing production CREATE privilege. The
bounded correction uses only the approved session owner's already-existing
superuser authority to create and transfer the absent fixed function, then
restores the application role. It preserves the exact guard body/owner/ACL and
trigger checks, durable denial, activation fence and schema ACL. No policy trust
root, migration or new privilege is introduced. A separate extra canonical
catalog diagnostic reported legacy owner/check/ACL mismatch; that is not this
CREATE failure's cause and adds no new rollout gate.

The corrected source requires focused real PG17 qualification, normal PR/CI and
merge, followed by the single release owner's separately approved corrected
SQL step. Do not replay already-completed migration/ACL phases, bypass denied
writes, or mark the grant deployed from source-only or disposable results.
