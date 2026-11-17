# Review run error triage (2026-11-17): deployment

- Task ID: `2026-11-17-review-run-error-triage`
- Goal: hosted reviews in the 777genius workspace authorize again with both
  configured reviewers; an unapproved Gateway reviewer profile is refused as an
  actionable 422 instead of an opaque retried 500, and other replaced typed
  failures are visible in logs; repositories without an active hosted lane stop
  receiving workflow dispatches that can only be refused.
- Affected services/targets: API (run authorization, Review Action v2 route
  diagnostics), worker (GitHub review request ingress), API configuration
  (`REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY`).
- Implementation PR/issue: [Draft PR #884](https://github.com/777genius/review-router-ai/pull/884).
- Implementation reference: branch `fix/review-run-errors-20261117`, base
  `a71e05a74`. Not merged, released or installed.
- Dependencies: none for the code. The production configuration step below is
  independent of the code and fixes the live outage on its own.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status      | Actual deployed version / image                                    | Last verified (UTC) | Evidence / next step / blocker                                                                                                                                                                                                                                                                               |
| -------------------- | ----------- | ------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| staging              | `pending`   | Not verified                                                       | Not verified        | Ordinary code rollout with the next release.                                                                                                                                                                                                                                                                 |
| production           | `installed` | API/worker `974295ea`; run policy has the NVIDIA entry since 01:01 | 2026-11-17 17:51    | Step 1 was applied as the run policy entry (API recreated 2026-11-17 01:01); step 2 shipped in the [coordinated rollout](2026-11-17-coordinated-rollout-974295ea.md); the worker logs "Review request ignored without an active hosted lane"; the 422 refusal is not exercised. Step 3 stays with the owner. |

## Production evidence (read-only, 2026-11-16 16:01 to 2026-11-17 00:37 UTC)

- Workspace default policy version 25 (`2026-11-16T23:27:14Z`) added reviewer 2:
  personal connection "NVIDIA Build Account 1", profile
  `nvidia-build-chat-apikey-v1`, model `nvidia/nemotron-3.5-super-vl-120b-a12b`.
  Reviewer 1 stays OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free`.
- `REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY` on the API approves seven profiles and
  not `nvidia-build-chat-apikey-v1`. The relay policy already contains the
  qualified NVIDIA entry, so only the run allowance is missing (the
  2026-11-15 NVIDIA availability window updated relay policy only).
- `ProductionReviewRunRuntimeSnapshot.capture` therefore returned `null` for
  reviewer 2, admission answered `admission_facts_changed` (412), and the
  authorize route replaced that non-contract code with
  `ambiguous_outcome`/`handler_failed` (500) without an internal trace. The
  runtime retried the same request once (two log lines per request id).
- Every authorize in that workspace has failed since: social-monitor 23:34 and
  23:54, review-router-ai run 43981956671 at 23:55, agent-teams-ai 23:56, and
  three more at 00:23, 00:28 and 00:37. The last workspace authorization was
  23:07; another workspace authorized normally at 23:33. NVIDIA has zero
  evidence observations, so reviewer 2 never ran.
- Earlier failures were external: the OpenRouter free-tier daily quota was
  exhausted (0 of 1000 requests remaining) in runs 43964966089, 43968539275 and
  43974897855, and upstream transport/`effect_unknown` ended runs 43926445422
  and 43934267905.
- `review_run_authorize:mutation_authority_unavailable` (403) came from
  repositories with the managed workflow but no active hosted lane:
  `777genius/agent-notifications` (`v1_open`), `agent-teams-ai/account-gateway`
  and `777genius/review-router` (no authority row). Ingress also dispatched
  hundreds of requests to repositories without the workflow and without a
  hosted authority row (for example `777genius/universal-agent-plugins`) that
  ended in `dispatch_attempts_exhausted`. The new gate checks the authority, not
  the workflow file, so a `v2_active` repository whose setup PR is still open
  keeps being dispatched.

## Ordered rollout

1. Production configuration (owner decision, not performed by this task).
   Either remove reviewer 2 from the workspace default policy in the dashboard
   (immediate recovery with one reviewer), or append this entry to the API
   `REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY` profiles and recreate the API through
   the [release process](../operations/07-environments-and-release-management.md):
   `{"profileRef":"nvidia-build-chat-apikey-v1","limits":{"requests":640,"concurrency":1,"requestBytes":1048576,"outputBytes":8388608,"tokens":32768}}`.
   The values mirror the other API-key profiles and the Gateway NVIDIA ceiling
   of 640 requests; `outputBytes` must stay at or below 8 MiB.
2. Ordinary API and worker code rollout. No migration, no new flag.
3. Repositories with an inactive hosted lane (owner decision): activate through
   the [cutover runbook](../../docs/operations/review-action-v2-cutover.md) or
   remove the managed workflow. After the worker rollout they are ignored at
   ingress instead of being dispatched.

## Verification and completion

- After step 1: the next 777genius workspace review authorizes (201) with a
  snapshot version 4 and two reviewers; a `ReviewEvidenceObservation` with
  actual model `nvidia/nemotron-3.5-super-vl-120b-a12b` appears; no
  `review_run_authorize` 500 in API logs.
- After step 2: a reviewer with an unapproved profile is refused with 422
  `review_run_authorize:gateway_profile_unapproved`. Other `null` captures on
  authorize still answer 500 `handler_failed`, but the log line now carries
  `internalFailureClass: ReviewActionV2RouteFailure`, the original
  `internalFailureCode` (for example `stale_precondition`) and
  `internalFailureIssues`; ordinary exceptions keep class/code/cause/stage. The
  worker logs "Review request ignored without an active hosted lane" instead of
  creating intents for the repositories listed above. Failed webhook deliveries
  record `github_webhook_persistence_failed:<code>` or a reviewed local code.
- OpenRouter `:free` models remain limited by the provider's daily request
  quota; one review can use up to 640 Gateway requests.

## Retry, partial completion, and rollback

Configuration and code steps are independent and idempotent. Roll back the
configuration by removing the entry; roll back code with the previous image.
Ignored ingress events are not replayed; the next pull request event creates a
request once the lane is active.

## Related links

- [Gateway diagnostic stream and NVIDIA availability](2026-11-09-gateway-diagnostic-stream.md)
- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)       | Environment | Operator  | Actual version / image  | Step and observed result                                      | Evidence                     | Next action                  |
| ---------------- | ----------- | --------- | ----------------------- | ------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| 2026-11-17 00:37 | production  | read-only | API `main-0c67c3e0a105` | Diagnosis only; no production write, deploy or provider call. | API logs, DB reads, run logs | Owner decision on step 1, 3. |
