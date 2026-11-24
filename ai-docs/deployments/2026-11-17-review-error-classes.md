# Review error classes of 2026-11-17: deployment

- Task ID: `2026-11-17-review-error-classes`
- Goal: five fixes from plan
  [71](../architecture/71-review-runtime-error-classes.md):
  - worker: an automatic pull request event for the revision whose run is
    already dispatched and waiting for authorization no longer starts a second
    run. That run used to take the execution over, and the first one ended with
    `review_orchestration_execution_refresh_invalid` after its reviewers had
    worked (19 minutes on PR 821, run 44078475296);
  - Action: a superseded `workflow_dispatch` run no longer fails with
    `review_superseded_by_newer_revision`;
  - native: the Chat bridge (NVIDIA Build) reports the real phase of a stopped
    stream, so a caller abort no longer reads as `sse_incomplete`;
  - Gateway: every early stop of a streamed response and its settlement logs
    its own closed phase instead of failing silently;
  - Action: OCR through the Account Gateway passes `--max-tokens` 87381
    (1 MiB / 12), so its own history compression keeps requests under the
    1 MiB relay and Gateway request limit.
- Affected services/targets: worker; public Action; private native engine;
  Account Gateway service.
- Implementation PR/issue: worker
  [#891](https://github.com/777genius/review-router-ai/pull/891), Action
  [777genius/review-router#395](https://github.com/777genius/review-router/pull/395),
  native
  [agent-teams-ai/sub2api#102](https://github.com/agent-teams-ai/sub2api/pull/102),
  Gateway
  [agent-teams-ai/account-gateway#112](https://github.com/agent-teams-ai/account-gateway/pull/112),
  Action OCR ceiling
  [777genius/review-router#397](https://github.com/777genius/review-router/pull/397).
- Implementation reference: native merged as `cfe50b7` (sub2api #102), Gateway
  as `4d113b5` (account-gateway #112), Action source as `d5c9a48` (#395) and
  `b994447` (#397, both not released yet), worker as `cfb918510` (#891).
- Dependencies: none between the parts; each can ship on its own. No schema or
  configuration change. `ACCOUNT_GATEWAY_BOUNDS.ocrMaxTokens` in the Action
  repeats the 1 MiB request limit (RR `REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY`
  `ingressBytes`, Gateway profile `limits.requestBytes`): if that limit changes,
  recompute it (limit / 12) in the same batch.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target  | Status      | Actual deployed version / image              | Last verified (UTC) | Evidence / next step / blocker                                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------- | -------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staging (worker)      | `pending`   | Not verified                                 | Not verified        | Ship with the next coherent application release, then verify below.                                                                                                                                                                                                                                                                |
| production (worker)   | `deployed`  | worker `974295ea`                            | 2026-11-17 17:59    | Same-revision join seen on review-router-ai PR 894 (see the [coordinated rollout](2026-11-17-coordinated-rollout-974295ea.md)).                                                                                                                                                                                                    |
| public Action release | `installed` | `v1.0.240` = `3a256b15`, `workflow-v1` = 240 | 2026-11-17 19:55    | A superseded queued run was cancelled by the worker before it started; the OCR `--max-tokens` argv is not observed yet. The started-run path of #395 was seen on 2026-11-19 with Action 241 (a superseded started run ended green and published nothing, [Action 241](2026-11-19-action-241-cce9dd98.md#acceptance-evidence-utc)). |
| production (native)   | `installed` | native `cfe50b7f`                            | 2026-11-17 17:52    | Phase check needs a stopped NVIDIA stream.                                                                                                                                                                                                                                                                                         |
| production (Gateway)  | `installed` | Gateway `4d113b5c`                           | 2026-11-17 17:47    | New closed-phase lines appear in the journal (`native_response`).                                                                                                                                                                                                                                                                  |

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
5. Gateway: include in the next Gateway service rollout (diagnostics only).

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
- Gateway: a cut streamed response leaves one `gateway_native_transport_failure`
  line with a `stream_*` or `settle_*` phase.
- Action OCR ceiling: the managed OCR argv of Account Gateway reviewers carries
  `--max-tokens 87381`, and API logs show no new `Request body is too large`
  for OCR reviewers on large pull requests.

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
