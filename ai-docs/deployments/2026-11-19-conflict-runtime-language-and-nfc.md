# Conflict runtime review language and decomposed file names: deployment

- Task ID: `2026-11-19-conflict-runtime-language-and-nfc`
- Goal: a conflict review answers in the repository's review language, and a
  changed file whose name uses decomposed Unicode gets its real patch.
- Affected target: the public Action runtime only
  (`777genius/review-router`, file `action-dist/conflict-runtime.cjs`). Web,
  API, worker, Gateway and native are unchanged.
- Implementation: [PR #931](https://github.com/777genius/review-router-ai/pull/931).
  Both findings came from
  CodeRabbit on [review-router#400](https://github.com/777genius/review-router/pull/400)
  and were left for the owner in [Action 241](2026-11-19-action-241-cce9dd98.md).
  - `REVIEW_OUTPUT_LANGUAGE` is now in `conflictRuntimeProviderEnvAllowlist`.
    The control plane already sends it in the runtime config and the provider
    prompt already reads it; the allowlist dropped it in between.
  - `GitCliConflictDiffSource` passes the file name git reported to the
    per-file `git diff`, and keeps the NFC form only as the packet identity.
  - The prompt asks for finding `title` and `body` in that language; it used to
    name a `message` field the output schema does not have.
  - A changed file for which git returns no patch now fails the conflict review
    with `conflict_diff_patch_missing`. Before, the file went into the packet
    with an empty patch, which also skipped the symlink and submodule checks;
    a symlink or submodule under a decomposed name is now refused with
    `conflict_diff_file_type_unsupported` like any other.
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
   review language writes its summary and findings in that language.

Bundle in PR #931: SHA-256 `55a3288fbf0e90a8a35398cdee6ec9c51d803c76b1c8e849f3f678dfafad1d87` (Node 26.11.1, frozen lockfile).

## Retry and rollback

The bundle is a build artifact: rebuild with `pnpm action:build` and commit.
Reverting the commit restores the old behaviour after the next sync and Action
release.

## Execution log

| Time (UTC)   | Environment        | Operator   | Actual version / image | Step and observed result | Evidence | Next action                                        |
| ------------ | ------------------ | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------------------- |
| Not executed | public Action main | Unassigned | Not verified           | Merged, not synced       | PR #931  | Check the sync run, then ship in the next release. |
