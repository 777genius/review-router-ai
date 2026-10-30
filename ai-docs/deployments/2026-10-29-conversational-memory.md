# Conversational memory and shared inference: deployment

- Task ID: `2026-10-29-conversational-memory`
- Goal: learn from authorized inline discussions and reuse verified memory in
  reviews, investigations, PR descriptions and App-authored conversation replies.
- Affected targets: Web, API, worker, PostgreSQL, private Hindsight, Account
  Gateway and the installed immutable GitHub interaction caller.
- Implementation: [control plane #734](https://github.com/777genius/review-router-ai/pull/734),
  [Action #350](https://github.com/777genius/review-router/pull/350) and
  [prerequisite #349](https://github.com/777genius/review-router/pull/349).
- Source provenance: control plane `9c715d9ad743dfc2ba21b29a7492772ce4b2c5ea`,
  paired Action `99cbd748aa025e27d5d9f689c3173c33b2d6b418`. These are tested source
  identities, not deployed versions. Action #349 and #350 subsequently merged as
  `7713c978f852f16b359ab816135a0b45de0c2ad1` and
  `8a6bb7395556ddabbda4b8275bc9e2de6fea4f8e`; a merge does not register a producer.
- Dependencies: existing memory/provider and private PostgreSQL release owners;
  reconcile [Review History](2026-10-28-review-history.md) and
  [dispatch/schema work](2026-10-28-dispatch-cleanup-ci.md) when included in the
  selected installed-to-target release range.
- Last updated: `2026-10-29`.

## Environment status

| Environment | Status    | Actual version / image | Last verified (UTC) | Remaining work                                                             |
| ----------- | --------- | ---------------------- | ------------------- | -------------------------------------------------------------------------- |
| staging     | `pending` | Not verified           | Not verified        | Reconcile, migrate, deploy disabled, qualify live, verify App publication. |
| production  | `pending` | Not verified           | Not verified        | Complete the independent production release and activation gates.          |

No environment rollout was executed in this source-integration step. `pending`
means completion has not been verified, not that deployment was observed absent.
Record each environment separately under the [status contract](README.md#status-contract).

## Applicability and prerequisites

Use the [release process](../operations/07-environments-and-release-management.md)
and [private PostgreSQL rollout](../../docs/operations/private-pg17-release-rollout.md),
not a new deployment path. Confirm the selected exact release contains this
implementation and its paired producer. Reconcile installed fleet versions,
migration ledger, native image/configuration, provider namespace/generation,
selected account/model and existing pauses before changing anything.

The ordinary configured-provider memory default and the new conversational
profile are separate. An existing explicit provider disable stays authoritative.
A configured Hindsight backend can enable ordinary memory without enabling
`transient-checked-inline-v1`. See the [memory owner](../../packages/features/memory/README.md)
and [ADR033](../decisions/033-conversational-memory-source-processing.md).

Source CI, synthetic HTTP/model fixtures and a generated release manifest do not
establish installed-model quality, production privacy or App publication. The
[implementation record](../plans/2026-10-28-conversational-memory-implementation.md)
contains the qualified boundaries. Keep production conversational qualification
unset until its required evidence exists; do not copy fixture proof values.

## Ordered rollout

1. **Select and admit the exact release.** Use the existing protected release
   gates, paired manifest generator/checker and approvals. The final protected
   control-plane main commit must pass its required CI, including both the
   dedicated release-authority contract and full PG16-to-PG17 rehearsal before
   release. A PR run that skips the latter is not release evidence. Preserve
   existing approved producers for admitted executions.
2. **Migrate before starting new code.** Reconcile the complete installed-to-target
   catalog through the existing fenced migration procedure. This feature adds
   [000152](../../packages/platform/db/prisma/migrations/000152_memory_automatic_source/migration.sql)
   and [000153](../../packages/platform/db/prisma/migrations/000153_conversation_processing/migration.sql).
   They must be part of the complete admitted catalog, not applied as detached
   SQL or used to bypass an earlier schema cutover. Verify durable source/cohort
   and conversation-processing tables. Do not backfill raw GitHub transcripts.
3. **Deploy one coherent, initially inactive conversational profile.** Deploy
   Web/API/worker and the generated portable memory runtime through the normal
   release path. Verify actual image/version and compatible parser/schema on all
   hosts before selecting a new producer. Keep the existing provider profile,
   namespace and generation coherent. Follow the [private Hindsight runbook](../../deploy/hindsight/README.md)
   for its image, model, mission, strict-preview and cleanup qualification. An
   ordinary code rollout alone does not complete this task.
4. **Qualify live behavior in disposable scopes.** Run the existing
   [evaluation runner](../../scripts/conversation-evals/README.md) against the
   actual selected Gateway and native models, starting with tuning. Inspect real
   synthetic outputs with the bound human rubric, then use one explicit protected
   checkpoint. Preserve cold namespaces, independent durable-command inventory,
   linked A-to-B recall and post-mutation witnesses. Missing configuration is
   `UNAVAILABLE`, not PASS. A failed hold-out is regression evidence, not a set to
   tune repeatedly. Verify deployed proxies, collectors, request/error logs and
   provider egress/residency do not retain raw thread/code/model streams.
5. **Prove the installed App-first path before widening activation.** Bind actual
   native preview evidence and mission through their existing configuration
   owners. For only the disposable repository, bind the approved runtime/model
   and scope in `REVIEW_ROUTER_CONVERSATION_QUALIFICATION` and require the same
   `REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA`. Use the existing provisioning
   owner and immutable Gateway-only interaction caller; do not seed provider
   secrets into CI or publish via `github.token`. Exercise created/edited/deleted
   inline events, replies-off and capped learning, same-event redelivery and
   ambiguous publication recovery. All new replies must be authored by the
   configured GitHub App bot with exact body, marker and parent identity.
6. **Activate only the qualified target and record evidence.** After the preceding
   gates pass, apply the qualified workspace/repository bindings to the intended
   environment and verify authorized recall, task/audience separation, current
   source checks and truthful status. Record actual image, native configuration
   identity, exact producer, operator, UTC time and durable receipts. Staging
   evidence does not mark production deployed or authorize an organization rollout.

## Verification and completion

Verify that an eligible maintainer revision learns without an explicit command;
ordinary contributors and bots cannot authorize writes; replies-off suppresses
publication without pretending learning was disabled. Replaying a settled event
must not buy another model call or duplicate a reply. Edited/deleted sources,
retirement, maintained edits and Forget must fence stale context at its owning
admission boundary. Investigation and PR-reader description/conversation inputs
must retain their separate audiences and exact hashes.

Inspect the real dashboard at desktop and narrow widths, including keyboard
validation, queued/unknown status, retirement and cleanup-pending Forget. A queued
command is not published content and a fenced Forget is not physical deletion.
Keep unresolved native cleanup debt visible until the existing operator proves
complete absence. Mark this task `deployed` only when all applicable checks pass
for the recorded environment, not when its PR merges or a mechanism test passes.

## Retry, partial completion, and rollback

Reconcile the recorded fleet/schema, source revisions, claimed publications,
native operations and unresolved command IDs before retrying. Never blindly
repeat an ambiguous create, consume a second model attempt for an already-bound
event, or rerun a consumed protected evaluation as an independent qualification.

To stop new contextual work, withdraw the affected conversation qualification
bindings and reconcile the installed caller through the existing provisioning
owner. Use `REVIEW_ROUTER_MEMORY_ENABLED=false` when new memory usage must pause
while retaining the configured provider for cleanup. Do not claim that withdrawing
configuration cancels an already admitted external operation. Drain/reconcile it
under its existing finite operation and maintenance contracts.

Use the release owner's rollback procedure for code; do not drop the new tables,
restore an old provider generation, erase suppression/tombstones or delete native
banks to conceal unresolved writes. Preserve in-flight evidence, retained approved
producers and cleanup ownership. Record residual schema and native data even when
new contextual processing has been disabled.

## Source merge handoff

The [implementation record](../plans/2026-10-28-conversational-memory-implementation.md#2026-10-29-final-lifecycle-fixture-repair-and-merge-handoff)
records the final fixture repair, exact pair and [observed qualification](https://github.com/777genius/review-router-ai/actions/runs/40877611193).
Another agent owns the control-plane merge after final-head required checks;
Action #349/#350 are already merged. Read the current PR head and checks,
then protected main checks before following the ordered rollout above.
Neither this source follow-up nor its disposable workflow changes the
staging/production status or supplies live activation evidence.

## Related evidence

- [Approved plan](../plans/2026-10-28-conversational-memory-and-shared-llm.md),
  [ADR033](../decisions/033-conversational-memory-source-processing.md),
  [implementation and original review rounds](../plans/2026-10-28-conversational-memory-implementation.md).
- Exact pre-documentation pair: [Memory/PostgreSQL/UI](https://github.com/777genius/review-router-ai/actions/runs/40864625185),
  [Hindsight mechanism](https://github.com/777genius/review-router-ai/actions/runs/40864625240),
  [Skills/Catalog](https://github.com/777genius/review-router-ai/actions/runs/40864625199)
  and [Action CI](https://github.com/777genius/review-router/actions/runs/40863723386).
  These successful source/mechanism checks do not satisfy the live steps above.
- [Final source CI](https://github.com/777genius/review-router-ai/actions/runs/40864625261)
  remains attached to its original SHA. Check its actual conclusion; this document
  does not turn a pending job into a pass or substitute for later main CI.
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment | Operator   | Actual version / image | Observed result                                                 | Next action                                                          |
| ------------ | ----------- | ---------- | ---------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Not executed | staging     | Unassigned | Not verified           | Source integration only; no deployment receipt.                 | Reconcile and execute the ordered rollout.                           |
| Not executed | production  | Unassigned | Not verified           | No live model, privacy or installed-App qualification recorded. | Retain activation hold until independent production evidence exists. |

## Source-authority rollout refinement

The [security refinement](../plans/2026-10-29-memory-source-authority.md) is part of the same source delivery. It adds no migration or service. Deploy API/worker/web and the portable package coherently; native selection now sees only the eligible source revision, while replies retain the complete thread. Model-proposed create/update/retire/forget/relearn actions require the exact standalone human maintainer confirmation, binding text, kind, target and revision. Test both the no-effect proposal and actual authored confirmation through the installed App before activation.

Use actual selected models to evaluate source-only quotation/negation fidelity and contextual abstention. Existing full-thread semantic scores are not evidence for this input contract. Keep the existing protected corpus and thresholds unchanged and report any recall or clarification differences rather than fabricating a pass. Physical Forget remains subject to the existing operator cleanup procedure. Staging and production remain pending; this source repair does not provide deployment or live-model evidence.

## Concurrent Gateway integration

The source integration with Gateway multi-reviewers and unified OCR preserves all four exact
checkout migrations: `000152_memory_automatic_source`,
`000152_review_run_gateway_allocations`, `000153_conversation_processing` and
`000154_unified_model_dispatch`.
Migration identities are complete directory names, not their numeric prefixes;
no SQL bytes or previously applied ledger names are rewritten. The combined
159-file checkout is independently pinned to SHA-256
`35d11ac132da5057b2ed6ff8a0eb82fcf0bd0c289975e7772deea55b1f14ad98`.
Existing reviewed 158/157/156/155 checkout and managed92/historical96 boundaries
remain admitted only under their original exact manifests.

Conversation inference and publication use the first/primary configured Gateway
reviewer, matching V4 companion tasks. Every roster revision remains part of the
captured configuration digest. Reordering, changing any selection, or losing the
primary account invalidates admission; no silent secondary-account fallback is
introduced. Verify this with a disposable two-reviewer repository during the
existing App-first deployment check. Mixed authentication remains outside this
profile. Both paired CI workflows select the existing integrated Action producer
`925df40c6c5806fe2b6673c5f807fdc6abf2fe40`; candidate verification is not release
registration. The source-authority confirmation and source-only extraction
refinements above remain mandatory, as do live qualification and truthful
per-environment deployment status.
