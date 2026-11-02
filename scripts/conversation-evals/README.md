# Conversation quality qualification

This owner contains versioned synthetic corpora and a thin runner around the **actual**
conversation application, PostgreSQL processing/memory stores, selected-account
Gateway extraction/replies and native delivery/readback. It creates no
second extractor, semantic judge, memory store, inference service or product
logging endpoint. The synthetic source authority is a fixture; this run does not
qualify a real GitHub App installation or replace the disposable App-first E2E.

## Full-thread successor slice

`--corpus full-thread-v2` selects the separately versioned
`corpus.full-thread-v2.json`, revision `2026-11-02-full-thread-r2`: **22 whole
threads, 16 tuning / 6 protected, 69 events and 29 fact labels in 13 scenario
groups**. Six groups have positive same-repository A→B recall. Three other paired
groups use different repositories in one workspace to test shared settings and
repository memory isolation; they are not counted as positive cross-thread recall.
The original `corpus.json`, its split, labels and numeric targets are unchanged.
`legacy-v1` remains the default selector.

The successor covers contextual maintainer endorsement, hostile contributor/bot
instructions, quotation and negation, unresolved maintainer disagreement,
exact-target update/forget, stale target revisions, the default automatic mode,
confirmation, workspace mode changes and settled-event replay. Per-event
`automaticLearning: false` is a restrictive source-learning policy; it is not a
claim that a complete provider shutdown or publication path was exercised.

Fixtures save workspace confirmation settings through the existing policy owner
and read the actual versioned workspace setting. Repository memory banks remain
separate. Target templates bind only returned entry IDs/revisions by source and
index, never expected fact content. An explicit `confirmProposal` event may copy
one **actually observed native** statement into a new standalone authored command.
This choice exists only on declared successor events; ordinary events and v1
never receive hidden confirmation. Wrong native text is retained as wrong text
for the independent human rubric, not replaced with a label. Successor mutations
run through `ProcessConversation`; they do not use the legacy direct owner-mutation
helper. Forget proves immediate read exclusion and reports the actual queued or
cleanup state; physical erasure remains the existing operator's responsibility.

The scorer checks each explicit command's actual owner fingerprint, source actor,
body revision, scope, effective mode and exact target. Complete independent command
inventory still includes omitted commands, and pending/bodyless metadata earns no
retention credit. Each declared successful mutation must have the matching actual
command; an unsupported human annotation cannot grant authority.
Maintained statements use the existing approved-provenance reader and a valid
template-repository GitHub URL. Later thread edits do not revoke maintained
ownership; native automatic facts retain their checked-context currency fences.

Structural validation and scorer controls are measured mechanism evidence only.
**A tuning PASS is not a successful protected qualification.** Revision r1's
checkpoint `rr-full-thread-v2-holdout-20261102-5da70100c-1`, run
`43ec0ef0-ec1d-4981-9da0-de8725cc8e9e`, was consumed and ended `UNAVAILABLE`.
Before the unavailable steps it also missed a completed contextual endorsement
and its linked recall. Its six original protected threads and eight fact labels
remain unchanged as tuning regression; only their split changes. Original r1
reports retain their r1 identity and are not retagged as r2 evidence.

The new protected set contains six unexecuted threads, 19 events and eight new
facts: transactional inbox acknowledgement under unrelated hostile quoted data;
distinct maintainers' export-completion disagreement with exact update/stale/Forget
and an unaffected catalog neighbor; and Cedar/Maple audit conventions with shared
confirmation settings, settled replay and strict repository isolation. The audit
pair is an isolation test, not positive cross-repository recall. These scenarios
were authored from the behavioral contract, not generated from model outputs.
Static label review is owner-delegated agent review, not external or human
independence. Review the new labels before one planned protected checkpoint;
no r2 protected result or successful qualification exists. Existing deterministic
native/PG suites do not supply semantic scores.

## Fixed corpus and gates

