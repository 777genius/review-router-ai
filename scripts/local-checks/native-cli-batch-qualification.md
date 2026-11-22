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

Accounting for the separately qualified shared/logger/root work and both cohorts,
the inventory retains 30 package manifests and 60 bare compiler script routes.
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
