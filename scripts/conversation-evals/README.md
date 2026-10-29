# Conversation quality qualification

This owner contains one synthetic corpus and a thin runner around the **actual**
conversation application, PostgreSQL processing/memory stores, native memory
preview/delivery/readback and selected-account Gateway policy. It creates no
second extractor, semantic judge, memory store, inference service or product
logging endpoint. The synthetic source authority is a fixture; this run does not
qualify a real GitHub App installation or replace the disposable App-first E2E.

## Fixed corpus and gates

`corpus.json` has 48 whole threads, 32 tuning and 16 protected hold-out, 149 source events and 81 eligible facts. Eight distinct repository scenarios have
linked A→B threads, five in tuning and three in hold-out. B has no copy of A's fact
in its source or code; protected pairs cover ordinary, replies-off and capped
learning, then an explicit retirement/forget and a fresh B source revision.
Different variants and splits never share accepted records, source IDs, product
scopes or native banks. Labels are loaded only by the scoring/inspection side;
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

Live quality requires the independently qualified strict-preview image/config,
mission and native model plus the real selected-account Gateway setup. Missing
configuration produces `UNAVAILABLE`, never a passing mocked quality score.
Deterministic product transport/authority suites remain separate contract proof.
Human review binds rubric decisions to the result run ID and source-event IDs;
there is no second LLM semantic verifier. Tune on the tuning split, then run one
planned hold-out checkpoint. A failed hold-out becomes regression evidence; a
new protected set is required before another independent qualification claim.

## Run

Run from the control-plane checkout with its exact installed lockfile/toolchain:

```sh
node --import tsx scripts/conversation-evals/run.ts --validate
REVIEW_ROUTER_ACTION_SOURCE_DIR=/absolute/pinned/action-checkout \
  node --import tsx scripts/conversation-evals/run.ts \
  --split tuning --variant parser-baseline --out tmp/parser-results.json
CONVERSATION_EVAL_LIVE=1 CONVERSATION_EVAL_DISPOSABLE=1 \
CONVERSATION_EVAL_DATABASE_URL="$DISPOSABLE_LOOPBACK_DATABASE_URL" \
CONVERSATION_EVAL_TEMPLATE_WORKSPACE_ID="$QUALIFIED_TEMPLATE_WORKSPACE_ID" \
CONVERSATION_EVAL_TEMPLATE_REPOSITORY_ID="$QUALIFIED_TEMPLATE_REPOSITORY_ID" \
  node --import tsx scripts/conversation-evals/run.ts \
  --split tuning --variant all --out tmp/conversation-results.json
```

The live database must be a migrated disposable loopback database whose name
ends in `_test`. The runner creates fresh named workspace/repository rows and
memory/native namespaces for each build, variant and scenario, then reads actual
product and native inventory to prove cold state. It never truncates a database,
seeds expected facts or reuses previous accepted records. Retained synthetic
fixture scopes and native namespaces remain identifiable in the report for the
existing operator full-forget/drain cleanup; do not delete metadata while native
cleanup debt exists. Use the existing disposable database lifecycle.

The template workspace/repository must already have a qualified selected review
account and repository configuration. The production selected-account policy
captures that binding; the fixture applies restrictive off/cap policy and uses
fresh synthetic source scopes. All standard native provider/profile/namespace,
strict-preview qualification/mission and Account Gateway run-access/relay/policy
variables must be configured through their existing owning mechanisms. The
runner never manufactures a qualification or copies OAuth credentials. The
transport sends real requests and can incur native and product inference cost.
`native-selection-only` uses actual strict preview without durable effects; its
selection metrics are separate from full-product retention and answer metrics.

A hold-out execution additionally requires a new explicit
`CONVERSATION_EVAL_HOLDOUT_CHECKPOINT_ID`. The runner exits 2 for unavailable
configuration or transport and 3 when an observed run awaits human review. These
codes never mean a quality pass. No raw Gateway stream, secret or credential is
written to results. Actual terminal model and usage evidence, native service time
and product time are recorded separately; absent usage is not estimated.

## Human rubric and scoring

Review only observed synthetic outputs, then create a JSON rubric with `runId`,
`corpusRevision`, `reviewer`, `reviewedAt`, `entries` and `answers`:

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
node --import tsx --test scripts/conversation-evals/eval-risk.test.ts
GOMEMLIMIT=768MiB GOMAXPROCS=2 node scripts/local-checks/compiler-cli.ts \
  --native --strict --noEmit -p scripts/conversation-evals/tsconfig.json
```

These are synthetic scorer/capture boundary regressions, including the R1
wrong-source unauthorized-rule witness, same-ID revised-digest bypass, the R2
current-schema CLI pending/no-readback negative, independent omitted-command
capture and known-owner internal retirement checks. They
never create a product bank or imply model-quality qualification.

## Source-authority security refinement

The current preview path receives only the selectable source. Full-thread replies
still use the checked complete snapshot. Explicit model-proposed mutations require
a standalone source-authored confirmation binding every action field; an arbitrary
natural-language proposal is not automatically an approved write. Qualify both the
proposal/no-effect turn and a separate author confirmation in a disposable installed
conversation, including stale revision, mixed authors and replies-off behavior.

The 48-thread corpus and protected labels have **not** been rewritten to make this
restriction pass. Source-only extraction can reduce recall for context-dependent
statements, and explicit mutation cases without a confirmation may correctly stop
at clarification. Report those observations honestly against the existing labels;
do not remove a hold-out witness, auto-confirm a proposal in the fixture, or claim
that corpus structure validation is measured semantic quality. Any successor corpus
must be separately versioned and reviewed before a new protected checkpoint.
