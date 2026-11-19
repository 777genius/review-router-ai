# Conflict runtime bundle rebuild: deployment

- Task ID: `2026-11-19-conflict-runtime-bundle-rebuild`
- Goal: the committed `action-dist/conflict-runtime.cjs` matches its source
  again, so the CI parity check passes and the public Action gets a conflict
  runtime built from current code.
- Affected target: the public Action runtime only
  (`777genius/review-router`, file `action-dist/conflict-runtime.cjs`). Web,
  API, worker, Gateway and native are unchanged.
- Implementation: the "Fix main CI" PR that adds this file. Source changes in
  the bundle came from
  [PR #890](https://github.com/777genius/review-router-ai/pull/890) (reviewer
  roster mode in `review-config`, pulled into the bundle transitively) and later
  edits to the same modules; none of them rebuilt the bundle.
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
   successful main `CI` run and pushes the synced files to the public Action
   `main`. Its last successful run was on 2026-11-17, before #890 merged, so
   that push also carries any other synced file that changed in the meantime
   (`action-dist/index.cjs`, the Codex bundle, the seed scripts). Check the
   sync run and the resulting public commit.
2. The conflict runtime reaches users only through the next Action release in
   the [release procedure](../operations/07-environments-and-release-management.md).
   Nothing moves `v1` or `workflow-v1` automatically.

Expected bundle: SHA-256
`820d48c5e81ce73b0f39aebf57a41ba9a06ffe41aaf2a79f68ed9d7f85d81b8a`
(two identical local builds on Node 26.11.1 with the frozen lockfile).

## Retry and rollback

The bundle is a build artifact. Rebuild with `pnpm action:build`; roll back by
reverting the commit, which brings the parity check back to red.
