# Native TypeScript checking in the Web build

- Task ID: `2026-11-23-next-native-typecheck`.
- Scope: the Web build's own TypeScript check and its exact dependencies,
  including the declared parser dependency needed by its contract tests.
- Base: `27c353d2425abf56db66e902caaba86f756dee8d`.
- Status: implementation and bounded local build qualification pass; browser
  scenarios and compatible final-source CI remain pending. No application
  deployment. Draft [PR #983](https://github.com/777genius/review-router-ai/pull/983).

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
The reviewed loader patch from the existing native-toolchain workstream is
included here and preserves its production-behavior assertions. This task declares exact root development dependency
`oxc-parser@0.159.0`, matching the public parser contract used by #980/#982; the
existing `esbuild@0.28.1` supplies the loader's transpilation seam. Architecture-parser source changes remain with their owners. An installed parser alone
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

The dependency change is published at `95c53b357aadcc1dd66e6ea8d4772815bb4c9856`,
with the same tree `144f6ef5125a2a30b3bf12945e9a02a176a2a3de` as local commit
`a3b8de5037e9c582a2c5766f1eb2956e746bad2e`. The loader is published at
`cc455f2cf7fd4812eb3a901edc1a82d2e943e9cf`. The build actually started on local
`a3b8de5` plus the recorded loader candidate bytes; it did not start on the later
publication SHA. All application inputs match `cc455f2`, verified against the
4,747-file build snapshot and published loader hashes; only these documentation
updates remain outside that commit.
Local qualification uses official checksum-verified Node 26.11.1, pnpm 11.28.7,
TypeScript 7.0.2, Prisma 7.8.0 and exact `oxc-parser@0.159.0`. The registry
integrities match the generated lockfile. The parser addition changes only the
root importer and adds its own platform bindings/types; existing package
versions are unchanged.

The frozen install and existing root `postinstall` pass. Canonical `db:generate`
resolves one physical generated client in root, DB and Web, with identical
runtime exports. All four generated type files and the generated schema match
the earlier canonical generation byte-for-byte. No generated client was copied
between peer contexts. Root, Web and the app's `next-auth` resolve one physical
Next 16.4.6 owner. Its own resolver selects TypeScript 7.0.2's native CLI without
a compiler API path; default CLI checking remains enabled and build errors are
not ignored.

The standalone browser harness still declares its historical Next peer, but its
only auth use is `next-auth/jwt`: an actual encode/decode probe loaded zero Next
modules. Its server subprocess launches the root Next binary in the Web app.
This verifies the request-context ownership boundary without changing that
standalone lockfile.

All 37 unchanged Web workspace dependencies compiled through the guarded native
compiler with their existing build flags; the configuration package's existing
source/release guards also ran. This is bounded preparation of unchanged inputs,
not qualification of the still-separate root compiler-script migration.

The reviewed Web contract-test loader passes 14 independent helper
cases and all 166 existing workflow recovery scenarios: 180/180, with no skips.
Full native Web preflight also passes. The production source and existing
assertions remain unchanged; the old test has no file-size ceiling entry.
Qualified source SHA256 values are `be402f459a352faebcd8b708e7ac070d845aaea4a4f8604876e017cb1dcb888f`
for the existing test, `2bbe4c9eb844246207db476e9a694fd1d8c19f01ad8eddc0a645fcfa55b2e8a1`
for the loader and `2044150b68637ce0bbe31a9b4aaef4c260cac2564f4d16e7f33027d049297dd1`
for its fixtures. Exact Oxfmt checking passes for all three files.

The first direct Next production builds compiled the complete application and
entered their own TypeScript check, then received SIGKILL. A second diagnostic
run recorded approximately 3.1 GiB native-compiler RSS; kernel OOM evidence is
unavailable, so the cause is not asserted. Neither run proves successful full
checking or intentional-error rejection. Both first outputs and removed
sentinel source hashes are retained. Next generated the new `root-params.d.ts`
reference in `next-env.d.ts` through its normal setup.

Resource recovery restored the coherent worktree on disk, verified all 4,745
tracked files and repeated frozen installation, canonical generation and
physical package resolution. Removing only its verified disposable tmpfs
dependencies/failed build released 2,680,557,568 bytes; source and evidence were
retained. The official Corepack shims were regenerated after relocation, and the
final canonical setup uses the pinned pnpm version throughout.

After recovery, direct `next build` rejected the unimported sentinel with exactly
one diagnostic, `TS2322: Type 'string' is not assignable to type 'number'`, and
exit 1. No preflight was invoked by that negative command. Process telemetry
identified the actual `@typescript/typescript-linux-x64@7.0.2` executable
(SHA256 `4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4`).
The temporary file was removed, and all 4,747 original source inputs remained
unchanged. No memory cap or compiler/configuration bypass was used in this run.

The normal `pnpm --filter @reviewrouter/web build` then passed its native
preflight, production compilation, Next's own complete TypeScript check
(18.6 seconds), page-data collection and 43/43 static-page generation, exit 0.
The existing final ESM import rewrite also passed. Build ID
`8FhNSHYseGNNf3RO_Q5aT` binds the compiled boundary checks. The positive build log
SHA256 is `68926a7aa416cb53a34cdd4c379e7eb72ddf07403c1972e2bedc46473c0836b6`;
the direct negative log SHA256 is
`e9f79ec92b0ca3fcd92cc79f612b2314679b563d326e1cc58935a1167556a234`.

Eight compiled HTTP boundaries pass: health, landing HTML, actual NextAuth
session and provider handlers, unauthenticated dashboard redirect, sign-in HTML,
and the emitted CSS and JavaScript assets. The dashboard uses Next's
[documented streaming redirect](https://nextjs.org/docs/app/api-reference/functions/redirect):
HTTP 200 carries the exact refresh-to-`/` metadata and 307 redirect digest.
The initial diagnostic probe incorrectly expected only an HTTP 307; its output
is retained, and the corrected probe asserts the actual documented transport.
These checks use the existing public CI values and no configured OAuth provider;
they do not establish an authenticated database/provider flow.

Compiled browser interactions remain pending. The unchanged existing landing
Chromium entrypoint reached production-server readiness, but the system browser
failed before scenarios because its singleton socket was denied with `EPERM`.
One normal official Playwright headless-shell installation attempt was refused
with HTTP 403 by the available network path. No browser security/socket bypass,
alternative mirror or weakened assertion was used. The existing final-source CI
Chromium lane is the ordinary continuation for its six theme/viewport scenarios
and animated benchmark/carousel check.

The checked-in [qualification evidence](evidence/2026-11-23-next-native-typecheck.json)
records exact commands, tool versions, source binding, selected hashes, outcomes
and remaining limits. Detailed source hashes, first failures and raw receipts remain under
`tmp/next-native-qualification/`, particularly
`web-test-loader-qualification.json`, `restored-runtime-resolution.json`,
`next-own-negative-qualification.json`, `web-maintained-production-build.json`,
`compiled-http-boundaries.json` and `qualification-publication-binding.json`.
Full browser interactions and compatible final-source CI remain pending.

This narrow task does not establish a TS7-only repository: ESLint, embedded
formatter parsers and other classic API consumers have independent owners and
remain explicitly unqualified until their supported routes pass. In particular,
the installed typescript-eslint 8.59.1 peer range ends below TypeScript 6.1.0;
the root TypeScript 7 pin does not make that parser supported or authorize its
execution.

## Rollout and rollback

| Environment            | Status  | Actual source/image                                                              | Next step                                                                                                            |
| ---------------------- | ------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Local qualification    | partial | Inputs match published loader commit `cc455f2`; build ID `8FhNSHYseGNNf3RO_Q5aT` | Full build, own negative check, 180 contracts and 8 HTTP checks pass; browser scenarios require the normal CI runner |
| CI/publication         | pending | Not yet merged                                                                   | Complete the compatible full CI route and normal merge                                                               |
| Staging/production Web | pending | Not deployed by this task                                                        | Include the qualified change in a separately authorized coherent rollout                                             |

No database migration, credential, feature activation or provider protocol change
is required. A later authorized Web rollout follows the existing release runbook
and retains the previous image. Roll back through that retained image or an
ordinary reviewed revert of this dependency change; do not rewrite shared
history or claim deployment from build/merge evidence.
