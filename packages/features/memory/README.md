# Memory: canonical records and replaceable search adapters

The memory feature stores confirmed, distilled review knowledge in PostgreSQL and builds bounded review context from those records. Search engines are replaceable projections of that knowledge. Selecting Infinity Context changes retrieval and projection maintenance; it does not transfer ownership of confirmation, authorization, canonical content, or deletion policy to the provider.

The implementation follows the [adapter plan](../../../ai-docs/plans/2026-10-22-memory-engine-adapters.md) and its [three design critique rounds and implementation review record](../../../ai-docs/plans/2026-10-22-memory-engine-reviews.md). The governing decisions are [privacy](../../../ai-docs/decisions/018-balanced-memory-privacy-boundary.md), [authority](../../../ai-docs/decisions/021-balanced-memory-authority.md), [tenancy](../../../ai-docs/decisions/022-balanced-memory-data-residency-tenancy.md), [search capabilities](../../../ai-docs/decisions/024-balanced-memory-search-capability-contract.md), and [transactional outbox](../../../ai-docs/decisions/026-balanced-memory-transaction-outbox.md).

## Ownership and boundaries

| Responsibility                      | Owner and behavior                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical knowledge                 | PostgreSQL `MemoryItem`: confirmed body, scope, provenance, status, revision, and expiry.                                                   |
| Proposed knowledge                  | `MemorySuggestion` and the confirmation workflow. Pending proposals never become runtime review context.                                    |
| Authorization and context selection | Application use cases reload canonical records and enforce workspace, repository/user scope, active status, expiry, and exact revision.     |
| Retrieval                           | A search reader returns IDs, revision evidence, scores, and bounded explanation codes. The application obtains text from canonical storage. |
| External projection                 | The configured writer exports eligible confirmed bodies and tracks every potentially sent revision in durable receipts.                     |
| Delivery and cleanup                | Transactional outbox plus bounded worker reconciliation; neither requires a provider response to authorize a canonical mutation.            |

Canonical changes, their audit record, and their outbox event are committed in one database transaction. Outbox delivery may retry. Idempotency and revision checks make that compatible with remote writes.

Memory is distilled knowledge, not a transcript archive. Raw source code, diffs, prompts, review threads, model responses, and secrets are outside the memory privacy boundary. The external document contains the eligible distilled body and stable protocol metadata. Outbox payloads and projection receipts contain IDs, versions, hashes, and safe status/error fields, not a second copy of the body. Existing provenance is bounded by the privacy policy.

See the [transaction port](src/application/ports/memory-transaction-port.ts), [Prisma transaction](src/infrastructure/prisma/prisma-memory-transaction.ts), and [bundle use case](src/application/use-cases/build-action-memory-bundle.ts).

## Reader, writer, and queryability

The [search contract](src/application/ports/memory-search-index-port.ts) separates `MemorySearchReaderPort` (`supports` / `search`) from `MemorySearchWriterPort` (`indexIdentity` / `upsertDocument` / `deleteDocument`). The combined interface is available for composition, while consumers can depend on the narrower role.

A search hit certifies a **queryable exact revision in the configured index**. An upsert result of `indexed` has the same meaning. A request accepted by the provider, an uncertain HTTP acknowledgement, or a document merely existing remotely is insufficient.

The bundle use case still reloads canonical data and checks tenant/scope, active status, current expiry, and exact `bodyVersion` / `bodyHash` before using its text. It rechecks expiry after asynchronous retrieval. A provider's native `canonical_version` is not a Router body revision.

The legacy canonical `indexState` / `indexVersion` fields remain diagnostic fields used by the outbox's compare-and-set updates. They are **not a second read authorization or readiness gate**:

- An external write can be recovered from its durable receipt after its original acknowledgement was lost, while the canonical diagnostic fields still lag.
- An edit that keeps the same body can change metadata without requiring a new projection of that body.
- The default Prisma adapter searches current canonical rows directly, so it has no separately materialized text copy whose readiness those flags could describe.

Infinity proves readiness with exact indexed receipts. Its reader requires coverage for the current eligible records in the authorized scope before using the external search path. Returned native identities are resolved through receipts and checked against the expected source, generation, and document identity. Canonical validation remains mandatory after retrieval.

### Fallback is bounded

