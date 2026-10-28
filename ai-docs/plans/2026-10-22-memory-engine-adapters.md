# Memory engine adapters and temporary dashboard pause

## Status and scope

Implementation plan, revision 3, cleared by three sequential independent
critique/fix rounds before implementation. Owner request: replace the Memory
dashboard with an honest under-development message, make the memory engine
replaceable, integrate the first Infinity Context SDK adapter, test the complete
changed paths, publish a PR and address review findings. Push each coherent
checkpoint. The initial delivery scope excluded merge and deployment.

Follow-up owner request, after the initial PR delivery: deepen the dependency
audit, improve the paused screen with existing shared components, repeat
independent implementation criticism and visual qualification, then merge the
verified PR. That request authorizes merge after these checks; it does not
activate Infinity or restore dashboard memory functionality. The accepted
canonical storage and lifecycle decisions remain unchanged.

Baseline: ReviewRouter `dfda0b419c2b713903d033662b03992cf5a3e4a7`.
The organization Engineering Quality Standard was read at
`agent-teams-ai/.github@1b17053bc92766742fec2329ee153171395e658e`.
Accepted memory ADRs 018–024 and 026 remain authoritative and unchanged.
The owner's explicit temporary UI pause supersedes the active-layout requirement
of ADR-025 for this delivery. Preserve that accepted ADR and its reference PNGs;
record the pause in the design README and this plan, without another approval.

## Product guarantees

1. The dashboard Memory section contains only a static development notice. It
   does not fetch memory records, render forms, offer simulated controls or call
   memory APIs. The existing main-page notice is retained and shared with the
   preview route; remove the unreachable production manager branch. Preview flags
   and old mode/query parameters cannot restore controls. Stale dashboard
   mutation submissions are refused. Existing
   canonical records are retained; internal lifecycle/recovery paths remain.
2. PostgreSQL owns confirmed memory, permissions, scope, revisions, expiry and
   audit/outbox transactions. An external engine owns only a derived search
   projection. Provider-generated text never becomes an approved memory item.
3. Application use cases consume provider-neutral contracts. Adding another
   engine changes infrastructure/composition and its contract tests, not memory
   policy or dashboard code. This is an extension boundary, not a claim that
   every third-party engine already meets the contract.
4. Search failure, unsupported capability, stale results or an incomplete
   multi-scope response degrade to canonical fallback within a bounded deadline.
   The default remains the existing PostgreSQL lexical adapter. Infinity is an
   explicit deployment configuration, never silently enabled.
5. Index writes are idempotent for an exact canonical revision. A transport
   timeout is not success or proof of absence. Durable metadata retains unknown
   write/delete outcomes for reconciliation; no raw body is copied into that
   metadata, audit records or outbox events.

## Ownership and interfaces

Keep `@reviewrouter/features-memory` and the accepted
`MemorySearchIndexPort` name. Split the consuming interface into read and write
capabilities while retaining the composite interface for adapter construction:

- retrieval consumes `supports` and `search`;
- the outbox consumes `upsertDocument` and `deleteDocument`;
- the application owns provider-neutral search inputs and hits;
- Infinity SDK types, capabilities, profile pins, locators and HTTP translation
  stay in `infrastructure/infinity`;
- server-only `./composition` owns adapter selection and Get Modular assembly;
- host processes own the borrowed Prisma connection and process lifetime.

Search hits identify the canonical item plus `bodyVersion` and `bodyHash`.
Scores are ordered within an adapter; provider scores are never mixed across
engines. Score breakdowns are optional diagnostics, not invented numbers.
Canonical reload verifies workspace/repository/user, active status, allowed
scope, expiry and the exact revision before accepting a hit. Queryability belongs
to the selected adapter; legacy canonical `indexState/indexVersion` are diagnostic
outbox fields, not a second read admission gate. Implementation review proved
that recovery and a concurrent same-body edit can leave these fields stale even
when the exact provider revision is queryable. Apply policy before
declaring search successful, so disallowed-only results cannot suppress fallback.
Allowed scopes are derived from trusted policy and actor context before external
IO and passed to canonical retrieval before its limit, so forbidden records
cannot exhaust the fallback budget. Search uses an absolute deadline/cancellation
carrier, also enforced by a bounded
outer call so a misbehaving adapter cannot stall a review indefinitely.