`corpus.json` has 48 whole threads, 32 tuning and 16 protected hold-out, 149 source events and 81 eligible facts. Eight distinct repository scenarios have
linked A→B threads, five in tuning and three in hold-out. B has no copy of A's fact
in its source or code; protected pairs cover ordinary, replies-off and capped
learning, then an explicit retirement/forget and a fresh B source revision.
Different variants and splits never share accepted records, source IDs, fresh memory
scopes or native banks. Model processing deliberately uses the qualified template
repository, with namespace-specific processing cold checks and record identities. Labels are loaded only by the scoring/inspection side;
fixture input is constructed from raw messages, anchors and explicit owner policy.
Per-event snapshots carry only concrete source body/revision changes. Repeated
source events have distinct event IDs while retaining the same stable comment
identity. The corpus includes a learned-source edit/delete before fresh questions,
an earlier-page nontrigger edit with the accepted trigger and head unchanged,
disagreeing named maintainers, a short contextual exception and ambiguous
update/forget requests that must clarify or abstain without durable effects.
These labels qualify source/model-context behavior. The fixture does not append
published assistant envelopes to later snapshots, so it does not qualify dynamic
publication history or cap evolution; the separate Action/App suites own that proof.

The targets are recorded in the corpus before tuning: precision ≥95%, recall
≥80%, supported answers ≥90%, harmful-write rate ≤5%, unnecessary clarification
and reply ≤10%, attribution ≥95% and 100% on blocking cases. Every protected linked
recall/mutation witness must pass, non-command and off/capped recall must each
reach ≥80% in each split, and unauthorized effects or exceeded enforced bounds
must be zero. Counts and denominators accompany every metric. This small corpus
is an engineering gate and cannot establish population reliability.

## Evidence and availability

The runner captures actual cold inventory, selected native statements, qualified
current readback, active-cohort IDs, memory receipt identity and body digests
observed in the **actual** inference request. A fact merely mentioned in an answer
is insufficient proof of memory delivery. Raw customer data is never used; the
bounded synthetic output and source labels are retained only in local evaluation
results. Secrets, account credentials and raw Gateway event streams are excluded.

Full-product candidate measurement requires a dedicated qualified native backend
and a real selected-account Gateway setup. Ordinary native storage uses the
configured `LLM_PROVIDER=none` profile and pinned local embeddings/reranking.
The historical `native-selection-only` comparison retains its real strict-preview
qualification/mission requirements; it is unavailable on a non-generative backend
and does not stand in for Gateway extraction. Missing
configuration produces `UNAVAILABLE`, never a passing mocked quality score.
Deterministic product transport/authority suites remain separate contract proof.
Human review binds rubric decisions to the result run ID and source-event IDs;
there is no second LLM semantic verifier. Tune on the tuning split, then run one
planned hold-out checkpoint. A failed hold-out becomes regression evidence; a
new protected set is required before another independent qualification claim.

The explicit API-owned candidate constructor reuses the production account,
owner, epoch, selection and paid-dispatch guards. It captures the real template
selection while durable attempts belong to fresh disposable processing scopes.
Its manifest contains `candidateEvaluationRunId`, never `qualificationProofId`.
No production capability or successful proof is needed or manufactured to measure
a candidate. A model bounds declaration is an operational limit, not quality
evidence. Neither the runner nor scorer activates production or issues a
`transient-checked-inline-gateway-full-thread-v1` capability. Historical source-only Gateway proof remains parseable but cannot activate this extractor.

## Run

Run from the control-plane checkout with its exact installed lockfile/toolchain:

