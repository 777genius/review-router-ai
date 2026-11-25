# Native-only compiler entrypoint: tooling rollout

- Task ID: `2026-11-23-native-only-compiler-pilot`.
- Goal: make the existing compiler CLI and supported manual qualification path
  use native TypeScript 7.0.2 while retaining real inputs and independent checks.
- Affected targets: compiler helper, opt-in pilot and strict tooling gates.
- Integration PR: [#977](https://github.com/777genius/review-router-ai/pull/977).
- Original implementation: [#987](https://github.com/777genius/review-router-ai/pull/987),
  source `da752f9752c9764a7d34c317193e48281d86411f` from branch
  `fix/native-only-compiler-pilot-20261123`, retained with its original author.
- Implementation reference: source hashes in the
  [qualification receipt](./evidence/2026-11-23-native-only-compiler-pilot.json),
  based on `8b63574eeaee32fa081cadc83d40bfc526d17ce4` and published plan
  `9b3bd4e228397b4d07ef56a922dd07e57b3caed3`. Full integration remains pending.
- Dependencies: existing exact native compiler preparation; owning parser,
  formatter and source-consumer prerequisites for the integrated tooling gate.
- Last updated: `2026-11-23`.

## Environment status

| Target                      | Status     | Actual source / version         | Last verified (UTC) | Evidence / next step                                                                                                             |
| --------------------------- | ---------- | ------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Local focused qualification | `verified` | Source-bound JSON; native 7.0.2 | 2026-11-23 18:07    | Six owned files pass strict checking; 18 focused tests pass; one real-project integration test is explicitly unselected locally. |
| Integrated compiler pilot   | `pending`  | Not verified                    | Not verified        | Reconcile owning prerequisites and full workspace builds, then run the complete real-tooling preflight and dedicated suite.      |
| Main CI                     | `pending`  | Not verified                    | Not verified        | Integrate prerequisites, complete required checks and review.                                                                    |

This tooling change requires no database migration, credential/configuration
cutover, application fleet activation or public Action release. It does not
establish that other embedded compiler consumers have migrated.

## Applicability and prerequisites

Follow the [bounded implementation plan](../plans/2026-11-23-native-only-compiler-pilot.md)
and the [release and Git flow](../operations/07-environments-and-release-management.md).
Keep the native installation exact and isolated. Existing historical comparison
receipts retain their original source/compiler attribution; current work must
not execute their old compiler commands.

## Ordered rollout

1. Qualify the CLI's actual native/default resolution and rejecting controls.
2. Migrate and strictly check the pilot without weakening source coverage,
   diagnostics, emission, runtime/type consumers or historical evidence custody.
3. Integrate the owning dependency and parser-consumer prerequisites. Run the
   complete effective tooling check and supported manual qualification command.
4. Review, run applicable final-head CI, merge through the protected PR flow and
   record the resulting main source and actual successful checks.

## Verification and completion

Require native 7.0.2 execution, pre-init rejection of legacy selection, preserved
strict flags and real source inventory, independent positive/negative cases,
retained historical-receipt attribution and a full integrated result. The old
live comparison is retired under the native compiler requirement; no current
classic/native byte parity is claimed. Missing historical output data is not
replaced by a second native execution. Bounded checks, source inspection and old
successful receipts are separate from final-head CI.

## Focused qualification evidence

The [durable JSON receipt](./evidence/2026-11-23-native-only-compiler-pilot.json)
binds the original `da752f9` implementation and unchanged governed inputs by SHA256. It
records actual commands, tool versions, native output hashes before and after
the ESM rewrite, process/guard log hashes and the required remaining gates.

- Native 7.0.2 strictly checks all six owned TypeScript files with the existing
  repository options. Actual normal `--showConfig` reports 57 roots and includes
  every owned file. No tooling include, strict option or governed package config
  changed; this bounded check is not a whole-tooling pass.
- The final focused run passes **18 tests**, with the one real-tooling-project
  integration test explicitly unselected. That test remains enabled and
  mandatory in the committed dedicated config. It checks the real source
  closure, package manifests and installed dependencies before rejecting the
  invalid copied heading assignment.
- Both original package configs emit exactly ten expected files. The checks
  retain 66 public names and ten type-only exports, compare leading public
  documentation, exercise all value/type-only declaration consumers, assert
  fixed semantic/runtime expectations and reject nine invalid typed consumers.
- The inherited pre-init guard observes only TypeScript 7.0.2 and the actual
  Oxc 0.159 parser. No old compiler implementation initializes. Existing Next
  workspace dependencies and built Shared production artifacts are reused via
  local links; this task performs no installation or dependency/lock edit.

The first whole-tooling attempt in the reused bare worktree failed with 1,350
diagnostics: missing workspace links/build prerequisites, the separately owned
classic API migrations and two own readdir overload errors. The latter are
fixed and final focused strict checking passes. The initial log is retained;
the known incomplete integration check was not repeatedly rerun or represented
as a successful whole-project result.

Two actual fixture failures were resolved: Node rejects a null package manifest
before custom JSON validation, and emitted workspace consumers need the real
`production` export condition. A further type experiment showed that separately
declared enum identities cannot use internal-type equality. Full public
source/declaration compatibility now uses bidirectional assignability; fixed
independent equality/literal/readonly fixtures remain required. These findings
and the final-source results are distinguished in the receipt.

## Integration in #977

The compiler implementation is consolidated into the existing #977 draft after
its parser, formatter and workspace prerequisites. Default and explicit native
CLI routes and the root `compiler:pilot` preflight use TypeScript 7.0.2. The
strict tooling project still includes every compiler helper and test; the full
real-project test remains enabled in the dedicated suite.

Independent review found that the pilot could count a compiler killed after
printing an expected diagnostic as a rejecting consumer: a null exit status is
different from zero. The pilot now rejects signals and a missing exit status
before interpreting compiler diagnostics or recording compilation success.
The original focused receipt is unchanged and does not attest to this correction
or to the integrated source. Run the complete strict tooling gate and dedicated
pilot on the integrated source before recording those gates as verified.

## Retry, partial completion, and rollback

Inspect exact source, dependency preparation, output prerequisites and failed
phase before retrying. Preserve successful bounded receipts and first failures.
No persistent product state changes in this task. Correct a regression with an
ordinary reviewed source change; do not restore a prohibited old-compiler path
as a way to obtain passing checks.

## Related links

- [Implementation plan](../plans/2026-11-23-native-only-compiler-pilot.md).
- [Compiler documentation](../../scripts/local-checks/compiler-README.md).
- [Source-bound qualification](./evidence/2026-11-23-native-only-compiler-pilot.json).
- [Quality gates](../operations/03-quality-gates.md).
- [Release and Git flow](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)       | Target        | Source            | Observed result                                                                                                                                   | Next action                                                                                                    |
| ---------------- | ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 2026-11-23       | Planning      | `8b63574`         | Complete original pilot/docs and active ownership reviewed; no current implementation pass claimed.                                               | Implement the native-only CLI and qualify retained pilot boundaries.                                           |
| 2026-11-23 18:07 | Local focused | JSON-bound source | Native strict PASS; 18 focused tests PASS; 57 normal tooling roots retain all six owned files. Historical source-bound receipts remain unchanged. | Independently review and integrate owning prerequisites, then run the mandatory whole-tooling/full-pilot gate. |
