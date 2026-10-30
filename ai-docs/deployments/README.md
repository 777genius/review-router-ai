# Deployment tasks

Keep one Markdown file per task whose implementation still needs deployment or
environment work. This includes ordinary code rollout, migrations, configuration,
data conversion, feature activation, and verification. Agents create or update
the record with the implementation and leave it ready for the next deployment.
Documentation-only changes with no environment work do not need a task record.

The [release process](../operations/07-environments-and-release-management.md)
remains authoritative for release gates, migration order, approvals, and tags.
Task files add feature-specific instructions and actual environment evidence.
They do not grant deployment permission or replace existing operational runbooks.

## Task index

| Task                                                                                   | Implementation                                                                                                                              | Staging   | Production    | Remaining work                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Review History](2026-10-28-review-history.md)                                         | [PR #730](https://github.com/777genius/review-router-ai/pull/730)                                                                           | `pending` | `deployed`    | Production capture/activation, live repeat runs, UI and workspace isolation verified.                                                         |
| [Account model catalog](2026-10-28-model-catalog.md)                                   | [PR #739](https://github.com/777genius/review-router-ai/pull/739), [PR #740](https://github.com/777genius/review-router-ai/pull/740)        | `pending` | `in_progress` | Qualify integrated source, adopt its compatible application/Action pair and verify native finding closure.                                    |
| [Skills catalog](2026-10-28-skills-catalog.md)                                         | [PR #735](https://github.com/777genius/review-router-ai/pull/735)                                                                           | `pending` | `deployed`    | Bounded Skills repair deployed; subsequent application rollout preserves it. PR CI/merge remains separate.                                    |
| [Dispatch cleanup and Scanner CI](2026-10-28-dispatch-cleanup-ci.md)                   | [PR #732](https://github.com/777genius/review-router-ai/pull/732)                                                                           | `pending` | `pending`     | Final source/main release gates; schema/fleet reconciliation, coherent consumers and verification.                                            |
| [Conversational memory and shared inference](2026-10-29-conversational-memory.md)      | [PR #734](https://github.com/777genius/review-router-ai/pull/734), [successor #744](https://github.com/777genius/review-router-ai/pull/744) | `pending` | `pending`     | Coherent rollout; full-thread model/privacy, workspace confirmation settings and installed App qualification.                                 |
| [Unified OCR and verification](2026-10-29-unified-ocr.md)                              | [PR #718](https://github.com/777genius/review-router-ai/pull/718), [Action #346](https://github.com/777genius/review-router/pull/346)       | `pending` | `pending`     | N/A4 baseline qualified; selected integration checks, migrations152/154, compatible fleet/producer and live provider/App verification remain. |
| [Several Gateway reviewers](2026-10-29-gateway-multi-reviewers.md)                     | [SaaS #738](https://github.com/777genius/review-router-ai/pull/738), [Action #351](https://github.com/777genius/review-router/pull/351)     | `pending` | `pending`     | Migrations 152/154, compatible fleet and qualified producer, disposable canary.                                                               |
| [Review dispatch retry storm](2026-10-29-review-dispatch-retry-storm.md)               | [PR #742](https://github.com/777genius/review-router-ai/pull/742)                                                                           | `pending` | `pending`     | Ordinary worker rollout with the next selected release; verify no redispatch after cancellation.                                              |
| [Trusted Statistics and Usage reports](2026-10-29-statistics-history-followthrough.md) | [PR #743](https://github.com/777genius/review-router-ai/pull/743)                                                                           | `pending` | `pending`     | Complete qualification; ordinary coherent Web/feature rollout and authenticated journey verification.                                         |

The task file is authoritative; keep this summary in sync in the same commit.
Missing entries do not prove that older changes are deployed: inspect the installed-to-target change range and
the release runbook for additional required work before each rollout.

## Status contract

Track status separately for each environment; add a named deployment/cohort when
an environment has multiple independently managed targets. Staging completion
never changes production status automatically.

| Status        | Meaning                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`     | No verified completion is recorded for this environment. Reconcile actual state before executing; this does not prove the code or a step is absent. |
| `in_progress` | Rollout has started. Record completed steps, evidence, and the next step.                                                                           |
| `blocked`     | An applicable required step cannot proceed. Record the exact blocker and what would unblock it.                                                     |
| `deployed`    | All required deployment, migration, configuration, activation, and verification steps passed in this environment, with evidence.                    |
| `rolled_back` | The rollout was reverted or the feature disabled. Record remaining schema, flags, data, and any recovery work before another attempt.               |

An unrelated or future task stays pending when it is outside the selected
release. Record that exclusion in the deployment summary; do not mark it deployed
or block an unrelated release because it exists. Preserve completed task records.

## Agent workflow

1. **Record the task.** Copy [TEMPLATE.md](TEMPLATE.md) to
   `YYYY-MM-DD-short-task-name.md`. Fill in the goal, affected services, related
   PRs/issues, implementation reference, prerequisites, ordered rollout,
   verification, retry/rollback, and environment status. Add it to the index.
2. **Select applicable work before deployment.** Read every unfinished entry for
   the target environment. Confirm its implementation and commands are included
   in the exact authorized release, inspect the actual installed fleet/schema,
   and check dependencies and existing holds. Add missing task records discovered
   in the release diff. Include applicable remaining steps in the rollout rather
   than leaving them as a handoff note.
3. **Execute in dependency and phase order.** Follow the release guide and each
   task's before-code, fleet, activation, and verification requirements. Reuse
   verified completed steps. Only repeat an operation when its runbook permits
   it; one idempotent command does not make the whole rollout idempotent. A task
   file never overrides an environment gate or expands the authorized release.
4. **Update after every attempt.** Record status and step completion separately
   per environment, including partial success, failures, blockers, and rollback.
   Keep task and index consistent and commit the documentation through the normal
   repository flow. Do not lose an incomplete rollout behind a successful merge.
5. **Close on observed results.** Set `deployed` only with the actual shipped
   commit/release or image digest, verification time, deployment/workflow or
   durable receipt links, and successful task-specific checks. PR/CI/local-test
   evidence establishes implementation readiness, not environment deployment.

Keep links to implementation PRs, plans, runbooks, migrations/scripts, relevant
CI, and actual rollout evidence in the task. Store secret-free summaries and
durable links; credentials, connection strings, and private payloads do not
belong here. Ignored local `tmp/` receipts alone cannot establish completion for
the next agent. If fresh evidence contradicts `deployed`, reopen the environment
status and record the discrepancy and required recovery.
