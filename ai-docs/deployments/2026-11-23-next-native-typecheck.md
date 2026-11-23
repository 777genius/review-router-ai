# Native TypeScript checking in the Web build

- Task ID: `2026-11-23-next-native-typecheck`.
- Scope: the Web build's own TypeScript check and its exact dependencies,
  including the declared parser dependency needed by its contract tests.
- Base: `27c353d2425abf56db66e902caaba86f756dee8d`.
- Status: planned qualification; no application deployment.

## Problem and ownership

Next 16.2.11 invokes the classic TypeScript compiler API after the existing
native Web preflight. Its native-preview branch omits that later check, so it
cannot establish a complete TypeScript 7 build. Next 16.4.6 has a supported CLI
route that resolves the application's TypeScript package and checks the full
configured project.

This task owns the Next upgrade and coherent root/Web TypeScript dependency.
Architecture parsing remains with #977/#980/#982, compiler CLI cohorts with
#967/#969/#971–#975, and the current modular consumer with #976. Their source and
qualification are not replaced. Existing Skills and PostgreSQL contract repairs
remain in #967 and #978.

The initial Web-only TypeScript 7 pin exposed a concrete Prisma installation
boundary: pnpm created separate root/DB and Web client peer contexts. Canonical
`db:generate` prepares the client resolved from the schema's directory, leaving
the Web context without generated types and runtime. The agreed minimal repair
is the same exact TypeScript 7.0.2 dependency at root and Web. This avoids a new
schema/output owner, copied clients, or package-resolution overrides. The root
dependency change does not qualify the remaining classic compiler-API consumers
or authorize their execution; integration with their existing owners is required.

The full Web project also includes the hosted workflow recovery contract test.
Its remaining classic-API loader is being migrated with the other test consumer
by the existing native-toolchain workstream, preserving its production-behavior
assertions. This task declares exact root development dependency
`oxc-parser@0.159.0`, matching the public parser contract used by #980/#982; the
existing `esbuild@0.28.1` supplies the loader's transpilation seam. Parser and
test-loader source changes remain with their owners. An installed parser alone
does not establish those gates or the complete Web build.

## Implementation plan

1. Pin Next 16.4.6 at root and Web, and declare TypeScript 7.0.2 directly in both
   packages. Declare root `oxc-parser@0.159.0` for the integrated contract-test
   loader and native AST gates. Generate the real pnpm lockfile, review the
   changed peer inventory and verify exact published dependency integrity.
2. Retain the existing native preflight, full Next build-time checking, strict
   project inputs and generated route types. Do not set `ignoreBuildErrors` or
   add an API compatibility shim.
3. Verify a frozen install and canonical Prisma generation resolve one generated
   client for root, DB and Web. Qualify the real Web project and production build
   on Node 26.11.1. Verify which TypeScript implementation Next actually selects
   and reject a deliberate type error through Next's own check, independently of
   the preflight.
4. Verify the compiled landing and dashboard boundaries, review the complete
   dependency/configuration diff and collect applicable final-source CI.
5. Integrate with the remaining native toolchain prerequisites through the normal
   reviewed PR flow. Record actual merge and publication evidence separately.

Expected maintained implementation: about 5–15 manifest/configuration lines,
plus the generated lockfile and this record. No new production business logic.
Complexity 4/10, confidence 8/10 and expected bounded reliability 8/10 are
engineering estimates before execution, not measured availability.

Two design checks identified the important boundaries: an isolated compiler
alias does not change Next's project-local resolution, and a successful native
preflight does not prove that Next retained its own type check. Both are explicit
qualification requirements above.

## Evidence and limits

Upstream source: [Next 16.4.6 release](https://github.com/vercel/next.js/releases/tag/v16.4.6),
[TypeScript verification](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/lib/verify-typescript-setup.ts)
and [CLI resolution/execution](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/lib/typescript/runTypeScriptCli.ts).

Implementation and execution are pending. This narrow task does not establish a
TS7-only repository: ESLint, embedded formatter parsers and other classic API
consumers have independent owners and must remain explicitly unqualified until
their supported routes pass the applicable checks.

## Rollout and rollback

| Environment            | Status  | Actual source/image       | Next step                                                                |
| ---------------------- | ------- | ------------------------- | ------------------------------------------------------------------------ |
| Local qualification    | pending | Not yet built             | Execute the source-bound checks above                                    |
| CI/publication         | pending | Not yet merged            | Complete the compatible full CI route and normal merge                   |
| Staging/production Web | pending | Not deployed by this task | Include the qualified change in a separately authorized coherent rollout |

No database migration, credential, feature activation or provider protocol change
is required. A later authorized Web rollout follows the existing release runbook
and retains the previous image. Roll back through that retained image or an
ordinary reviewed revert of this dependency change; do not rewrite shared
history or claim deployment from build/merge evidence.
