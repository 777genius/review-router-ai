# Private Hindsight qualification and operation

This directory prepares the native memory backend; it does not enable memory or
deploy infrastructure. Hindsight owns approved source text and native memory
processing. Router owns authority, application revisions, ordered commands,
eligibility/deletion fences and temporary approved delivery envelopes.

## Reproducible qualification

Requirements: Linux, Node 24, Git, Docker, and network access to the public pinned
native source and OCI releases. No inference credentials or downloaded ML models
are used by the qualification harness. The inference fixture implements only
declared deterministic embeddings, reranking and consolidation protocol cases;
an unscripted LLM call fails the run.

Run `.github/workflows/hindsight-memory-qualification.yml` on the reviewed branch.

The malformed-consolidation probe changes a bank from observations disabled to
enabled, then restarts both existing worker containers before retaining its
fault input. Native 1.1.0 caches bank configuration per process for 30 seconds;
the API's configuration edit invalidates only the API cache. Without refreshing
the workers, retain can skip consolidation enqueue using its previous disabled
configuration and leave the probe waiting for the separate 300-second reconcile
tick. The restart preserves each container's image, identity and environment;
the probe still requires an actual malformed provider response and terminal
native operations before checking private sinks. A source-pinned cache
regression executes the native cache implementations and post-insert enqueue
gate, while the Docker workflow remains the lifecycle qualification authority.

It clones the exact upstream source, resolves immutable API-only/PG17 image
inputs, verifies the bounded patch, builds the derivative and tests real HTTP
API, two separate native workers and isolated PostgreSQL17/pgvector. It uses a
dedicated non-superuser DB role after explicit extension/bootstrap work. Native
database ownership includes required runtime index DDL; it is not DML-only.

For an already prepared local runtime:

```bash
node scripts/hindsight-e2e/prepare-hardening.ts /path/to/pinned-hindsight /tmp/hindsight-build
docker build --build-arg HINDSIGHT_BASE_IMAGE=ghcr.io/vectorize-io/hindsight-api@sha256:REVIEWED_DIGEST -f deploy/hindsight/Dockerfile -t reviewrouter-hindsight:qualified /tmp/hindsight-build
HINDSIGHT_SDK_ENTRY=/path/to/verified-sdk/package/dist/index.mjs HINDSIGHT_QUALIFICATION_IMAGE=reviewrouter-hindsight:qualified HINDSIGHT_QUALIFICATION_POSTGRES_IMAGE=pgvector/pgvector@sha256:REVIEWED_DIGEST node --experimental-transform-types --import ./scripts/hindsight-e2e/register-native-runtime.ts scripts/hindsight-e2e/qualify-native.ts
```

The gate covers named `chunks` strategy/readback, scoped native storage, UUID
retry identity, same-body event-time preservation, online replace/retire, topic
movement, provider 4xx/5xx echo failures, malformed consolidation, HTTP validation,
native readiness failures and diagnostic sinks. It then stops every API/old/new
executor, verifies process exit and DB-session closure, proves maintenance-off
cleanup does not execute a queued sentinel, discovers historical parents/leaves
with pagination, removes terminal payloads and verifies absence after restart.
These are native protocol/storage/failure guarantees with deterministic inference;
they establish no actual selected-model semantic quality benchmark.

The same run executes the actual production SDK adapter and the production Docker
cleanup operator. Its cleanup fixture first produces a real derived observation
and a native consolidation update with nonempty persisted history, then verifies
physical history/source/payload absence after restart and signs the observed
receipt. The Router maintenance HTTP attestation in this native-only fixture is
synthetic and is recorded as such in `qualification-boundary.json`; the actual
Router maintenance transport barrier requires separate real-PostgreSQL application
qualification. Unit/contract success and source inspection do not establish a
native-image runtime pass. A release requires the completed CI evidence artifact.

For local runs, `HINDSIGHT_SDK_ENTRY` must point at the exact release archive whose
SHA512 is checked in the workflow and package lock. The small Node loader resolves
that real SDK and application TypeScript sources without a full repository install.

## Normal private service profile

API command: `hindsight-api`; standalone executor command:
`hindsight-worker --http-host 0.0.0.0 --http-port 8889`. Both use the same reviewed
immutable derivative image. Copy `profile.env.example` to the deployment secret
configuration and supply dedicated native database/service/inference credentials.
Set a stable unique executor ID and a traceable process/generation-specific
PostgreSQL `application_name`. Run bounded `hindsight-admin run-db-migration` as a
release/admin job; disable startup migrations on long-running services.