Capability discovery and search share a two-second application budget. Provider failures, unavailable capabilities, incomplete receipt coverage, and stale hits use the bounded canonical selection path. The default bundle policy permits up to 12 items and 6,000 characters. The canonical fallback applies the same authorization/status/expiry rules; it does not promise equivalent ranking or recall.

A healthy search with no matches also uses canonical selection, without being labeled a provider failure. A request without a search query uses normal canonical selection. Disabled memory produces an empty disabled bundle.

Fallback does not change the configured engine or discard its cleanup inventory. Keep the Infinity configuration during an outage. See the [bundle implementation](src/application/use-cases/build-action-memory-bundle.ts) and [Prisma search adapter](src/infrastructure/prisma/prisma-memory-search-index.ts).

## Composition and dependencies

The package root `@reviewrouter/features-memory` exports domain types,
application ports/use cases and the pure interaction interface. Concrete Prisma,
entitlement and configuration adapters are available only through the explicit
server-side `@reviewrouter/features-memory/infrastructure` entrypoint. Host
composition imports that entrypoint; policy and read-only consumers use the root.
The API retrieval route requires only `MemorySearchReaderPort`, so a reader does
not need dummy write methods or a deployment identity.

Use the server-only export `@reviewrouter/features-memory/composition`:

```ts
const runtime = await createMemorySearchRuntime({ prisma, env });

// Reader/writer roles are supplied to their respective consumers.
runtime.searchIndex;
await runtime.backfill({ limit: 100, afterId: previousCursor });
await runtime.maintenance({ limit: 10 });
await runtime.drain({ limit: 10 });
```

The API, worker, and operator CLI use the same configuration selection. The API retains its test injection seam. The host owns the borrowed Prisma client and its shutdown.

The [composition root](src/composition/index.ts) uses `@get-modular/core` and `@get-modular/assembly` **0.2.0**: declare the host dependencies and selected implementation, compile the composition, bind factories, prepare, and run once at process startup. Get Modular stays in composition. Provider DTOs and SDK calls stay in the Infinity infrastructure adapter. This is a fixed choice between explicit implementations, with no runtime plugin registry or hot reload.

Shared projection receipts belong to `infrastructure/projection`, independently
of a search engine. The Prisma receipt store implements that neutral contract;
it does not import the Infinity adapter. Provider configuration diagnostics are
classified inside the feature, so the operator CLI does not enumerate provider
fields. Adding an engine changes its infrastructure adapter, configuration,
composition and qualification coverage; application policy, API retrieval and
the dashboard remain independent of that choice.

The [package manifest](package.json) pins `@infinity-context/sdk` to the **sdk-v0.2.4 release tarball**:

```text
https://github.com/777genius/infinity-context/releases/download/sdk-v0.2.4/infinity-context-sdk-0.2.4.tgz
```

The adapter targets that exact contract, including its exact-document reconciliation behavior. Upgrading the SDK requires rerunning protocol and lifecycle tests. The [Foundation policy](../../../architecture/foundation/provider-seams.yaml) and [memory boundary qualification](../../../scripts/memory-foundation/qualify-boundaries.ts) check the dependency boundaries; they do not introduce a runtime framework.

## Configuration and startup

The default is `REVIEW_ROUTER_MEMORY_SEARCH_ENGINE=prisma`. Prisma uses canonical lexical search and has identity `prisma`. Its projection maintenance/drain operations are no-ops **after** the shared identity guard has succeeded.

Explicit Infinity configuration requires every field below. See [.env.example](../../../.env.example) and the [configuration parser](src/infrastructure/config/memory-search-config.ts).

| Environment variable                                    | Meaning                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `REVIEW_ROUTER_MEMORY_SEARCH_ENGINE`                    | `prisma` or `infinity`; an unknown value is an error.                                                                        |
| `REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL`                | HTTP(S) endpoint without URL credentials, query, or fragment. Normalized before identity calculation.                        |
| `REVIEW_ROUTER_MEMORY_INFINITY_API_KEY`                 | Credential with the required retrieval and document write/delete permissions. Never part of the identity or operator output. |
| `REVIEW_ROUTER_MEMORY_INFINITY_SPACE_ID`                | Pre-provisioned native space; at most 80 UTF-8 bytes.                                                                        |
| `REVIEW_ROUTER_MEMORY_INFINITY_MEMORY_SCOPE_ID`         | Pre-provisioned native scope; at most 80 UTF-8 bytes.                                                                        |
| `REVIEW_ROUTER_MEMORY_INFINITY_PROJECTION_GENERATION`   | Deployment projection generation; at most 256 UTF-8 bytes. Use a fresh value after a drain.                                  |
| `REVIEW_ROUTER_MEMORY_INFINITY_PROFILE_ID`              | Admitted retrieval profile; at most 256 Unicode code points.                                                                 |
| `REVIEW_ROUTER_MEMORY_INFINITY_CAPABILITY_FINGERPRINT`  | Expected profile capability fingerprint: 64 lowercase hexadecimal characters.                                                |
| `REVIEW_ROUTER_MEMORY_INFINITY_REQUIRED_PROVIDER_LANES` | Comma-separated list of 1–4 unique provider lane IDs admitted by that profile. Normalized to UTF-8 order.                    |

