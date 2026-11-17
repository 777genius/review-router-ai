# Coordinated rollout of 2026-11-17: native 100/102, Gateway 112, ReviewRouter 974295ea

- Task ID: `2026-11-17-coordinated-rollout-974295ea`
- Goal: ship everything merged on 2026-11-17 in the required order: native with
  the coding plan catalogue (sub2api #100), the Gateway with the 512-model bound
  and stream settle diagnostics (account-gateway #111, #112), ReviewRouter
  `974295ea` with migrations 158 and 159 (#878 to #893), native with the live
  NVIDIA list and stream stop phases (sub2api #101, #102) last, then the public
  Action release with reviewer plan v2 (#394 to #397), producer registration and
  the `workflow-v1` promotion.
- Affected targets: private native engine, Account Gateway service, ReviewRouter
  database, API, Web, worker and skills scan worker, public Action release,
  producer registry, `workflow-v1`.
- Covers the task records
  [provider quota non-fatal](2026-11-17-provider-quota-nonfatal.md),
  [reviewer roster mode](2026-11-17-provider-interaction-mode.md),
  [NVIDIA live model list](2026-11-17-nvidia-live-model-catalog.md),
  [review error classes](2026-11-17-review-error-classes.md),
  [review run error triage](2026-11-17-review-run-error-triage.md),
  [all providers in all workspaces](2026-11-17-all-providers-in-all-workspaces.md),
  [connect attaches to the current workspace](2026-11-17-connect-attaches-to-current-workspace.md),
  [dashboard Providers tab](2026-11-17-dashboard-provider-ui.md),
  [Codex limits refresh on open](2026-11-17-codex-limits-refresh-on-open.md) and
  [Usage labels](2026-11-17-usage-not-reported-labels.md).
- Not in this rollout, merged after the pinned commits: #894 (Usage page) and a
  second small release, ReviewRouter #896 with Gateway #113/#114 (usage vendor
  attribution, SDK repack). That release runs in the opposite order:
  ReviewRouter first, then the Gateway, because the installed SDK rejects the new
  `unknown` value; it also carries the conversation qualification step. Note
  for it: `REVIEW_ROUTER_CONVERSATION_QUALIFICATION` is not set on any
  production role today (see the baseline below).
- Last updated: `2026-11-17`.

## Environment status

| Target                         | Status     | Actual version                                                | Verified (UTC)   | Evidence / next step                                       |
| ------------------------------ | ---------- | ------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| production native              | `deployed` | sub2api `cfe50b7f` (#101/#102), binary `fdf825d2…`            | 2026-11-17 17:52 | Window 2 below; NVIDIA list 18 models through the Gateway. |
| production Gateway             | `deployed` | account-gateway `4d113b5c` (#111/#112), manifest `a5a9cb63…`  | 2026-11-17 17:47 | Window 1 below.                                            |
| production database            | `deployed` | ledger 168 (000158, 000159)                                   | 2026-11-17 17:50 | pgBackRest full backup `20261117-184829F` taken before.    |
| production API/Web/worker/scan | `deployed` | review-router-ai `974295ea`, image `sha256:596eb430…`         | 2026-11-17 17:51 | Four roles healthy, zero restarts, ready 200.              |
| public Action 240              | `deployed` | `v1.0.240` = `3a256b15`, release run 44152856502              | 2026-11-17 19:12 | Steps 4 and 5 below.                                       |
| producer 240 / FILE 68         | `deployed` | FILE 68 `de650886…`, producer `3a256b15` registered (plan v2) | 2026-11-17 19:13 | Steps 7 to 9 below.                                        |
| `workflow-v1`                  | `deployed` | `3a256b15` (240), promotion run 44161249760                   | 2026-11-17 19:55 | Step 10 below.                                             |

`pending` and `blocked` follow the [status contract](README.md#status-contract).

## Baseline before the rollout (read-only, 2026-11-17 17:20 to 17:45 UTC)

- Four ReviewRouter roles on `reviewrouter-manual:0c67c3e0`, image
  `sha256:dd234f5dfa811cd1c65d9de1350cf75ef86544de73dba891be85b2d75e22f753`,
  revision `0c67c3e0a105`, FILE 67 registry
  (`coordinated239-20261115/producer-release-attestations.json`, SHA256
  `c2db79b7…`, 67 rows), primary Action refs `1112a0f1` (239).
- Database ledger 166 rows, last `000157_claude_code_api_key_secret`. 64
  registered and 132 revoked producers; newest registered is 239
  (`reviewrouter-action.1112a0f1…`, reviewer plan version 1).
- `workflow-v1` and `v1` = `1112a0f1de568f9fa927316ab68cef54fbcd4653` (239).
- Gateway unit `review-router-account-gateway.service`: Gateway 108
  (`gateway108-9a842ff-native96-20261114`), Node 26.11.1 from
  `admitted-stream-dd63852-native95-20261114`, native 98
  (`native-retention-5ed186e-20261115`, SHA256 `171cdfdc…`), service config
  SHA256 `49ba7d0e…`, drop-in `zzzz-fact-diagnostic-f043.conf` SHA256
  `32db4f59…`, origin ready with 65 receipts, native ledger 318, eight profiles.
- API `REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY` already lists eight profiles
  including `nvidia-build-chat-apikey-v1` (added on 2026-11-17 at 01:01 UTC;
  retained container `…-api-1-before-nvidia-policy-retained`). Relay policy SHA256
  `4b74ad2d…` with four entries; NVIDIA is a dynamic catalogue profile, so its
  model list comes from native and needs no relay change. Both were carried over
  unchanged by the swap.
- `REVIEW_ROUTER_CONVERSATION_QUALIFICATION` and
  `REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA` are not set on any role, so the
  changed `conversation-source-stamp` has no production qualification to
  reissue; full-thread Gateway conversations stay off as before.

## Source verification

The ReviewRouter, Gateway and native merges were made with `--admin` while the
GitHub Actions queue was starved, so the exact commits were checked on the
worker host before deployment:

- ReviewRouter `974295ea`: `pnpm install --frozen-lockfile`, `pnpm typecheck`
  (56/56 tasks), Vitest for `apps/web/app/dashboard` (71 files) and for
  review-config, review-run-control, review-publishing, review-orchestration,
  `apps/api` and `apps/worker` (245 files passed, 30 skipped), plus 11 files for
  the provider attach and workspace paths of #886/#887. The committed
  `action-dist/conflict-runtime.cjs` is stale (`conflict_runtime_bundle_stale`,
  already noted since 2026-11-04); it is only used by a conflict runtime checkout
  of a private release tag, which this rollout does not move.
- Gateway `4d113b5c`: PR #112 CI 21/21 green; the release tree reuses the
  gateway108 dependency tree (byte-identical lockfile and package manifests), all
  tracked files equal the merge tree, `packages/account-gateway/dist` rebuilt;
  service domain tests 80/80 and `tests/account-models.test.mts` 6/6.
- native `d92f681c` and `cfe50b7f`: static builds with the qualified Go 1.27.3
  toolchain (`CGO_ENABLED=0 -trimpath -ldflags='-s -w' ./cmd/account-gateway`);
  `go test -tags unit` for `internal/gatewaytransport` and the Gateway, native,
  NVIDIA, catalogue, chat and stream tests of `internal/service` passed for both.

## What ran (UTC)

Custody for every step is under `/srv/platform/projects/review-router/releases/`
(root, 0700). The operators are the reviewed native97, gateway108 and
apply-gate-v2 operators with only their constants changed.

1. **Window 1, native #100 then Gateway #112** (`gate1-20261117`,
   `native100-20261117`, `gateway112-20261117`). Admission gate applied at
   17:47:28.6; Gateway idle (open, occupied, inflight and cleanup all 0); native
   stop 17:47:34, start 17:47:36, `READY_FENCED` with native
   `native-catalog-d92f681-20261117` (SHA256 `d2017c24…`, 85,082,272 bytes);
   Gateway stop 17:47:48, start 17:47:51, `READY_FENCED` with release
   `gateway112-4d113b5-native100-20261117` (manifest SHA256 `a5a9cb63…`, 11,277
   entries). Profiles (8), native accounts (28) and kernel rows were equal before
   and after; ledger 318; autorestart preserved. Gate restored 17:48:03, so
   admission was fenced for 34 seconds. Public `/ready` and Web 200.
2. **ReviewRouter `974295ea`** through
   [`deploy/hetzner/release.sh`](../../deploy/hetzner/release.sh): image built on
   the host (`reviewrouter-manual:974295ea`,
   `sha256:596eb430365c8784a3d5ba69e7a52aff80fd573e55ad8630051f2f141214c9d3`);
   pgBackRest full backup `20261117-184829F` (error=false); `migrate` applied
   000158 and 000159 at 17:50:26 (ledger 168, 0 unfinished), then the canonical
   ACL and the worker repository grant; `swap --apply` at 17:50:53 (controller
   `fleet-overlay-974295ea-JAaVW0mN`). All four roles run `974295ea` with zero
   restarts; API, Web, `/ready` and the dashboard answer 200 and the new
   containers log no errors. `verify` passed the role and seven privilege checks
   and then stopped on nine older permission-error dead letters of
   `installation.sync_requested` (latest 2026-11-15 21:47, before this rollout).
3. **Window 2, native #101/#102 last** (`gate2-20261117`,
   `native102-20261117`): gate 17:52:16.7, idle, native stop 17:52:17, start
   17:52:20, `READY_FENCED` with `native-stream-cfe50b7-20261117` (SHA256
   `fdf825d2…`, 85,090,464 bytes), gate restored 17:52:21.9 (5 seconds).

## Acceptance evidence (UTC)

| Check                              | Result                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) normal review with publication | **PASS**                        | Disposable [777genius/rr-codex-rotating-e2e PR 138](https://github.com/777genius/rr-codex-rotating-e2e/pull/138) (Draft, then ready at 18:24:15): one request, [run 44147523978](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/44147523978), execution `rr:execution:7a8f7c74…` `completed` at 18:37:22 on producer 239, App summary "1 major · 3 minor" with inline comments at 18:38:13. The run ends red only through `review_merge_gate_failed`, which is the expected merge gate for the deliberate bug in the canary. An earlier attempt on [get-tok PR 2](https://github.com/get-tok/reviewrouter-onboarding-e2e/pull/2) (run 44145369545) reached the provider through Gateway 112/native 102 and published "Review incomplete": the Codex `gpt-6.1-sol` account answered HTTP 429 upstream (`gateway_native_response_failure` `http_status` 429), likely a usage limit, not proven. |
| (b) NVIDIA reviewer and live list  | **PASS**                        | The PR 138 review ran on the NVIDIA reviewer: `ReviewEvidenceObservation` requested and actual model `nvidia/nemotron-3.5-super-vl-120b-a12b` at 18:36:49, no Gateway failure lines in that window. Normal Gateway route `POST /v1/account-models/read` for the NVIDIA account at 18:17:52 (first read just after window 2): `snapshot`, source `nvidia`, 18 models, anchor first, no embed, rerank, guard, safety or similar ids; Kimi reads 6 models from `native_catalog` (#100).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| (c) quota skip                     | **Not run**                     | Runtime 240 and its producer are live, but no production policy has two reviewers (read-only check of all active configurations). It needs a disposable two-reviewer parallel roster with an OpenRouter `:free` reviewer that is out of daily quota, set by the owner in the dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| (d) ordered fallback               | **Not run**                     | Producer 240 with reviewer plan v2 is registered and `workflow-v1` = 240, so fallback rosters are admitted now; no policy is in fallback mode. It needs a disposable repository policy in "Fallback in order" with two reviewers, the first pointed at an unavailable model, set and restored by the owner in the dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| (e) one run per revision           | **PASS**                        | Natural traffic on the new worker: 777genius/review-router-ai PR 894, `pull_request_synchronized` request `f2b78c94…` dispatched run 44142567038 for head `93a30f42`; the `pull_request_ready_for_review` request `3c3b3df8…` for the same head at 17:59:02 became `superseded` with `supersededByRequestId` = `f2b78c94…` and no second run. After the 240 promotion, two quick pushes to the canary PR (`f8d3c3dc`, `161728c2`): request `c5764dc6…` (run 44163881463) became `superseded` by `9987d8c1…` and the worker cancelled that queued run, so it ended `cancelled`, not red. The run never started, so the runtime 240 path of #395 (a started run that learns it was superseded) was not exercised.                                                                                                                                                                                                |
| (f) connect and attach any plan    | **Code PASS; UI not exercised** | The 11 attach and workspace test files of #886/#887 pass on the exact source; no real GLM request. The worker logs "Review request ignored without an active hosted lane" (#884).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Action 240, FILE 68 and producer registration

4. **Release prep** [PR #398](https://github.com/777genius/review-router/pull/398),
   squash `3a256b15ceccbb0a8069c6b6bdacfecf1a36ffc6` (tree equal to the
   reviewed head): version metadata for 1.0.240 plus a re-export of the protocol
   handoff. The handoff exported for #396 named feature-branch commit `b3f1e9c8`
   as its base, which is not an ancestor of `main` after the squash merge, so the
   release manifest generator refused it; the re-export from `974295ea` onto
   `c11f550` changes only `expectedPublicActionBaseCommit`. Required `build`
   passed after waiting in the account queue since 17:53.
5. **Release** [44152856502](https://github.com/777genius/review-router/actions/runs/44152856502)
   SUCCESS, published 19:12:33: `v1.0.240` and `v1` = `3a256b15`. The first
   dispatch 44147024800 stayed queued for 33 minutes while later jobs started and
   was cancelled before it ran; nothing was published by it.
6. **Canonical manifest** for `3a256b15` from `974295ea` tooling: generator and
   checker pass, SHA256 `f32ade98…`, reviewer plan
   `{ planVersion: 2, descriptorDigest: sha256:53ad81ad… }`, runtime entrypoint
   `04649ab5…`; schema, canonicalizer, agent profiles and dispatch descriptor
   equal 239.
7. **FILE 68** `coordinated240-20261117/producer-release-attestations.json`,
   SHA256 `de650886…`, 160,740 bytes, mode 0444: all 67 rows kept, the 240 row is
   the 239 row with only `producerReleaseId`, `actionCommitSha`,
   `runtimeCommitSha`, `runtimeEntrypointDigest` and `reviewerPlanProfile`
   changed (production keeps its `account_gateway`-only dispatch profile). The
   installed image's own reader parses 68 rows and plan version 2 in an offline
   container. Rotating installer descriptor for 240 (seed script SHA256
   `b8e05bfb…`, unchanged), binding `c425a450…`.
8. **FILE 68 cohort** with the reviewed FILE67 operator (constants only),
   applied 19:13:23: four roles restarted on the same image, mount moved to the
   FILE 68 generation, `REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF` (api, web) and
   `REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF` (all) moved to `3a256b15`, 239 added
   to the rotating overlap, installer tuple `v1.0.240`; zero restarts, `/ready`
   and Web 200, no errors. Old containers are kept as
   `*-before-file68-retained`.
9. **Producer registration** through the normal trusted materializer inside the
   API (`issuer240.mjs` inspect, then register) at 19:13:48:
   `reviewrouter-action.3a256b15…` `registered` with reviewer plan version 2;
   239, limits and SLO profiles unchanged; no direct SQL.
10. **`workflow-v1` promotion** with `promote-workflow-channel.yml`
    (`version=v1.0.240`, `expected_current_sha=1112a0f1…`):
    [44161249760](https://github.com/777genius/review-router/actions/runs/44161249760)
    SUCCESS at 19:55; readback `workflow-v1` = `v1.0.240` =
    `3a256b15ceccbb0a8069c6b6bdacfecf1a36ffc6`. The first dispatch 44156338278
    stayed queued for 26 minutes and was cancelled before it ran; the channel
    did not move then.

## Other observations

- `release.sh verify` stops on nine `installation.sync_requested` dead letters
  with a permission error, the latest from 2026-11-15 21:47, before this
  rollout. The worker repository grant is in place (`worker can update fullName
= t`); requeueing those events is a separate owner decision.
- The new worker logs `review_investigation_active_turn_recovery_failed` in
  retention maintenance; the previous worker logged the same 12 times since
  12:00, so it is not new.
- `777genius/social-monitor` PR 665 execution `c8fec135…` turned `failed` at
  17:50:59 when the new worker started. Its GitHub run 44117482365 had already
  failed at 16:29, so this is reconciliation of a dead execution, not a run cut by
  the swap.
- Main is now at `751238b9` (#894); it is not part of this rollout.

## Rollback pins

Undo in the exact reverse of what ran. Admission gate custody for a rollback
window: copy the `caddy-*` files of `gate1-20261117` into a fresh custody and use
the same operator.

1. If producer 240 was registered and `workflow-v1` moved, first move
   `workflow-v1` back to `1112a0f1de568f9fa927316ab68cef54fbcd4653` (239) with
   the promotion workflow; nothing of this is done yet.
2. Native 102 to 100: under the gate, stop the unit, put back
   `native102-20261117/config.before` (native
   `native-catalog-d92f681-20261117`, SHA256 `d2017c24…`) and start.
3. ReviewRouter: stop the four `974295ea` containers and start the retained
   `*-before-ovl-20261117175053384` containers (image `dd234f5d…`, revision
   `0c67c3e0`). Migrations 158 and 159 stay; they only add a nullable column and
   widen a CHECK, and the old image runs against them.
4. Gateway 112 to 108: under the gate, stop, put back
   `gateway112-20261117/dropin.before` (WorkingDirectory and `serve.ts` of
   `gateway108-9a842ff-native96-20261114`), `systemctl daemon-reload`, start.
5. Native 100 to 98: under the gate, stop, put back
   `native100-20261117/config.before` (native
   `native-retention-5ed186e-20261115`, SHA256 `171cdfdc…`), start.

Database recovery point: pgBackRest full backup `20261117-184829F` (stanza
`reviewrouter`), taken before 000158/000159.
