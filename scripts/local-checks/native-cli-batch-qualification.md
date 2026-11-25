# Native compiler CLI batch qualification

Compiler CLI coverage is separate from classic parser/API migration. The root
ordinary TypeScript package, Next, ESLint, architecture/layout/memory AST tools,
source-analysis/transpilation tests, and the pinned Prettier embedded parser
still have classic consumers. Do not replace their imports with native enums or present CLI qualification as TS7-only
conformance. The isolated native compiler remains exactly TypeScript 7.0.2.

## Dependency-coherent foundation cohort

The following normal package scripts explicitly select the existing native
helper; config flags, source coverage and exports stay with their current owners.

| Package                                 | Qualified script fields                       |
| --------------------------------------- | --------------------------------------------- |
| `platform/signed-capabilities`          | `build`, `typecheck`                          |
| `platform/locks`                        | `build`, `typecheck`                          |
| `protocol-review-action-v2`             | `build`, `typecheck`                          |
| `protocol-review-workflow`              | `build`, `typecheck`                          |
| `features/review-execution-checkpoints` | `build`, `typecheck`                          |
| `features/review-processes`             | `build`, `typecheck`                          |
| `features/review-executions`            | `build`, `build:contract-source`, `typecheck` |

These seven manifests own 15 routes and eight emitting projects. Shared output
is an existing prerequisite. The protocol fixtures also need the existing
compiled contract-source bootstrap from `protocol:check`; preparing those
unchanged inputs does not migrate their other package scripts.

## Authority contract cohort (stacked on #971)

Eight further packages select native build/typecheck and, where present,
contract-source compilation: `review-context-attestation`, `review-evidence`,
`review-investigation-operations`, `review-investigations`, `review-snapshots`,
`review-publishing`, `review-run-control`, and `action-control-plane` under
`packages/features/`. This is 23 routes and 15 emitting projects, based on
foundation PR #971 at `84bad00de58eee29d59e485c1863f18e3867ec09`.

Native inference initially dropped readonly from two optional-never branches of
concrete in-memory run-control methods. Explicit return annotations preserve the
original TS6 class declarations without changing runtime bodies. Comparison uses
the original pre-annotation baseline; readonly normalization was not relaxed.
All 427 JavaScript comparisons are byte-identical and all 427 complete declaration
surfaces equivalent. These projects emit no source maps. Focused fixtures passed
320 cases with one existing skipped case; both API/worker native typechecks passed.

## Service foundation cohort (stacked on #972)

Ten independent service packages select native `build` and `typecheck`:
`audit-log`, `auth`, `outbox`, `entitlements`, `rate-limits`, `api-demo`,
`system-health`, `review-context-tools`, `review-skills`, and `review-progress`
under `packages/features/`. These 20 routes and ten emitting projects are based
on authority PR #972 at `d80b9797435dea1f83e8db1e9980b76e1fec75d3`.
No source, config, dependency or export changes were needed. All 100 JavaScript
comparisons are byte-identical and all 100 declaration surfaces equivalent;
these configs emit no maps. All 180 focused fixtures and both API/worker native
typechecks passed. The complete selected package trees have no overlap with the
172-file provider #959 snapshot at `fd0e0c6dfeca24934a60318bdc2b491d32d86b12`.

## Independent runtime cohort (stacked on #973)

`packages/context-memory` and feature packages `conversations`,
`sdk-growth-authority`, `hosted-account-pool`, and `gitlab-integration` select
native build/typecheck for ten routes and five emitting projects. The exact base
is service PR #973 at `fb1782717ba4b50d8907586e115700edeb02b57c`.
All 128 JavaScript comparisons are byte-identical and all 128 complete declaration
surfaces equivalent; these selected configs emit no maps. Focused fixtures passed
259 cases with two existing persistence cases skipped; both native host checks
passed. Source, configs, exports and dependency pins are unchanged.

At that checkpoint two candidates were deliberately deferred. `codex-oauth-rotating` declaration
maps now map inferred tuple literals to their individual original literals, where
TS6 used the initializer start; the constructor-only map profile rejects that
unqualified class of differences. `conflict-runtime` requires the complete
`action-control-plane` production barrel, whose wider provider/auth closure
remains outside the bounded runtime evidence. Their manifests retain original
scripts. Qualify the tuple mapping with rejecting fixtures, and finish the actual
production closure after provider integration, before migrating those routes.

