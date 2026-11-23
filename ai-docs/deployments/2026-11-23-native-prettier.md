# Native TypeScript formatting prerequisite

- Task ID: `2026-11-23-native-prettier`.
- Goal: retain the complete Prettier formatting gate and protocol generator while
  avoiding initialization of the bundled legacy TypeScript implementation.
- Affected targets: repository formatting, local/CI qualification, and the existing
  protocol generator formatting boundary. Application services are unchanged.
- Implementation PR: draft to be opened from
  `fix/ci-native-prettier-20261123`.
- Implementation base: `27c353d2425abf56db66e902caaba86f756dee8d`.
- Dependencies: existing Prettier 3.8.3, exact official
  `@prettier/plugin-oxc@0.2.4`, Node 26.11.1, and native TypeScript 7.0.2.
- Last updated: `2026-11-23`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                               |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------ |
| Local qualification  | `pending` | Not qualified                   | Not verified        | Install exact candidate, implement and run the checks below.        |
| GitHub CI            | `pending` | Not merged                      | Not verified        | Review the exact source, run normal checks, merge and verify main.  |

This task requires ordinary repository delivery. It does not deploy application
services, publish an Action, change the database, activate a feature, or modify
production configuration. The original E2E/CD objective retains its separate
release gates and evidence.

## Design and scope

Register one typed Prettier plugin through its public Plugin API. It maps the
existing `typescript` parser ID to the official Oxc TypeScript parser and registers
only that parser's distinct AST printer. Preserve built-in language inference and
all other parser/printer selections. Keep `prettier --check .`, both ignore files,
existing style defaults, and embedded-language formatting unchanged.

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

| Time (UTC) | Target             | Actual source / version | Observed result                                                   | Next action                         |
| ---------- | ------------------ | ----------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| 2026-11-23 | Design and package | Main `27c353d`, Oxc 0.2.4 | Two design reviews; archive integrity and distinct printer checked. | Commit plan, open draft, implement. |
