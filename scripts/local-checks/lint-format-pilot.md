# ReviewRouter native lint/format pilot

Candidate only. Package `lint` and `format:check` remain ESLint and Prettier.
No activation, whole-corpus parity, speed, release, CI or production claim.
The local lint adapter reports successful checks as `feedback-only`; mutable
source and package version assertions do not establish frozen input custody.

## Rule ownership and scope

The fallback imports `eslint.config.mjs`. Its syntax rules come from the public
`stack-toolchain/eslint-syntax` adapter; the three recommended layers, original
20-rule namespace, file scopes and repository overrides remain intact. Only `no-debugger`,
`no-compare-neg-zero`, `no-empty-character-class`, `no-invalid-regexp`,
`no-regex-spaces`, `no-sparse-arrays` and `use-isnan` move to the candidate
Oxlint config. All other effective rules and globals retain baseline ownership.
An independent literal oracle retains the 8.59.1 rule set and typed core-rule
adjustments without loading the old plugin or compiler. It also checks the
qualified parser/plugin identity and readonly globals. The executed ledger
compares every baseline rule, full options and language option for JS,
MJS, CJS, TS, MTS, CTS and TSX. Each moved rule has an independent positive and
rejecting source in all seven extensions. Retained behavior covers undefined
and readonly globals, unused variables, explicit any and empty object types.
TS/TSX allow-any exceptions remain narrow: MTS and CTS still reject any.
ESLint suppressions and existing ignore paths remain effective.

Supply 1-128 explicit files to `lint-format-lint.mts`; directories, symlinks,
escaped paths and unsupported extensions are refused. Baseline ignored files
are reported separately. The native invocation disables Git-only filtering;
the ESLint baseline retains ignore ownership. No automatic write is provided.

## Formatter ledger

| Option/scope                          | Finite qualification                                                                                                    | Unsupported or retained gap                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Width 80 instead of Oxfmt default 100 | TS call between 80 and 100 columns, independent multiline golden; actual 100-column mutant differs                      | No whole-corpus layout equivalence                                                                                            |
| Import sorting disabled               | Reverse import order with attached comments stays byte-identical; enabled native mutant differs                         | No import sorting plugin adoption                                                                                             |
| Package sorting disabled              | Reverse package keys and dependency names stay ordered; enabled mutant differs                                          | No package sorting plugin adoption                                                                                            |
| Tailwind sorting disabled             | TSX class order preserved against baseline without a plugin; enabled native mutant differs                              | No Tailwind plugin/config/version parity claim                                                                                |
| Baseline syntax options               | Comments, regex, templates, typed TS/MTS, JSX, JSON, Markdown and CSS independent goldens and repeat idempotence        | Not an exhaustive per-option oracle                                                                                           |
| Semantics                             | TS parse diagnostics; evaluated template, typed export, regex and JSX output; JSON input value preserved                | Formatting parse checks do not replace project typecheck/build                                                                |
| Ignore paths                          | Every current `.prettierignore` entry tested in a fresh minimal TEST subject, explicit file invocation, bytes unchanged | Generated, release-evidence, secrets and vendor files are excluded inputs                                                     |
| Other formats/configs                 | Retain Prettier                                                                                                         | CTS formatting, YAML, HTML, SCSS, Vue, Astro, Svelte, MDX, plugins, nested configs and embedded-language behavior unqualified |

## Disposable qualification

The maintained local and ordinary CI entrypoint is:

```sh
pnpm lint:qualify
```

Use `pnpm lint:qualify --output /absolute/new-proof-directory` to retain evidence
at an explicit new location. The default creates a private temporary evidence
directory and prints its path. Run it from the repository's ordinary frozen
installation after the exact public adapter artifact has been admitted.
No installation or lifecycle script runs inside this command.

The wrapper verifies tool metadata before allocating a private `TEST` copy,
copies every maintained qualification input and existing ignored-byte witness,
and records their hashes. It reads the real frozen dependency closure through
one link; all fixture sources, cache and temporary writes stay in the private
copy. Each child inherits the native preload guard, expressed as a file URL.
The wrapper then runs the original strict `tsconfig.lint-format.json`, the
complete native formatter Vitest suite with proof-boundary controls and both
Node safety/full qualification suites. JSON and TAP totals must contain positive passing counts and zero
failed, pending, skipped, cancelled or todo cases. The unchanged independent
rule ledger is required. Original source hashes, the exact copied TEST input
path set and installed identities are checked again before the receipt can
pass. Mutable inner fixtures and caches are outside that copied input set.
Cleanup removes only the new `TEST` copy before the final receipt is written.
A cleanup failure produces an explicitly failed receipt retaining earlier
execution failures and cleanup debt. Stage logs, native audit, rule ledger
and receipt remain in the evidence directory.
This checks the maintained fixture scope; whole-repository lint and format
checks remain separate required gates.

The current fixture ownership contract requires a POSIX current user ID and
private directory permissions. The wrapper refuses an environment that cannot
prove that existing contract. For direct harness development, the equivalent
isolated setup is described below.

Use a fresh private job-owned dependency root, such as one created with
`mktemp -d`, and job-owned scratch beneath it on the same filesystem. Both
directories must belong to the current user and must not allow group or other
users to write. Symlinks in either path are rejected.
Install only the exact admitted tooling below, with lifecycle scripts disabled,
job-owned TMPDIR/cache/store and a recorded lock. Do not install the product's
optional runtime or invoke its postinstall. Baseline versions match checkpoint
pins; newer registry baseline versions do not authorize an upgrade.

