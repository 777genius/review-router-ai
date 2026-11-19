# Conflict runtime bundle rebuild: deployment

- Task ID: `2026-11-19-conflict-runtime-bundle-rebuild`
- Goal: the committed `action-dist/conflict-runtime.cjs` matches its source
  again, so the CI parity check passes and the public Action gets a conflict
  runtime built from current code.
- Affected target: the public Action runtime only
  (`777genius/review-router`, file `action-dist/conflict-runtime.cjs`). Web,
  API, worker, Gateway and native are unchanged.
- Implementation: [PR #918](https://github.com/777genius/review-router-ai/pull/918).
  The bundle went stale with
  [PR #890](https://github.com/777genius/review-router-ai/pull/890), whose
  reviewer roster mode in `review-config` is pulled into the bundle
  transitively; #890 did not rebuild it. The rebuilt bundle differs only in
  the roster mode logic from #890 and #892.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-19.

## Environment status

| Target                    | Status    | Actual version | Evidence                                                    |
| ------------------------- | --------- | -------------- | ----------------------------------------------------------- |
| Public Action `main`      | `pending` | Not verified   | Synced automatically after the first green main CI run      |
| Public Action release/tag | `pending` | Not verified   | Ships with the next ordinary Action release, `v1` unchanged |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and rollout

1. After merge, the `Sync Public Action Runtime` workflow runs on the first
   fully green main `CI` run and pushes the synced files to the public Action
   `main`, rebuilding them from that main commit. Its last successful run was
   on 2026-11-17, before #890 merged. Besides this bundle, the only synced file
   that differs from the public `main` is `action-dist/index.cjs` (two unused
   `reviewerPlanContract` constants from #899), which also closes the pending
   `index.cjs` sync in [verification residuals](2026-11-17-verification-residuals.md).
   Public `main` is the live channel for hosted beta `@main` users, so
   `index.cjs` reaches them on that push; it has no runtime effect. Check the
   sync run and the resulting public commit.
2. The conflict runtime itself reaches users only through the next Action
   release in the
   [release procedure](../operations/07-environments-and-release-management.md):
   the conflict workflow accepts only a `v1` tag or an exact SHA as
   `runtime_ref`. Nothing moves `v1` or `workflow-v1` automatically.

Bundle in PR #918: SHA-256
`820d48c5e81ce73b0f39aebf57a41ba9a06ffe41aaf2a79f68ed9d7f85d81b8a` (two
identical builds on Node 26.11.1 with the frozen lockfile). Any later merge
that touches a bundle input changes this hash and needs another rebuild.

## Retry and rollback

The bundle is a build artifact. Rebuild with `pnpm action:build` and commit the
result. Reverting the commit makes the parity check red again and stops the
sync; it does not roll back a public `main` that was already synced, which
needs a separate commit in the public Action repository.

## Execution log

| Time (UTC)   | Environment        | Operator   | Actual version / image | Step and observed result | Evidence | Next action                                  |
| ------------ | ------------------ | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------------- |
| Not executed | public Action main | Unassigned | Not verified           | Merged, not synced       | PR #918  | Check the sync run after the first green CI. |
