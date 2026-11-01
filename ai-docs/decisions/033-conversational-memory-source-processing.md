# ADR-033: Checked conversational source processing and finite plain inference

## Status

Accepted for implementation, 2026-10-28, by the owner's explicit authorization of
the [conversational memory plan](../plans/2026-10-28-conversational-memory-and-shared-llm.md).
This decision does not activate a production source-processing profile. Native
privacy, strict-preview, selected-model quality and App-first live interaction
qualification remain required before enabling a workspace/repository.

## Scope of the successor

The new `transient-checked-inline-v1` profile is a scoped successor to the raw
ingress clauses of ADR-018, the per-fact suggestion default of ADR-021 and the
approved-source-only clauses of ADR-031. Those accepted records stay historical;
the existing approved/manual profile retains its current meaning and storage
generation. The new profile admits only complete fitting GitHub inline threads
verified through the installed GitHub App. No arbitrary prompt endpoint is added.

GitHub remains the transcript store. Complete message bodies, code anchors and
raw model events exist only in bounded process memory until the common deadline.
They must not enter Prisma, outbox, audit, generic errors, request logs or prompt
artifacts. Retrying source processing reads GitHub again rather than restoring a
transcript archive. Deletion requires a verified complete source inventory or a
trusted signed tombstone; a failed/unauthorized 404 is not deletion evidence.

Router may persist bodyless source/revision/actor identities, revision-vector
digests, captured policy/account/model/bounds, child effect IDs and statuses. A
bounded exact reply may remain only as an unresolved publication envelope. A
verified App publication or terminal publication resolution purges its body;
settled replay returns IDs, hashes and status, without historical output bytes.

## Current owner refinement, 2026-10-30

The [full-thread/settings successor](../plans/2026-10-30-full-thread-memory-settings.md)
replaces the two interaction choices in the historical refinement below. Native
selection uses the checked full thread to interpret the eligible maintainer's
message. One workspace-wide setting controls confirmation for AI writes and
defaults to automatic. Existing exact authored confirmations remain available in
confirmation mode. Context revision vectors, final transactional settings checks,
authority, audience, replay and cleanup remain product-owned. New semantic quality
needs actual-model evaluation; prior source-only evidence is not reused as that proof.

## Historical security refinement, 2026-10-29

The [source-authority refinement](../plans/2026-10-29-memory-source-authority.md)
supersedes this unactivated profile's mixed-author preview context and free-form
model mutation admission below. Selection receives only the verified eligible
source; replies retain the complete thread. Exact source-authored confirmation
binds every explicit mutation field through one shared guard. This introduces no
second semantic engine or paid call and does not claim deterministic model truth.
Unresolved references may abstain and free-form mutations may need one confirmation
turn. Existing live qualification, scopes, privacy and lifecycle owners remain.

## Source authority and learning

The server reads every inline-comment page, preserves stable actor identity,
chronology, edits, reply edges and the current code anchor/base/head. It checks the
complete vector after assembly and before admission/effects. This is a checked
frozen read, not a transaction across GitHub and PostgreSQL. One pre-bind rebuild
is permitted; after binding or any inference, drift is stale and never buys a
replacement attempt. Oversized/incomplete threads are explicit unavailable input;
last-N history and silent truncation are not permitted.

Existing memory policy owns `memoryEnabled` and `automaticLearning` (default on
for a configured qualified backend; explicit disable wins). The first automatic
source class is a verified human repository maintainer's new revision. Bots and
ordinary contributors remain useful read-only context and never become approval
actors. Native extraction selects from the new eligible human revision only; the
whole thread/anchor is labelled untrusted read-only context. Router does not add
an extractor, semantic deduper, confidence threshold or second semantic verifier.

One qualified native strict preview may return at most four complete nonempty
statements, each at most 1,000 characters. Unknown, invalid, partial and overflow
results do not mean successful empty selection. Frozen statements use the existing
exact chunks writer once; raw source never enters retain content/context/metadata.
Native semantic extraction, embeddings and consolidation remain separately
operator-funded and do not inherit customer OAuth or the product reply account.

Implementation sequencing refinement: capture/freeze authorized recall once and
admit the one product inference before automatic learning reserves a replacement
cohort. Learning's own scope-epoch change must not invalidate that model grant or
cause context recapture. Native learning is attempted independently after a
missing/malformed model result when the original source/deadline remain valid.
Newly selected facts help subsequent turns. When a product decision was obtained,
its bounded normalized reply/action intent is frozen before dependent effects.
Independent native learning can proceed without product output; its exact selected
statements use the existing bounded command envelopes. Neither envelope is a
transcript or an output-replay service.

Automatic cohorts become visible only after complete verified readback and atomic
metadata activation. Source replacement withdraws the old cohort; explicit
authorized retire/forget creates bodyless lineage suppression that survives edits,
new entry IDs and generations. Explicit update detaches/promotes a maintained
entry before old source replacement can retire it. An explicit authorized relearn
transition is required to remove suppression. The common current-source predicate
and receipt locks apply to every context consumer and native-derived evidence.
Across-head automatic observations are historical and retain their observed SHA.

