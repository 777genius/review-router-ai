# Explicit locked Memory resume

- Goal: recover a completed standalone Memory installation after an explicit
  stop or reboot without recreating native state or weakening physical Forget.
- Affected targets: Memory operator API/store, all Router command writers,
  standalone native bootstrap/setup and stock self-hosted lifecycle acceptance.
- Source: uncommitted successor batch after `aa99`; no release/image assigned.
- Dependencies: [Memory startup](2026-11-01-memory-production-startup.md),
  [cleanup inventory](2026-11-01-memory-bootstrap-cleanup.md),
  [conversation delivery](2026-10-29-conversational-memory.md) and the existing
  [release process](../operations/07-environments-and-release-management.md).

| Environment | Status    | Actual version                                                     | Remaining work                                                                                                |
| ----------- | --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| production  | `pending` | Core `57cc1513` / image `3550f3c7` unchanged; resume not activated | Exact-source remote checks, coherent normal release and applicable operator acceptance.                       |
| self-hosted | `pending` | Source implementation only                                         | Remote PostgreSQL/operator checks, real stock installation/stop/start acceptance, normal distribution/update. |

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

Independent source review of the first coherent implementation passed; identified
binding, lock-order, debt, lost-finish and foreign-volume-user gaps were addressed.
Remote formatting/types/contracts and real PostgreSQL/native lifecycle execution
are pending. There has been no deployment, reboot, native lifecycle effect, model
call or activation from this preparation. No acceptance PASS is claimed.
