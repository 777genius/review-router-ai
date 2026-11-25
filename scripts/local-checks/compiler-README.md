# Native compiler qualification

The repository compiler entrypoint selects exact TypeScript 7.0.2. The default
invocation and `--native` resolve the same isolated package, independently of
cwd and PATH. `--legacy` is rejected before resolving or initializing a compiler.
This follows the maintained [Engineering Quality Standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md);
retained historical comparisons do not authorize new old-compiler execution.

Both compiler distributions publish a bin named `tsc`. The native alias therefore
stays in the existing private `scripts/local-checks/native` installation, outside
the pnpm workspace. Its manifest and frozen lock pin `typescript-native` to
`npm:typescript@7.0.2`. Normal root postinstall prepares this installation. The
explicit preparation command is:

```sh
pnpm --dir scripts/local-checks/native install --ignore-workspace --ignore-scripts --frozen-lockfile
```

Invoke from the package whose project is being checked, resolving the helper
path relative to that package. From the repository root, these are equivalent:

```sh
node scripts/local-checks/compiler-cli.ts --native --noEmit -p tsconfig.tooling.json
node scripts/local-checks/compiler-cli.ts --noEmit -p tsconfig.tooling.json
```

The helper preserves cwd and all project/compiler arguments. It validates the
resolved package name, exact version and compiler entry before starting it.
Missing installations, invalid manifests, compilation errors and terminated
compiler processes remain failures. It never installs dependencies or selects a
fallback compiler.

## Supported manual gate

Run with the normal workspace dependencies and build prerequisites prepared:

```sh
pnpm compiler:pilot
```

That command first runs native TypeScript against the real `tsconfig.tooling.json`,
then runs the dedicated Vitest config. The tooling project extends the existing
strict base and covers the heading helper/test, compiler harness/helpers and
agreed `lint-format-*.ts/.mts` inputs. The authoritative root typecheck also
includes its explicit native invocation. The root tsconfig alone does not
establish tooling coverage; one-shot NodeNext, spikes and hosted-pool operations
retain their separate projects.

`compiler-cli.pilot.ts` remains opt-in. Ordinary Vitest discovery does not select
that expensive compiler suite; the small public-surface helper tests remain
ordinary unit tests and are also included in the dedicated config. Native
qualification uses the pre-init compiler load guard from the formatter/toolchain
prerequisite, including inherited child processes.

The dedicated suite covers these distinct boundaries:

| Boundary                | Required observation                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler resolution     | Default and explicit native report 7.0.2 under unrelated cwd and a colliding PATH; legacy selection and invalid package manifests fail before bin execution.                                                                                                                                                                                      |
| Real tooling project    | Public `--showConfig` reports the governed roots and strict options; the actual project passes; its copied local source closure, package manifests and installed dependency links pass; an invalid assignment in the copied real heading helper fails with TS2322.                                                                                |
| Independent diagnostics | Exact optional properties, indexed access, null and aliased downstream errors are rejected; the valid aliased consumer passes.                                                                                                                                                                                                                    |
| Real emission           | The unchanged workflow build and restricted review-evidence contract config emit exactly the ten expected JavaScript/declaration files.                                                                                                                                                                                                           |
| Public declarations     | Every named export and its leading documentation survives; every value export and ten type-only exports have bidirectional source/declaration type compatibility. Fixed independent consumers additionally assert literal values, union members, readonly objects/tuples, optional returns and NUL domain strings, with nine rejecting consumers. |
| Runtime and syntax      | Node runs the actual emitted modules through production exports and checks fixed values and behavior; public Oxc and esbuild parse/transform the three original governed source files; pure Node retains both heading outcomes.                                                                                                                   |

The existing ESM rewriter runs only on disposable emitted outputs. Runtime
subjects link the actual package's installed dependencies explicitly and request
the `production` export condition; qualification does not depend on the temporary
directory's ancestor packages or on an ambient Node condition.

The public-surface helper uses Oxc's named-export metadata and comments. It fails
on parse errors or unsupported default/star exports. It compares documentation
by export name after trimming line indentation, so printer indentation and source
offsets are irrelevant. It is not a declaration-type normalizer. Type consumers
check source/declaration assignability, while fixed independent fixtures check
semantic properties that assignability alone does not preserve, such as readonly
and literal tuple contracts. Distinct source/declaration enum identities do not
need to be identical compiler-internal types to satisfy those public consumers.

Set `REVIEW_ROUTER_COMPILER_PROOF_LOG` to a file under `tmp/` to retain actual
process arguments, exit/output data, native source inventory and emitted bytes.
New records identify native 7.0.2 explicitly; they contain no live classic run
and make no fresh classic/native parity claim.

## Historical comparison boundary

The original [pilot source](https://github.com/777genius/review-router-ai/blob/9c52c250b279f81470703b35fae0e787880a08ea/scripts/local-checks/compiler-cli.pilot.ts)
performed live TS6/TS7 compilation, JavaScript byte comparison and union-order
normalization through classic compiler APIs. That executable comparison is
retired because starting the old compiler conflicts with the native compiler
requirement. The available checked-in [logger/tooling receipt](../../ai-docs/deployments/2026-11-22-native-logger-tooling-compiler-routes.md)
and [contract-foundation receipt](../../ai-docs/deployments/2026-11-22-native-contract-foundation-compilers.md)
retain their original source, compiler attribution and limitations unchanged.
The original two-subject raw pilot output was not found in the bounded archive
audit; new native output is not attributed to that missing historic baseline.

The successor checks public contracts through independent expected results and
real consumers. It makes no claim of current-source byte parity with TS6. The
three governed syntax probes retain their actual filenames, now through public
native parser/transform APIs. Their production source migrations and behavioral
tests remain with the owning changes.

## Required Get Modular consumer path

The five feature packages using Get Modular explicitly invoke this helper
with `--native` for their normal build/typecheck scripts. Root postinstall prepares
the isolated compiler, so its `tsc` bin does not compete with another root bin.
`pnpm modular:qualify` checks the real feature compositions, statistics adapters
and full worker host consumers with `skipLibCheck: false`, then runs their
runtime suites. CI runs that gate separately after architecture checks with
`GOMAXPROCS=2` and `GOMEMLIMIT=2048MiB`. Worker and API normal builds/typechecks
also invoke native explicitly.

## Shared package compiler

`packages/shared` explicitly uses the same isolated native TypeScript 7.0.2
helper for its normal build and typecheck. Its tsconfigs, exports and Turbo
dependency ordering are unchanged. Next, ESLint and source-analysis tools retain
their separately qualified compiler/parser routes.

Turbo dependency ordering/output keys, generated Next types, production exports,
offline Prisma preparation and workflow routes remain independent integration
obligations. Web's native preflight and Next's own production build must both be
qualified. Passing the compiler pilot does not establish migration of every
embedded compiler consumer or a successful Next production build.
