# Provider fixture native AST qualification

- Owner: CI provider-scope fixture checks in ReviewRouter.
- Base: `8b63574eeaee32fa081cadc83d40bfc526d17ce4` (`main`, 2026-11-23).
- Branch: `fix/provider-fixture-native-ast-20261123`.
- Status: bounded local implementation qualified; dependency integration and
  final required CI remain pending in [Draft #986](https://github.com/777genius/review-router-ai/pull/986).
- Rollout record: [provider fixture native AST](../deployments/2026-11-23-provider-fixture-native-ast.md).

## Guarantee and scope

Remove the existing provider fixture oracle's dependency on the classic
TypeScript compiler API. The real provider suite must still bind exactly one
dedicated environment URL directly to a const, use that binding in exactly one
literal Prisma client configuration, and reject fallbacks and widened authority.
The original workflow, migration catalog, privilege, ambiguous-commit recovery,
and provider URL mutation cases remain independent expected results.

Use the public typed `parseSync` and `Visitor` API from exact
`oxc-parser@0.159.0`. This is an existing native parser dependency owned by
[the current toolchain prerequisite](https://github.com/777genius/review-router-ai/pull/983),
not a new consumer-local parser framework. No classic TypeScript implementation
may be initialized for this work. TypeScript 7.0.2 and the repository's strict
options remain required.

## Intended changes

1. Replace only the AST helpers in
   `scripts/manage-review-provider-scope-concurrency.test.ts` with public Oxc
   visitors. Count unique identifier source spans so shorthand key/value nodes
   still represent one lexical identifier. Preserve the existing acceptance
   criteria and negative tables.
2. Add an independent rejecting case for a quoted duplicate `databaseUrl` key.
   The old source-text property filter misses that override; this is an explicit
   strengthening of the dedicated-URL oracle. Also require malformed source to
   fail parsing before a valid-looking binding can be accepted.
3. Enroll the complete test in `tsconfig.tooling.json`. Add precise declarations
   for its two unchanged `.mjs` imports, without unchecked `any` or weakening
   compiler options. The `.d.mts` suffix matches those existing ESM module
   boundaries; it does not introduce maintained JavaScript implementation.
4. Record actual source hashes, compiler version, guard observations, and
   test results. Keep isolated qualification distinct from full workspace CI.

The four implementation files are the existing test and tooling configuration,
`scripts/manage-review-provider-scope-concurrency.d.mts`, and
`scripts/self-hosted-e2e/disposable-release-role-fixture.d.mts`.
The JavaScript implementations remain unchanged and are not claimed to have
received a strict implementation typecheck. Their public call boundaries are
typed and their existing runtime tests remain required.

## Ownership and integration

- [#977](https://github.com/777genius/review-router-ai/pull/977) adds
  `scripts/lib/module-import-specifiers.ts` to the same tooling include list;
  retain both additions during integration.
- [#980](https://github.com/777genius/review-router-ai/pull/980) and
  [#982](https://github.com/777genius/review-router-ai/pull/982) own the separate
  architecture, layout, and memory AST migrations. Their files are outside this
  change.
- [#985](https://github.com/777genius/review-router-ai/pull/985) owns the separate
  hosted-workflow recovery and lint/format semantic-oracle migration. Do not
  duplicate that work in this branch.
- Main does not yet declare Oxc. The exact root dependency and generated frozen
  lockfile from #983 must be integrated before this change can qualify through a
  clean workspace installation and merge. Local qualification may reuse that
  already installed graph; it is not evidence of a standalone install of this
  branch.

## Verification plan

- Run the complete existing provider fixture test file through the owning
  Vitest configuration, including the new duplicate-key rejection.
- Use the native TypeScript 7.0.2 CLI to strictly check the enrolled test and
  declarations. Verify inclusion in the real tooling project without excluding
  existing subjects or relaxing its options.
- Preload the qualified native toolchain guard before test/compiler imports and
  retain audit output. Do not execute TypeScript below 7 or legacy ESLint.
- Check native formatting and `git diff --check`, and compare the unchanged test
  sections and JavaScript implementations against the base.
- Before merge, integrate dependency prerequisites, run the required workspace
  gate and applicable CI on the final source, and reconcile their actual result.

## Evidence journal

- 2026-11-23: read current repository instructions, maintained Engineering
  Quality Standard and development-tools catalog. Fetched and verified base
  main. Inspected current owner PR file lists and the public Oxc 0.159.0 API.
  This first commit records the plan before implementation.
- 2026-11-23: implemented the four scoped files and qualified their final source
  snapshot. The complete provider fixture file passed **38/38** tests: all 36
  existing cases plus quoted-duplicate and malformed-source rejection. All
  previous test sections outside the replaced AST helpers/import remain
  byte-identical; both JavaScript implementations, the real provider suite and
  the CI workflow are unchanged from base.
- Native TypeScript **7.0.2** strictly checked the complete changed test and its
  two declarations using the actual tooling project's inherited options.
  Native `--showConfig` confirmed enrollment in the real 55-source project with
  every previous include entry and compiler option preserved. This is **not** a
  whole-project typecheck result. Four independent invalid call-boundary cases
  produced exactly the expected compiler diagnostics; none were executed.
- Native formatting and whitespace checks passed. Pre-init audit records show
  Oxc **0.159.0** public Visitor modules and its GNU binding package during the
  test run, TypeScript **7.0.2** during compilation, and no legacy compiler load.
  The qualified guard and formatter are reused from #984; no package install or
  dependency manifest change was performed for this branch.
- [Durable source-bound evidence](../deployments/evidence/2026-11-23-provider-fixture-native-ast.json)
  contains exact commands, output, source hashes, guard observations, the native
  effective configuration and the independent type-negative fixture. The earlier
  intermediate 37-pass result is retained locally and is not relabeled as proof
  for the final source. Full required workspace checks and main CI still need
  the owning dependency and compiler-stack prerequisites.
