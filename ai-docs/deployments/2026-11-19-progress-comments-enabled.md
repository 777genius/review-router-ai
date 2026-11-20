# Bundled rollout of 2026-11-19/20: ReviewRouter 9ee93eb1, progress comments on for every repository

- Task ID: `2026-11-19-progress-comments-enabled`
- Goal: one ReviewRouter release that turns the live progress comment on for
  every repository and ships the fixes merged after it, with the historical
  backlog of progress rows expired right before the switch.
- Content: ReviewRouter `9ee93eb13e3a7d49fbd9ba45173bfecd879a8b78` on all four
  roles, which is `061f04bc` plus #926 (progress comment on by default), #934
  (progress terminal promotion retry), #933 (one summary per pull request), #938
  (oversize notice), #935 (expired investigation turn recovery), #930, #932 and
  #937 (Web: usage wording, model list auto refresh, no manual Refresh), and the
  release tooling #927 and #929. #931 is a public Action bundle and reaches users
  only with a future Action release. No migration.
- Covers the task records
  [progress comment on by default](2026-11-19-progress-comments-default-on.md),
  [terminal promotion retry](2026-11-20-progress-terminal-promotion-retry.md),
  [one summary per pull request](2026-11-20-sticky-review-summary.md),
  [oversize notice](2026-11-20-oversize-review-notice.md),
  [expired turn recovery](2026-11-20-expired-turn-recovery.md),
  [usage wording](2026-11-19-usage-plain-wording.md),
  [model list auto refresh](2026-11-20-account-model-list-auto-refresh.md) and
  [no manual Refresh](2026-11-20-no-manual-refresh-provider-setup.md).
- Not in this image: #939 (private material prune isolation, merged after the
  build).
- Last updated: `2026-11-20`.

## Environment status

| Target                         | Status     | Actual version                                        | Verified (UTC)   | Evidence / next step        |
| ------------------------------ | ---------- | ----------------------------------------------------- | ---------------- | --------------------------- |
| production API/Web/worker/scan | `deployed` | review-router-ai `9ee93eb1`, image `sha256:a032a165…` | 2026-11-20 01:05 | Steps and acceptance below. |
| production database            | `deployed` | no migration; 1144 progress rows expired              | 2026-11-20 00:07 | Guarded expiry below.       |
| Gateway, native, Action        | unchanged  | Gateway 115, native 102, `workflow-v1` = 241          | -                | Not part of this release.   |

The Web task records are `installed`: their strings are served, but the
signed-in dialog and usage checks need the owner's session.

## Pre-checks (exact commit)

- `git diff 4765de28..9ee93eb1`: no migration, `schema.prisma`, SQL, package or
  lockfile change.
- Hetzner build host, clean `pnpm install --frozen-lockfile` of the archive of
  `9ee93eb1`: `pnpm typecheck` exit 0; Vitest for `apps/worker/src`,
  `apps/web/app`, `apps/web/src`, `apps/api/src/review*`, conflict-runtime,
  review-investigations, review-progress and review-publishing: 385 files
  passed, 17 skipped (4,666 tests); fleet-overlay node tests 20/20 and
  `release.test.sh` green.
- Image built on the production host with
  [`release.sh`](../../deploy/hetzner/release.sh) `build`:
  `sha256:a032a165315459f9a34c9eda3299e0c03c81db79b9f2066b385e39f289441691`,
  revision label `9ee93eb1`, linux/amd64, 461 s.

## Tooling added for this rollout

