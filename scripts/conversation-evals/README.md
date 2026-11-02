# Conversation quality qualification

This owner contains versioned synthetic corpora and a thin runner around the **actual**
conversation application, PostgreSQL processing/memory stores, selected-account
Gateway extraction/replies and native delivery/readback. It creates no
second extractor, semantic judge, memory store, inference service or product
logging endpoint. The synthetic source authority is a fixture; this run does not
qualify a real GitHub App installation or replace the disposable App-first E2E.

## Isolated Gateway/Hindsight quality E2E

The focused [Memory quality evaluation](../../.github/workflows/memory-quality-evals.yml)
workflow verifies all three immutable corpora plus scorer regressions on PRs,
without obtaining model credentials or making paid requests. The new
`--corpus multilingual-v1` is independently versioned as
`2026-11-02-multilingual-r1`: **10 threads, 14 events, 7 fact labels**;
4 tuning / 6 protected. The successor explicitly includes RU and mixed RU/EN
contexts, prompt injection, quote/negation, source edit, cross-repository
isolation and actual A→B recall. All original corpora are unchanged.

An operator can select **Run workflow → live-tuning** on reviewed `main`,
with a protected `memory-quality-eval` environment and an isolated runner
(`MEMORY_QUALITY_EVAL_RUNNER`). Required environment secrets/variables are named
in the workflow. Set `MEMORY_EVAL_PRIVATE_RESULTS_DIR` to an existing
operator-owned mode-0700 directory under `/srv/reviewrouter-memory-quality/`
on that runner. Before *any* paid inference, the workflow verifies its real
path and access, then creates a run-ID subdirectory with restrictive permissions.
Each raw result is written there with mode 0600 and must be reviewed/retired
under the operator's existing private evidence policy. No raw model responses
or private account metadata are uploaded as public GitHub Actions artifacts. The operator must separately qualify the selected Account
Gateway account/model, native Hindsight generation and a migrated disposable
loopback PostgreSQL database ending `_test`. The preflight refuses PR/head
runs, absent authorization, production database/native endpoints, reused
production generation, a protected checkpoint and missing selected-model
bounds. It runs **three fresh full-product tuning observations** using the
existing runner; failures stop the loop rather than buying replacement
inference. This is not a release action or production activation.

A successful tuning workflow reports **AWAITING_HUMAN_RUBRIC**, never
automatically claims semantic accuracy. The result JSON is bounded synthetic
observation evidence and must be reviewed under the existing human rubric
contract. The scorer requires actual source/current authority, delivered
body digests and a closed selected-account Gateway receipt. Use the exact
returned `runId`, `corpusRevision` and observed source digests in each rubric:

```sh
node --import tsx scripts/conversation-evals/score.ts \
  private/tuning-1.json private/tuning-1.rubric.json
node --import tsx scripts/conversation-evals/score.ts \
  private/tuning-2.json private/tuning-2.rubric.json
node --import tsx scripts/conversation-evals/score.ts \
  private/tuning-3.json private/tuning-3.rubric.json
node --import tsx scripts/conversation-evals/memory-quality-reliability.ts \
  private/tuning-1.json.score.json \
  private/tuning-2.json.score.json \
  private/tuning-3.json.score.json
```

The independent reliability summary compares three human-reviewed run IDs,
one actual model and identical source/configuration digests; it preserves each
run's numerator/denominator and reports min/max/range, failures and causal
linked-recall witnesses without pooling correlated examples. Missing rubrics,
model identity, authorization evidence, or a valid denominator never become
a PASS. This tiny engineering benchmark does **not** establish population
reliability. Protected holdout is not dispatched by this workflow; run one
new checkpoint only after tuning is complete and the existing protected
review/approval process is followed. Keep live artifacts strictly synthetic
and protected from public release when they contain operator metadata.

## Full-thread successor slice

`--corpus full-thread-v2` selects the separately versioned
`corpus.full-thread-v2.json`, revision `2026-10-30-full-thread-r1`: **16 whole
threads, 10 tuning / 6 protected, 50 events and 21 fact labels in 10 scenario
groups**. Four groups have positive same-repository A→B recall. Two other paired
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
**Live native/product precision, recall and answer quality remain UNAVAILABLE until
a qualified live run and bound human rubric exist.** No protected live checkpoint
has been consumed for this successor. Its new protected labels must be reviewed
before the first qualification claim. Existing deterministic native/PG suites do
not supply semantic scores.

## Isolated multilingual and repeated Gateway/Hindsight quality E2E