Index writes return an explicit indexed/superseded outcome. Only an indexed
outcome can trigger the existing conditional `markIndexingSucceeded`; check its
updated count. If the canonical revision changed during remote IO, clean up only
that exact exported revision. Do not delete a newer revision through an item-wide
cleanup. Express this in the neutral port as an explicit exact revision target
(`bodyVersion` and `bodyHash`) versus an all-revisions item target; do not expose
SDK locators. Delete resolves only when the requested known exports are confirmed
deleted or safely never sent; uncertainty throws a sanitized retryable error.
Terminal item deletion removes all inventoried exports for that item.

## Durable projection metadata

Add one additive adapter-state table and a narrow infrastructure-owned repository
contract for
projection bookkeeping. It contains no memory text: engine namespace/generation,
workspace/item identity, canonical body version/hash, scope identity, a database
sequence ordinal, remote document ID when observed, and reconciliation state.

- Reserve an exact revision only while the canonical item still matches and is
  active. The reservation is durable before any HTTP write.
- Database uniqueness provides stable retries and collision-free int32 ordinal
  allocation. Reject exhausted ordinals instead of hashing UUIDs into integers.
- Namespace binds endpoint, native space/scope IDs, profile identity and
  projection generation without credentials. A different identity, including
  switching to Prisma, is rejected at startup while nondeleted/unknown Infinity
  receipts remain. There is one configured backend identity in this slice.
- Startup validation is not a concurrency fence. Reservation and send admission
  recheck identity under the same PostgreSQL transaction advisory lock, so two
  fresh workers configured for different endpoints cannot both export. A
  reserved-to-sent CAS also rechecks current active canonical revision and delete
  intent; a cancelled never-sent receipt can never dispatch later.
- Distinguish reserved, sent/unknown, accepted/indexed and deletion debt. A
  response may settle the remote document ID without clearing concurrent delete
  intent. No body or credentials are stored in the table.
- An absent reconciliation response cannot close a previously sent unknown
  write: the old request could still commit. Keep that debt retryable/visible
  rather than claim deletion. If canonical text is still active, the same
  idempotent request can be retried; after deletion it must not be reconstructed
  from a hidden text copy.
- On an acknowledged write, reconcile queryability before reporting indexed.
  Superseded acknowledged documents are deleted by exact receipt. Cleanup is
  bounded per attempt and reuses the existing outbox retry/dead-letter mechanism.
- Preserve receipt metadata across canonical terminal-record pruning. Backend
  rotation/rollback must retain access to outstanding cleanup generations.
- Receipt identity columns have no cascading foreign key to canonical records.
  A bounded step in the existing worker maintenance loop reconciles missing,
  terminal, expired and superseded canonical items, even when their workspace,
  repository and original outbox rows have already been removed. Due-time
  ordering/backoff prevents permanent unknown debt starving later cleanup.

Provide a narrow operator command for backfill/drain. Backfill uses bounded
canonical pages and generation-specific idempotent existing reindex events; it
does not copy bodies into events. Before searching Infinity, an indexed-receipt
coverage query (`NOT EXISTS`) verifies all active, nonexpired, authorized current
canonical revisions in that scope. Until coverage is complete, use degraded
canonical fallback. The old canonical `indexState` does not certify a new engine.
This uses the same receipt table, not a second readiness state machine.

