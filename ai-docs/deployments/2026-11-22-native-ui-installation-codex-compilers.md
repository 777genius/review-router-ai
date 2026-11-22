# Native UI, installation and Codex compilers

- Task ID: `2026-11-22-native-ui-installation-codex-compilers`.
- Goal: use the existing isolated TypeScript 7.0.2 helper for six build/typecheck
  routes in UI, GitHub installations and Codex rotating packages.
- Affected targets: compiled UI/library and API/worker build artifacts.
- Implementation PR: [#975](https://github.com/777genius/review-router-ai/pull/975).
- Implementation reference: `7df34c5c1b3c2edd1a11eb47cdf46645168f6cab`;
  stack on runtime
  [#974](https://github.com/777genius/review-router-ai/pull/974) exact head
  `02df99012d854c42abee5e25ef92f15905376c46`; merge prerequisite stack first.
- Dependencies: existing native preparation and unchanged prior stack outputs.
  Parent #967/#969/#971/#972/#973/#974 and provider #959 branches/queues are untouched.
- Last updated: `2026-11-22`.

## Environment status

| Target     | Status    | Actual version | Evidence / next step                                                       |
| ---------- | --------- | -------------- | -------------------------------------------------------------------------- |
| CI         | `pending` | Not verified   | Independent final review, prerequisite merge and required final-commit CI. |
| staging    | `pending` | Not verified   | Include in a later authorized coherent build.                              |
| production | `pending` | Not verified   | Include in a later authorized coherent build.                              |

## Applicability and prerequisites

Only six compiler-selection fields change in three manifests. Source, styles,
configs, flags, dependencies, exports and coverage stay unchanged. The complete
selected package trees have zero overlap with provider #959's 172-file snapshot
at `fd0e0c6dfeca24934a60318bdc2b491d32d86b12`.

The isolated DB prerequisite is only a native compile of unchanged `platform/db`.
No database, container, PrismaClient session or live query was started. This is
not database runtime qualification or verification of the pending provider schema.
The GitHub fixtures use synthetic/fake adapters.

Classic Next/ESLint APIs, own architecture/layout/memory AST tools, analysis/
transpilation tests, explicit compatibility probes and Prettier 3.8.3's embedded
TS5.9 parser remain. The owner's bounded migration exception covers TS6.0.3
comparison/parser and pinned formatter execution. This is not TS7-only conformance.

## Ordered rollout

1. Complete final review and merge #974 and its prerequisite stack.
2. Reconcile onto resulting main and pass required checks for the exact commit.
3. Include in a later authorized batch through the
   [release process](../operations/07-environments-and-release-management.md).
4. Record actual source/image and verification per environment.

No migration, runtime flag, configuration or separate activation is needed.
This record does not authorize deployment.

## Verification and completion

CI-pinned Node 26.11.1 qualified all six native routes and three emitting projects.
The 139 output comparisons comprise 62 byte-identical JavaScript files, 62
complete equivalent declaration surfaces and 15 declaration maps.

Base UI 1.4.1 exposes two pairs of names for the exact same original interfaces.
The bounded proof resolves the actual ESM import/types entry, traverses declaration
export chains and fingerprints all 272 read inputs. Only imported CloseProps and
PortalProps aliases from `@base-ui/react` are canonicalized. Six rejecting alias
mutants preserve unrelated-module/local-name/different-prop/readonly boundaries.
An initial full-checker experiment ended killed without a result or established
cause; it provides no evidence. The successful AST proof and fresh current-output
recomparison are separate records.

Ten Codex maps are byte-identical. Five retain all original segments unchanged
and add exactly 84 AST-derived anchors: 70 endpoints of 35 inferred tuple literals,
six exact method signature/body ends, and eight inferred-object property/value
positions. Generated mapped lines stay byte-identical; declaration reorderings
occur only on lines unmapped in both maps with identical line counts and complete
semantic surface comparison. Ten mutants reject the expected mapping violation,
including in-bounds wrong method ends and missing real-method/literal mappings.
The actual current Codex build reproduced all 45 prior comparison artifacts
(bytes for JS/declarations; resolved-source/segment equivalence for map paths).
No source annotation or broad normalization was introduced.

All 78 focused cases passed with no skips. API, Web and worker native consumer
checks passed. Both comparison compilers checked the native declarations with
`skipLibCheck: false`. Successful prior stack outputs were reused with 1,532 hashes;
UI/API/Web/worker phases were not repeated for the Codex manifest-only admission.

Ten declared runtime target files imported after normal ESM rewriting. Compiled
JSX rendered a disabled semantic button and escaped fixture text; the existing
CSS source export was fingerprinted. Codex runtime tuple values were checked.
These are file-target imports and bounded SSR, not every package export selector,
full browser/visual review, full Next build or live provider qualification.

Final formatting and native harness checks passed. Detailed receipts, initial
failures, resolved alias graph, source hashes, exact map anchors and rejecting
mutants remain in the isolated worktree's `tmp/native-ui-installations-qualification/`.
Full workspace CI/current provider composition/Next production build remain pending.
See the [qualification procedure](../../scripts/local-checks/native-cli-batch-qualification.md).

## Remaining scope and rollback

After this cohort and separately tracked #967/#969, 12 package manifests still
have 24 compiler routes. The action-control production closure blocks conflict-
runtime qualification; four package trees overlap the active provider work; seven
other packages await that workflow/provider dependency closure. Five specialized
compiler invocations and the classic API owners remain independently tracked.
The earlier Codex map deferral is resolved here; conflict-runtime is not migrated.

If a regression is confirmed, revert only these six manifest fields and rebuild
normally. No data rollback is involved. Do not weaken checks or reset unrelated CI.

## Execution log

Local qualification, scoped profile review and independent final review passed.
PR #975 is a draft stacked on #974. Prerequisite merge and required final-commit
CI remain pending. No merge, release or deployment.
