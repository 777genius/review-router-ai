# Task name: deployment

- Task ID: `YYYY-MM-DD-short-task-name`
- Goal: the user-visible result after deployment.
- Affected services/targets: Web, API, worker, database, or other named targets.
- Implementation PR/issue: add links.
- Implementation reference: exact commit for source provenance; this is not proof
  that the commit is merged, selected for release, or installed.
- Dependencies: linked task files and environment prerequisites, or `none`.
- Last updated: `YYYY-MM-DD`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                      |
| -------------------- | --------- | ------------------------------- | ------------------- | --------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Reconcile actual state and fill the rollout record. |
| production           | `pending` | Not verified                    | Not verified        | Reconcile actual state and fill the rollout record. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Record steps separately for each environment; do not share completion checkmarks.

## Applicability and prerequisites

- Exact release target and confirmation that it contains this implementation.
- Current fleet, schema, configuration, and applicable earlier migration cutovers.
- Required release evidence, dependent tasks, and any unresolved holds.
- Existing release path and environment/credentials to use, without secret values.

## Ordered rollout

Replace these prompts with concrete steps and expected results. Link to the
authoritative procedure instead of copying the general release process.

1. Before new code starts: backup/fence/drain/migrate/data conversion if required.
2. Deploy the required services; verify fleet versions and configuration.
3. After all prerequisites pass: apply any explicit activation or cutover.
4. Verify the actual result and record evidence before widening rollout.

If ordinary code deployment is sufficient, say so and link to its release path.
Do not invent migrations or activation commands. Explain any non-applicable phase.

## Verification and completion

List observable success criteria, including feature-specific checks and failure
signals. `deployed` requires all applicable steps and checks in this environment.
Capture the real version/image, environment, operator, timestamp, and durable
deployment/check references. Local tests and green PR CI are separate evidence.

## Retry, partial completion, and rollback

State what must be inspected before resuming, which commands are idempotent, and
which steps must not repeat. Link the rollback procedure, preserve relevant data
and migration constraints, and record any gap or residual environment change.

## Related links

- Implementation PRs/issues, plan, design/decision, and review record.
- Feature runbook, migrations, scripts, configuration, and relevant validation.
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).
- Actual release/deployment/verification evidence when available.

Pin source links when the files are not yet on the destination branch. Refresh
the task if later changes alter its procedure; never relabel old evidence as new.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result                                    | Evidence | Next action                   |
| ------------ | -------------------- | ---------- | ---------------------- | ----------------------------------------------------------- | -------- | ----------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Template only; replace with actual per-environment records. | None     | Fill the task before rollout. |
