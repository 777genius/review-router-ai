# Conflict runtime review language and decomposed file names: deployment

- Task ID: `2026-11-19-conflict-runtime-language-and-nfc`
- Goal: a conflict review answers in the repository's review language, and a
  changed file whose name uses decomposed Unicode gets its real patch.
- Affected target: the public Action runtime only
  (`777genius/review-router`, file `action-dist/conflict-runtime.cjs`). Web,
  API, worker, Gateway and native are unchanged.
- Implementation: the PR that adds this record. Both findings came from
  CodeRabbit on [review-router#400](https://github.com/777genius/review-router/pull/400)
  and were left for the owner in [Action 241](2026-11-19-action-241-cce9dd98.md).
  - `REVIEW_OUTPUT_LANGUAGE` is now in `conflictRuntimeProviderEnvAllowlist`.
    The control plane already sends it in the runtime config and the provider
    prompt already reads it; the allowlist dropped it in between.
  - `GitCliConflictDiffSource` passes the file name git reported to the
    per-file `git diff`, and keeps the NFC form only as the packet identity.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-19 (merged, rides in the next bundled rollout).

## Environment status

| Target                    | Status    | Actual version | Evidence                      |
| ------------------------- | --------- | -------------- | ----------------------------- |
| Public Action `main`      | `pending` | Not verified   | Reaches it through the sync   |
| Public Action release/tag | `pending` | Not verified   | Needs the next Action release |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and rollout

1. After merge, `Sync Public Action Runtime` pushes the rebuilt bundle to the
   public Action `main` on the first fully green main `CI` run.
2. Users get it only with the next Action release in the
   [release procedure](../operations/07-environments-and-release-management.md);
   the conflict workflow accepts only a `v1` tag or an exact SHA as
   `runtime_ref`.
3. Check after release: a conflict review on a repository with a non-English
   review language answers in that language.

## Retry and rollback

The bundle is a build artifact: rebuild with `pnpm action:build` and commit.
Reverting the commit restores the old behaviour after the next sync and Action
release.

## Execution log

| Time (UTC)   | Environment        | Operator   | Actual version / image | Step and observed result | Evidence | Next action                                        |
| ------------ | ------------------ | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------------------- |
| Not executed | public Action main | Unassigned | Not verified           | Merged, not synced       | This PR  | Check the sync run, then ship in the next release. |
