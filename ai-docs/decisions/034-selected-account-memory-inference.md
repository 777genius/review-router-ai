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
The full-thread successor carries the complete host-checked discussion and its
bodyless revision evidence to interpret the selected maintainer source. Source
authority stays with that source; other authors, code and bot output remain
evidence. The input digest also binds the effective workspace confirmation setting.

A separate `ConversationProcessing` purpose, `memory-preview-v1`, reserves one
stable extraction attempt for the original source revision before Gateway grant
admission. The request wrapper rechecks current source, account authority, parent
state and the frozen selection at paid dispatch. A lost grant, interrupted output
or settled replay cannot buy a replacement call. Unavailable extraction degrades
to incomplete learning without replacing the ordinary conversation result.
Only bounded decoded statements reach the existing memory admission flow.
Raw input/output bodies remain transient; durable records contain identities,
digests, status and usage rather than source transcripts or provider streams.

The exact `transient-checked-inline-gateway-full-thread-v1` capability distinguishes newly
qualified Gateway extraction from historical native preview evidence. An old
`transient-checked-inline-v1` or source-only Gateway proof may still authorize its existing reply path,
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

### Reusable mechanism capability, 2026-11-02

Accepted for implementation within the owner's requirement that new self-hosted
users/repositories use their selected review accounts without per-repository
operator qualification. Source implementation is not production activation.

The existing `REVIEW_ROUTER_CONVERSATION_QUALIFICATION` key accepts two strict
versions. Version 1 keeps its required finite `repositories` list and all historical
mechanism meanings. Version 2 requires `coverage: normal-current-product-admission`,
the exact `transient-checked-inline-gateway-full-thread-v1` mechanism, proof ID,
immutable interaction runtime SHA, qualified profile/model bounds and a strict
`sourceProfile` containing the common prompt, Gateway preview, account-policy and
Gateway SDK provenance SHA-256 digests. Version 2 has no repository/account selector;
mixed versions, historical mechanisms, absent coverage/digests and wildcard lists
are rejected. The coverage literal is an immutable deployment contract, not a flag.
The frozen account manifest binds the exact version-2 declaration by digest, so
replay/child admission cannot silently substitute different mechanism evidence.

This capability says that a mechanism/model combination is qualified. It confers
no repository, maintainer, credential or publication authority. Normal authorized
setup may install its exact interaction caller in a newly connected repository.
The existing independent authorities remain mandatory: selected GitHub repository
and installation, canonical App caller, session identity epoch, verified maintainer,
and primary review account/profile/model, owner, binding and remote authorization
epoch. Current-source readback retains its selected-repository and checked-source
verification. Transactional confirmation/revision and deletion fences remain
unchanged. Synthetic evaluation constructors are never used for product admission.
Different authorized accounts/repositories may reuse the same qualified mechanism
and model; an unsupported profile/model remains unavailable without fallback.

Changing proof identity changes the standing policy revision of automatic sources.
Release activation must retain the genuine evidence identity or explicitly reconcile
existing automatic observations; it must not silently relabel historical evidence.
Changing the mechanism/source/model requires matching reviewed qualification.

The parser validates a trusted deployment declaration's shape; it does not create
or verify a successful model-quality result. No version-2 qualified release artifact
has been supplied by this implementation. Native self-hosted setup continues to
configure only approved memory with `LLM_PROVIDER=none`; it does not mint a
conversation capability. When a genuine source-bound qualified release artifact is
supplied, setup validates its installed source/runtime and approved caller pin, then
privately merges the existing qualification/runtime keys while preserving operator
configuration and opt-outs. No such artifact is supplied here. No placeholder
artifact, automatic checkpoint, new flag or default qualification claim is introduced.

The deployment record separates source tests, deterministic native protocol
qualification, actual local model lifecycle, selected-account model quality,
installed-App behavior and production activation. None substitutes for another.
See [the deployment task](../deployments/2026-11-01-memory-production-startup.md)
for actual results and unfinished work.
