# Memory engine adapters and temporary dashboard pause

## Status and scope

Implementation plan, revision 1, prepared for three sequential independent
critique/fix rounds before implementation. Owner request: replace the Memory
dashboard with an honest under-development message, make the memory engine
replaceable, integrate the first Infinity Context SDK adapter, test the complete
changed paths, publish a PR and address review findings. Push each coherent
checkpoint. This work does not deploy or merge the PR.

Baseline: ReviewRouter `dfda0b419c2b713903d033662b03992cf5a3e4a7`.
The organization Engineering Quality Standard was read at
`agent-teams-ai/.github@1b17053bc92766742fec2329ee153171395e658e`.
Accepted memory ADRs 018–026 remain authoritative and unchanged.

## Product guarantees

1. The dashboard Memory section contains only a static development notice. It
   does not fetch memory records, render forms, offer simulated controls or call
   memory APIs. Stale dashboard mutation submissions are refused. Existing
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
scope, expiry and the exact revision before accepting a hit. Apply policy before
declaring search successful, so disallowed-only results cannot suppress fallback.
Search uses an absolute deadline/cancellation carrier, also enforced by a bounded
outer call so a misbehaving adapter cannot stall a review indefinitely.

Index writes return an explicit indexed/superseded outcome. Only an indexed
outcome can trigger the existing conditional `markIndexingSucceeded`; check its
updated count. If the canonical revision changed during remote IO, clean up only
that exact exported revision. Do not delete a newer revision through an item-wide
cleanup. Terminal item deletion removes all inventoried exports for that item.

## Durable projection metadata

Add one additive adapter-state table and a narrow repository contract for
projection bookkeeping. It contains no memory text: engine namespace/generation,
workspace/item identity, canonical body version/hash, scope identity, a database
sequence ordinal, remote document ID when observed, and reconciliation state.

- Reserve an exact revision only while the canonical item still matches and is
  active. The reservation is durable before any HTTP write.
- Database uniqueness provides stable retries and collision-free int32 ordinal
  allocation. Reject exhausted ordinals instead of hashing UUIDs into integers.
- Namespace includes the configured backend/index generation; receipts for an
  old deployment are retained until its cleanup is reconciled.
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

This bookkeeping is projection lifecycle state, not a second memory store or a
generic workflow engine. Concurrency and actual SQL constraints receive real
PostgreSQL tests.

## Infinity adapter

Pin the released `@infinity-context/sdk` 0.2.4 archive:

`https://github.com/777genius/infinity-context/releases/download/sdk-v0.2.4/infinity-context-sdk-0.2.4.tgz`

Observed SHA-512:
`sha512-PpLM+eW84DRsNhYDvX02Y+v5hOCuQJMHJoNinyUwclHtizmpDEh4aBcRsCEvgqyQqYh2pD+zsu3VAZdKfbjKAg==`.
Public npm returned not-found during verification; 0.3.1 remains a draft release.
Use the SDK, not a duplicate REST client.

Use Contract-C document projection and `context.retrieve`, never legacy
content-deduplicating ingestion or generated rendered context as authority:

- one authorized collection per workspace/repository/user scope;
- stable source key for a collection, not one source key per memory item;
- configured projection generation and active retrieval profile pins;
- locator/source external ID binds item, exact version/hash and namespace;
- ordinal comes from durable sequence metadata;
- only the already normalized, confirmed body is exported, without metadata
  prepended to the text; enforce the one-chunk projection contract;
- independently scoped retrieval calls share one deadline and deterministic
  scope ordering; any required scope failure degrades the whole request;
- parse locators strictly and validate their workspace/scope/generation before
  returning canonical IDs; the application repeats canonical authorization;
- reconcile through the SDK exact-document API and preserve unknown/conflict
  states; accepted ingestion alone is not queryability;
- timeouts, response bounds, retry budget and authentication are explicit and
  credentials/error bodies never enter diagnostics.

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
coverage with the actual memory boundaries. Permit the SDK only inside its
adapter and Get Modular only inside composition. Add executable rejecting
fixtures for SDK value/type/reexport leakage, outward application imports and
unclassified files. Keep the current consumer pins, source universe and accepted
profiles; no workspace-wide toolchain migration is part of this feature.

## Delivery sequence

1. Record this plan; run independent architecture, lifecycle/security and
   product/testing critiques. Revise it, repeat twice more, and preserve findings
   and dispositions. Push each plan checkpoint.
2. Implement the static dashboard pause and stale-action refusal, with real
   page/loading-boundary tests. Keep authenticated navigation and shared style.
3. Implement neutral contracts, revision-aware retrieval/fallback and outbox
   outcomes, additive projection schema/store and concurrency tests.
4. Implement the Infinity SDK adapter and its bounded lifecycle/HTTP tests.
5. Connect shared Get Modular composition to API/worker, validate configuration,
   and extend Foundation coverage/negative qualification.
6. Run affected unit/integration tests, actual Router PostgreSQL + authenticated
   API/outbox flow using the real SDK against a clearly test-only HTTP service,
   and browser qualification of the actual Memory page at desktop/mobile sizes.
7. Run required architecture, lint, formatting, typecheck, test and build gates.
   Open/update the PR, inspect remote checks and independent implementation
   reviews, fix actionable findings, push and verify the final head.

## Acceptance and evidence limits

Include malicious/cross-tenant locators, stale and duplicate revisions, disabled
and expired items, all-results-filtered fallback, unknown capabilities, shared
deadline/cancellation, provider partial failure, repeated identical writes,
uncertain acknowledgements, edit/delete races and exact stale cleanup.

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
