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

Memory source candidate: [One-turn source-fenced learning](2026-11-03-memory-one-turn-learning.md) — staging/production `pending`; one parent request, no new quality/deployment claim. Private227 installed independently; first live tuning failed (precision20/23, three unauthorized effects); evidence-binding repair and fresh qualification pending.

Hosted test infrastructure: [stock self-hosted network isolation](2026-11-03-selfhost-test-network-isolation.md) — test target `pending`: continuous configured-HTTPS acceptance PASS on b361; source merged in PR803/543869f7a, without merged-source target installation evidence. Product networks and production services are outside this test-harness change.

**Current production baseline:** release227 / `dbc161c986`, image `89a28e11`, public Action/channel `abff4814`. See [status reconciliation and owner decision](2026-11-03-production-status-reconciliation.md). `installed` means the code is already delivered and must not be redeployed merely to close a special verification item. Staging `pending` is not a production rollout instruction. Memory successors and GitLab remain separate.

Hosted test infrastructure: [stock self-hosted network isolation](2026-11-03-selfhost-test-network-isolation.md) - source-only candidate b361 continuous configured-HTTPS disposable acceptance PASS; normal PR803 distribution pending. Product networks and production services are outside this test-harness change.

Gateway saturation follow-up: [terminal-run cleanup](2026-11-02-gateway-terminal-run-cleanup.md) - staging `pending`, production `installed`;227 contains the repair. Old unknown test executions are retained and their reconciliation is waived by the owner; no repeat deploy/replay is required.

Current reliability batch: [Analytics and review completion](2026-11-02-analytics-review-reliability.md) - staging `pending`, production `deployed`; A/B evidence retained, fresh227 Payments17/17 and Statistics verified. Usage honestly records one optional description unknown. Old test-event recovery is waived.

Bounded request capacity: [Named capacity128 rollout](2026-11-03-model-dispatch-capacity.md) — staging `pending`, production `deployed`; paired227 / `dbc161c` + `abff4814`, image `89a28e11`, immutable128 producer and workflow-v1 verified. Fresh Payments17/17 found two minor issues; Statistics and truthful Usage readbacks passed. One optional description call has unknown outcome/tokens, preserved without replay. See the [durable summary](evidence/2026-11-03-capacity128-release227.json).