Drain requires the operator to stop API/worker writers first, retains the old
validated Infinity configuration and deletes inventoried exact documents in
bounded batches. Report remaining debt and fail if any write is still unknown;
retry count or elapsed time never proves absence. Only a successful empty-debt
check permits configuration rotation. Existing memory service disable is the
immediate review rollback while preserving the configured cleanup path.
This deliberately pauses runtime memory during an outage; it is not instantaneous
engine hot switching. Startup with retained valid config and memory disabled
must perform no Infinity network call, so an unavailable engine cannot prevent
normal reviews from starting. Backfill events carry an opaque target index
identity and are rejected by a differently configured writer instead of being
silently acknowledged by the Prisma adapter. After drain, re-enabling Infinity
requires a fresh projection generation rather than replaying tombstoned keys.

This bookkeeping is projection lifecycle state, not a second memory store or a
generic workflow engine. Concurrency and actual SQL constraints receive real
PostgreSQL tests.
An exact export retry preserves every fingerprinted input, including title,
ordinal, projection metadata and idempotency key. Do not substitute current time
or mutable canonical update timestamps into the payload.

## Infinity adapter

Pin the released `@infinity-context/sdk` 0.2.4 archive:

`https://github.com/777genius/infinity-context/releases/download/sdk-v0.2.4/infinity-context-sdk-0.2.4.tgz`

Observed SHA-512:
`sha512-PpLM+eW84DRsNhYDvX02Y+v5hOCuQJMHJoNinyUwclHtizmpDEh4aBcRsCEvgqyQqYh2pD+zsu3VAZdKfbjKAg==`.
Public npm returned not-found during verification; 0.3.1 remains a draft release.
Use the SDK, not a duplicate REST client.

Use Contract-C document projection and `context.retrieve`, never legacy
content-deduplicating ingestion or generated rendered context as authority:

- pre-provisioned canonical Infinity space ID and native memory scope ID for
  this installation; no automatic topology bootstrap or provisioning subsystem;
- one logical authorized collection per workspace/repository/user scope, always
  encoded as trusted hard source-generation filters in the shared native scope;
- stable source key for a collection, not one source key per memory item;
- configured projection generation and active retrieval profile pins;
- bounded locator/source external ID binds the durable receipt and namespace;
  the receipt binds canonical item, exact version/hash and scope;
- ordinal comes from durable sequence metadata;
- explicitly use `classification: internal`, complete projection fields and
  UTF-8-sorted unique bounded tags;
- only the already normalized, confirmed body is exported, without metadata
  prepended to the text; enforce the one-chunk projection contract;
- one retrieval request contains the at-most-three authorized source-generation
  filters under one deadline; a required provider failure/degraded response
  degrades the entire request;
- parse locators strictly and validate their workspace/scope/generation before
  returning canonical IDs; verify each native `document_key` against the exact
  receipt document ID as well as source key and locator. Infinity's own
  `canonical_version` is not Router's body version. The application repeats
  canonical authorization;
- reconcile through the SDK exact-document API and preserve unknown/conflict
  states; accepted ingestion alone is not queryability. SDK 0.2.4 rejects an
  ordinary absent response when optional projection/profile generation filters
  are sent. Use generation-bound sourceExternalId for discovery, omit those
  optional filters and verify generation explicitly for every found document;
- timeouts, response bounds, retry budget and authentication are explicit and
  credentials/error bodies never enter diagnostics. Use a scoped service token
  without repository binding; Infinity's repository-bound token does not permit
  the document write/delete APIs. Respect Contract-C resultLimit <= 50.

The service needs an admitted retrieval profile and qualified providers/build,
not just a base URL. A fresh unqualified server must cause degraded retrieval,
not a fake capability or silent alternate ingestion path.

## Composition, configuration and enforcement

Reuse exact Get Modular core/assembly 0.2.0, already adopted by this repository.
Declare only the host dependencies and selected engine implementation. Compile
and prepare once per API/worker startup, not per request/event. Use the same
configuration parser/factory in both processes; preserve the API test-injection
seam. Unknown engine names or incomplete explicit Infinity config fail startup
before external IO. The stateless SDK needs no artificial close method.