Use a separate private PostgreSQL17 database, pgvector and native text search.
Bootstrap extensions with admin authority, then run native migrations/services
under isolated bounded ownership without superuser or access to Router's DB.
Set and verify the DB logging profile in PATCH-RECORD.md. Keep API and worker
ingress private; no direct customer/admin mutations outside Router ordering.
MCP, uploads, bodyful audit, LLM traces and request/error body dumps stay disabled.
Store only approved distilled statements as document text. Retention of native
operations must exceed the application's bounded unresolved-command horizon.
The exact horizon is a release configuration gate shared with Router metadata;
operation absence cannot establish non-execution after retention.

The qualified retry profile sets **both** `HINDSIGHT_API_OPERATION_RETENTION_DAYS=0`
and `HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS=0` on every API and worker.
In native 1.1.0 zero disables pruning. This preserves the parent UUID row that is
the native concurrency/replay authority. The native gate verifies those resolved
settings for every executor and exercises concurrent identical UUID submissions,
a committed native request with its HTTP acknowledgment discarded, and one
ambiguous status 404 followed by exact-UUID replay. It checks that one executable
child remains and source fact IDs stay stable.

Router's `REVIEW_ROUTER_MEMORY_RESUBMIT_WINDOW_MS` defaults to `0`; explicit
integer windows up to 24 hours are accepted only with the exact Hindsight profile.
Enable a positive value only after final-image qualification and verification of
the deployed no-pruning settings. Delivery retention may be longer than this
window; its expiry never proves non-execution. Retries keep the original bank,
generation, UUID and immutable approved payload, and require current application
permission under its delivery fence. Forget/revocation disables resubmission.
Native service credentials are private to ordered Router paths; manual operation
deletion or native pruning outside the paused bound cleanup procedure invalidates
this retry profile. Keeping terminal UUID rows/payloads indefinitely grows native
storage; monitor capacity and use the physical-forget operator to purge all
associated historical payloads when forgetting an entry.

Probe `/health/live` for process liveness and `/health/ready` for DB readiness;
monitor queue lag, poll age and native metrics privately. Render private service
provider checks are TCP-only, so internal HTTP/poll monitoring remains necessary.
Native memory health is feature-local and does not fail ordinary Router reviews.
Inference provider/model/dimensions, data egress and multilingual quality require
their own recorded release choice; self-hosted storage does not imply local inference.

## Initial physical forget: complete operator pause

1. Router records the current entry's irreversible forget fence and command,
   increments/binds a global pause epoch and pauses every submission/retry path.
   Ordinary reviews continue with no memory. Do not return cleanup complete yet.
2. Inventory **all** native executors, including API internal workers and every
   old/rolling replica. Stop them and observe actual process/container exit.
   Verify matching DB sessions have closed/rolled back. A sent signal, cancelled
   native operation, failed health probe or provider suspend acknowledgment is
   insufficient. An incomplete inventory leaves cleanup pending.
3. Start a private cleanup-only API from the same qualified image with API worker
   and migrations disabled, plus all four maintenance cadences set to `0` as in
   `profile.env.example`. Confirm resolved configuration and that a queued sentinel
   cannot execute. Fence ordinary mutation ingress throughout the window.
4. Snapshot tracked and historical retain parent/child identities, including work
   requeued by shutdown. Enumerate public operations with complete pagination.
   Cancel queued/requeued leaves and terminalize parents; do not delete a child
   while its parent remains active. Delete the document, then associated terminal
   operation payload rows. Verify document, facts/evidence and payload absence.
5. Clear Router's approved delivery envelope under the same forget fence. Restart
   native processing with fences retained and verify absence again after remaining
   work settles. Only a verified receipt bound to the current scope, generation,
   entry, command, image and pause epoch may complete application cleanup.

The first operator execution tooling supports a complete Docker host inventory.
Render cleanup remains pending until its host/executor exit and DB-session proof
can satisfy the same barrier. Do not turn a Render pause acknowledgment into a
Docker process-exit receipt. Normal successful replacements and retirement stay
online; this broad pause applies to physical forget closure only.

### Signed Docker operator receipt

