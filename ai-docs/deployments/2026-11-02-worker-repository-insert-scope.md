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

| Environment | Status    | Actual version | Evidence   |
| ----------- | --------- | -------------- | ---------- |
| staging     | `pending` | Not verified   | No rollout |
| production  | `pending` | Not verified   | No rollout |

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
