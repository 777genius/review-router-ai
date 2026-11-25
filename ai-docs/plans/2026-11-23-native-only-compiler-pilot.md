# Native-only compiler CLI and qualification pilot

- Owner: ReviewRouter compiler entrypoint and its opt-in qualification suite.
- Base: `8b63574eeaee32fa081cadc83d40bfc526d17ce4` (`main`, 2026-11-23).
- Branch: `fix/native-only-compiler-pilot-20261123`.
- Integration: existing draft [#977](https://github.com/777genius/review-router-ai/pull/977),
  preserving implementation source `da752f9752c9764a7d34c317193e48281d86411f`
  and its original author; no separate implementation publication is required.
- Status: focused native qualification passed; independent review and integrated full-pilot pass are pending.
- Rollout record: [native compiler entrypoint](../deployments/2026-11-23-native-only-compiler-pilot.md).

## Problem and guarantee

Normal migrated routes select the isolated TypeScript 7.0.2 compiler explicitly,
but omitting the selector still starts TypeScript 6.0.3. The documented manual
pilot also explicitly starts that old compiler, imports its classic AST API and
runs live classic/native comparisons. Those current execution paths conflict
with the maintained compiler requirement. Previous comparison receipts remain
historical evidence; they do not authorize new old-compiler execution.

The existing helper must provide a supported native-only manual entrypoint with
the same cwd, project arguments, flags and dependency ownership. The pilot must
retain the actual source inventory, independent diagnostics, real package emit,
runtime/type-consumer cases and historical comparison provenance. A second
native invocation is not a substitute for a classic baseline.

## Current owner and source audit

Read the complete `compiler-cli.pilot.ts`, `compiler-cli.ts`,
`compiler-vitest.config.ts`, `compiler-README.md`, native manifest, actual root
scripts and the retained logger/contract qualification records before this plan.
The pilot was introduced in immutable source
`9c52c250b279f81470703b35fae0e787880a08ea`; that source remains the authority for
the prior live comparison behavior.

- No active PR was found owning the CLI, pilot or dedicated Vitest config in
  the 2026-11-23 owner check.
- [#967](https://github.com/777genius/review-router-ai/pull/967) adds the Shared
  package section to `compiler-README.md`; preserve it during integration.
- [#972](https://github.com/777genius/review-router-ai/pull/972) through #975 own
  their separate package routes and `native-cli-batch-qualification.md`. Those
  files and governed package inventories stay outside this change.
- [#985](https://github.com/777genius/review-router-ai/pull/985) owns the separate
  hosted recovery and lint/format oracle migration. Do not edit its files.
- Exact parser dependency/lock integration belongs to
  [#983](https://github.com/777genius/review-router-ai/pull/983); the native
  formatter and pre-init load guard belong to
  [#984](https://github.com/777genius/review-router-ai/pull/984).

## Intended implementation

1. Keep the existing isolated exact TypeScript 7.0.2 installation and resolver.
   Default and `--native` CLI use it; `--legacy` fails before compiler resolution
   or initialization. Preserve ordinary compiler arguments, cwd and explicit
   failure behavior. Validate parsed manifest data without unchecked assertions.
2. Change the supported `compiler:pilot` preflight to native. Keep the dedicated
   opt-in test discovery and effective strict tooling project; do not move the
   expensive pilot into ordinary unit discovery or exclude it from typechecking.
3. Replace classic config parsing with the native CLI's public `--showConfig`
   output and validate that external JSON. Preserve all governed root inputs;
   copy the actual required source closure for the disposable invalid-heading
   check, including imported repository files when necessary.
4. Retain the original optional/indexed/null/alias diagnostics and their positive
   consumer; actual workflow-package and restricted review-evidence contract
   emission; emitted runtime values; and positive/negative declaration consumers.
   Link installed workspace dependencies explicitly in disposable emitted
   subjects, instead of relying on an incidental temporary-directory ancestor.
5. Replace the classic parser/transpiler probes through already qualified public
   native tools. Preserve the three real governed consumer filenames and the
   pure Node heading positive/negative behavior. Keep the source/API migration
   of those consumers with their existing owners.
6. Replace the prohibited live compiler comparison with an explicit native-only
   public-contract qualification. Retain both package configs and assert the
   complete ten-file output inventory, all 66 named exports, their leading
   documentation and absence of the ten type-only exports from JavaScript.
   Check bidirectional source/declaration compatibility for every value export
   and all ten type-only exports. Fixed independent consumers additionally
   check union members, literals, readonly objects/tuples, optional returns and
   NUL domain strings; nine independent invalid consumers must be rejected.
   This is declaration-consumer qualification, not TS7-as-TS6 parity.
7. Preserve historical receipts unchanged and explicitly retire the old live
   comparison under the maintained native compiler requirement. The bounded
   archive audit found no raw original two-subject pilot output. Do not replace
   unavailable historic bytes, invent successful archive validation, or turn
   the historical evidence gap into an endless search. Native output records
   identify their actual compiler and cannot establish historical byte parity.

## Historical evidence boundary

The checked-in [logger/tooling receipt](../deployments/2026-11-22-native-logger-tooling-compiler-routes.md)
and [contract-foundation receipt](../deployments/2026-11-22-native-contract-foundation-compilers.md)
bind their prior observations to source
`06aae0faf17687e52b9d0be63717c8ccc16d1458` and their recorded implementations.
Their original classic compiler version, commands, output claims and limitations
must stay intact. They are not current-source results.

The original pilot optionally recorded complete outputs through
`REVIEW_ROUTER_COMPILER_PROOF_LOG`. Its two-subject raw comparison JSON was not
found in the inspected shared checkout scratch, committed records or relevant
PR evidence. The audit is complete for this bounded implementation. The parent
approved a native-only test redesign retaining semantic responsibilities and
independent expected results. New native output records retain full bytes for
their own source/command evidence, without a classic baseline attribution.

Source/declaration type compatibility deliberately uses bidirectional
assignability: separately declared enums have distinct compiler-internal
identities. Fixed independent equality/literal/readonly fixtures protect the
public semantic properties that structural assignability alone would miss.
Oxc's public export/comment metadata only handles names and documentation; it is
not represented as a general declaration-type normalizer.

## Verification and completion

- Pre-init guard on every compiler/test process; no TypeScript below 7 executes.
- Actual default and `--native` compiler version 7.0.2 under unrelated cwd and
  colliding PATH; `--legacy` and invalid manifest cases reject before execution.
- Existing strict options and real tooling inventory retained. A bounded helper
  typecheck is separate from a successful integrated whole-tooling gate.
- All original diagnostic, package, emitted-runtime and declaration-consumer
  expected cases remain independent assertions. Preserve the current source
  filenames, configs and output requirements.
- Public-surface helper rejection cases protect dropped/renamed exports,
  lost/misattached documentation, malformed syntax and unsupported export forms.
  Fixed file/export inventories and independent typed/runtime consumers protect
  meaningful contract changes; historical byte parity is explicitly unclaimed.
- Strictly check all new/migrated TypeScript through the existing required
  tooling project, qualify the supported manual command, format and review the
  final source, and complete applicable CI after prerequisite integration.

No package installation, old compiler execution, unrelated dependency migration,
production service change or external publication is part of this local phase.
The root agent owns Git Data publication, the Draft, integration and final CI.

## Evidence journal

- 2026-11-23: current main fetched; owner audit and complete original pilot/docs
  reviewed. The provider branch remains preserved at
  `c134358423a5e00aa15ae674f3612abed12e3c70`. Its clean worktree is reused to avoid
  another full checkout; this compiler branch starts from main, not that patch.
  No compiler-pilot implementation checks have run for this plan.
- 2026-11-23 18:07: final six-file native strict check passes. Focused suite:
  18 passed, one explicitly unselected integration test. Actual normal tooling
  `--showConfig` retains 57 roots and all six owned files; no full tooling pass
  is claimed. Both actual emission subjects and their independent typed/runtime
  consumers pass under the inherited pre-init guard. See the source-bound
  [receipt](../deployments/evidence/2026-11-23-native-only-compiler-pilot.json)
  for final hashes, commands, first failures and remaining mandatory gates.
- 2026-11-23: original implementation integrated into #977 with its author
  retained. Review corrected the pilot's abnormal-termination handling: signals
  and missing exit status now fail before negative diagnostic assertions.
  Original receipt hashes remain bound to `da752f9`; complete integrated strict
  tooling and pilot qualification remain pending.