`scripts/hindsight-e2e/cleanup-operator.ts` takes a reviewed JSON plan and an output
receipt path. The plan names `profile: docker-complete-inventory-v1`, the stored
forget binding, `nativeBankId`, an authoritative
`io.reviewrouter.hindsight.deployment=...` label, every executor container ID,
the API container ID, the subset of current containers to restart, tracked native
operation UUIDs, `deploymentLockPath`, `sourceInventoryPath`, and an
authenticated `routerPauseCheckUrl`. API/worker containers carry role labels
`io.reviewrouter.hindsight.role=api|worker`. The initial host profile requires
the native DB URL to point at a loopback PostgreSQL17 process. Every read-only SQL
observation connects through the **actual inspected API DSN** from the exact native
image; no plan-selected PostgreSQL container can supply absence evidence.

The supported deployment mechanism is standalone Docker with Swarm inactive,
automatic container restart disabled (`--restart=no`), and no Compose, Swarm or
Kubernetes reconciler. Create an operator-owned mode0700 directory and use the
same mode0600 `deploymentLockPath` for every launch, start, stop, replacement and
cleanup operation. The executable launcher acquires a real Linux `flock`:

```sh
node scripts/hindsight-e2e/deployment-lock.ts /srv/reviewrouter/hindsight-operator/deployment.lock docker start EXACT_CONTAINER_ID
```

Run every deployment mutation through that wrapper. The cleanup CLI acquires and
holds the same lock through cleanup and restart, checks the lock inode and actual
OS exclusion, and repeatedly verifies the complete Docker inventory and each
expected stopped/running process state. The current API and at least one separate
worker must restart. A host with an unowned launcher, reconciler or unknown replica
is unsupported. A privileged administrator bypassing the agreed deployment
controller is outside this host profile's guarantee.

Supply `HINDSIGHT_OPERATOR_NATIVE_SERVICE_KEY` and a **different**
`REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN`. Supply an independently managed Ed25519
private key file (mode 0600), public key file and registered key ID via
`HINDSIGHT_CLEANUP_SIGNING_PRIVATE_KEY_FILE`,
`HINDSIGHT_CLEANUP_SIGNING_PUBLIC_KEY_FILE` and
`HINDSIGHT_CLEANUP_SIGNING_KEY_ID`. The signing key is never the native service key.
The pause endpoint returns the current server-derived `binding`,
`submissionsPaused: true`, and `maintenance: {generation, epoch, paused:true}`.
The numeric `binding.pauseEpoch` must equal that live durable maintenance epoch.
The Router pause operation first obtains its exclusive transport drain barrier;
a plan-supplied pause boolean is insufficient.

Before any target deletion, the CLI writes a mode0600, signed and fsynced inventory
of nonempty source fact IDs, related observation IDs and the recursively closed
operation graph to `sourceInventoryPath`. Keep this file across retries. A retry
authenticates and reuses the same command/generation/pause-bound inventory, so
already-deleted facts cannot make observation-history verification vacuous. An
absent document without authenticated pre-delete inventory, a partial/corrupt
inventory or changed source/operation set leaves cleanup pending. The file contains
identities and proof metadata, without approved prose. Never replace it with an
empty inventory to force completion.

The CLI observes exit/session/configuration/queued-sentinel/native absence and
restart readiness itself. It signs only after every check succeeds; any failure
keeps cleanup pending and leaves Router submissions paused. Receipt verification
uses the current stored command's namespace, generation, scope digest, raw-UTF8
SHA256 of the mapped native bank ID, entry ID, forget-command UUID, exact native
image ID and pause epoch. The server must atomically recheck the current global
pause/fence before accepting completion. Receipts expire after 15 minutes and
cannot cross entries, scopes, generations, images, commands or pause epochs.

The complete host inventory is a deployment prerequisite. A signature cannot
discover unknown external executors; an unowned host/replica or incomplete label
inventory makes this profile unsupported. Mixed-source retain batches, more
than 1,024 relevant operation identities, missing history/evidence or failed
restart readiness leave cleanup pending. The CLI scans current and archived
source facts, observations and public observation-history support. It provides
read-only checks of persisted history for known source and observation identities,
including history whose observation is already absent from the public API. It provides
no semantic erasure repair and does not claim model-generated old prose has been
removed when native evidence cannot establish that postcondition.

## Recovery and upgrade

Back up native storage and Router metadata with a generation/recovery manifest.
Restore privately with memory disabled; reconcile current deletion/revision/command
fences before serving. If both databases restore to snapshots before a completed
forget, those snapshots cannot prove that deletion: recover independent newer
metadata/WAL evidence or keep affected memory fenced. Reapproval alone does not
authorize resurrecting forgotten text. A backup file without an RPO and retained
post-backup deletion evidence is not a supported restore receipt. Rehearse native
migrations on a disposable restored database; no schema rollback is assumed.