Extend existing Engineering Foundation 2.1.0 dev-only source-dependencies v1
coverage with the actual memory boundaries, preserving all existing roots.
Permit the SDK only inside its
adapter and Get Modular only inside composition. Add executable rejecting
fixtures for SDK value/type/reexport leakage, outward application imports and
unclassified files. Keep the current consumer pins and accepted profiles,
preserve existing governed roots and explicitly add memory; no workspace-wide
toolchain migration is part of this feature.

## Delivery sequence

1. Record this plan; run independent architecture, lifecycle/security and
   product/testing critiques. Revise it, repeat twice more, and preserve findings
   and dispositions. Push each plan checkpoint.
2. Implement the static dashboard pause and stale-action refusal, with real
   page/loading-boundary tests. Keep authenticated navigation and shared style.
   Refuse all twelve server/client mutation exports through their shared entry
   guard after existing authentication but before actor/body processing, memory
   IO and mutation/revalidation. Keep the existing protected export endpoint as
   a backend recovery/privacy path, with no dashboard link.
3. Implement neutral contracts, revision-aware retrieval/fallback and outbox
   outcomes, additive projection schema/store and concurrency tests.
4. Implement the Infinity SDK adapter and its bounded lifecycle/HTTP tests.
5. Connect shared Get Modular composition to API/worker, validate configuration,
   and extend Foundation coverage/negative qualification. Add
   `scripts/memory-foundation/qualify-boundaries.ts`, exposed as
   `foundation:qualify-memory` and run sequentially by `architecture:check`.
6. Run affected unit/integration tests, actual Router PostgreSQL + authenticated
   API/outbox flow using the real SDK against a clearly test-only HTTP service,
   and browser qualification of the actual Memory page at 1440x1000, 900x1100
   and 390x844, including old query parameters and the preview flag.
7. Run required architecture, lint, formatting, typecheck, test and build gates.
   Open/update the PR, inspect remote checks and independent implementation
   reviews, fix actionable findings, push and verify the final head.

## Acceptance and evidence limits

Include malicious/cross-tenant locators, stale and duplicate revisions, disabled
and expired items, all-results-filtered fallback, unknown capabilities, shared
deadline/cancellation, provider partial failure, repeated identical writes,
uncertain acknowledgements, edit/delete races and exact stale cleanup.

The end-to-end consumer scenario is: authenticated canonical confirm in a real
Router PostgreSQL database -> committed outbox -> real handler -> published SDK
over loopback HTTP -> accepted and indexed reconciliation -> authenticated
bundle endpoint returning canonical text. Then edit/delete with delayed responses
and restart the adapter: reject the old hit, preserve the current revision,
exclude deleted text and retain/retry unresolved cleanup debt. Include existing
already-indexed canonical rows when enabling the new backend to prove backfill
and partial-coverage fallback. The loopback server is explicitly a test fixture.

Run a small parameterized consumer contract against both the Prisma adapter and
Infinity adapter through the same application seam. Cover canonical revision and
scope identity, duplicate retry, stale rejection, exact cleanup isolation and
fallback. Prisma's direct canonical view has no separate remote lifecycle; test
that real guarantee without manufacturing external state.

Include a privacy sentinel error from the provider containing unique body/query/
token strings. Public errors, logger output, outbox/audit metadata and receipt
rows must not contain those strings. Foreign generated response text is never
returned as the bundle body. Test two concurrent backend identities, cancellation
before send, canonical/workspace cascade cleanup without outbox, fair retry of
permanently unknown debt and byte-stable retry payload after restart.

Tests must exercise the published SDK's real wire protocol, not a hand-written
SDK mock. A loopback service proves consumer protocol handling, not Infinity's
production retrieval quality. A separate opt-in live test may target an already
qualified disposable Infinity service. Do not invent qualification/profile
receipts or claim a Postgres-only Infinity E2E: current production composition
also requires the admitted Qdrant/retrieval-profile lifecycle.

No production service configuration, rollout, release tags, canonical memory
authority, automatic extraction/approval, OCR/Action repository changes,
multi-engine federation, per-workspace engine selector or plugin hot reload is
included. Subsequent engines implement the same documented contract and pass
the same consumer acceptance suite.
