# SDK growth authority (RR-1)

Product-neutral domain/application core with pure constructor injection. It stores
only authority metadata and digests. No production route or provider is activated.
The existing workspace glob discovers this package; its lockfile importer is empty.

`request(identity, body)` resolves canonical revision and owner evidence through
`CurrentAuthoritySnapshotPort`. The body selects repository/PR and an idempotency key; it cannot
supply bindings, approval or expiry. Authentication adapters must establish the
identity of the pinned verifier execution independently of candidate input. The
snapshot adapter must authorize that principal against the repository and immutable
verifier custody. It must also authenticate actual owners and current approval.
An arbitrary JSON file, digest, model verdict or same-name CI job proves none of this.

The port resolves Identity+Request into a detached canonical `Binding` and matching
`OwnerEvidence` from one current authority version/epoch. The adapter must fence the
entire resolution, including owner revocation/replacement and every canonical field:
if that epoch changes before resolution finishes, reject the pair. An atomic read or
shared transaction/version fence across all authority sources must prove consistency;
alternating independent reads cannot implement this contract. Missing, closed,
unauthorized or unavailable snapshots return null or reject, and fail closed.
`request` and every live validation (`complete`, `currentReceipt`, pending `dispatch`)
use this single port; historical idempotent replay retains its existing semantics.

Request IDs are scoped to tenant/repository/PR. Each new request advances that
scope's fence across subjects. A grant binds the entire revision/toolchain/evidence
snapshot. Completion requires the same identity, live fence, unchanged canonical
bindings and unchanged current owner evidence. Partial, missing or extra coverage
always yields a non-admitting receipt. Reusing a completion with different content
conflicts; identical replay returns the original receipt even after expiry/revocation.
Historical replay never restores authority or queues a second publication intent.

The repository transaction retains the receipt and pending intent atomically.
`dispatch` retries an idempotent outbox handoff; lost acknowledgements are harmless
only when the existing outbox adapter deduplicates `intentId`. `currentReceipt`
revalidates live authority. A future publisher must call it and fence its provider
write against newer intents and authority changes. Snapshot resolution is not a lease:
authority must be revalidated and fenced at publication time. An intent/receipt alone is not publication permission.

`testing` exports an epoch-fenced snapshot fixture with a deterministic resolution
pause hook (every replacement advances the epoch), plus a serializable, rollback-capable in-memory conformance adapter.
Production storage must implement the documented transaction contract with durable
fences/tombstones and cross-process serialization, using existing infrastructure.
No Prisma migration is needed for this unactivated core; durable adapter integration,
GitHub checks and runner composition are separate work. No source/diff is retained.

Validation from the repository root:

- `node node_modules/vitest/vitest.mjs run --configLoader runner packages/features/sdk-growth-authority/src/tests`
- `node node_modules/typescript/bin/tsc --noEmit -p packages/features/sdk-growth-authority/tsconfig.json`
- `node scripts/check-architecture-boundaries.mjs`
