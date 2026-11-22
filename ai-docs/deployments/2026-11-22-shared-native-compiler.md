# Shared package native compiler

- Task ID: `2026-11-22-shared-native-compiler`.
- Goal: compile and typecheck shared through the existing isolated TypeScript
  7.0.2 helper in normal builds, preserving its runtime and type contracts.
- Affected targets: build/CI; shared artifacts consumed by Web, API and worker.
- Implementation PR: [#967](https://github.com/777genius/review-router-ai/pull/967), draft.
- Implementation reference: `3495ca84c6e4e1162ae4dc4b77aa32fa24729578`, based on
  main `cc8ab361d1fcb22140037d20380e02eb2ba1e2d5`; not merged or deployed.
- Dependencies: existing `compiler:prepare` installation of the pinned native
  compiler; no dependency, lockfile, schema or configuration changes.
- Last updated: `2026-11-22`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                    |
| -------------------- | --------- | ------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| CI                   | `pending` | Required checks not verified    | Not verified        | Run required exact-commit checks before merging.                        |
| staging              | `pending` | Not verified                    | Not verified        | Include in a later authorized coherent build; no standalone activation. |
| production           | `pending` | Not verified                    | Not verified        | Include in a later authorized coherent build; no standalone activation. |

## Applicability and prerequisites

Only shared's two normal compiler commands change. Keep native installation
preparation and package build ordering. Classic TypeScript remains necessary for
Next, ESLint and source-analysis tooling; this change is not TS7-only compliance.
The owner permitted a bounded classic baseline for this compatibility check.

## Ordered rollout

1. Complete shared and affected-consumer qualification and required exact-commit CI.
2. A later authorized batch follows the [release process](../operations/07-environments-and-release-management.md).
3. Record the actual release source/image for each environment after that batch.

No migration, environment setting, runtime flag or separate activation is needed.
This record does not authorize a release or deployment.

## Verification and completion

Verify shared strict typecheck/build, emitted JS/declaration compatibility,
shared tests and direct consumers. Local evidence remains in the isolated
worktree's `tmp/shared-native-qualification/`; deployment completion requires the
actual release version and normal environment verification, not local success.

Local qualification used Node 26.11.0 and pnpm 11.28.7 (CI pins Node 26.11.1).
Shared's actual native build and typecheck passed. All 21 emitted JavaScript
files are byte-identical to the permitted TS6.0.3 baseline; all 21 declaration
surfaces are equivalent. Four declaration files differ textually only in the
order of distinct properties or a redundant ambient function `declare` modifier.
Both TS6.0.3 and TS7.0.2 checked the native declarations with `skipLibCheck: false`.
All four production exports imported after the unchanged ESM rewriting step;
87 shared and nearest-consumer tests passed. All 27 directly dependent packages
passed their existing typecheck commands against this worktree's shared package.
Required exact-commit CI remains pending.

## Retry, partial completion, and rollback

Inspect the failed command and exact source before retrying only the failed
qualification. Compiler failures must fail the build; do not silently retry with
classic. If needed, revert the two shared compiler commands and rebuild through
the normal release process. No data rollback is involved.

## Execution log

Draft PR #967 is open; draft CI was queued. Required exact-commit CI remains
pending. No release or deployment has been executed for this patch.
