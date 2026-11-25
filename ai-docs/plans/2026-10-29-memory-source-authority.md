# Memory source authority: bounded security refinement

Historical refinement. The owner explicitly replaced its source-only extraction
and unconditional confirmation choices on 2026-10-30 with
[full-thread learning and one workspace confirmation setting](2026-10-30-full-thread-memory-settings.md).
Permission, exact source/evidence validity, audiences, replay and cleanup remain.
The historical evidence below does not qualify the successor's model behavior.

Date: 2026-10-29. Scope: review-router-ai #734, source attribution and explicit
mutation authority. This refines the unactivated conversational profile; it does
not activate a deployment, waive live qualification, or claim new independent
model review rounds. Original user intent, scope and implementation remain in the
[approved plan](2026-10-28-conversational-memory-and-shared-llm.md).

## Decision and product behavior

Complete multi-author inline chronology is still read and supplied to the answer
model, together with audience-authorized memory. Automatic selection is a separate
privileged operation: its portable and product ports now accept only the verified
eligible maintainer revision, with no thread/code/recalled-context field. The
native engine still performs semantic selection, consolidation and recall. Router
does not add a second extractor, lexical-overlap heuristic or semantic judge.
The wire is identical for identical source/configuration irrespective of foreign
thread content, including unknown context fields supplied by JavaScript clients.

One source's model-generated facts are still not a deterministic semantic proof.
Native hallucination, negation and quotation fidelity require live evaluation.
The security claim is removal of the mixed-author input channel, not universal
truth verification. A phrase needing another person's text must abstain; useful
standalone maintainer observations continue to learn without per-fact approval.

The full-thread answer model may propose a memory mutation but cannot authorize
it. One pure conversation-domain renderer defines exact English/Russian authored
confirmation forms. The verified latest human maintainer message must equal one
of those forms, binding kind, complete body, exact entry/exception target and
revision. Actor, comment identity, source timestamp and body digest also match.
Only EOL and outside whitespace normalize; model text is not semantically matched
or case-folded. Earlier messages, quotations, negations, partial confirmations and
other participants cannot complete that decision. Legitimate mixed-author threads
remain usable; there is no blanket rejection of other contributors.

The use case and actual mutation adapter call the same guard. Unconfirmed output
becomes a truthful server-rendered clarification, not an effect or generated success
notice. A confirmed matching command enters the existing permissions, revision CAS,
source-current, idempotency and cleanup owners. No new endpoint, schema, migration,
confirmation table, agent, provider or paid request is introduced. Free-form
mutations may need one explicit confirmation turn; this is the disclosed security
tradeoff relative to one-turn arbitrary natural-language CRUD. A matching authored
command needs no additional confirmation.

Examples: `Remember observation: IDs preserve leading zeroes.`, `Запомни правило:
Use pnpm.`, `Update mem_example@2: Use Vitest.`, `Stop using auto_example@3`,
`Forget mem_example@4`, `Разреши повторное обучение auto_example@5`.
The displayed confirmation always contains the exact candidate fields. Stale
revisions remain rejected by the existing store. Physical Forget retains its
operator cleanup and evidence procedure; accepting a command is not complete erasure.

## Verification scope

Risk-focused tests cover every mutation kind, independent English/Russian expected
forms, unrequested model actions, author/source drift, exact body/type/target/revision,
quotes and negation, replay without a second paid request, safe Markdown fences,
actual adapter rejection before any command/outbox row, and source-only native
transport noninterference. The existing positive PostgreSQL lost-ack lifecycle now
uses an actually authored exact command instead of an unrelated question. Neither
production permission checks nor existing correctness assertions are weakened.

Run the pinned standard gates plus `memory-projections.yml` on the final feature
head. The targeted qualification must run actual PostgreSQL tests with no skips,
full memory/authority units, the package consumer build, protocol, and affected
package typechecks. Inspect receipts rather than treating a queued job as success.
Locally transpiled source assertions are only preliminary mechanism evidence.
The final PR review/CI record supplies actual SHA-bound results, not this decision.

## Activation and handoff

The [deployment registry task](../deployments/2026-10-29-conversational-memory.md)
remains the sole rollout record. Ship API, worker, web and the portable package
from one tested release, keep the contextual qualification inactive, and qualify
source-only selection plus explicit confirmations on the actual selected models
and installed GitHub App. This refinement introduces no additional migrations.
Do not reuse historical full-context semantic scores as source-only evidence.

The existing 48-thread corpus/protected labels are retained without edits. A
change in recall or extra clarification must be reported, not hidden by changing
thresholds or silently auto-confirming writes in the fixture. Stage any revised
corpus separately through its owner before using a new protected checkpoint.
Staging/production remain pending until their actual receipts exist. Another
agent may merge only after current required checks and security review are clear;
merge readiness is not a production quality or deployment claim.