Identifiers must be nonblank and free of control characters and invalid Unicode scalars. Configuration does not provision native scopes, admit profiles, or configure providers. Obtain the profile, fingerprint, and lane IDs from the actual provisioned deployment; example lane names are not a discovery mechanism.

A deployment's native scope is a container. Router tenant isolation also requires the adapter's workspace/scope-derived source filters, generation constraints, receipt resolution, and canonical authorization. A native scope ID by itself is not the Router tenancy boundary.

The opaque `indexIdentity` hashes the normalized endpoint, native IDs, projection generation, and profile/capability/lane pins. Credentials are excluded, so rotating a credential for the same deployment preserves identity.

Startup performs database identity checks and **no Infinity HTTP request**. Both engine choices reject incompatible configuration while outstanding receipts for another identity remain:

- `memory_index_identity_conflict`: an incompatible identity still owns unsettled external projection inventory.
- `memory_index_generation_retired`: the selected identity has already been retired.

The same guard participates in atomic reservation/send admission; startup validation alone is not the concurrency fence. A service can start while Infinity is unavailable and use bounded fallback. Invalid explicit Infinity configuration still fails startup.

The worker's reconciliation defaults are:

```dotenv
REVIEW_ROUTER_MEMORY_PROJECTION_RECONCILE_INTERVAL_MS=30000
REVIEW_ROUTER_MEMORY_PROJECTION_RECONCILE_BATCH_SIZE=10
```

The interval must be positive and at most one day; the batch size is 1–100. The scheduler prevents overlapping maintenance passes within a worker process. Database guards handle competing processes. See [worker maintenance](../../../apps/worker/src/memory-projection-maintenance.ts).

## Durable projection lifecycle

The [receipt contract](src/infrastructure/projection/memory-projection-receipt-store.ts), [Prisma receipt store](src/infrastructure/prisma/prisma-memory-projection-receipt-store.ts), and [migration 000141](../../platform/db/prisma/migrations/000141_memory_search_projections/migration.sql) hold the durable export inventory.

| State          | Meaning                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `reserved`     | An eligible exact canonical revision has a stable receipt and sequence ordinal; sending has not been admitted yet. |
| `sent_unknown` | Send admission committed before HTTP. The request may or may not have reached or committed at the provider.        |
| `accepted`     | The native document ID is known; queryability has not yet been proven.                                             |
| `indexed`      | Exact provider readiness and the canonical revision have been validated.                                           |
| `deleted`      | This receipt's remote obligation is settled, or an unsent reservation was safely canceled.                         |

Deletion intent is separate from state so an acknowledgement arriving after an edit/delete cannot erase it. Admission locks the canonical row, checks current revision/status/expiry using current database time, and serializes against configuration retirement and delete intent. HTTP happens outside the database transaction.

Ordinary edits create a new body revision. Cleanup of a superseded export targets that exact revision; terminal deletion inventories all revisions for the item. Receipts survive canonical pruning and workspace deletion, allowing cleanup to continue after the original rows are gone.

Worker reconciliation is bounded and uses due ordering/backoff. It can recover lost acknowledgements, identify superseded/orphaned/expired records, and continue deletion. It does not revive dead-letter outbox events.

Infinity maintenance and deletion share one external-I/O budget per pass (five seconds by default), rather than multiplying that budget by the batch size. A pass stops before starting another receipt when less than the reconciliation minimum remains. Untouched receipts keep their schedule and error state; only attempted failures receive backoff. A successful exact-reconciliation capability is reused within that pass and refreshed on the next pass. Repeating deletion intent preserves an existing deletion retry schedule, so an earlier failed revision cannot repeatedly displace untouched revisions.

