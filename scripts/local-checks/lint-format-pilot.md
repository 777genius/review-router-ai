# ReviewRouter native lint/format pilot

Candidate only. Package `lint` and `format:check` remain ESLint and Prettier.
No activation, whole-corpus parity, speed, release, CI or production claim.
The local lint adapter reports successful checks as `feedback-only`; mutable
source and package version assertions do not establish frozen input custody.

## Rule ownership and scope

The fallback imports `eslint.config.mjs` unchanged. Only `no-debugger`,
`no-compare-neg-zero`, `no-empty-character-class`, `no-invalid-regexp`,
`no-regex-spaces`, `no-sparse-arrays` and `use-isnan` move to the candidate
Oxlint config. All other effective rules and globals retain baseline ownership.
The executed ledger compares every baseline rule and language option for JS,
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

Use a fresh job-owned dependency root on verified `/srv/workers` storage.
Install only the exact admitted tooling below, with lifecycle scripts disabled,
job-owned TMPDIR/cache/store and a recorded lock. Do not install the product's
optional runtime or invoke its postinstall. Baseline versions match checkpoint
pins; newer registry baseline versions do not authorize an upgrade.

Copy the five configs (`eslint.config.mjs`, fallback, both native configs,
`.prettierignore`) and `scripts/local-checks/lint-format-*` into that TEST root.
Copy the existing ignored generated/release-evidence subjects and lockfile as
preservation witnesses. These are copies of source bytes, never executed.
Create `.rr-n1-test-subject` containing `disposable N1 lint/format subject` plus
newline, and an empty `output` directory beneath the TEST dependency root.

From the TEST root, run:

```sh
TMPDIR="$PWD/output" RR_N1_TEST_ROOT="$PWD" RR_N1_SCRATCH="$PWD/output" \
  node --test scripts/local-checks/lint-format-safety.test.mts \
  scripts/local-checks/lint-format-qualification.mts
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

## Exact Root insertion fragments

Add exact dev dependencies; preserve existing defaults and baseline lock pins:

```json
{ "oxlint": "1.87.0", "oxfmt": "0.72.0" }
```

The harness additionally requires existing `eslint@10.3.0`, `prettier@3.8.3`,
`typescript@6.0.3`, `typescript-eslint@8.59.1`, `@eslint/js@10.0.1` and
`@types/node@22.19.17`. No unpublished C3 API or TS7 dependency is used.

Optional pilot script entries (qualification must run only in the TEST copy):

```json
{
  "lint:native:files": "node scripts/local-checks/lint-format-lint.mts",
  "test:lint-format:qualification": "node --test scripts/local-checks/lint-format-safety.test.mts scripts/local-checks/lint-format-qualification.mts",
  "typecheck:lint-format": "tsc --noEmit -p tsconfig.lint-format.json"
}
```

Exact `tsconfig.lint-format.json` fragment; integrate this additional tooling
check without replacing the existing project typecheck:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
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

Actual tests are Node tests, not Vitest tests: `lint-format-safety.test.mts` and
`lint-format-qualification.mts`. Register them through the designated Root
integrator if an inventory/gate needs wiring. The helper awaits the ESLint
formatter's `string | Promise<string>` result, and resolves Oxlint from the
TEST dependency closure so the fresh subject need not contain dependency links.

Root must rerun against the final integrated dependency lock/source, obtain
independent final review and required checks before accepting activation. This
worker's finite isolated receipts are qualification observations only.
