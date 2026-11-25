# Native logger and tooling compiler routes

- Task ID: `2026-11-22-native-logger-tooling-compiler-routes`.
- Goal: use the existing pinned TypeScript 7.0.2 helper for normal logger
  compilation and the root spikes, one-shot handoff, tooling and lint/format
  noEmit projects, preserving their strict configuration and source coverage.
  The qualified follow-up also selects native for two dedicated hosted contract
  commands and the existing protocol contract-source bootstrap compiler.
- Affected targets: build/CI; logger artifacts consumed by API and worker.
- Implementation PR: [#969](https://github.com/777genius/review-router-ai/pull/969).
- Implementation reference: `838d5bad4a3398abd135b4f0c247966f0fba6015`, based on
  main `06aae0faf17687e52b9d0be63717c8ccc16d1458`; not merged or deployed.
- Dependencies: existing root `compiler:prepare`; the root typecheck's existing
  shared-build prerequisite. The [shared compiler task](https://github.com/777genius/review-router-ai/blob/799ab5edf653f435cedaaa179e20966a07fa7b8a/ai-docs/deployments/2026-11-22-shared-native-compiler.md)
  is independently tracked by [PR #967](https://github.com/777genius/review-router-ai/pull/967).
  This patch does not require that PR to be merged first.
- Last updated: `2026-11-23`.

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
The durable receipt below records commands, outcomes, initial diagnostics and
output hashes directly; isolated `tmp/` files are supplementary recovery evidence.
Full workspace CI and a complete Next production build remain unverified.

## Durable qualification receipt

This records the original local qualification at implementation
`838d5bad4a3398abd135b4f0c247966f0fba6015`, source base
`06aae0faf17687e52b9d0be63717c8ccc16d1458`, on 2026-11-22 from
18:36:44Z through 18:42:58Z. Runtime was Node 26.11.1; helper versions were
native 7.0.2 and the explicitly approved classic 6.0.3 baseline. These local
results do not attest a later commit's CI or deployment. Commands below use the
repository root unless a cwd is stated; no isolated worktree path is required.

| Check                     | Reproduction command                                                                                                                                                                             | Recorded result       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Actual logger build       | cwd `packages/platform/logger`: `node ../../../scripts/local-checks/compiler-cli.ts --native -p tsconfig.build.json`                                                                             | exit 0                |
| Actual logger typecheck   | same cwd: `node ../../../scripts/local-checks/compiler-cli.ts --native --noEmit -p tsconfig.json`                                                                                                | exit 0                |
| Native comparison output  | `node scripts/local-checks/compiler-cli.ts --native -p packages/platform/logger/tsconfig.build.json --outDir tmp/logger-native-qualification/native`                                             | exit 0                |
| Classic comparison output | same command with `--legacy` and outDir `tmp/logger-native-qualification/legacy`                                                                                                                 | exit 0                |
| Both declaration checks   | `node scripts/local-checks/compiler-cli.ts --native --noEmit -p tmp/logger-native-qualification/tsconfig.emitted.json`; repeat with `--legacy`                                                   | both exit 0           |
| Focused fixtures          | `node node_modules/vitest/vitest.mjs run packages/platform/logger apps/api/src/app.test.ts apps/worker/src/outbox-worker-loop.test.ts apps/worker/src/memory-maintenance.test.ts --maxWorkers=2` | exit 0; 63 passed     |
| API consumer              | cwd `apps/api`: `node ../../scripts/local-checks/compiler-cli.ts --native --noEmit -p tsconfig.json`                                                                                             | exit 0                |
| Worker consumer           | same command from `apps/worker`                                                                                                                                                                  | exit 0                |
| Root projects             | `node scripts/local-checks/compiler-cli.ts --native --noEmit -p PROJECT` for `tsconfig.spikes.json`, `tsconfig.one-shot-test-handoff.json`, `tsconfig.tooling.json`, `tsconfig.lint-format.json` | final exit 0 for each |

For the declaration checks create the following config at the named scratch
path; it preserves the stricter library check used in the original receipt:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "skipLibCheck": false },
  "include": ["native/**/*.d.ts"]
}
```

Both output directories contained exactly these four files, with equal bytes
and SHA256 in each directory:

| File              | Native and classic SHA256                                          |
| ----------------- | ------------------------------------------------------------------ |
| `index.d.ts`      | `27424b7ce3ba1ce5387779ada51606dc419e82982436ae8531d83840a69e8e56` |
| `index.js`        | `d391fb27afe41ca73e83e3d96aaf72d0ce5ed65ad4f280d630c502a73baaadca` |
| `index.test.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `index.test.js`   | `8e9ff52b83a0a6913621e65d44de46cfbaefc9e62b249d2e74ebe93813c6bc35` |

The emitted native logger also returned `token=<redacted>` for the synthetic
input `token=synthetic-value`, `safe message` for `new Error("safe message")`,
and `abc` for `safeErrorSummary("abcdef", {maxLength: 3})`; all assertions passed.

The initial standalone tooling check exited 1 with TS2307 for these missing
prerequisite outputs: `packages/shared/dist/review-agent-profile.js`,
`review-model-dispatch-contract.js` and `review-model-dispatch-default-agents.js`.
The normal shared-build prerequisite resolved that failure. To prepare it on a
fresh checkout use the existing native helper:
`node scripts/local-checks/compiler-cli.ts --native -p packages/shared/tsconfig.build.json`.
Spikes and one-shot successes were reused; only tooling and the previously
unrun lint/format project ran afterward (18:42:48Z through 18:42:58Z), both exit 0.
No assertion, source inclusion or compiler flag was weakened.

## Additional independent CLI routes (2026-11-23)

Three further invocations are qualified without changing provider inputs:

- `hosted-pool:production-contract`: native `--noEmit -p tsconfig.hosted-pool-operations.json`.
- `hosted-pool:test-handoff:contract`: native `--noEmit -p tsconfig.one-shot-test-handoff.json`.
- `scripts/check-review-action-v2-protocol.mjs`: the context-attestation bootstrap
  uses `node scripts/local-checks/compiler-cli.ts --native` with its original
  `--ignoreConfig --target ES2022 --module NodeNext --moduleResolution NodeNext
--strict --skipLibCheck` arguments, rootDir and source entry unchanged.

Both noEmit projects passed native on Node 26.11.1. The qualifying project calls
used the configs' existing `noEmit: true`; the dedicated script fields retain
explicit `--noEmit`. The standalone bootstrap compiler passed native and approved
classic comparison runs with job-owned outDirs. Their complete file sets consist
of one byte-identical `contract-source/index.js`, SHA256 `24252348800d0ba83d4729a1ffadb1ef2248d3d1bcaa9a9dea5423e74d976c28`.
All 48 synthetic hosted-control and contiguous-handoff fixture cases passed with
no skips. Only this compiler sub-invocation was reproduced: the complete protocol
regeneration/packed-consumer flows and live hosted operations were not run.
Previously passed projects were reused after the excluded fixture failed.

The bootstrap's `.mjs` format is retained for this localized selector-only
correction; no new JavaScript responsibility is added. Its existing JavaScript
type-coverage gap remains. Node syntax checking passed; strict native checking
covers the qualification harness and real compiler projects. No generated source,
contract pin, dependency, assertion or compiler flag was changed.

The attempted fourth route, `foundation:qualify`, remains unchanged. Its existing
`scripts/provider-foundation/consumer.ts` is incompatible with pinned
`@get-modular/assembly` and `@get-modular/core` 0.7.0. Native and classic both report
the same six diagnostics: missing `bindFactory` at 79/89 (TS2339), implicit `store`
at 89 (TS7031), unsupported `factories` at 97/137 (TS2353), and unknown query root
at 145 (TS18046). This is an existing consumer/API compatibility blocker, not a
native regression. A separate owner-reviewed consumer migration is required;
no check or package pin was weakened to hide it. The packed TS6 consumer remains
unchanged as well.

## Retry, partial completion, and rollback

Inspect the failed command and its build prerequisites before retrying only the
unproven phase. Native failures remain failures; do not silently fall back.
Revert the selected script fields and bootstrap compiler selector if a regression
is confirmed, then rebuild
through the normal release process. No data rollback is involved.

## Related links

- [Shared compiler PR #967](https://github.com/777genius/review-router-ai/pull/967).
- [Compiler route documentation](../../scripts/local-checks/compiler-README.md).

## Execution log

PR #969 was opened as a draft after local qualification and independent review.
Required exact-commit CI remains pending. No release or deployment has been
performed for this patch.

On 2026-11-23 the original qualification commands, output hashes, outcomes and
initial prerequisite diagnostics were recorded durably above. No old check was
rerun or relabeled as final-commit CI for this documentation repair.