Copy the six configs (`eslint.config.mjs`, fallback, both native configs,
`.prettierignore`, `.prettierrc.json`), `tsconfig.base.json`,
`tsconfig.lint-format.json` and `scripts/local-checks/lint-format-*` into that TEST root.
Copy the existing ignored generated/release-evidence subjects and lockfile as
preservation witnesses. These are copies of source bytes, never executed.
Create `.rr-n1-test-subject` containing `disposable N1 lint/format subject` plus
newline, and an empty `output` directory beneath the TEST dependency root.

From the TEST root, run:

```sh
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=$PWD/scripts/local-checks/lint-format-native-load-guard.ts"
TMPDIR="$PWD/output" RR_N1_TEST_ROOT="$PWD" RR_N1_SCRATCH="$PWD/output" \
  node --test scripts/local-checks/lint-format-safety.test.ts \
  scripts/local-checks/lint-format-qualification.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.lint-format.json
```

Package identities are checked before fixture creation/test registration;
native `--version` is checked before fixture tools execute. Wrong-version
rejection runs the actual harness with a TEST sentinel tool and proves no
fixture tool invocation or output creation. A fresh minimal root holds copied
configs and all test inputs; exclusive writes reject existing leaves and
symlink components. Original generated/evidence bytes are compared after the
suite and during cleanup. Cleanup removes only the newly allocated TEST root;
rule ledgers stay in the separate job output directory. This assumes exclusive
ownership of TEST scratch; path checks are not atomic protection from hostile
concurrent writers.

The minimal subject retains the admitted Prettier configuration and native
TypeScript parser helper. Every Prettier fixture invocation selects that copied
configuration explicitly. The inherited pre-initialization guard rejects an old
TypeScript implementation or Prettier's bundled TypeScript parser in every
child process. The unchanged independent formatter goldens, idempotence and
option-mutant checks qualify this current native baseline.

## Exact Root insertion fragments

Add exact dev dependencies; preserve existing defaults and baseline lock pins:

```json
{ "oxlint": "1.87.0", "oxfmt": "0.72.0" }
```

The harness additionally requires existing `eslint@10.3.0`, `prettier@3.8.3`,
`typescript@7.0.2`, `stack-toolchain@0.3.1`, `@eslint/js@10.0.1`,
`@prettier/plugin-oxc@0.2.4`, `esbuild@0.28.1`, `vitest@4.1.10` and the
repository's frozen `@types/node` declaration package.
The protected Foundation [release run 45516866453, attempt 2](https://github.com/agent-teams-ai/engineering-foundation/actions/runs/45516866453)
published `stack-toolchain@0.3.1` from `fac03920e50ebde038ae415edeb7aa9e3d610ada`.
The publisher verified the exact packed manifest and archive, npm signatures,
SLSA source identity and final registry tag; both pre-merge and resulting-main
CI passed 35/35 jobs. The qualified archive is SHA-256
`2cef8769bfa8408025f4c30f5c2702abc0c4b43a43937fdb1b67a4cb33c892ed`, with SRI
`sha512-chxhm1Hn/lfE/y+ttOeqL6JmjJqq8IVNXs6fdEUNDmdVHmmXXbhBfHLVh2W9EUBhp+s+DrskUaKy6QbehLUE3w==`.

Consumer acceptance still requires the retained root graph to be resolved by
pinned pnpm 11.28.7, an ordinary frozen installation with its required builds,
and complete native lint qualification on that installed graph. Preserve
Foundation 3.1.0, FMS 0.3.2 and the accepted Get Modular coordinates. Do not
substitute a source link or hand-edit lock integrities. The legacy
`typescript-eslint` package is removed from the direct dependencies; no legacy
plugin execution is permitted.

The consumer executes the syntax adapter under Node. Its exact optional
`bun@1.4.3` postinstall is explicitly denied in `allowBuilds`; existing required
dependency builds and the normal root lifecycle remain enabled.

Before any fixture creation, metadata-only admission resolves the native parser
0.1.1, scope-manager 8.73.0 and TypeScript 7.0.2 from the physical Stack package.
The parser and retained rules must resolve the same physical scope-manager;
the actual parser-owned visitor keys and scope-owned types/visitor keys must
also be 8.73.0. Parser 0.1.1 publishes ranges for some of these dependencies, so
this verifies the manager-resolved graph instead of assuming a declaration
provides an exact transitive pin. Independent sentinel fixtures reject wrong
parser, scope, visitor-key or type versions and a second physical scope without
initializing either implementation or writing fixture output. Package-manager
links within the installed closure remain allowed; fixture paths themselves
remain symlink-free.

Maintained wrapper and direct TEST-only pilot script entries:

```json
{
  "lint:qualify": "node scripts/local-checks/lint-format-qualify.ts",
  "lint:native:files": "node scripts/local-checks/lint-format-lint.mts",
  "test:lint-format:qualification": "node --test scripts/local-checks/lint-format-safety.test.ts scripts/local-checks/lint-format-qualification.ts",
  "typecheck:lint-format": "node scripts/local-checks/compiler-cli.ts --native --noEmit -p tsconfig.lint-format.json"
}
```

Exact `tsconfig.lint-format.json` fragment; integrate this additional tooling
check without replacing the existing project typecheck:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": false,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": [
    "scripts/local-checks/lint-format-*.mts",
    "scripts/local-checks/lint-format-*.ts"
  ]
}
```

Actual tests are Node tests, not Vitest tests: `lint-format-safety.test.ts` and
`lint-format-qualification.ts`. Register them through the designated Root
integrator if an inventory/gate needs wiring. The helper awaits the ESLint
formatter's `string | Promise<string>` result, and resolves Oxlint from the
TEST dependency closure so the fresh subject need not contain dependency links.

Root must rerun against the final integrated dependency lock/source, obtain
independent final review and required checks before accepting activation. This
worker's finite isolated receipts are qualification observations only.