The independent `--corpus multilingual-v1` selects revision
`2026-11-02-multilingual-r1`: **10 whole Russian/mixed Russian-English
threads, 14 source events, 7 labeled facts; 4 tuning / 6 protected threads**.
Three linked A→B groups include two positive recall paths and one
cross-repository isolation path; only actual same-repository A→B delivery can
earn positive recall. The original two corpora, labels and thresholds are
untouched. The held-out messages/labels are not tuning prompts.

[`memory-quality-evals.yml`](../../.github/workflows/memory-quality-evals.yml)
runs *only* fixed corpus/scorer contracts on pull requests. It also supports
a manual `live-tuning` dispatch **from reviewed `main`**, never a PR,
using the protected `memory-quality-eval` GitHub Environment and dedicated
`MEMORY_QUALITY_EVAL_RUNNER` variable. This runner must have a previously
provisioned **disposable migrated local PostgreSQL database** named `*_test`
containing only the minimum selected-account template graph; it must also
connect to a **separate Hindsight native service on loopback** with a
qualified `eval_*` namespace and generation. A tunnel to an isolated
service is acceptable; **do not point the native URL at production**.
The Gateway is the actual authorized selected-account inference route.
No workflow step creates an account, skips a grant, installs a Hindsight
production image or performs a deployment.

The environment must provide, without exposing values in logs:

| Setting | Source |
| --- | --- |
| `MEMORY_QUALITY_EVAL_RUNNER`, `MEMORY_EVAL_NAMESPACE`, `MEMORY_EVAL_GENERATION` | Protected environment/repository variables; both IDs begin `eval_` |
| `MEMORY_EVAL_TEMPLATE_WORKSPACE_ID`, `MEMORY_EVAL_TEMPLATE_REPOSITORY_ID` | Minimal selected-account template fixture identifiers |
| `MEMORY_EVAL_MODEL_BOUNDS_JSON` | Actual selected model/profile operational bounds, not an invented quality proof |
| `MEMORY_EVAL_OPERATOR_ACK` | Protected secret, exact `APPROVED_ISOLATED_QUALITY_EVAL` |
| `MEMORY_EVAL_DISPOSABLE_DATABASE_URL` | Protected secret, local PostgreSQL `*_test` only |
| `MEMORY_EVAL_HINDSIGHT_URL`, `MEMORY_EVAL_HINDSIGHT_API_KEY` | Protected secrets, **dedicated loopback native**, never production |
| `MEMORY_EVAL_GATEWAY_ORIGIN`, `MEMORY_EVAL_GATEWAY_RUN_CONTROL_BEARER` | Authorized Gateway endpoint and scoped run-control secret |
| `MEMORY_EVAL_GATEWAY_POLICY`, `MEMORY_EVAL_GATEWAY_RELAY_POLICY` | Existing selected-account Gateway authorization and relay policies |

If a requirement is absent or the operator has not approved the run, preflight
fails before paid inference. No such environment is created automatically.
The live job runs three separately named **full-product tuning** observations,
not model-quality PASS assertions. A completed observation has exit code `3`
and status `AWAITING_HUMAN_RUBRIC`; `2`/`UNAVAILABLE` is a real
qualification blocker and stops further calls. Incomplete or ambiguous
Gateway effects require investigation of the original attempt and cleanup,
**not an automatic charged retry**. The bounded synthetic observations remain only in the operator-controlled
private runner directory. **This workflow does not implement a three-day TTL
or upload any GitHub artifact.** The operator must enforce an explicit private
evidence retention/deletion policy and retire namespaces through the qualified
native cleanup operator, never direct deletion. These observations are not
customer data, a real App qualification or production activation.

Bind **each** observed report to an independent human rubric using the existing
[scorer](score.ts) and its exact run ID/source digests:

```sh
node --import tsx scripts/conversation-evals/score.ts tuning-1.json rubric-1.json
node --import tsx scripts/conversation-evals/score.ts tuning-2.json rubric-2.json
node --import tsx scripts/conversation-evals/score.ts tuning-3.json rubric-3.json
node --import tsx scripts/conversation-evals/memory-quality-reliability.ts \
  tuning-1.json.score.json tuning-2.json.score.json tuning-3.json.score.json
```

The comparison rejects duplicate run IDs, missing rubrics, inconsistent source
digests, corpus revision, selected model/bounds or non-Gateway runs. It reports
actual numerator/denominator for every run and min/max/range; it never pools
correlated examples into fake statistical confidence. `PASS` means **all three
independently human-scored tuning runs** met existing engineering gates, not
population reliability, an unconsumed protected holdout, or live product
activation. Use the existing separately authorized one-time holdout process
*only after* evaluating tuning and reviewing protected labels. Do not add a
holdout option to the CI workflow or repeat a consumed holdout as new evidence.

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
