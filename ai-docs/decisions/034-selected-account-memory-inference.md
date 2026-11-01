# ADR-034: Selected-account memory inference and reproducible native startup

## Status and scope

Accepted for implementation, 2026-11-01, within the owner's request to repair
production memory end-to-end and use the same user accounts selected for reviews.
This is a scoped successor to ADR-033's native extraction mechanism. It does not
relax source authority, tenant boundaries, confirmed mutation admission, native
storage/physical deletion or actual-model and installed-App qualification.

## Decision

Hindsight remains the complete current-content provider. Ordinary approved
statements use its exact chunks strategy, local embeddings and local reranking.
Native `LLM_PROVIDER=none`, observations disabled and automatic consolidation
disabled prevent a global server account from purchasing user inference.

Conversational observation selection implements the existing product-owned
`MemorySourcePreviewPort` through `@agent-teams/account-gateway/llm`. This SDK
entry is not a new OpenAI-compatible Hindsight endpoint. The API reuses the
parent conversation's captured primary review account, model and policy tuple;
it cannot substitute an operator account or choose another user's account.
The current source-only input boundary is unchanged. Full-thread learning and
confirmation settings in other work remain outside this change.

A separate `ConversationProcessing` purpose, `memory-preview-v1`, reserves one
stable extraction attempt for the original source revision before Gateway grant
admission. The request wrapper rechecks current source, account authority, parent
state and the frozen selection at paid dispatch. A lost grant, interrupted output
or settled replay cannot buy a replacement call. Unavailable extraction degrades
to incomplete learning without replacing the ordinary conversation result.
Only bounded decoded statements reach the existing memory admission flow.
Raw input/output bodies remain transient; durable records contain identities,
digests, status and usage rather than source transcripts or provider streams.

The exact `transient-checked-inline-gateway-v1` capability distinguishes newly
qualified Gateway extraction from historical native preview evidence. An old
`transient-checked-inline-v1` proof may still authorize its existing reply path,
but cannot authorize the new learning mechanism. This is an immutable mechanism
version, not a user feature toggle. Actual selected-model and App-first checks
are still required before assigning the new capability to a production scope.

Self-hosted first startup prepares and verifies the pinned native source/image,
runs real native qualification, downloads pinned local model snapshots, activates
fresh provenance before writers, and merges private provider configuration.
Explicit operator opt-outs and service pauses remain authoritative. Native
services stay under the existing standalone Docker lock and complete-inventory
cleanup profile, with a separate PG17 database and no Compose reconciler.

## Evidence boundary

The deployment record separates source tests, deterministic native protocol
qualification, actual local model lifecycle, selected-account model quality,
installed-App behavior and production activation. None substitutes for another.
See [the deployment task](../deployments/2026-11-01-memory-production-startup.md)
for actual results and unfinished work.
