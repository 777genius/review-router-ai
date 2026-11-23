# Native-only compiler CLI and qualification pilot

- Owner: ReviewRouter compiler entrypoint and its opt-in qualification suite.
- Base: `8b63574eeaee32fa081cadc83d40bfc526d17ce4` (`main`, 2026-11-23).
- Branch: `fix/native-only-compiler-pilot-20261123`.
- Status: planned; no implementation or current full-pilot pass is claimed.
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
6. Retain full output-file and declaration comparison requirements. Qualify any
   native declaration normalizer with independent union-order acceptance and
   lost-member/literal/readonly/tuple/comment rejection. Do not silently discard
   public declaration information merely to compare ASTs.
7. Bind any reused historical comparison to its exact input/configuration and
   retained output bytes or hashes. Preserve historical receipts unchanged.
   Validate available archived baseline custody before using it; missing raw
   comparison data is an explicit evidence gap, never a generated TS7-as-TS6
   replacement or an automatic parity success.

## Historical evidence boundary

The checked-in [logger/tooling receipt](../deployments/2026-11-22-native-logger-tooling-compiler-routes.md)
and [contract-foundation receipt](../deployments/2026-11-22-native-contract-foundation-compilers.md)
bind their prior observations to source
`06aae0faf17687e52b9d0be63717c8ccc16d1458` and their recorded implementations.
Their original classic compiler version, commands, output claims and limitations
must stay intact. They are not current-source results.

The original pilot optionally records complete outputs through
`REVIEW_ROUTER_COMPILER_PROOF_LOG`. Its two-subject raw comparison JSON has not
yet been found in the inspected shared checkout scratch or committed records.
Continue the bounded archive/source audit. New native outputs may establish
native execution, but cannot establish missing historic bytes. Any successor
comparison must state exactly which preserved source-bound receipt it uses and
reject changed inputs or missing evidence before claiming parity.

## Verification and completion

- Pre-init guard on every compiler/test process; no TypeScript below 7 executes.
- Actual default and `--native` compiler version 7.0.2 under unrelated cwd and
  colliding PATH; `--legacy` and invalid manifest cases reject before execution.
- Existing strict options and real tooling inventory retained. A bounded helper
  typecheck is separate from a successful integrated whole-tooling gate.
- All original diagnostic, package, emitted-runtime and declaration-consumer
  expected cases remain independent assertions. Preserve the current source
  filenames, configs and output requirements.
- Normalizer and receipt rejection cases protect meaningful declaration changes,
  missing outputs, mismatched source and invalid archive data.
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
