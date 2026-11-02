# Full-thread memory and workspace confirmation settings

Date: 2026-10-30. Status: implemented; final-source CI tracked in
[PR #744](https://github.com/777genius/review-router-ai/pull/744), live qualification pending.
Owner request: use the complete checked PR inline thread for learning; expose one
workspace-wide confirmation setting in Memory, automatic by default; evaluate
accuracy and keep deterministic reliability evidence separate from model quality.

This explicitly supersedes the source-only extraction and unconditional
exact-confirmation requirements of
[the 2026-10-29 refinement](2026-10-29-memory-source-authority.md).
The source delivery in #734 remains its historical baseline. Existing permission,
audience, source-current, replay, revision and cleanup contracts remain applicable.

## User behavior

- Memory -> Settings contains one checkbox: Require confirmation for memory changes.
  It applies to every repository of the current workspace and defaults to off.
  Workspace owners/admins manage it. No repository override is introduced.
- Automatic mode: useful facts can be learned from a maintainer message in the
  context of the whole checked thread, including a clear contextual endorsement.
  The existing answer model can request permitted create/update/retire/forget/
  relearn operations without an extra confirmation reply.
- Confirmation mode: native selection still runs, but proposed observations and
  model-requested mutations do not enter the command/outbox/provider write path.
  The bot presents the existing exact standalone confirmation text. A maintainer
  who sends it authorizes those exact fields. Reuse this existing interaction;
  no new proposal table, pending-approval workflow or second semantic judge.
- Manual dashboard actions remain deliberate user actions. Source revocation,
  loss of access and already-admitted cleanup retain their safety semantics.
- Scope stays at existing ReviewRouter inline findings. General PR comments,
  GitHub Discussions, new knowledge types, moves between scopes and repository
  groups are outside this change.

## Ownership and smallest implementation

1. Persist optional `memory.requireConfirmation` in the existing versioned
   workspace review-policy JSON. Absence means false. Preserve it when unrelated
   settings/providers are saved. Reuse owner/admin authority, CAS and workspace
   scope guards; no SQL migration or feature flag is needed.
2. Read the setting freshly through the memory policy port, using a narrow
   review-config reader supplied by host composition. Include its revision in
   the captured request, and recheck at admission. Existing retained knowledge
   must not become invalid merely because this setting or a provider changes.
3. Use the already-verified ConversationSnapshot as the extraction context.
   Preserve all message identities, authors, ordering, source revisions and
   source distinction. Context helps resolve the current authorized message;
   foreign instructions and quoted commands do not become its execution intent.
   Keep bounded complete input, strict-preview checks and explicit oversized/
   incomplete outcomes; never silently truncate to the last few messages.
4. Keep the native engine as the sole observation selector. Add a read-only
   selection result for confirmation mode; do not call automatic cohort admission
   or retire old children as an AI decision before approval. The conversation
   owner formats selected observations using the existing authored commands.
   Human confirmation binds the entire new statement/operation; an altered model
   result cannot pass the exact confirmation guard.
5. Store only a bodyless vector of frozen context-message revisions alongside
   existing automatic-source metadata. Reuse the shared GitHub App source reader
   to detect changed/deleted evidence on later use. New appended comments,
   including our own bot reply, do not invalidate unchanged evidence.
6. Automatic explicit mutations retain verified current maintainer identity,
   repository/workspace permission, exact target and revision, source-current
   checks, bounded command IDs, replay and physical Forget ownership. The mode
   decides whether exact authored confirmation is additionally required.
7. Coordinate settings writes and final AI command admission through the existing
   workspace guard. A change to confirmation mode during inference cannot be
   bypassed by a stale captured setting. Do not claim cancellation of an already
   admitted external operation.

## Evaluation and verification

Existing v1 corpus: 48 threads, 149 source events, 81 eligible facts. Its measured
live semantic quality remains unavailable. Earlier unit/PG/native fixture passes
prove mechanisms, not real-model precision or recall.

Keep v1 corpus and thresholds unchanged. The independently versioned full-thread
successor contains 16 threads, 50 events and 21 independently labeled facts;
10 threads are tuning and 6 are protected. It covers contextual agreement, foreign/bot/code instructions,
quotation/negation, conflicting maintainers, exact-target updates and forgetting,
default automatic and confirmation modes, mode changes, replay and two repositories
of one workspace. Keep tuning and fresh protected scenarios separate.

Extend the existing runner and complete command-inventory scorer, not a second
test platform. New positive conversational mutations must go through the actual
ProcessConversation owner; fixture target references may bind actual IDs and
revisions, never seed an expected answer. Score automatic and explicit effects
against actual authority, source, scope and target witnesses. Unavailable or
queued content never earns successful-publication credit.

Focused deterministic verification covers:

- real workspace setting round trip, default and owner/admin/CAS enforcement;
- whole-thread preview transport and changed/deleted context validity;
- automatic vs confirmation command/outbox admission and a mode-change race;
- exact target, source authority, audience and replay;
- scorer negatives and a legitimate positive command witness;
- the changed Memory settings UI using the existing browser acceptance fixture.

Reuse existing unchanged migration, cleanup and Action publication evidence.
Run applicable repository CI after focused checks; do not repeat unrelated suites
locally. Critic review checks the final changed boundaries and fixes concrete findings.

Focused core tests (56 cases), settings/authority tests, the repaired dashboard
page suite (43 cases) and scorer/fixture regressions (32 cases) passed. API, web
and worker typechecks passed. Existing CI owns the new real PostgreSQL race,
settings round trip, confirmation/replay and desktop/narrow browser cases.
The eval fixture now explicitly separates the actual qualified account/processing
identity from fresh memory scopes and native banks, preserving the production
dispatch grant. Its synthetic source mapping does not qualify an installed App.

Live semantic qualification still requires the real selected Gateway/native model,
tuning outputs, a bound human rubric and one fresh protected checkpoint. Existing
precision >=95%, recall >=80%, supported-answer >=90%, attribution >=95%, zero
unauthorized effects and all blocking witnesses remain targets, not claimed scores.
This environment currently lacks the required live configuration. Record unavailable
honestly rather than substitute mocked semantic scores.

## Rollout

Update the existing conversational-memory deployment task. The new full-thread
mission and automatic mutation behavior need their own live qualification before
activation; a source/CI pass does not reuse prior source-only model evidence.
Migrate no schema for this change. Deploy one coherent Web/API/worker/portable
runtime, check the actual Memory setting, then follow the existing disposable
App-first rollout and cleanup procedure. Staging and production remain separately
pending until actual execution receipts exist.
