# Native logger and tooling compiler routes

- Task ID: `2026-11-22-native-logger-tooling-compiler-routes`.
- Goal: use the existing pinned TypeScript 7.0.2 helper for normal logger
  compilation and the root spikes, one-shot handoff, tooling and lint/format
  noEmit projects, preserving their strict configuration and source coverage.
- Affected targets: build/CI; logger artifacts consumed by API and worker.
- Implementation PR: [#969](https://github.com/777genius/review-router-ai/pull/969).
- Implementation reference: `838d5bad4a3398abd135b4f0c247966f0fba6015`, based on
  main `06aae0faf17687e52b9d0be63717c8ccc16d1458`; not merged or deployed.
- Dependencies: existing root `compiler:prepare`; the root typecheck's existing
  shared-build prerequisite. The [shared compiler task](https://github.com/777genius/review-router-ai/blob/799ab5edf653f435cedaaa179e20966a07fa7b8a/ai-docs/deployments/2026-11-22-shared-native-compiler.md)
  is independently tracked by [PR #967](https://github.com/777genius/review-router-ai/pull/967).
  This patch does not require that PR to be merged first.
- Last updated: `2026-11-22`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                           |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------- |
| CI                   | `pending` | Required checks not verified    | Not verified        | Run required exact-commit checks before merge. |
| staging              | `pending` | Not verified                    | Not verified        | Include in a later authorized coherent build.  |
| production           | `pending` | Not verified                    | Not verified        | Include in a later authorized coherent build.  |

## Applicability and prerequisites

Keep the existing native installation and shared-before-root-tooling ordering.
No dependencies, lockfiles, tsconfigs, exports, compiler defaults, provider code,
runtime flags or environment settings change. Next, ESLint, classic AST consumers
and other legacy routes retain classic TypeScript; this is not TS7-only compliance.
The bounded TS6 compatibility baseline uses the owner's existing exception for
qualifying this migration. Existing queued PR checks are not restarted.

## Ordered rollout

1. Complete local compiler/output/consumer checks and required exact-commit CI.
2. Include in a later authorized batch following the
   [release process](../operations/07-environments-and-release-management.md).
3. Record actual source/image and normal verification for each environment.

No migration, configuration change or separate activation is required. This task
does not authorize deployment.

## Verification and completion

Managed qualification used Node 26.11.1, the CI pin, and isolated TypeScript 7.0.2.
The logger's actual build and typecheck passed. All four emitted logger files
(including existing test outputs) are byte-identical to the TS6.0.3 baseline.
Both compilers checked native declarations with `skipLibCheck: false`; emitted
redaction/summary/length-bound checks passed. Logger and API/worker fixtures
passed 63 tests, and both direct consumers passed their existing typechecks.

All four root noEmit projects passed on native. The first standalone tooling
check observed missing shared/dist; the existing shared-build prerequisite
resolved it. Passed spikes and one-shot checks were retained; only tooling and
the not-yet-run lint/format check ran afterward. No source or flags were weakened.
Reproducible commands and initial failure evidence are retained under the
isolated worktree's `tmp/logger-native-qualification/` and its managed job records.
Full workspace CI and a complete Next production build remain unverified.

## Retry, partial completion, and rollback

Inspect the failed command and its build prerequisites before retrying only the
unproven phase. Native failures remain failures; do not silently fall back.
Revert the four changed script fields if a regression is confirmed, then rebuild
through the normal release process. No data rollback is involved.

## Related links

- [Shared compiler PR #967](https://github.com/777genius/review-router-ai/pull/967).
- [Compiler route documentation](../../scripts/local-checks/compiler-README.md).

## Execution log

PR #969 was opened as a draft after local qualification and independent review.
Required exact-commit CI remains pending. No release or deployment has been
performed for this patch.
