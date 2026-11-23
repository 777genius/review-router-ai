# Native-only compiler entrypoint: tooling rollout

- Task ID: `2026-11-23-native-only-compiler-pilot`.
- Goal: make the existing compiler CLI and supported manual qualification path
  use native TypeScript 7.0.2 while retaining real inputs and independent checks.
- Affected targets: compiler helper, opt-in pilot and strict tooling gates.
- Implementation PR: pending; branch `fix/native-only-compiler-pilot-20261123`.
- Implementation reference: planned from
  `8b63574eeaee32fa081cadc83d40bfc526d17ce4`; no implementation pass claimed.
- Dependencies: existing exact native compiler preparation; owning parser,
  formatter and source-consumer prerequisites for the integrated tooling gate.
- Last updated: `2026-11-23`.

## Environment status

| Target                       | Status    | Actual source / version | Last verified (UTC) | Evidence / next step                                          |
| ---------------------------- | --------- | ----------------------- | ------------------- | ------------------------------------------------------------- |
| Local compiler qualification | `pending` | Not implemented         | Not verified        | Implement and qualify the native-only entrypoint and pilot.   |
| Main CI                      | `pending` | Not verified            | Not verified        | Integrate prerequisites, complete required checks and review. |

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
valid historical-receipt custody and a full integrated result. Missing historical
output data cannot be replaced by a second native execution. Bounded checks,
source inspection and old successful receipts are separate from final-head CI.

## Retry, partial completion, and rollback

Inspect exact source, dependency preparation, output prerequisites and failed
phase before retrying. Preserve successful bounded receipts and first failures.
No persistent product state changes in this task. Correct a regression with an
ordinary reviewed source change; do not restore a prohibited old-compiler path
as a way to obtain passing checks.

## Related links

- [Implementation plan](../plans/2026-11-23-native-only-compiler-pilot.md).
- [Compiler documentation](../../scripts/local-checks/compiler-README.md).
- [Quality gates](../operations/03-quality-gates.md).
- [Release and Git flow](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC) | Target   | Source    | Observed result                                                                                     | Next action                                                          |
| ---------- | -------- | --------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-11-23 | Planning | `8b63574` | Complete original pilot/docs and active ownership reviewed; no current implementation pass claimed. | Implement the native-only CLI and qualify retained pilot boundaries. |
