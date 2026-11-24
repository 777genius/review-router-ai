# Native service foundation compilers

- Task ID: `2026-11-22-native-service-foundation-compilers`.
- Goal: use the existing isolated TypeScript 7.0.2 compiler for ten service feature
  packages and their 20 normal build/typecheck routes.
- Affected targets: build/CI artifacts consumed by API and worker.
- Implementation PR: [#973](https://github.com/777genius/review-router-ai/pull/973).
- Implementation reference: `b156c899dfa0820771d3f447588d0348cc08ea52`;
  isolated stack on authority
  [#972](https://github.com/777genius/review-router-ai/pull/972) exact head
  `d80b9797435dea1f83e8db1e9980b76e1fec75d3`; merge prerequisite stack first.
- Dependencies: existing native preparation and unchanged shared/foundation/
  authority outputs. Shared #967, logger/root #969, foundation #971 and authority
  #972 remain separately tracked; their branches and provider #959 are untouched.
- Last updated: `2026-11-22`.

## Environment status

| Target     | Status    | Actual version | Evidence / next step                                                       |
| ---------- | --------- | -------------- | -------------------------------------------------------------------------- |
| CI         | `pending` | Not verified   | Independent review, prerequisite stack merge and required final-commit CI. |
| staging    | `pending` | Not verified   | Include in a later authorized coherent build.                              |
| production | `pending` | Not verified   | Include in a later authorized coherent build.                              |

## Applicability and prerequisites

Only the 20 compiler selector fields change. Source, tsconfigs, flags, exports,
coverage and lockfiles are unchanged. The complete ten selected package trees
have no path overlap with the 172-file provider #959 snapshot at
`fd0e0c6dfeca24934a60318bdc2b491d32d86b12`. Platform DB/config, release-rollout
and the active provider owners are excluded from this migration cohort.

The platform DB native build is an unchanged scratch runtime prerequisite, not
an additional migrated script. Existing root ESM import rewriting remains the
normal final build step. Classic Next/ESLint APIs, own architecture/layout/memory
AST utilities, analysis/transpilation tests and Prettier 3.8.3's embedded TS5.9
parser remain. The owner's bounded migration exception covers TS6.0.3 baseline
and pinned formatter execution. This is not full TS7-only conformance.

## Ordered rollout

1. Finish local qualification/review and merge #972 and its prerequisite stack.
2. Reconcile onto resulting main; pass required checks for that exact commit.
3. Include in a later authorized batch through the
   [release process](../operations/07-environments-and-release-management.md).
4. Record actual image/source and verification per environment.

No migration, runtime configuration, flag or separate activation is needed.
This record does not authorize deployment.

## Verification and completion

CI-pinned Node 26.11.1 qualified all 20 routes and ten emitting projects on the
first run. Two hundred comparisons passed: 100 byte-identical JavaScript files
and 100 equivalent complete declaration surfaces (five declaration files differ
only in accepted canonical spelling/order). No maps are emitted by these configs.
No inference compatibility fix or comparison relaxation was needed.

All 180 focused fixtures passed with no skipped cases; both API/worker native
consumer typechecks passed. Both supported comparison compilers checked native
emitted declarations with `skipLibCheck: false`. Unchanged stack outputs were
copied with 1,076 file hashes at the exact base instead of recompiled.

After the unchanged platform DB prerequisite and existing root ESM import rewrite,
all 16 declared production target files across these ten packages imported under
`--conditions=production`. These are target-file imports, not qualification of
all package export selectors. Final formatting and native harness checks passed.
Detailed commands, matrices, copied-output hashes, runtime results and managed
job references remain in the isolated worktree's `tmp/native-service-qualification/`.
Whole-workspace CI, the current provider composition and complete Next production
build remain unverified. The full action-control production barrel remains
outside this cohort's runtime claim. See the
[qualification procedure](../../scripts/local-checks/native-cli-batch-qualification.md).

## Retry, partial completion, and rollback

Inspect diagnostics, exact flags and missing prerequisites before retrying; reuse
hash-bound successful phases. Do not weaken flags, normalize away declaration
modifiers, ignore maps, or silently fall back to classic. If a regression is
confirmed, revert only this cohort's manifest compiler fields and rebuild normally.
No data rollback is involved. Preserve unrelated queued checks.

## Execution log

Local compiler/fixture qualification and independent review passed. PR #973
is a draft stacked on #972. Prerequisite merge and required final-commit CI
remain pending. No merge, release or deployment performed.
