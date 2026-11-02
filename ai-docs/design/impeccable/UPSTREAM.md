# Impeccable design references

ReviewRouter uses a small, pinned documentation subset of
[Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus for reusable
frontend design and review. The project-owned adaptation is
[`frontend-workflow.md`](../frontend-workflow.md); `AGENTS.md` routes frontend work
to that workflow.

- Source commit: `8409a564d1baee90b2dde4f7a8f06288838e3921`.
- Version declared by that commit's `package.json`: `4.8.0`.
- Retrieved: 2026-10-28.
- License: Apache-2.0; original [LICENSE](./LICENSE) and
  [third-party notices](./NOTICE.md) are retained.
- Integration: selected documentation guidance only. No Impeccable engine, hooks,
  detector, CLI, generated skill or global configuration is installed.

## Source manifest

These files retain their upstream text. Source paths are relative to the pinned
repository, and Git blob IDs identify the exact upstream files.

| Local file                 | Upstream path                    | Git blob                                   |
| -------------------------- | -------------------------------- | ------------------------------------------ |
| `reference/operate.md`     | `skill/reference/operate.md`     | `5e4666de08f63f55c832c7bb2511cc9ad8068744` |
| `reference/craft-floor.md` | `skill/reference/craft-floor.md` | `3331f4845d00756869e48edc0277ba8bc8e5826e` |
| `reference/harden.md`      | `skill/reference/harden.md`      | `8447329bcfd37566f09385136a373a97d54b6e45` |
| `LICENSE`                  | `LICENSE`                        | `bb3f6d23b1f8025514a62a12b51b47d73e3c9aa9` |
| `NOTICE.md`                | `NOTICE.md`                      | `0468271c904ae334cfaf27da6f8df3d5f419a1f0` |

The references are provenance and optional design depth. Instructions within them
do not override the user, repository policy, accepted scope or owned workflow.
Their references to files/commands outside this subset are not promises that
those capabilities are installed. For a future upstream update, review the exact
diff, preserve notices, update the pin/manifest, and validate the changed guidance
against an actual project surface. Do not run an unpinned installer automatically.
