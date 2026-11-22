# Native contract and review-state foundation compilers

- Task ID: `2026-11-22-native-contract-foundation-compilers`.
- Goal: compile/typecheck the seven protocol, capability, lock and review-state
  foundation packages through the existing isolated TypeScript 7.0.2 helper.
- Affected targets: build/CI and artifacts consumed by API/worker/protocol callers.
- Implementation PR: [#971](https://github.com/777genius/review-router-ai/pull/971).
- Implementation reference: `c4d4c3c3ecba533b2be9528d04bb1c68dd3a3b09`, based on
  main `06aae0faf17687e52b9d0be63717c8ccc16d1458`; not merged or deployed.
- Dependencies: existing native preparation, shared build and protocol contract
  bootstrap. Shared [#967](https://github.com/777genius/review-router-ai/pull/967)
  and logger/root [#969](https://github.com/777genius/review-router-ai/pull/969) are
  independently tracked; this patch does not modify their branches or queues.
- Last updated: `2026-11-22`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                      |
| -------------------- | --------- | ------------------------------- | ------------------- | --------------------------------------------------------- |
| CI                   | `pending` | Required checks not verified    | Not verified        | Complete independent review and required exact-commit CI. |
| staging              | `pending` | Not verified                    | Not verified        | Include in a later authorized coherent build.             |
| production           | `pending` | Not verified                    | Not verified        | Include in a later authorized coherent build.             |

## Applicability and prerequisites

The 15 changed fields are native compiler selections only. Keep tsconfigs,
source coverage, preconditions, exports and generated contract inputs unchanged.
Next, ESLint, own architecture/layout/memory AST utilities and source-analysis/
transpilation tests retain classic APIs. Other compiler routes remain separately
inventoried. This is not a full TypeScript 7-only toolchain or API-port claim.
TS6.0.3 was used solely for the approved bounded compatibility baseline.

## Ordered rollout

1. Complete local qualification, review and required exact-commit CI.
2. Include in a later authorized coherent batch through the
   [release process](../operations/07-environments-and-release-management.md).
3. Record actual source/image and normal verification for each environment.

No migration, runtime flag, configuration or separate activation is needed.
This task does not authorize deployment.

## Verification and completion

Managed qualification used CI-pinned Node 26.11.1. All 15 native routes and eight
native/classic emitting-project comparisons passed. The 216-file matrix contains
101 byte-identical JavaScript files, 101 equivalent declaration surfaces, eight
decoded-segment-equivalent maps and six maps qualified against a finite
constructor/parameter-property mapping profile. Twenty token-start positions
differ at synthesized anchors; real-function mapping mutants reject. Literal
quote spellings differ in some declarations, while decoded values remain exact;
five semantic mutants protect JSON/NUL/numeric/readonly/tuple behavior.

All 207 focused cases are qualified: 204 passed initially and three compiled-
contract cases passed targeted retry after the existing ABI bootstrap artifacts
were prepared. The unmodified bootstrap inputs were compiled natively with their
existing flags. Initial failures and successful compilation phases were retained;
already proven emits were reused. Both API/worker native consumer typechecks
passed. Both compilers checked native declarations with `skipLibCheck: false`.
Sixteen declared production export targets imported under production conditions,
with emitted workflow/capability/lock runtime checks.

Detailed commands, matrices, initial failures, guards and runtime records remain
under this isolated worktree's `tmp/native-foundations-qualification/` and managed
job custody. Full workspace CI and the complete Next production build remain
unverified. See the [bounded qualification procedure](../../scripts/local-checks/native-cli-batch-qualification.md).

## Retry, partial completion, and rollback

Inspect source, exact flags, dependency/output prerequisites and the failed phase
before retrying. Do not weaken flags, alter generated inputs or silently fall back
to classic. Revert only the selected manifest compiler fields if a regression is
confirmed, then rebuild through the normal release process. No data rollback is
involved. Preserve queued checks for unrelated PRs.

## Execution log

PR #971 was opened as a draft after local qualification and independent review.
Required exact-commit CI remains pending. No release or deployment has been
performed for this patch.