| Task                                                                                   | Implementation                                                                                                                                                    | Staging   | Production    | Remaining work                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Public AI-agent discovery](2026-11-02-public-agent-discovery.md)                      | [PR #786](https://github.com/777genius/review-router-ai/pull/786)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Reviewer-v4 MCP qualification](2026-11-01-reviewer-v4-mcp.md)                         | Source/test `a09c68214`; [PR777](https://github.com/777genius/review-router-ai/pull/777)                                                                          | `pending` | `deployed`    | 226 API code installed; accepted historical2/2 and six real MCP calls retained; seven configured tools preserved. No broader matrix claim.                                                                                           |
| [Memory bootstrap cleanup](2026-11-01-memory-bootstrap-cleanup.md)                     | Explicit saved PostgreSQL infrastructure binding and bounded complete-host inventory                                                                              | `n/a`     | `deployed`    | 226 operator delivered; prior two task-owned signed physical Forget settlements retained. Self-hosted distribution/update remains separate.                                                                                          |
| [Memory production startup](2026-11-01-memory-production-startup.md)                   | Official 226 / application `6e6a0f078`; Gateway `a717bfe5` / native `f2deab24` preserved                                                                          | `n/a`     | `in_progress` | 226/6e installed; native state and prior signed Forget preserved. Qualification/App/genuine-artifact update remain pending; candidate b361 configured-HTTPS stock PASS.                                                              |
| `installed`                                                                            | The actual production code/image is installed. Some feature-specific verification remains unproven; this is not permission or a requirement to repeat deployment. |
| [Explicit locked Memory resume](2026-11-02-memory-explicit-resume.md)                  | Compatible operator/writers installed in 226; historical657/b53 continuation retained                                                                             | `n/a`     | `in_progress` | 226 compatible writers/operator installed. Historical continuation retained; candidate b361 configured-HTTPS continuous stock PASS. Genuine-artifact distribution/update and qualification pending.                                  |
| [Architecture and reliability](2026-10-30-architecture-reliability.md)                 | [PR #747](https://github.com/777genius/review-router-ai/pull/747)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [GitLab inventory](2026-10-31-gitlab-installation-inventory.md)                        | [PR #753](https://github.com/777genius/review-router-ai/pull/753)                                                                                                 | `pending` | `pending`     | Shared226 code installed; external GitLab cohort acceptance remains outside this GitHub rollout and unverified.                                                                                                                      |
| [GitLab OIDC issuer scope](2026-10-31-gitlab-oidc-issuer-scope.md)                     | [PR #754](https://github.com/777genius/review-router-ai/pull/754)                                                                                                 | `pending` | `pending`     | Shared226 code installed; external GitLab cohort acceptance remains outside this GitHub rollout and unverified.                                                                                                                      |
| [GitHub webhook privacy](2026-10-31-github-webhook-error-privacy.md)                   | [PR #755](https://github.com/777genius/review-router-ai/pull/755)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Outbox error privacy](2026-10-31-outbox-error-privacy.md)                             | [PR #756](https://github.com/777genius/review-router-ai/pull/756)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Review publication item isolation](2026-10-31-review-publication-item-isolation.md)   | [PR #751](https://github.com/777genius/review-router-ai/pull/751)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Review History](2026-10-28-review-history.md)                                         | [PR #730](https://github.com/777genius/review-router-ai/pull/730)                                                                                                 | `pending` | `deployed`    | Production capture/activation, live repeat runs, UI and workspace isolation verified.                                                                                                                                                |
| [Account model catalog](2026-10-28-model-catalog.md)                                   | [PR #739](https://github.com/777genius/review-router-ai/pull/739), [PR #740](https://github.com/777genius/review-router-ai/pull/740)                              | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Skills catalog](2026-10-28-skills-catalog.md)                                         | [PR #735](https://github.com/777genius/review-router-ai/pull/735)                                                                                                 | `pending` | `deployed`    | Full text-only UAP → Skills → OCR/App publication E2E passed on Oct 29; later rollouts preserve the repair. Final evidence delivery: #735; staging unverified.                                                                       |
| [Dispatch cleanup and Scanner CI](2026-10-28-dispatch-cleanup-ci.md)                   | [PR #732](https://github.com/777genius/review-router-ai/pull/732)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Current-source Memory evidence](2026-11-03-memory-current-source-evidence.md)         | Original286 implementation in226/6e; Merged800/347 (observed feature9a6), preview797 not deployed                                                                 | `pending` | `in_progress` | Original286 code shipped in226 unqualified; Merged800/347 (observed feature9a6), preview797 not deployed. Contextual-adoption and truthful reviewer-reporting source merged; T1 unavailable, no semantic/App/artifact qualification. |
| [Conversational memory and shared inference](2026-10-29-conversational-memory.md)      | [PR785](https://github.com/777genius/review-router-ai/pull/785), ordinary226/6e code; semantic capability unset                                                   | `pending` | `in_progress` | 226/6e ordinary code installed; qcap/pin unset, FREE config89+7MCP preserved. No semantic PASS; App/genuine artifact/HTTPS stock pending.                                                                                            |
| [Unified OCR and verification](2026-10-29-unified-ocr.md)                              | [SaaS #745](https://github.com/777genius/review-router-ai/pull/745), [Action #354](https://github.com/777genius/review-router/pull/354)                           | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Several Gateway reviewers](2026-10-29-gateway-multi-reviewers.md)                     | [SaaS #738](https://github.com/777genius/review-router-ai/pull/738), [Action #351](https://github.com/777genius/review-router/pull/351)                           | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Review dispatch retry storm](2026-10-29-review-dispatch-retry-storm.md)               | [PR #742](https://github.com/777genius/review-router-ai/pull/742)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Trusted Statistics and Usage reports](2026-10-29-statistics-history-followthrough.md) | [PR #743](https://github.com/777genius/review-router-ai/pull/743)                                                                                                 | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Usage SQL read path](2026-10-30-usage-sql-read-path.md)                               | [PR #746](https://github.com/777genius/review-router-ai/pull/746)                                                                                                 | `pending` | `deployed`    | Migration155/index already applied and valid since Oct31; retained in227, fresh Usage verified. Optional load testing is not another deployment.                                                                                     |
| [Analytics extensibility](2026-10-31-analytics-extensibility.md)                       | [#768][analytics-catalog], [#769][analytics-ui], [#770][analytics-diagnostics]                                                                                    | `pending` | `installed`   | Code installed in227; remaining specific checks are verification-only, not another deployment. Historical recovery waived; see current disposition.                                                                                  |
| [Worker repository INSERT fence](2026-11-02-worker-repository-insert-scope.md)         | [PR783](https://github.com/777genius/review-router-ai/pull/783) + [installation fix799](https://github.com/777genius/review-router-ai/pull/799), SQL `b34490ba…`  | `pending` | `deployed`    | 226/6e fleet; corrected ced6 SQL live, actual worker LOGIN + four 42501 + signed sync PASS; archived private residue retained; #761 separate.                                                                                        |
| [Production rollout 533c040d](2026-10-30-production-rollout-533c040d.md)               | Main `533c040d`, Action v1.0.224                                                                                                                                  | `pending` | `deployed`    | Follow-ups and per-task verification remain in the linked rollout/task records.                                                                                                                                                      |
| [Production rollout d5f16400](2026-10-31-production-rollout-d5f16400.md)               | Main `d5f16400`, PRs #752, #757, #758, #759                                                                                                                       | `pending` | `deployed`    | Shared evidence for the tasks above; follow-ups listed in the record.                                                                                                                                                                |
| [V4 review memory authorization](2026-11-01-memory-review-authorization.md)            | [PR #776](https://github.com/777genius/review-router-ai/pull/776), Core `57cc1513` and Action `v1.0.225`: reviewer delivery and physical Forget verified          | `n/a`     | `deployed`    | Production authorization/retrieval E2E verified. Self-hosted rollout and automatic-learning qualification/release delivery remain pending in #774.                                                                                   |
| [Gateway refusal diagnostics][gateway-refusal]                                         | [PR #772](https://github.com/777genius/review-router-ai/pull/772)                                                                                                 | `pending` | `deployed`    | `57cc15137` logger active; Gateway a717bfe/native f2deab cutover and fresh FREE run 41425170166 passed, required coverage 1/1; optional description unknown retained.                                                                |

[gateway-refusal]: 2026-11-01-companion-gateway-refusal-diagnostics.md
[analytics-catalog]: https://github.com/777genius/review-router-ai/pull/768
[analytics-ui]: https://github.com/777genius/review-router-ai/pull/769
[analytics-diagnostics]: https://github.com/777genius/review-router-ai/pull/770

The task file is authoritative; keep this summary in sync in the same commit.
Missing entries do not prove that older changes are deployed: inspect the installed-to-target change range and
the release runbook for additional required work before each rollout.

Installed Gateway onboarding: [scoped operator path](2026-11-02-installed-gateway-operator-onboarding.md) - staging `pending`, production `deployed`; genuine scoped CLI READY/CREATED and fresh227 Payments17/17/App/Statistics verified. No repeated onboarding or legacy replay.

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

## Production R1 /226 evidence

[The 2026-11-03 shared release summary](evidence/2026-11-03-memory-production-r1-226.json)
binds official 6e application/image, staged226 producer/ref adoption, corrected 783
guard and actual worker/signed-sync proofs. It preserves the failed first grant
attempt, extra formal-catalog diagnostic and archived private fixture residue.
A/B have full coverage; B adds zero new issues and retains the original A lineage,
with the prior issue NOT VERIFIED rather than resolved. Payments is PARTIAL 0/17
after 32 complete requests and 508,896 tokens; a versioned successor and future
fresh normal acceptance remain pending. Ordinary release
is complete while semantic Memory qualification and genuine self-hosted
artifact/configured-HTTPS acceptance remain separate and unfinished.

Release227 supersedes the historical Payments-pending statement in the R1/226 section above. See [the actual capacity128 rollout and live acceptance](2026-11-03-model-dispatch-capacity.md#release227-actual-rollout-and-live-acceptance); separate Memory successor and GitLab work are not claimed complete.
