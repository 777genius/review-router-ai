# Second rollout of 2026-11-17: ReviewRouter afa74c8f, then Gateway 115, then Action 241

- Task ID: `2026-11-17-second-rollout-afa74c8f`
- Goal: ship the second small release in its required order: ReviewRouter
  first (the new SDK accepts the `unknown` usage value), then the Gateway that
  starts storing it, then the public Action.
- Content: ReviewRouter `afa74c8fef1056ace856abcb12d2a44e20610397` = #894, #896,
  #897, #898, #899 on top of the
  [first rollout](2026-11-17-coordinated-rollout-974295ea.md); account-gateway
  `1dce5c327d14e9c0e5466da91441faa0d0ae38a5` = #113, #114, #115; public Action
  `8e932ec36` = review-router #399.
- Covers the task records
  [Usage names the Gateway vendor](2026-11-17-usage-gateway-vendor.md),
  [verification residuals](2026-11-17-verification-residuals.md),
  [repository scan progress](2026-11-17-repository-scan-progress.md),
  [first-run flow fixes](2026-11-17-first-run-flow-fixes.md) and
  [usage statistics audit](2026-11-17-usage-statistics-audit.md).
- Last updated: `2026-11-19` (Action 241 finished).

## Environment status

| Target                         | Status     | Actual version                                                  | Verified (UTC)   | Evidence / next step                                                         |
| ------------------------------ | ---------- | --------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| production API/Web/worker/scan | `deployed` | review-router-ai `afa74c8f`, image `sha256:178a7be6…`           | 2026-11-17 21:49 | Step 1 below; (a), (b), (e), (g) pass.                                       |
| production database            | `deployed` | ledger 168, unchanged                                           | 2026-11-17 21:20 | No migration in the range.                                                   |
| production Gateway             | `deployed` | account-gateway `1dce5c32` (#113 to #115), manifest `f4e6b398…` | 2026-11-17 21:23 | Step 2 below; forward-only from here.                                        |
| public Action 241              | `deployed` | `v1.0.241` = `cce9dd98` (#400)                                  | 2026-11-19 18:49 | Finished on 2026-11-19, see [Action 241](2026-11-19-action-241-cce9dd98.md). |
| producer 241 / `workflow-v1`   | `deployed` | producer 241 registered, `workflow-v1` = `cce9dd98`             | 2026-11-19 20:51 | [Action 241](2026-11-19-action-241-cce9dd98.md); rollback pins there.        |

`pending`, `blocked` and `deployed` follow the
[status contract](README.md#status-contract).

## Baseline before this release (read-only, 21:00 to 21:20 UTC)

- Four roles on `974295ea`, image `sha256:596eb430…`, FILE 68
  (`coordinated240-20261117`), Action refs `3a256b15` (240); zero restarts.
- Gateway 112 (`gateway112-4d113b5-native100-20261117`), native 102
  (`native-stream-cfe50b7-20261117`, SHA256 `fdf825d2…`), service config
  SHA256 `7183913c…`, drop-in SHA256 `b6ee6bc5…`.
- Database ledger 168, last `000159_producer_reviewer_plan_v2`, no unfinished
  migration. The range `974295ea..afa74c8f` adds no migration directory, so no
  migration and no backup step ran; the recovery point of the first rollout
  (pgBackRest `20261117-184829F`) stays the latest backup taken by an operator.
- `workflow-v1` and `v1` = `3a256b15` (240); producers 240 and 239 registered.
- `REVIEW_ROUTER_CONVERSATION_QUALIFICATION` is not set on any role, so the SDK
  repack of #896 leaves no production conversation qualification to reissue;
  full-thread Gateway conversations stay off as before.

## Pre-checks (read-only)

1. **Relay policy is a subset of the run policy (#899 startup check): PASS.**
   API relay profiles (`openai-responses-apikey-v1`,
   `openrouter-openai-responses-apikey-v1`, `openai-codex-oauth-responses-v1`,
   `nvidia-build-chat-apikey-v1`) all appear among the eight `profileRef`s of
   `REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY`; nothing missing. Only profile names
   were compared, on the host. The other roles do not carry the relay policy.
2. **"Repository scan failed" after #898.** The newest
   `installation.sync_requested` event is `dead_letter` for 6 of the 9 newest
   active installations (6 workspaces, 7 workspace members): one
   `db_permission_denied` from 2026-11-15 21:46 (agent-teams-ai organization,
   before the worker grant was restored on 2026-11-17) and five `handler_error`
   from 2026-09-10 to 2026-10-18 (the #761 period; 777genius user workspace, the
   padelapp-club organization and three single-user workspaces). The other 3
   show their last scan as finished. In total 139 sync events are dead-lettered
   (130 `handler_error` 2026-08-21 to 2026-10-24, 9 `db_permission_denied`
   2026-11-14 to 2026-11-15). The worker repository grant is in place, so Retry
   scan can work; nothing was requeued.
3. **The "calls without a usage report".** Over 30 days there are 344
   dispatched or possibly dispatched Gateway calls with no usage fact (plus 139
   proven not dispatched, which the report excludes, and 1 with completeness
   `unknown`). By lifecycle: 192 `completed`/`dispatched` Codex OCR calls on
   2026-10-22 (padelapp-club `gpt-5.6-sol` 183 in 4 runs, 777genius MiMo 9 in 1
   run), from before the usage reconciliation fixes of #847; 147 `unknown` /
   `effect_unknown` calls, one per affected run (stream cut or cancelled
   attempts: Codex 111 from 2026-10-22 to 2026-11-05, OpenRouter `:free` 33 from
   2026-11-03 to 2026-11-17, NVIDIA 3 on 2026-11-17), 3 PR description calls on
   2026-11-01 and 2 `prepared`. These are final states that never get a report,
   which is why the Usage page polled forever before #899. The 79 seen earlier is
   a subset of the same rows in an earlier window and one workspace.

## Source verification

- ReviewRouter `afa74c8f` on the worker host: `pnpm install --frozen-lockfile`,
  `pnpm typecheck` 56/56, Vitest for `apps/web/app/dashboard`, `apps/web/src`,
  provider-usage, github-installations, the runtime snapshot and provider usage
  API tests and `scripts/build-codex-rotating-action.test.ts`: 211 files passed,
  11 skipped. `node scripts/build-codex-rotating-action.mjs` reproduces the
  committed `action-dist/index.cjs` (SHA256 `ffeac0fe…`) with no diff.
- Gateway `1dce5c32`: PR checks #113 21/21, #114 21/21, #115 20/20; the SDK
  package is unchanged after #113 (#114 and #115 only touch
  `services/account-gateway`), so the archive vendored by #896
  (`…-nvidia-0c68a5d544ff.tgz`) is current and no repack is needed. The release
  tree reuses the gateway108 dependency tree; tracked files equal the merge tree;
  service tests including usage 94/94 and `tests/account-models.test.mts` 6/6.

## What ran (UTC)

Custody under `/srv/platform/projects/review-router/releases/` (root, 0700).

1. **ReviewRouter `afa74c8f`** through
   [`deploy/hetzner/release.sh`](../../deploy/hetzner/release.sh): image built
   on the host (`reviewrouter-manual:afa74c8f`,
   `sha256:178a7be64e38f43607e57559f944981bb671ac689d98de458702d6cf846d414b`);
   no migrate step; `swap --apply` at 21:22:18 to 21:22:41 (controller
   `fleet-overlay-afa74c8f-vnga0DTJ`). Four roles on `afa74c8f`, zero restarts,
   FILE 68 and the 240 Action refs unchanged, no
   `review_run_gateway_relay_profile_unapproved`, no errors; `/ready`, Web and
   the dashboard answer 200. Old containers retained as
   `*-before-ovl-20261117212218108`.
2. **Gateway 115** (`gate3-20261117`, `gateway115-20261117`), only after step 1:
   admission gate 21:23:01.8, idle (open, occupied, inflight, cleanup all 0),
   stop 21:23:02, start 21:23:05, `READY_FENCED` with release
   `gateway115-1dce5c3-native102-20261117` (manifest SHA256 `f4e6b398…`, 11,277
   entries), native 102 unchanged, profiles (8), native accounts (28) and kernel
   rows equal, ledger 318; gate restored 21:23:06.6, so admission was fenced for
   5 seconds. The operator is the reviewed gateway108 operator with only its
   constants changed. From here the rollout is forward-only (see the
   [usage vendor record](2026-11-17-usage-gateway-vendor.md#retry-partial-completion-and-rollback)).

## Action 241: blocked on the GitHub Actions queue, 240 stays live

- [PR #400](https://github.com/777genius/review-router/pull/400) (`8114f39d`)
  prepares 1.0.241 on top of #399 (`8e932ec3`): version metadata only, plus
  `action-dist/index.cjs` from `afa74c8f` (the reviewer plan contract v2 with
  the parallel and fallback modes, matching what producer 240 already declares;
  a clean rebuild gives the same bytes `ffeac0fe…`). The automatic
  `Sync Public Action Runtime` cannot run while CI on main is queued.
- Its required `build` check waited in the account queue from 21:19 to past
  22:05 (one re-queue at 22:00 did not help), so the release, FILE 69, producer
  241 and the promotion were not started. Nothing was tagged; `workflow-v1` and
  `v1` stay on 240 `3a256b15`, producer 240 stays the newest registered.
- Ready to run once runners are available, in this order: merge #400 after its
  `build` passes; `release.yml` for `v1.0.241`; generate and check the canonical
  manifest for the release commit; build FILE 69 (all 68 rows plus the 241 row,
  derived from the 240 row) and its binding; parse it with the installed image's
  reader; apply the FILE 69 cohort with the FILE 68 operator (constants only);
  inspect, then register producer 241 through the trusted materializer; promote
  `workflow-v1` from `3a256b15` with `promote-workflow-channel.yml`. The module
  pins of the registration operator are unchanged in the `afa74c8f` image.

## Acceptance evidence (UTC)

| Check                                      | Result                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) normal review with publication         | **PASS**                       | Disposable [777genius/rr-codex-rotating-e2e PR 139](https://github.com/777genius/rr-codex-rotating-e2e/pull/139) after both steps: head `c275a636`, [run 44181370461](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/44181370461) green, admitted 21:46:33, execution `rr:execution:1dcb443d…` `completed` on producer 240 at 21:48:42, App summary "1 minor" with an inline comment at 21:49:37. The first dispatch for that head ([run 44179669736](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/44179669736), 21:33:49) was refused at authorization with 403 `review_request_intent_required` before any admission decision was stored; the worker then retried with a new request (`dispatchAttempt` 2) as designed. In the same window the new API admitted social-monitor PR 665 normally. The cause of the single refusal is not proven: the gate maps every internal error to that code without logging it. |
| (b) NVIDIA reviewer and live list          | **PASS**                       | The PR 139 review ran on the NVIDIA reviewer (`ReviewEvidenceObservation` actual model `nvidia/nemotron-3.5-super-vl-120b-a12b` at 21:48:15); its five Usage calls are `nvidia` with completeness `complete`. Gateway 115 live list at 21:23:21: NVIDIA `snapshot`, 18 models, anchor first, no filtered families; Kimi 6 from `native_catalog`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| (e) one run per revision                   | **PASS**                       | PR 139: `lifecycle_changed` joined the `pull_request_ready_for_review` request (`9953dc0b…` superseded by `abc6ce65…`, one run); the push of `c275a636` at 21:25:07 superseded that request (`abc6ce65…` by `cd65c5f5…`) and the worker cancelled its queued run 44179554327 (cancelled, not red).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| (g) Usage provider attribution and polling | **PASS (MiMo); others absent** | Read-only run of the deployed report SQL (`usageRequestedProviderJoinSql`) in the API container over 30 days: 1,766 Gateway rows stored as `codex` for `mimo-v2.6-pro` now show `mimo`; 1,420 `codex` rows for the OpenRouter `:free` model and 95 for `openai/gpt-4.1` show `openrouter`; Codex rows stay `codex`, NVIDIA `nvidia`. There are no Gateway GLM, MiniMax, Kimi, Grok or Claude usage rows in production, so those vendors cannot be shown yet (the vendor table of the deployed SDK maps all nine profiles). 26 diagnostic `unknown` rows without an authorization snapshot stay `unknown`, as designed. Polling: the newest pending call per workspace is older than one hour everywhere except the 777genius workspace (21:06:52, a review a few minutes before), so its page polls until 22:06 and then stops; the other three workspaces do not poll.                                                                                  |
| (h) repository scan state                  | **Not triggered**              | No safe way to start a fresh scan without the owner's dashboard session; the read path was checked with the same query the new route uses (pre-check 2). Owner step: in the get-tok workspace open Repositories and press Refresh repos; the list shows "Scanning repositories" and refreshes itself when the scan ends.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| (c) quota skip                             | **Not run**                    | No production policy has two reviewers (read-only check of every active configuration). Owner step, on a disposable repository only (for example `777genius/rr-codex-rotating-e2e`): Repository settings, Review providers, add a second Gateway reviewer with an OpenRouter `:free` model whose daily quota is used up, keep "Together, in parallel", save, then push a commit to a canary PR; the summary must say the reviewer was skipped for quota. Remove the second reviewer afterwards.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| (d) ordered fallback                       | **Not run**                    | Same repository settings page: two reviewers, mode "Fallback in order", the first one pointed at a model the account does not list, save, push a commit; the second reviewer must run. Switch back to the previous roster afterwards (do not switch a fallback roster to parallel as a rollback).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Rollback pins

Reverse order. The Gateway step is forward-only: Gateway 115 stores `unknown`
usage facts that Gateway 112 and a ReviewRouter on the old SDK cannot read, so
fix forward instead of rolling the Gateway or ReviewRouter back once Gateway 115
has written such facts.

1. Action part: 241 was released, registered and promoted on 2026-11-19; use
   the [Action 241 rollback pins](2026-11-19-action-241-cce9dd98.md#rollback-pins),
   which replace the draft steps that stood here. Producer 240 stays
   registered; the
   [first rollout](2026-11-17-coordinated-rollout-974295ea.md#rollback-pins)
   describes the same steps for 240 and must not be applied while `afa74c8f`
   or later runs, because the image would then go below the SDK that reads the
   new usage values.
2. Gateway 115 to 112 is not supported once 115 has stored an `unknown` usage
   fact; fix forward. Only if no such fact exists yet: under a fresh gate (copy
   the `caddy-*` files of `gate3-20261117`), stop, put back
   `gateway115-20261117/dropin.before` (WorkingDirectory and `serve.ts` of
   `gateway112-4d113b5-native100-20261117`), `systemctl daemon-reload`, start.
3. ReviewRouter `afa74c8f` to `974295ea`: only while the Gateway is back on 112
   and no `unknown` usage fact exists, stop the four `afa74c8f` containers and
   start the retained `*-before-ovl-20261117212218108` containers (image
   `sha256:596eb430…`, FILE 68). No migration to undo.
