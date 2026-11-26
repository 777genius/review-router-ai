# Shared package native compiler

- Task ID: `2026-11-22-shared-native-compiler`.
- Goal: compile and typecheck shared through the existing isolated TypeScript
  7.0.2 helper in normal builds, preserving its runtime and type contracts.
- Affected targets: build/CI; shared artifacts consumed by Web, API and worker.
- Implementation PR: [#967](https://github.com/777genius/review-router-ai/pull/967), ready.
- Implementation reference: `3495ca84c6e4e1162ae4dc4b77aa32fa24729578`, based on
  main `cc8ab361d1fcb22140037d20380e02eb2ba1e2d5`; merged into the installed main.
- Dependencies: existing `compiler:prepare` installation of the pinned native
  compiler; no dependency, lockfile, schema or configuration changes.
- Last updated: `2026-11-23`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                    |
| -------------------- | --------- | ------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| CI                   | `pending` | Required checks not verified    | Not verified        | Run required exact-commit checks before merging.                        |
| staging              | `pending` | Not verified                    | Not verified        | Include in a later authorized coherent build; no standalone activation. |
| production           | `installed` | `f20a75ed` / `sha256:2a601d6b…` | 2026-11-26 | Included in the exact fleet build; downstream classic API consumers remain. |

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

## Browser fixture follow-up (2026-11-23)

Main `06aae0faf17687e52b9d0be63717c8ccc16d1458` was merged normally as
`0731105f41c1e035ca4943eab83598e7fe51a44d`. This includes the independently
fixed static-lint failures from the previous CI attempt. The Skills generation
case now reacquires its second-tab mutation actor immediately before removal.
The first tab retains its stale draft in its original document; generation,
version, conflict, draft-retention and final persisted-value assertions remain
unchanged. The original CI timeout's underlying cause has not been proven.

The browser harness's existing frozen lockfile was installed into its own
`scripts/accounts-reference-e2e/node_modules`, with a worktree-owned pnpm store
and cache. Shared root dependencies were not modified. The existing native
harness project passed:

```sh
node scripts/local-checks/compiler-cli.ts --native --noEmit -p scripts/accounts-reference-e2e/tsconfig.json
```

The exact previously failing case passed on Node 26.11.1, PostgreSQL 17.11,
locked Playwright 1.64.1 and its Chromium revision 1248. A fresh disposable local
database was migrated before this command; the runtime retained its loopback
network guard, existing timeouts and zero-retry policy:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/tmp/typescript7-skills-browser-cache" \
ACCOUNTS_REFERENCE_E2E_GREP='Skills generation rejects an old Paths editor after remove and re-add at version one' \
ACCOUNTS_REFERENCE_E2E_TRACE=on \
node --import ./scripts/accounts-reference-e2e/node_modules/tsx/dist/loader.mjs \
  scripts/accounts-reference-e2e/src/run.ts \
  --repo-root "$PWD" \
  --database-url 'postgresql://fixture_owner@127.0.0.1:35437/review_router_accounts_reference_e2e_test?schema=public' \
  --work-dir tmp/accounts-reference-e2e/runs/ts7-generation-postgres17 \
  --skills-fixture
```

Recorded result: exit 0, `outcome: done`, `boot.ok: true`, one passed in 23.9s,
zero failed, zero skipped, `databaseMode: explicit-test-url`,
`databaseBaseline: fresh migrated`, `externalNetworkAllowed: false`.
The run used commit `0731105f41c1e035ca4943eab83598e7fe51a44d` plus source-delta
SHA256 `7aaf59bf280c38279ae0d0d08dad61f644505e5c091992bb2e14f34dd3afe69b`;
the tested `skills-ux.spec.ts` SHA256 was
`1ecd915e9a6638262867fb8edcd5d461004195ee069ecd7fe270709423ecdd8f`.
The disposable server was stopped afterward. Ignored run receipts and trace are
retained under the work directory as supplementary evidence.

An earlier isolated-PGlite attempt failed before the target scenario because
the socket returned PostgreSQL protocol error `08P01` (126 bind parameters for
a prepared statement requiring 3). That failed run is retained separately; it
does not qualify the browser change. Local PostgreSQL 17.11 and Node 26.11.1
also differ from the current CI's PostgreSQL 17.10 and Node 26.12.1 pins. This
one-case local result does not replace all 24 browser scenarios or required
exact-commit CI. No deployment or release is claimed.

## Retry, partial completion, and rollback

Inspect the failed command and exact source before retrying only the failed
qualification. Compiler failures must fail the build; do not silently retry with
classic. If needed, revert the two shared compiler commands and rebuild through
the normal release process. No data rollback is involved.

## Execution log

PR #967 is ready after local qualification and technical review. Required
exact-commit CI remains pending. No release or deployment has been executed for
this patch.

## Production installation — 2026-11-26

The shared build/typecheck implementation was included in RR `f20a75edbc7eff11be4f2423fb2e723f6e484223`, image `sha256:2a601d6bffaebea0c2cdd4e1cf82c95a10312136b173f56e837f15a09aa0d810`; the image build succeeded and the production fleet runs it. This does not claim that Next, ESLint or every compiler consumer has moved off classic APIs.