Maintenance `processed` counts receipts actually started; `pending` includes selected receipts left unattempted. Drain also checks remaining durable inventory before retiring an index identity. These counters describe one bounded pass, not a global inventory or guaranteed completion time.

### Unknown writes remain debt

If a send became uncertain, an absent lookup alone cannot prove that an old in-flight request will never commit. The adapter retains that debt rather than declaring deletion complete. A known native document can be deleted or its settled deletion verified with exact identity evidence.

There is no guaranteed bounded completion time for an unknown send. Timeouts and retry counts are not deletion proofs. Receipts contain no hidden body archive with which to reconstruct a deleted record. Preserve the old configuration, credentials, and provider access until the obligations are settled. The [Infinity adapter](src/infrastructure/infinity/infinity-memory-search-index.ts) is the source for reconciliation and cleanup conditions.

## Operator: backfill an existing deployment

The CLI uses the same composition/configuration as API and worker. Run commands from the repository root with the intended `DATABASE_URL` and deployment configuration. Explicit environment values take precedence over root `.env.local` and `.env`.

```sh
pnpm memory:index --help
pnpm memory:index backfill --limit 100
pnpm memory:index backfill --limit 100 --after mem_last_page_id
```

[Backfill](src/infrastructure/prisma/prisma-memory-projection-backfill.ts) scans one installation-wide page of active, nonexpired canonical IDs/revisions, ordered by ID. Default page size is 100; maximum is 500. It enqueues ordinary `memory.embedding.reindex.requested` events targeted to the current index identity. It reads no body for the event payload; the normal outbox handler reloads current canonical content before export.

Idempotency includes index identity, workspace, item, and body revision/hash. Repeating a page does not create duplicate events. Continue with `nextCursor` until it is `null`, and allow ordinary workers to process the queue.

A completed scan is **not a queryability assertion**. `enqueued: 0` may mean existing events; `nextCursor: null` means the scan reached its end. Receipt coverage still governs external retrieval.

### Blocked backfill and explicit retry

If a page's existing idempotent event is in `dead_letter`, the result includes its ID in `deadLetterEventIds`. The list is bounded by the page; it is not an installation-wide failure inventory. The CLI prints safe JSON and exits **2**, for example:

```json
{
  "command": "backfill",
  "scanned": 1,
  "enqueued": 0,
  "nextCursor": null,
  "deadLetterEventIds": ["outbox_event_id"],
  "deadLetterCount": 1,
  "code": "memory_projection_backfill_blocked"
}
```

Resolve the cause, then use the existing **authorized workspace Outbox retry action** for the reported event. The [retry use case](../outbox/src/application/use-cases/retry-dead-letter-outbox-event.ts) is workspace-scoped. Backfill and maintenance do not automatically revive the event or reset its retry budget. After explicit retry, the normal worker processes it; rerun the blocked page before proceeding with the cursor.

## Operator: disable, drain, and change engine

Setting `REVIEW_ROUTER_MEMORY_ENABLED=false` disables memory use through the service policy. It does not stop all writers, erase queued events, settle remote debt, or make a different index identity safe. Keep the existing Infinity configuration while maintenance continues.

To change endpoint, scope, generation, profile pins, or engine when external receipts exist:

1. Stop API/worker processes and any other processes that can write or export memory. Retain the **old** configuration and credentials.
2. Run a bounded drain pass, explicitly asserting the operational precondition:

   ```sh
   pnpm memory:index drain --writers-stopped --limit 10
   ```

3. If it exits 2 with `memory_projection_drain_pending`, retain the old configuration and repeat after the relevant provider/delivery condition is resolved. The command performs one pass, not an unbounded retry loop.
4. Once drain succeeds, change configuration. A recorded drained identity is retired; select a **fresh projection generation** before using Infinity again. Restart the hosts and backfill the new projection if needed.

`--writers-stopped` is an operator assertion; the CLI does not stop or discover host processes. The default drain limit is 10 and maximum is 100. `processed`, `deleted`, and `pending` describe bounded work and outstanding-debt detection, not an exact global inventory count. Unknown writes can keep drain pending indefinitely.

Switching to Prisma is subject to the same outstanding-receipt guard. Deleting receipt rows or changing configuration to evade the guard is not a supported migration procedure.

