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

All public contract parsers inspect the complete source graph through descriptors
before cloning: accessors (without invocation), symbols, non-enumerable surprise
properties, custom prototypes, sparse arrays and array surprise keys are rejected.
Cycle-safe inspection precedes exactly one structured clone; field validation and
the returned object use only that detached graph. Clone failures and invalid cyclic
contract values become `invalid-contract`.

Authority resolution and publication enqueue each have a 5,000 ms default I/O
budget (constructor argument three accepts an integer from 1 to 60,000 ms).
Resolution stays inside the serializable scope transaction. Expiry rejects with
`io-timeout`, invalidates the port budget, and rolls back the ledger draft, allowing
other scope operations to proceed. Late resolution cannot resume ledger changes.
The monotonic deadline is checked even if timer delivery is delayed. This bounds
asynchronous port waits, not blocked JavaScript execution or repository acquisition,
commit, or rollback; production repository adapters must bound those themselves.

Publication enqueue has bounded-wait semantics, not durable remote commit fencing.
An `AuthorityError` with code `io-timeout` exposes `effect: "none"` for
read resolution and `effect: "unknown"` for enqueue. A timed-out enqueue may
already have committed or may commit later, even after AbortSignal fires.
Adapters **must** deduplicate by `intentId`, including overlapping retries.
The pending intent remains retryable with the same ID; a late completion cannot
mutate the ledger or mark it dispatched. Cooperative `budget.assertActive()`
checks do not cancel remote commits. Tests cover scope release, late external
effects, ledger isolation and idempotent retries.

Package exports remain unchanged: source `types`/`default` with production `dist`
follow the existing feature-package convention (for example `api-demo` and `outbox`).
