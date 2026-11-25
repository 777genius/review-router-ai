# Provider fixture native AST: CI rollout

- Task ID: `2026-11-23-provider-fixture-native-ast`.
- Goal: retain the provider fixture's dedicated-database and restricted-authority
  regression checks without initializing the classic TypeScript compiler.
- Affected targets: repository test and strict tooling gates.
- Implementation PR: [Draft #986](https://github.com/777genius/review-router-ai/pull/986);
  branch `fix/provider-fixture-native-ast-20261123`.
- Implementation reference: the exact source hashes in the
  [qualification record](evidence/2026-11-23-provider-fixture-native-ast.json),
  based on `8b63574eeaee32fa081cadc83d40bfc526d17ce4` and published plan
  `1eec9552a4beb01bc4ba64abd7d33087aebc42eb`; final shipping commit is pending.
- Dependencies: [#983](https://github.com/777genius/review-router-ai/pull/983)
  exact Oxc 0.159.0 root dependency and frozen lockfile; effective native
  TypeScript 7.0.2 tooling route.
- Last updated: `2026-11-23`.

## Environment status

| Target                             | Status        | Actual installed source                   | Last verified (UTC) | Evidence / next step                                                                                                          |
| ---------------------------------- | ------------- | ----------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Local implementation qualification | `in_progress` | Source hashes in the qualification record | 2026-11-23          | Complete provider test 38/38, bounded strict TS7, type negatives and formatting passed; full workspace check remains pending. |
| Main CI                            | `pending`     | Not verified                              | Not verified        | Integrate prerequisites, review, run required checks and merge.                                                               |

This changes test infrastructure only. It requires no application service
deployment, database migration, fleet activation, credentials, or public Action
release. Staging and production application state is outside this task.

## Applicability and prerequisites

Follow the [implementation plan](../plans/2026-11-23-provider-fixture-native-ast.md)
and the [release and Git flow](../operations/07-environments-and-release-management.md).
The final shipping source must contain the exact native parser dependency and
the complete strict test enrollment. Preserve the parallel tooling include
addition from #977 and all completed compiler prerequisite work.

## Ordered rollout

1. Implement and qualify the test-only change under the pre-init legacy compiler
   guard. Retain existing assertions and add the quoted duplicate-key rejection.
2. Integrate the generated dependency prerequisite through its owning PR. Run
   the effective strict tooling project and applicable CI on the exact source.
3. Review and merge through the normal protected PR flow, then record the
   resulting main SHA and actual successful checks. Local evidence alone does
   not complete the main CI target.

## Verification and completion

Require the full provider fixture suite, the new rejecting case, strict
TypeScript 7.0.2 source coverage and no old compiler initialization. Preserve
independent expected values and the real JavaScript operator runtime test.
Record source hashes and exact commands/results, distinguishing bounded local
proof from full workspace verification.

The bounded local result is **38/38 PASS** (36 preserved cases and two new
rejecting cases), with strict TypeScript **7.0.2 PASS** and four independently
expected type-error diagnostics. The real tooling configuration includes the
complete changed test, but its full 55-source check has not been claimed.
Existing `.mjs` implementations are unchanged and are not described as strictly
typechecked. Their precise declaration boundaries do not replace runtime tests.

See the [durable evidence](evidence/2026-11-23-provider-fixture-native-ast.json)
for exact commands, source hashes, output, audit and effective configuration.
The normal test run loads public Oxc 0.159.0 Visitor modules under the guard.

## Retry, partial completion, and rollback

Inspect current branch, prerequisite and CI state before retrying. These local
test runs use disposable directories and require no persistent environment
mutation. If source needs correction, use an ordinary follow-up commit and
recheck the affected guarantee. A reviewed code revert is the rollback path;
do not restore an old compiler execution path as a qualification bypass.

## Related links

- [Implementation plan](../plans/2026-11-23-provider-fixture-native-ast.md).
- [Quality gates](../operations/03-quality-gates.md).
- [Release and Git flow](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC) | Target              | Source                         | Step and observed result                                                                                                          | Next action                                                                |
| ---------- | ------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2026-11-23 | Local planning      | `8b63574`                      | Current instructions and owner overlaps inspected; no implementation checks claimed.                                              | Implement and qualify the provider fixture oracle.                         |
| 2026-11-23 | Local qualification | Evidence-bound source snapshot | 38/38 tests, bounded strict TS7 and formatting passed; four expected type-boundary errors confirmed. No old compiler initialized. | Integrate dependency prerequisite and complete required final-head checks. |
