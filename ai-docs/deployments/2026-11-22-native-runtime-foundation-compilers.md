# Native independent runtime compilers

- Task ID: `2026-11-22-native-runtime-foundation-compilers`.
- Goal: select the existing isolated TypeScript 7.0.2 helper for ten build/typecheck
  routes in five independent memory, conversation, authority, pool and GitLab packages.
- Affected targets: build/CI artifacts consumed by API and worker.
- Implementation PR: [#974](https://github.com/777genius/review-router-ai/pull/974).
- Implementation reference: `1e054e433eacac6a4949d2c7224a4c86efe02ea8`;
  isolated stack on service
  [#973](https://github.com/777genius/review-router-ai/pull/973) exact head
  `fb1782717ba4b50d8907586e115700edeb02b57c`; merge prerequisite stack first.
- Dependencies: existing native preparation and unchanged prior stack outputs.
  Parent #967/#969/#971/#972/#973 and provider #959 branches/queues are untouched.
- Last updated: `2026-11-22`.

## Environment status

| Target     | Status    | Actual version | Evidence / next step                                                       |
| ---------- | --------- | -------------- | -------------------------------------------------------------------------- |
| CI         | `pending` | Not verified   | Independent review, prerequisite stack merge and required final-commit CI. |
| staging    | `pending` | Not verified   | Include in a later authorized coherent build.                              |
| production | `pending` | Not verified   | Include in a later authorized coherent build.                              |

## Applicability and prerequisites

Selected packages: `context-memory`, `features/conversations`,
`features/sdk-growth-authority`, `features/hosted-account-pool`, and
`features/gitlab-integration`. Only ten compiler-selector fields change; source,
configs, flags, exports, coverage and lockfiles are unchanged. Their complete trees
have zero overlap with the 172-file #959 snapshot at
`fd0e0c6dfeca24934a60318bdc2b491d32d86b12`.

Classic Next/ESLint APIs, own architecture/layout/memory AST utilities,
analysis/transpilation tests and Prettier 3.8.3's embedded TS5.9 parser remain.
The owner's bounded migration exception covers TS6.0.3 compatibility baselines
and the pinned formatter. This is not a TS7-only toolchain claim.

## Deliberately deferred candidates

`features/codex-oauth-rotating` remains on its original scripts. The existing
constructor-only declaration-map oracle rejected a new inferred tuple-literal
mapping profile: generated `setup_pending` in `domain/codex-contract.d.ts.map`
points to source `codex-contract.ts:117:2` with native, versus the initializer
start `116:45` with classic. This is an unqualified mapping difference, not a
proven runtime or declaration-type regression. Initial map files, failed job and
source provenance remain intact. Qualify that profile with AST/value/range checks
and wrong/missing real-literal mapping mutants before switching this package.

`features/conflict-runtime` also retains its original scripts. Its runtime
`github-actions-oidc-token-provider.ts`, `action-control-plane-runtime-config-client.ts`
and `domain/conflict-runtime.ts` import the complete action-control-plane barrel.
That wider production provider-accounts/auth closure was explicitly not qualified
by #972. Finish the real production closure after provider integration, rather
than expanding this isolated cohort into an unbuilt whole application.

## Ordered rollout

1. Complete local qualification/review and merge #973 and its prerequisite stack.
2. Reconcile onto resulting main and pass required checks for that exact commit.
3. Include in a later authorized batch through the
   [release process](../operations/07-environments-and-release-management.md).
4. Record actual image/source and verification for each environment.

No migration, runtime configuration, flag or separate activation is needed.
This record does not authorize deployment.

## Verification and completion

CI-pinned Node 26.11.1 qualified all ten selected native routes and five emitting
projects. The 256-file comparison matrix contains 128 byte-identical JavaScript
files and 128 equivalent complete declaration surfaces. Seven declaration files
differ only under accepted canonical spelling/order; no source fixes or oracle
relaxations were needed. The selected projects emit no maps.

259 focused fixture cases passed, two existing hosted persistence cases were
skipped, and both API/worker native consumer typechecks passed. The successful
selected compiler phases were reused after removing the unqualified candidates;
no selected emitting project was recompiled. Both supported comparison compilers
checked selected native declarations with `skipLibCheck: false`. The scratch
probe needed each package's existing dependency context for AWS SDK declarations;
that initial missing-module failure and local module links are retained.

After the existing root ESM import rewrite, all 14 declared runtime target files
imported: 13 production targets plus `context-memory`'s existing compiled default
target. Exports were preserved. These are file-target imports, not qualification
of all package export selectors. Prior stack outputs were reused with 1,276 hashes.
Final formatting and native harness checks passed.

Detailed commands, matrices, skipped cases, source/output hashes, initial failures,
deferred candidates and managed job references remain in the isolated worktree's
`tmp/native-runtime-qualification/`. Whole-workspace CI, current provider composition,
full action-control production barrel and complete Next production build remain
unverified. See the
[qualification procedure](../../scripts/local-checks/native-cli-batch-qualification.md).

## Retry, partial completion, and rollback

Inspect exact flags and prerequisites before retrying; reuse hash-bound phases.
Do not weaken declaration modifiers, ignore maps, or fall back silently. The
scratch map report now distinguishes exact decoded segments from token-start
agreement with inter-token mapping differences; the old initial codex report is
not evidence of segment equality or accepted codex maps. If a regression is
confirmed, revert only these ten manifest fields and rebuild normally. No data
rollback is involved. Preserve unrelated queued checks.

## Execution log

Local selected qualification and independent review passed. PR #974 is a draft
stacked on #973. Prerequisite merge and required final-commit CI remain pending.
No merge, release or deployment performed.
