# Native TypeScript formatting prerequisite

- Task ID: `2026-11-23-native-prettier`.
- Goal: retain the complete Prettier formatting gate and protocol generator while
  avoiding initialization of the bundled legacy TypeScript implementation.
- Affected targets: repository formatting, local/CI qualification, and the existing
  protocol generator formatting boundary. Application services are unchanged.
- Implementation PR: [#984](https://github.com/777genius/review-router-ai/pull/984),
  `fix/ci-native-prettier-20261123`.
- Implementation base: `27c353d2425abf56db66e902caaba86f756dee8d`.
- Dependencies: existing Prettier 3.8.3, exact official
  `@prettier/plugin-oxc@0.2.4`, Node 26.11.1, and native TypeScript 7.0.2.
- Last updated: `2026-11-23`.

## Environment status

| Environment / target | Status      | Actual deployed version / image                 | Last verified (UTC) | Evidence / next step                                                            |
| -------------------- | ----------- | ----------------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| Local qualification  | `installed` | Source `e3856967` and recorded baseline repairs | 2026-11-23 14:55    | Scoped formatter checks verified; full protocol compiler gate remains separate. |
| GitHub CI            | `pending`   | Not merged                                      | Not verified        | Review the exact source, run normal checks, merge and verify main.              |

This task requires ordinary repository delivery. It does not deploy application
services, publish an Action, change the database, activate a feature, or modify
production configuration. The original E2E/CD objective retains its separate
release gates and evidence.

## Design and scope

Register one typed Prettier plugin through its public Plugin API. It maps the
existing `typescript` parser ID to the official Oxc TypeScript parser and pairs
its ESTree AST with the already pinned Prettier 3.8.3 ESTree printer. A distinct
`native-typescript-estree` registration prevents replacing the printer selected
by Babel/JavaScript. Preserve built-in language inference and all other parser
selections. Keep `prettier --check .`, both ignore files, existing style defaults,
and embedded-language formatting unchanged.

The CLI loads this plugin through a root configuration. The protocol generator
loads the same plugin through a typed formatting helper; its existing explicit
parser selections remain intact. A single import correction in
`scripts/generate-review-action-v2-protocol.mjs` is a bounded legacy-file change:
migrating the complete generator would expand this task beyond its formatting
boundary. The legacy generator is not claimed to be strictly typechecked.

New maintained source and tests use `scripts/local-checks/lint-format-*.ts`, which
the existing strict `tsconfig.lint-format.json` includes. Do not change the active
architecture/AST work in PRs #977/#980, the Next prerequisite, other compiler
migrations, ESLint ownership, generated protocol contracts, or accepted evidence.

### Design review 1: public API and call sites

Prettier 3.8.3 deliberately resolves parser IDs from the last matching plugin;
its integration test verifies overriding a built-in ID. Built-in parser modules
load lazily. Markdown TS fences use language inference, whereas HTML
`application/x-typescript` scripts select the literal `typescript` ID. Both must
reach the same native parser. Thirteen explicit TypeScript formatting call sites
in the protocol generator need the API plugin; `format()` does not automatically
read the root configuration.

### Design review 2: exact published package

Read the published 0.2.4 archive without executing it and verified its SHA-512
against npm metadata. Published `index.d.ts` declares parsers `oxc` and `oxc-ts`,
and the single printer key `estree-oxc`. Published `index.mjs` assigns that same
distinct AST format to both parsers. Registering only the TypeScript parser and
`estree-oxc` printer therefore does not replace the existing `estree` printer used
by Babel/JavaScript. No custom AST conversion or fallback is required.

- Archive integrity:
  `sha512-XiXCHZIJ/Xrrc40rQAjXzNcCig8piVImL0tBvakuHGWGqSN7c+hA7Dli79ZbIwOeeSG+8gT6JRZr2hMQAuP+jA==`.
- Published `index.mjs` SHA-256:
  `f6b0a12b60ef8f52e47e8c654fef281c234ad315ec43d20482cb55e8c0f5f24e`.
- Published `index.d.ts` SHA-256:
  `e12f64226b964a3b17bb1d5dbf5fad632d8f12ef12ebb5784da67424db80b48f`.
- Exact native dependency: `oxc-parser@0.158.0`.

These reviews establish a supported candidate design, not runtime qualification.
The plugin carries its own printer, so corpus equivalence still needs observation.

### First qualification and printer correction

The initial direct Oxc-printer candidate passed 42 regression tests and the
native TypeScript 7.0.2 strict lint-format project, but the complete formatter
check reported 204 files. Representative differences were the newer printer's
union wrapping, including a generated protocol contract. No source files were
rewritten to accept that drift and no exclusions were added.

The public Plugin API also permits associating a parser's AST format with an
existing printer. The corrected candidate retains the official native parser,
registers the public `prettier/plugins/estree` printer from the pinned 3.8.3 package
under its own AST-format key, and changes no AST nodes. Three representative
drifting files then matched committed bytes. Full repeated qualification is
required before accepting that pairing; the original failure remains recorded.

The first fixture run was 41/42: the hand-written HTML-template golden incorrectly
expected outer newlines. The unchanged Prettier 3.8.3 Babel printer independently
produced exactly the candidate's outer layout. Only that erroneous golden was
corrected; embedded TypeScript formatting and its rejecting fixture were retained.

### Observed implementation checks

The corrected candidate passes 43/43 regressions, the native TS7 strict
lint-format project, and that project with the repository's
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` options enabled.
The existing tooling project already includes every new `lint-format-*.ts` file.

The first complete check of the corrected candidate reported two baseline
whitespace failures: `ai-docs/deployments/2026-11-23-hero-video-v96.md` and
`scripts/ci-impact.test.mjs`. The original Prettier 3.8.3 configuration without
the native plugin independently reported both same failures. The final complete
`pnpm format:check` after the integration below passed with zero legacy TypeScript
load attempts. Both ignore-file hashes remain unchanged; no exclusion or mass
reformat was used.

Ten native compiler invocations built the actual protocol prerequisites, followed
by the existing dist-import rewrite. The real generator then ran twice: all 65
protocol files match their original SHA-256 values and both outputs are identical.
The full `protocol:check` command separately stopped when its existing shared
build selected TypeScript 6.0.3; the guard rejected `bin/tsc` before initialization.
Its remaining compiler migration is not represented as a passing full gate.

The guard's deliberate CommonJS initializer is a temporary syntax fixture: its
`.js` form proves that both import and require are rejected before a side effect.
It contains no old compiler implementation. Real installed bundled-parser ESM
and CommonJS negative controls also pass. These checks qualify the guard, not a
substitute compiler.

The [durable evidence record](evidence/2026-11-23-native-prettier.json) preserves
the complete first failed corpus output, independent baseline failure, runtime
versions, source and ignore hashes, load audits, and all protocol file digests.
Ignored local scratch additionally retains the original commands and raw logs.

### Baseline integration and final formatter result

Merged main `0ced6f2666203f37825010afe5a999b1e229d81b` without conflicts before
repairing the two independently confirmed formatting defects. The hero document's
table whitespace reuses the exact existing patch from [PR #959](https://github.com/777genius/review-router-ai/pull/959),
head `15806fc09c4f276b5ec546f27365b50c3abed9dc`. Its resulting Git blob is exactly
`8477aae75d8e064ebcffe38392d6799c9aba13c5`; all Markdown table cell contents and
non-table lines are unchanged. No provider implementation from that PR is copied.

The second repair formats the current `scripts/ci-impact.test.mjs`, including the
already merged #981 additions. Prettier's independent AST/debug checks pass for
both files, and the actual CI-impact suite passes 40/40. The complete unchanged
formatter command then passes across the repository under the pre-initialization
guard. The first failing runs and exact baseline repair patches remain in the
durable evidence record.

An independent source/evidence review of `e38569670d4a2725564313ab99974ee930bf8e78`
found no blocking implementation issue. It checked the public parser/printer
boundary, guard negative controls, source enrollment/discovery, all eight source
and two ignore hashes, raw audit counters, and all 65 protocol file digests.
This is scoped implementation review; ordinary full CI, the owning compiler
prerequisite and the final merge remain separate required evidence.

## Ordered implementation and verification

1. Commit this plan and registry entry, then open a draft PR through the owning
   agent before implementation. Preserve exact author and committer identity.
2. Add the exact dependency and real package-manager lockfile without running
   legacy compiler lifecycle scripts. Inspect resolved package provenance.
3. Implement the typed plugin, shared API helper and one generator import change.
   Use existing strict source enrollment and add meaningful regression tests.
4. Install a qualification-only load guard that rejects legacy TypeScript modules
   before initialization. Prove the guard with an independent negative control.
5. Run positive, rejecting, idempotence and compatibility fixtures for TS, MTS,
   CTS, TSX, declarations, explicit API calls, Markdown fences, HTML script modes,
   templates, comments, regex, JSON, YAML and CSS. Verify JS uses its old printer.
6. Run the complete unchanged formatter corpus with the guard. Preserve first
   failures, selected/ignored-file evidence and every remaining difference; never
   add exclusions or suppress diagnostics to obtain a successful result.
7. Run actual protocol output verification and native TS7 strict checking of the
   owning project. Preserve generated protocol bytes and ignore-file hashes.
8. Review the complete diff, record actual results, and deliver through normal PR
   CI and merge. Main CI and the separate E2E/CD rollout remain independently
   verified by the owning agent.

The guard must catch the bundled `prettier/plugins/typescript` implementation as
well as an old standalone TypeScript package. For embedded rejection fixtures,
use `PRETTIER_DEBUG=1`: ordinary Prettier can retain malformed embedded text after
a parser error, which is not proof that the intended parser executed successfully.
Do not execute the existing TS6-based pilot harness as migration evidence.

## Retry, partial completion, and rollback

Retain failed commands and their exact inputs under ignored task scratch; record
durable summaries here. Fix a demonstrated failure before repeating its check.
Dependency or formatter output failures leave qualification incomplete. Rollback
reverts this task's dependency/configuration/helper/import changes together; it
does not authorize execution of the previous legacy parser under current policy.
No application state, schema, deployment or remote publication is changed here.

## Related links

- [Prettier 3.8.3 parser resolution](https://github.com/prettier/prettier/blob/3.8.3/src/main/parser-and-printer.js).
- [Upstream built-in parser override test](https://github.com/prettier/prettier/blob/3.8.3/tests/integration/__tests__/plugin-override-buitin-plugins.js).
- [Official Oxc plugin](https://github.com/prettier/prettier/tree/3.10.1/packages/plugin-oxc).
- [Prettier public Plugin API](https://prettier.io/docs/plugins).
- [Existing pilot coverage and limits](../../scripts/local-checks/lint-format-pilot.md).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)       | Target             | Actual source / version                                          | Observed result                                                                                                           | Next action                                                         |
| ---------------- | ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 2026-11-23       | Design and package | Main `27c353d`, Oxc 0.2.4                                        | Two design reviews; archive integrity and distinct printer checked.                                                       | Commit plan, open draft, implement.                                 |
| 2026-11-23 14:55 | Local formatting   | `e3856967`, integrated main `0ced6f2`, recorded baseline repairs | Complete formatter passed; 43 regressions, native strict checks and 65 unchanged deterministic protocol outputs verified. | Complete the separate compiler-owned gate and ordinary PR CI/merge. |