```sh
node --import tsx scripts/conversation-evals/run.ts --validate
node --import tsx scripts/conversation-evals/run.ts --validate --corpus full-thread-v2
REVIEW_ROUTER_ACTION_SOURCE_DIR=/absolute/pinned/action-checkout \
  node --import tsx scripts/conversation-evals/run.ts \
  --split tuning --variant parser-baseline --out tmp/parser-results.json
CONVERSATION_EVAL_LIVE=1 CONVERSATION_EVAL_DISPOSABLE=1 \
CONVERSATION_EVAL_DATABASE_URL="$DISPOSABLE_LOOPBACK_DATABASE_URL" \
CONVERSATION_EVAL_TEMPLATE_WORKSPACE_ID="$QUALIFIED_TEMPLATE_WORKSPACE_ID" \
CONVERSATION_EVAL_TEMPLATE_REPOSITORY_ID="$QUALIFIED_TEMPLATE_REPOSITORY_ID" \
CONVERSATION_EVAL_MODEL_BOUNDS_JSON='[{"profileId":"ACTUAL_SELECTED_PROFILE","model":"ACTUAL_SELECTED_MODEL","contextWindowTokens":32768,"tokensPerByteUpperBound":4}]' \
  node --import tsx scripts/conversation-evals/run.ts \
  --split tuning --variant full-product --out tmp/conversation-results.json
```

Add `--corpus full-thread-v2` to the existing live command to select the successor.
The results record both selector and revision; `score.ts` loads that exact corpus.
Use a new explicit hold-out checkpoint only after tuning and protected-label review.

For a bounded integration diagnostic, add `--scenario contextual-units` to the
full-thread tuning command. The name must already exist in that corpus's tuning
split; all threads/events belonging to that scenario remain intact. This does
not accept custom messages, labels or settings. `--scenario` is rejected with
hold-out or `--validate`, and unknown names are rejected before runtime imports,
database clients or fixtures. Use the source graph through `node --import tsx`
as above, without `--conditions=production`.

Filtered runs retain actual witnesses and cleanup semantics, but always report
`UNAVAILABLE`, exit 2, and record `diagnosticScenario`,
`qualificationEligible: false` and `diagnostic_subset_not_qualification`, even
when every observation completes. The scorer refuses these diagnostic reports.
Omitting `--scenario` runs the entire selected split with the existing qualification
gates; a diagnostic subset cannot replace that run or consume a protected checkpoint.

The live database must be a migrated disposable loopback database whose name
ends in `_test`. The runner creates fresh named workspace/repository rows and
product scopes and native banks for each build, variant and scenario, then reads actual
product and native inventory to prove cold state. It never truncates a database,
seeds expected facts or reuses previous accepted records. Retained synthetic
fixture scopes and native namespaces remain identifiable in the report for the
existing operator full-forget/drain cleanup; do not delete metadata while native
cleanup debt exists. Use the existing disposable database lifecycle.

Use a dedicated disposable native deployment, never production banks. Its
configured namespace and generation must both start with `eval_`; unchanged
production configuration is rejected before fixture creation. The runner keeps
that deployment's one configured namespace/generation intact, matching its fresh
provenance activation. Scenario isolation comes from unique product scope IDs and
their native bank hashes, with observed cold inventory. It does not rewrite the
installed ledger or invent a new generation. Models may mount read-only from
the already pinned model inputs. Retain native cleanup debt and evidence until
the owned deployment is safely drained/disposed or verified by its operator.

The template workspace/repository must have an actual selected review account,
a real numeric GitHub identity and repository configuration. The explicit
candidate constructor captures that exact primary account/model and all live
owner/binding/epoch authority; it never creates a production qualification.
Processing rows and memory stay in the same fresh synthetic repository scopes,
including the separately bounded repository-isolation suffixes in full-thread-v2.
The real template and fresh workspace policy are both checked: a disabled template
cannot be widened, and either confirmation requirement remains restrictive.
The configured native namespace/generation and provenance ledger are unchanged.
Cold checks cover every synthetic scope and processing row, with no seeded facts.
Full checked context, bodyless revision evidence and effective settings are bound
into the one-shot extraction input digest. The selected-account policy
captures that binding; the fixture applies restrictive off/cap policy and uses
fresh synthetic source scopes. Replace the example model/profile strings with
the actual selected pair. The example 32768 context and four tokens/byte are
declared application planning bounds, not a claim about the model's capacity;
the public Gateway catalog does not expose that capacity. Input/output caps
remain enforced. A live corpus must settle without context errors before any
quality claim. Those declarations cannot choose a different account/model.
All standard native provider/profile/namespace and Account Gateway run-access/relay/policy
variables must be configured through their existing owning mechanisms. The
runner never manufactures a qualification or copies OAuth credentials. The
transport sends real requests and can incur native and product inference cost.
`native-selection-only` uses actual strict preview without durable effects; its
selection metrics are separate from full-product retention and answer metrics.
Run it separately only against its own genuinely qualified native configuration.
Do not populate obsolete preview proofs/mission merely to unblock Gateway tests.

