# Review error classes of 2026-11-17: deployment

- Task ID: `2026-11-17-review-error-classes`
- Goal: three fixes from plan
  [71](../architecture/71-review-runtime-error-classes.md):
  - worker: an automatic pull request event for the revision whose run is
    already dispatched and waiting for authorization no longer starts a second
    run. That run used to take the execution over, and the first one ended with
    `review_orchestration_execution_refresh_invalid` after its reviewers had
    worked (19 minutes on PR 821, run 44078475296);
  - Action: a superseded `workflow_dispatch` run no longer fails with
    `review_superseded_by_newer_revision`;
  - native: the Chat bridge (NVIDIA Build) reports the real phase of a stopped
    stream, so a caller abort no longer reads as `sse_incomplete`.
- Affected services/targets: worker; public Action; private native engine.
- Implementation PR/issue: worker
  [#891](https://github.com/777genius/review-router-ai/pull/891), Action
  [777genius/review-router#395](https://github.com/777genius/review-router/pull/395),
  native
  [agent-teams-ai/sub2api#102](https://github.com/agent-teams-ai/sub2api/pull/102).
- Implementation reference: native merged as `cfe50b7` (sub2api #102), Action
  source merged as `d5c9a48` (review-router #395, not released yet), worker on
  branch `fix/review-error-classes-20261117` until #891 merges.
- Dependencies: none between the three parts; each can ship on its own. No
  schema, configuration or Gateway change.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target  | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                      |
| --------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------- |
| staging (worker)      | `pending` | Not verified                    | Not verified        | Ship with the next coherent application release, then verify below. |
| production (worker)   | `pending` | Not verified                    | Not verified        | Ship with the next coherent application release, then verify below. |
| public Action release | `pending` | Not verified                    | Not verified        | Next ordinary Action release per the release process.               |
| production (native)   | `pending` | Not verified                    | Not verified        | Next native engine rollout with the Gateway service.                |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

- Ordinary code rollout for each target. No migration, configuration, feature
  flag or activation step.
- Manual commands and explicit reruns are not affected and still start a new
  run for the same revision.

## Ordered rollout

1. Before new code starts: nothing to fence, drain or migrate.
2. Worker: deploy with the next coherent application release.
3. Action: include in the next Action release and register it as usual.
4. Native: include in the next native engine rollout; the Gateway parser already
   accepts every phase it can emit.

## Verification and completion

- Worker: when a pull request gets `synchronize` and then `ready_for_review`
  (or another lifecycle event) for the same head within the authorization
  window, the second `ReviewRequestedIntent` row is `superseded` with
  `supersededByRequestId` set to the dispatched request, and only one workflow
  run is created. No new `review_orchestration_execution_refresh_invalid` for
  that pattern. A push with a new head still supersedes as before.
- Action: a superseded dispatched run ends green and its step summary says the
  review was superseded; a superseded `pull_request` run still fails.
- Native: a reviewer abort appears in the Gateway journal as `sse_read` with
  `read_error_reason` `context_canceled`, not as `sse_incomplete`.

## Retry, partial completion, and rollback

Stateless code changes. Roll back by deploying the previous worker image,
Action release or native binary. Rows registered as `superseded` stay as they
are and need no repair.

## Related links

- Plan and evidence: [71](../architecture/71-review-runtime-error-classes.md).
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)   | Environment | Operator   | Actual version / image | Step and observed result | Evidence | Next action                  |
| ------------ | ----------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------- |
| Not executed | all targets | Unassigned | Not verified           | Not deployed yet.        | None     | Ship with the next releases. |