| CLI exit | Meaning                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| `0`      | The requested bounded operation succeeded; backfill completion is not full index readiness.                        |
| `2`      | Drain still has debt, or backfill found dead-letter events requiring explicit retry. Inspect the safe JSON `code`. |
| `1`      | Invalid arguments/configuration or an operational failure; stderr contains a fixed safe code.                      |

See the [operator implementation](../../../apps/worker/src/memory-projection-operator.ts) and [operator tests](../../../apps/worker/src/memory-projection-operator.test.ts).

## Reproducible validation and evidence limits

Use the repository's supported Node/pnpm toolchain, install dependencies, and generate Prisma using `pnpm db:generate`. Run these commands from the repository root.

### Unit and SDK protocol tests

```sh
pnpm exec vitest run packages/features/memory/src \
  apps/worker/src/memory-projection-maintenance.test.ts \
  apps/worker/src/memory-projection-operator.test.ts
```

Database suites skip without their explicit test database variables. The [SDK tests](src/tests/infinity-memory-search-index.test.ts) run the pinned real SDK against a [loopback HTTP protocol fixture](src/tests/infinity-protocol-fixture.ts), so local listening must be permitted. They exercise request/response validation and lifecycle failures without depending on a live provider.

### Real PostgreSQL and authenticated API/outbox flow

Use separate, disposable, empty PostgreSQL **17 or newer** databases. The following assumes a local `memory_test` role and port 5432; adjust local connection settings as needed.

```sh
createdb -h 127.0.0.1 -p 5432 -U memory_test reviewrouter_memory_test
createdb -h 127.0.0.1 -p 5432 -U memory_test reviewrouter_memory_api_test

MEMORY_E2E_DATABASE_URL=postgresql://memory_test@127.0.0.1:5432/reviewrouter_memory_test \
  pnpm memory:prepare-test-db

MEMORY_E2E_DATABASE_URL=postgresql://memory_test@127.0.0.1:5432/reviewrouter_memory_api_test \
  pnpm memory:prepare-test-db

REVIEW_ROUTER_MEMORY_TEST_DATABASE_URL=postgresql://memory_test@127.0.0.1:5432/reviewrouter_memory_test \
  pnpm exec vitest run packages/features/memory/src/tests/memory-projection-receipts.pg.test.ts

REVIEW_ROUTER_MEMORY_API_TEST_DATABASE_URL=postgresql://memory_test@127.0.0.1:5432/reviewrouter_memory_api_test \
  pnpm exec vitest run apps/api/src/memory-projection.e2e.test.ts
```

The [database preparation script](../../../scripts/memory-e2e/prepare-database.ts) rejects non-loopback hosts, unexpected names, nonempty schemas, and PostgreSQL versions below 17. It establishes the full current Prisma schema, applies actual projection migration 000141, and reconstructs the outbox tables with the initial DDL and actual fencing migration 000028. This setup **does not replay the complete historical migration chain** and is not a production migration command.

The [receipt suite](src/tests/memory-projection-receipts.pg.test.ts) exercises real PostgreSQL locking, admission, retirement, receipt coverage, and deletion races. The [API suite](../../../apps/api/src/memory-projection.e2e.test.ts) combines real Prisma repositories/transactions, authenticated API requests with a test-only GitHub OIDC verification seam, real fenced outbox delivery, and the real SDK talking to the loopback fixture. It covers confirmation, coverage/backfill, edit/delete races, lost acknowledgement and restart, privacy, and explicit dead-letter recovery including CLI exit 2.

### Architecture, types, and browser boundary

```sh
pnpm --filter @reviewrouter/features-memory typecheck
pnpm --filter @reviewrouter/api typecheck
pnpm --filter @reviewrouter/worker typecheck
pnpm architecture:check
```

Run gates sequentially. The architecture gate includes `foundation:qualify-memory`, which creates temporary negative-test source fixtures; do not run multiple copies against the same checkout.

The separate [browser qualification guide](../../../scripts/memory-e2e/browser-README.md) covers the under-development Memory UI and stale-action boundary. A paused UI does not suspend backend cleanup.

These tests establish the Router integration contract under controlled HTTP and real database conditions. They do not establish live Infinity deployment compatibility for an untested configuration, production provider health, semantic retrieval quality, scale limits, or improved code-review outcomes. Those require a provisioned live deployment and separate retrieval/review evaluation.