Before a full-product run, the template metadata graph is: the selected repository
and active installation, its workspace (plus account-owning workspace when
different), active workspace/repository review-policy heads with their exact latest
versions, all referenced provider profiles and their actual bindings/connections,
the entitlement when present, and required FK user identities. Personal account
use also needs the actual donor membership role/personal-owner relationship and
the trusted personal-sharing setting. Preserve pending fences and availability
truthfully; unavailable bindings stop capture. No sessions, user access tokens,
comments, code, raw Gateway streams or broad production dump belong in this seed.

A hold-out execution additionally requires a new explicit
`CONVERSATION_EVAL_HOLDOUT_CHECKPOINT_ID`. The runner exits 2 for unavailable
configuration or transport and 3 when an observed run awaits human review. These
codes never mean a quality pass. No raw Gateway stream, secret or credential is
written to results. Actual terminal model and usage evidence, native service time
and product time are recorded separately; absent usage is not estimated.
Gateway extraction additionally records its actual deterministic durable child
attempt, completed effect, acknowledged Gateway cleanup, observed model,
selected-account digest and candidate run identity. Pending or missing cleanup
marks the run `UNAVAILABLE` and stops further model requests; retain the witness
and settle the original execution rather than buying a replacement call. The candidate scorer rejects a missing, unsettled or different-run
receipt, and requires cleanup `closed`. Before any calls, reports hash the actual common prompt, Gateway extractor,
shared account-policy and vendored SDK provenance file bytes. Carry those exact
source files at their repository paths in the frozen execution bundle; no
source identity is read from an environment-provided SHA.
These receipts establish execution identity; human review still decides quality.

## Human rubric and scoring

Review only observed synthetic outputs, then create a JSON rubric with `runId`,
`corpusRevision`, `reviewer`, `reviewedAt`, `entries` and `answers`:

- A Gateway candidate rubric must include `candidateSourceProfile`, containing these
  four values copied from the observed report's `profile`: `commonPromptSourceDigest`, `gatewayPreviewSourceDigest`,
  `accountPolicySourceDigest`, and `gatewaySdkProvenanceDigest`. The scorer rejects
  missing source identities or a mismatch between report and reviewed sources.
- Each entry row binds `variant`, `namespace`, actual `entryId`, `entryRevision`, `bodyDigest`,
  `supportedFactIds`, `attributionCorrect`, and `wrongScope`. Unsupported facts
  have an empty `supportedFactIds`. For parser/native-only rows use the actual
  selected output ID `selection:<threadId>:<messageId>:<index>`; parser namespace
  is `parser-baseline`, native namespace comes from the scenario result.
- Each full-product answer row binds `variant`, actual `eventId`, `supported`,
  `requiredFactsUsed`, `clarificationUnnecessary`, `replyUnnecessary`,
  `effectTruthful`, and `forbiddenEffect`. Protected mutation follow-ups also
  require `afterMutationAbstains`. A queued effect must not be labelled published.

```sh
node --import tsx scripts/conversation-evals/score.ts \
  tmp/conversation-results.json tmp/human-rubric.json
```