## UI, installation and Codex cohort (stacked on #974)

`ui`, `features/github-installations`, and `features/codex-oauth-rotating` select
native build/typecheck for six routes, based on #974 exact head
`02df99012d854c42abee5e25ef92f15905376c46`. Source/config/dependency/export
contracts are unchanged. All 62 JavaScript comparisons are byte-identical and
62 complete declaration surfaces equivalent. UI qualification resolves Base UI
1.4.1's actual ESM import/types entry and follows its declaration reexports:
`AlertDialogCloseProps`/`DialogCloseProps` and the Portal pair each denote the same
canonical interface. Only these two verified imported aliases are normalized;
unrelated modules, local names and distinct props remain different.

The earlier Codex map deferral is resolved by a finite profile: ten maps are
byte-identical; five retain every old segment exactly and add exactly 84
independently derived AST anchors (70 tuple-literal endpoints, six method/body
ends and eight inferred-object property/value anchors). Mapped generated lines
remain byte-identical. Reordered declaration lines have no mappings in either
map, the line count stays exact, and the complete declaration surface is checked.
This does not permit arbitrary points in a source range or blanket map changes.
Ten wrong/missing-map mutants and six alias mutants reject.

78 focused cases, API/Web/Worker native checks, strict emitted declarations in
both compilers, ten runtime target imports and emitted JSX SSR passed. The DB
prerequisite is compilation only; no database/container/live query was started.
The conflict-runtime production closure and provider owners remain deferred.

## Reusable bounded qualification procedure

1. Freeze an explicit manifest/route inventory at an exact source commit. Include
   workspace dependencies, dev-only fixture dependencies and generated-contract
   prerequisites. Inspect the complete original command before substituting its
   compiler; preserve prechecks and every flag. Do not blindly rewrite shell text.
2. Use an isolated checkout and job-owned output directories. Link installed
   immutable dependencies read-only, resolving workspace aliases to that checkout.
   Keep comparison baseline execution within the owner's bounded permission.
   Limit concurrency and memory to the available host resources.
3. Run each real strict typecheck and emitting project through the version-checked
   native helper. Capture command, cwd, flags, Node version, diagnostics and exit.
   Emit separate native/classic comparison trees without changing source inputs.
4. Require identical output file sets and JavaScript bytes. For declarations,
   compare the complete parsed surface, preserving literal values, tuple order,
   modifiers and overloads. Quote spelling, union order, distinct property order
   and redundant ambient function `declare` may differ. Guard against changed
   JSON/NUL/numeric values, lost readonly and reordered tuples with negative cases.
5. Preserve source maps. In this cohort eight maps have identical decoded segment
   semantics; six differ only at 20 parameter-property constructor anchors.
   Their emitted text is identical. A bounded AST/range profile validates every
   segment and every emitted token start, permitting only explicit constructor
   declaration maps and compiler-generated parameter-property field/default/
   assignment prefixes. Wrong or missing real-function mappings must reject.
   This is not blanket map byte/segment parity or permission to ignore maps.
6. Check native declarations through both supported comparison compilers with
   `skipLibCheck: false`. Import declared production export targets under normal
   production conditions, run meaningful fixture suites and affected host
   typechecks. Keep initial failures and their causes; repeat only unproven phases.
7. Review the exact diff and oracle evidence independently. Run required CI on the
   final commit; local checks do not replace whole-workspace or production builds.

## Finish the remaining CLI migration without one PR per package

Accounting for the separately qualified shared/logger/root work and these cohorts,
the inventory retains 12 package manifests and 24 bare compiler script routes.
Specialized root scripts, protocol bootstrap and packed-consumer compilers also
need their own exact-command inventory; explicit compatibility baselines remain
separate from ordinary routes.

Reuse the same per-route receipt/matrix in dependency order. Accumulate qualified
cohorts on one remaining-CLI integration branch, stop at an unexplained diagnostic
or output difference, and publish one coherent PR after the full admitted cohort
passes. Reuse hash-bound successful phases instead of repeating all compilation
or starting a new PR/CI queue for every manifest. A larger host run is appropriate
only after scratch ownership, exact dependencies and resource capacity are known.
The independent classic AST/API port and upstream Next/ESLint compatibility stay
explicit acceptance obligations throughout.