- [#927](https://github.com/777genius/review-router-ai/pull/927): fleet-overlay
  `unset`, and `RR_SWAP_EXTRA_UPDATES` so one `release.sh swap` changes the
  image and env together.
- [#929](https://github.com/777genius/review-router-ai/pull/929): the overlay
  CAS accepts a plain `KEY="v"` canonical line. Production canonical files keep
  most keys dotenv-quoted, so the first dry-run of the unset stopped safely at
  `canonical_differs_from_container`.

Both had an independent read-only review; all remarks were fixed before merge.

## Quiet window: rule used

A swap restarts the four stateless roles, so it waited for no in-process work:
`busy=0` in every 15 s sample for 120 s, counting

- open executions that are live: an active invocation lease, a lease renewal in
  the last 10 minutes, or created in the last 10 minutes; plus no GitHub
  Actions run `in_progress` for the head of any open execution;
- outbox events in `processing` or with an unexpired claim;
- active publication claim terms, publication attempts `publishing` or
  `reconciling`, publication operations in flight with an unexpired
  reconcile window, active operation attempts with an unexpired effect window;
- claimed completion processes, or ones in a publication state created within
  the last hour;
- claimed progress publications, investigation turns leased in the last 15
  minutes, active investigation leases.

Rule change on 2026-11-20 (orchestrator decision): at first every `planned` or
`running` execution blocked the swap. Three executions (social-monitor #665,
review-router-ai #931 and #932) stayed `running` with no lease, last renewal at
22:31, 22:00 and 22:33, and their Actions runs queued, not started, behind a
starved Actions queue; their deadlines were 03:56 to 04:31. Waiting for those
deadlines protects nothing: the executions live in the database and resume when
their runner starts (same runtime protocol, no migration). So an execution
counts as live only with real activity, as listed above. After the swap all
three kept their rows and deadlines: #665 was superseded normally by a new
execution at 00:46, #931 and #932 stay `running` until their own deadline.

Stale rows excluded by recency so they do not block forever (owner items below).

## What ran (UTC)

1. **Bounded build cache cleanup** (2026-11-19 22:06 to 22:07), see "Disk".
2. **Dry-run plan** (`swap` without `--apply`, controller
   `fleet-overlay-9ee93eb1-fWUbCDKu`, `RR_SWAP_EXTRA_UPDATES` unsetting the four
   progress keys on api, worker and scan): the three release identity keys on
   all four roles, the four unsets on api, worker and scan, web identity only,
   ExtraHosts unchanged. Approved by the orchestrator.
3. **Quiet window** open at 00:06:50.
4. **Backlog expiry** 00:07:41, database owner session, one transaction: the
   `SELECT count(*)` taken in the same transaction (1144) had to equal the
   `UPDATE` row count, otherwise everything rolled back. Predicate: unpublished,
   unclaimed rows whose active execution is not `planned` or `running`. Effect
   as the publisher's own suppress: `publishedVersion = desiredVersion`,
   `lastErrorCode = 'review_progress_backlog_expired'`, no GitHub call. Three
   rows stayed pending (the three open executions above); after the swap the
   publisher closed them as `review_progress_stale_head` without writing. A
   rollback-only dry run of the same SQL ran first.
5. **Swap** 00:07:52 to 00:08:25: `fleet-overlay apply` of the planned
   controller, started detached on the host (`setsid nohup`) because the
   operator's ssh link kept dropping; same tool and spec as `release.sh swap
--apply`. Receipt phase `applied`. New roles started 00:07:56 to 00:07:57.
   Old containers retained as `*-before-ovl-20261120000752907`.
6. **Checks:** four roles on `a032a165` (revision `9ee93eb1`), zero restarts;
   no `REVIEW_ROUTER_PROGRESS_*` or `REVIEW_ROUTER_HOSTED_PROGRESS_*` key in the
   live api, worker and scan containers or the canonical env files (files still
   root 0600); `/ready` 200. Worker booted, no "Review progress settings are
   invalid" warning, no `phases failed` line.

## Acceptance evidence (UTC)

| Check                                    | Result     | Evidence                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worker and API 15 minutes after the swap | **PASS**   | 00:23: zero restarts, no error, fatal or `phases failed` line; API `forbidden` lines are the usual protocol rejections (`review_request_intent_required`, `target_revision_mismatch`), seven of them in the seven hours before.                                                                                                               |
| worker loop                              | **PASS**   | Outbox pass interval median 6.9 s, p95 10.4 s, max 68 s (00:08 to 01:01), against 6.0 s, 9.4 s and 73 s on the old worker (17:00 to 00:07). The longest passes are the ones that publish a review.                                                                                                                                            |
| progress comment on the canary           | **PASS**   | [Canary PR 142](https://github.com/777genius/rr-codex-rotating-e2e/pull/142), one comment `7026650386`, seven edits, see below.                                                                                                                                                                                                               |
| one summary per pull request (#933)      | **PASS**   | Second push to PR 142: the summary `7026712624` was edited in place at 01:00:00 ("Review updated"), one summary comment on the PR. social-monitor #782 reused its existing summary (edited 00:21:03), no new one.                                                                                                                             |
| real review                              | **PASS**   | social-monitor #782: one progress comment `7026020278`, Reviewing 00:14:28, 00:14:54, 00:20:12, Complete 00:21:10, 7 s after the summary edit. Later social-monitor #665 (new execution), #764 and review-router-ai #939 published too.                                                                                                       |
| no stale comment on old pull requests    | **PASS**   | Since the swap progress was published only for those reviews and the canary (five pull requests), all with a live or new execution, `failureCount` 0. The only pending row is review-router-saas-e2e #57 (an execution of 2026-09-17 re-promoted by #934; the repository is not selected, so it is deferred every 60 s with no GitHub write). |
| GitHub rate limit or permission errors   | **PASS**   | None in the worker log or in `lastErrorCode` since the swap.                                                                                                                                                                                                                                                                                  |
| investigation recovery (#935)            | **PASS**   | First pass at boot: `recoveredActiveTurnCount` 6, `failedInvestigationCount` 42, `failureCauseCode` `dossier_digest_invalid`, `deferredActiveTurnCount` 0 on the first pass. Turns now: leased 42, expired 7.                                                                                                                                 |
| Web strings                              | **served** | Web container `.next/static`: "Updating the model list…", the out-of-date banner, "at least ", "so far, until … UTC", "Try again"; "Refresh models" only as the aria-label of the optional manual Refresh in the status line.                                                                                                                 |

### Canary timings (PR 142)

Revision 1, run 44645643616 (dispatched 00:24:42, it waited in the Actions
queue until about 00:42):

| Edit     | Phase              | Snapshot | Note                                       |
| -------- | ------------------ | -------- | ------------------------------------------ |
| 00:42:36 | Reviewing          | 00:42:32 | comment created                            |
| 00:44:15 | Reviewing          | 00:44:08 |                                            |
| 00:44:46 | Assembling results | 00:44:41 | phase change, 31 s after the previous edit |
| 00:45:54 | Complete           | 00:45:52 | 17 s after the App summary (00:45:37)      |

Revision 2 (push 00:56:03), run 44649809909, same comment edited in place:

| Edit     | Phase     | Snapshot | Note                                   |
| -------- | --------- | -------- | -------------------------------------- |
| 00:58:10 | Preparing | 00:58:08 | new review takes over the comment      |
| 00:58:36 | Reviewing | 00:58:13 |                                        |
| 01:00:31 | Complete  | 01:00:30 | 31 s after the summary edit (01:00:00) |

Every edit landed within 25 s of its snapshot (target 90 s); terminal edits
came 7 s, 17 s and 31 s after the summary (target about 30 s). Short phases
(Publishing, and Assembling on revision 2) can pass between two publisher
passes and are then not shown; the comment never went backwards.

Final comment text of revision 1 (single part, so no percentage):

```text
## ReviewRouter

**Phase:** Complete

Files fully reviewed: 1 of 1
Files not assigned to any part: 0
Files skipped (unavailable or excluded): 0
Parts that could not be finished: 1

Started: 2026-11-20 00:42:26 UTC
Last update: 2026-11-20 00:45:52 UTC

How progress is measured (collapsed): The comment shows the review phase; a
percentage appears only when the review is split into two or more parts.
Updates are best effort, so this comment can lag a little behind the review.
```

Finding for the owner: both the canary and social-monitor #782 show "Parts that
could not be finished: 1" next to "Complete" while all files are reviewed. That
reads like a contradiction; the count likely includes an optional part. Not a
rollback signal; worth a wording or counting fix.

## Private material retention (facts, not changed)

The first maintenance pass also logged
`review_investigation_private_material_prune_failed` (cause not in the
allowlist, so `null`). It is new in kind: the old worker ran the same step after
its active-turn failure and did not report it. `ReviewInvestigationPrivateMaterial`
holds 2,065 rows of 53 investigations (302,802 ciphertext bytes), created
2026-08-06 to 2026-10-19, all past `expiresAt` (oldest 2026-08-07): 1,181 belong
to `superseded` investigations without an active turn, 823 to the 42 leased
turns, 60 to `awaiting_turn`, 1 to `inconclusive`. Expired encrypted material
has been kept 1 to 3.5 months past expiry. #939 (merged after this build)
addresses the prune isolation; it ships with the next release.

## Disk: bounded build cache cleanup (2026-11-19 22:06 to 22:07 UTC)

Done before the rollout because the root disk was at 99 % with 12.87 GB free and
each image build costs about 7 GB.

- Evidence: `/srv/platform/operations/disk-cleanup-20261119-prod-docker`
  (root 0700, files 0600): `df`, `docker system df` and `docker buildx du`
  (plain and verbose) before and after, builder list, command output, receipt,
  image usage list.
- Command, default daemon only, no build running:
  `docker builder prune --force --filter until=48h`.
- Prune reported 76.85 GB. Free space on `/` 12,866,469,888 to 91,413,860,352
  bytes (99 % to 91 %). Build cache 181 GB in 819 records to 104 GB in 686.
  Images (215), containers (472), volumes and the 32 retained rollback
  containers were not touched. After the 9ee93eb1 build: 75 GB free.
- Images, for the owner's decision (not changed): 17 used by running
  containers, 51 only by stopped or retained containers, 205 by no container
  (28 untagged intermediates; the rest include other projects on this host such
  as social-monitor and discord-meeting, and `reviewrouter-manual` images of
  recent releases that must stay until their rollback window ends). Names, tags
  and sizes: `images-usage-after.txt` in the evidence directory.
- The pgBackRest repository is a remote Hetzner Storage Box (sftp, full backup
  about 680 MB), so the nightly backups do not use the root disk.

## Owner items: stale data found, not changed

| Family                                         | Count | Age                      | Current cost                                                                                                                                 |
| ---------------------------------------------- | ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReviewPublicationOperationV2` still in flight | 7     | 2026-07-26 to 2026-08-08 | 5 operation attempts stay `active` under terminal attempts; noise for any in-flight check                                                    |
| `ReviewCompletionProcess` awaiting publication | 63    | since 2026-08-24         | maintenance touches every row every 5 minutes (`updatedAt`, `nextActionAt`)                                                                  |
| `ReviewInvestigationTurn` stuck `leased`       | 42    | since 2026-10-06         | the 42 legacy rows fail `dossier_digest_invalid` each pass and are backed off in worker memory ([#935](2026-11-20-expired-turn-recovery.md)) |

## Rollback pins

ReviewRouter `9ee93eb1` to `061f04bc`: stop the four `9ee93eb1` containers,
rename them away, rename the retained `*-before-ovl-20261120000752907`
containers back to their names and start them (image `sha256:c196f4fb…`). They
carry the old env, including `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0`
and the one-repository allow-list on api, worker and scan, so that also turns
progress comments off. Then restore the canonical env files from
`roles.<role>.canonical` in
`/srv/platform/projects/review-router/releases/fleet-overlay-9ee93eb1-fWUbCDKu/snapshot.json`
(see [fleet-overlay](../../deploy/hetzner/fleet-overlay/README.md)). No
migration to undo. The expired progress rows stay expired (a new review on the
same pull request opens its row again). Published comments stay on GitHub.

Kill switch without a rollback: fleet-overlay `add`
`REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0` on the worker (recreates the
fleet). Capture keeps running, so turning writes back on later needs the expiry
again, as in the [default-on task](2026-11-19-progress-comments-default-on.md).