Every observed metadata version is checked before source attribution. Full
inventory includes inactive and pending rows, with current visible bodies kept
separately. Concrete human maintainer authority and the actual standing learning
policy determine automatic source eligibility per source revision. Both automatic
command proofs and observed automatic entries require that eligibility; semantic
support and human forbidden-effect labels cannot grant it. Explicit owner
retirement/forget retains its separate authority checks.
Actual readback records the unavailable reason, checked source
currency and the owning store's active-cohort eligibility. Only a visible active
body with successful readback and both eligibility checks earns retention,
precision or recall credit. A digest on pending or unavailable metadata earns no
such credit. Earlier qualified publication remains credited after later
retirement/forget; a never-visible pending version never does. Every new/revised statement version needs exactly one human rubric
row; the key includes the actual entry revision and digest, and authority changes
with the same ID/body are checked again. A bounded independent PostgreSQL command
inventory queries the fresh workspace, source namespace, known entry identities
and stable processing child IDs, including commands outside the requested scope.
It proves an empty command inventory at cold start and preserves cumulative IDs.
Every new durable command and returned learning/mutation ID needs an actual
bodyless command proof, including queued destructive commands with no body change.
Unreturned internal replacement/recovery retirements require a known historical
source, actual automatic ownership/cohort state and the owning stable command ID;
other unreturned commands are rejected. Proofs also check actor, scope and permitted
automatic save/withdrawal semantics. An unexpected source/actor/scope/kind/authority cannot
be removed from precision or harmful-write denominators by source filtering.

The scorer rejects an unbound rubric, a missing full-product variant, incomplete scenario/event inventory, mixed split/source mappings, a nonempty cold start,
missing native inventory proof, readback digest mismatches and unknown fact IDs.
It reports parser/native-only selection precision/recall separately. Full-product
metrics include counts/denominators, actual source attribution, entry kind and automatic authority/cohort identity, enforced request
bounds and every linked A→B/mutation witness. A required fact must be supported by
verified A readback, delivered in B's **actual** inference input and used correctly
in B's answer. The scorer cannot turn an unavailable run into a quality result.

## Focused regression checks

```sh
node --import tsx --test --test-concurrency=1 scripts/conversation-evals/eval-risk.test.ts
GOMEMLIMIT=768MiB GOMAXPROCS=2 node scripts/local-checks/compiler-cli.ts \
  --native --strict --noEmit -p scripts/conversation-evals/tsconfig.json
```

These are synthetic scorer/capture boundary regressions, including the R1
wrong-source unauthorized-rule witness, same-ID revised-digest bypass, the R2
current-schema CLI pending/no-readback negative, independent omitted-command
capture and known-owner internal retirement checks. They
never create a product bank or imply model-quality qualification.

## Source authority and measurement boundaries

The earlier source-only refinement and mandatory exact-command behavior remain
historical implementation evidence. The new authorized contract supplies the
complete checked thread to selected-account Gateway selection while preserving the selected human
maintainer as the write authority. Automatic mode is the workspace default;
confirmation mode performs selection read-only and exposes exact authored
commands through the existing conversation notice. Neither context nor a model's
JSON grants another participant permission or bypasses target/revision checks.

The 48-thread corpus and protected labels have **not** been rewritten to match a
new implementation. Report behavior honestly against their original expectations;
do not remove a hold-out witness or treat structural validation as quality. The
successor is separately selected and versioned, and its explicit confirmation
events are visible inputs, not a repair silently applied to the old corpus.

The selected template account and fresh synthetic product scopes resolve through
the existing binding and dispatch owners. Candidate processing and memory use the
same per-repository synthetic tenant, while the immutable account manifest binds
the exact real template account/model and current owner/epoch. This is the explicit
operator-only candidate constructor, not a production qualification or an Action
request capability. Full-thread repository isolation does not widen the original
synthetic identity guard. Missing or incompatible fixture setup remains UNAVAILABLE;
never repair it with a Prisma proxy, grant bypass, copied credentials or a mocked
quality PASS.