## Plain inference and finite authority

Conversation understanding depends on the application `TextInferencePort`, whose
request contains messages/instructions, an optional schema and absolute request
controls. The injected independent Account Gateway SDK adapter owns selected
account/model binding and one native Responses SSE exchange. It imports no ar,
agent task protocol, bridge, CLI, workspace, tools or agent loop.

The selected repository review connection is captured through the existing
configuration and provider-account owners. A distinct finite conversation purpose
uses its own operation/attempt/request identities and allowance; a review lease
does not grant conversation permission. Account custody, refresh, remote epoch,
quota and paid dispatch remain in Gateway/Sub2API. Tool calls, refusal, incomplete
output and an unqualified model are explicit failures, without fallback.

Initial server ceilings are 90 seconds total, one product call of at most 60
seconds, 128 KiB input, 256 KiB captured SSE and 16 KiB normalized output. Captured
transport limits may reduce them. Final serialized input, schema/instructions,
memory, anchor and requested 2,048-token output reserve must fit the qualified
context bound. The requested token target is not a hard paid-generation ceiling:
the pinned Codex OAuth transport removes `max_output_tokens`. Cancellation and
byte/deadline bounds do not prove a refund or upstream execution drain.

Accepted identity is repository/thread/human source/trusted source revision/purpose,
before recall/model/account dependencies that can change after a reply. The input
manifest binds once. Re-delivery restores the same effect identities and available
envelope. SDK status reports effect/status, not output replay. Losing terminal
output produces `output_unavailable`; it never causes another paid inference.

## Entry point and publication

The managed Gateway interaction caller is pinned to one qualified immutable
`reviewrouter-interaction-reusable.yml` SHA and receives created/edited/deleted
inline-comment events. It uses OIDC and App publication, with no provider secret or
workflow-token publication fallback. Server admission checks the exact signed
reusable source facts and current canonical installed caller. The neutral review
workflow ABI is unchanged. An unqualified interaction profile remains unavailable.

Learning and publication gates are independent. Existing caller discussion mode
may suppress publication; server reservations enforce five replies per thread and
twenty per PR, including unresolved publication envelopes. Exhausted reply caps
do not suppress permitted learning. The Action publishes only the frozen reply
with its stable marker and reconciles unknown publication before any further
create. A receipt is accepted only after an App read proves exact configured bot
identity, repository/PR/parent, marker and body digest.

Immediately before its first create, the exact qualified Action claims publication
on the existing publication endpoint. The server checks the frozen vector/head,
source actor authority, audience, selected repository/binding, captured reply mode,
completed bounded output and original deadline, then atomically changes `ready`
to `unknown`. Only one claim wins. A lost claim acknowledgement permits no create;
later runs perform marker reconciliation only. Source/policy drift withdraws an
unclaimed envelope without inference or text regeneration.

Publication completes the already admitted immutable model request. It does not
readmit memory using the 30-second recall-capture TTL after a potentially
60-second call and 25-second native learning phase. That would reject valid
completion and self-invalidate on learning's own epoch change. No receipt expiry
or hash is extended, no context/account/model is recaptured, and no additional
inference grant is issued. The original finite operation must still be live and
its publication authority must pass the checks above.

Natural language CRUD uses the existing permission/CAS/command owner. Model JSON
does not confer authority. Exact target/revision/scope and a verified maintainer
decision are required; ambiguous/destructive intent requests clarification. Status
notices describe actual queued/published/revoked/unknown/cleanup state rather than
claiming success from generated prose.

## Activation evidence

`REVIEW_ROUTER_CONVERSATION_QUALIFICATION` contains trusted deployment proof ID,
exact runtime SHA, supported workspace/repository bindings and qualified model
context bounds. It is not an account selector or a parallel user policy store.
`REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA` installs that same exact caller
pin; mismatching or absent proof fails closed. Native preview has its separate
image/mission/model/privacy/strict-preview proof. Supplying configuration is not
itself proof that qualification passed.

Focused deterministic SDK/source/PostgreSQL tests prove contracts, privacy,
coherence, replay and cap reservations. They do not prove live model quality,
production installation, native transient privacy or deployment. Before enabling,
run the plan's protected whole-thread corpus and linked memory witnesses, native
privacy/strict-preview qualification and a disposable Gateway-only App-first
interaction E2E. Existing issued review leases keep their frozen contract.

The shared context capture implementation has distinct finite task policies.
Review/investigation preserve their authorized internal workspace context. A
public PR description captures a separately filtered immutable input through the
same endpoint/mechanism; an internal receipt/hash cannot authorize the description
task. Conversation remains filtered for the readers of its PR. This separates
audience authority without copying retrieval or introducing another wire system.
