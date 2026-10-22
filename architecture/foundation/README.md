# Provider seam tooling

The root `foundation.config.yaml` adopts only the existing provider catalog
source boundaries. Foundation 2.1.0 is a development dependency; Get Modular
Core and Assembly are pinned to 0.2.0, matching the Gateway SDK generation.
The existing WEB Host CMS / Foundation 1.6 qualification is independent and
retains its previous pins and meaning.

Foundation 2.1's public source-dependencies v2 requires a closed complete pnpm
workspace. A profile selecting this feature fails with
`WORKSPACE_PACKAGE_OUTSIDE_PACKAGE_ROOTS: apps/api/package.json`; selecting all
packages then requires their entire source coverage. This conflicts with the
explicitly bounded adoption. The public v1 capability is therefore used against
the real RR workspace. It enforces value and type import direction, declared
package dependencies and public exports, entrypoints, development source
ownership and unknown files within the governed catalog root. It does not claim
v2 portable topology or repository-wide adoption. The exact registry exports
and SRI are retained in `scripts/provider-foundation/registry-artifacts.json`.

Run `pnpm foundation:check`, `pnpm foundation:assert-dev-only`, and
`pnpm foundation:assert-registry`; all are included in `architecture:check`.
`pnpm foundation:qualify` also downloads and verifies exact Core/Assembly packed
artifacts, builds an isolated ESM consumer with TypeScript 6.0.3 and
`skipLibCheck: false`, and verifies construction, rejection before I/O and host
cleanup of created resources. Assembly 0.2 performs no automatic disposal.

Boundary qualification uses exclusively created temporary files in the real
governed source roots and removes them in `finally`. Run it with no simultaneous
architecture check. It checks allowed domain imports, forbidden value/type
Prisma imports, HTTP adapter imports, another feature's internals and unknown
sources. Qualification output and downloaded packages remain in ignored `tmp/`.
The catalog and usage implementation checkpoints extend this explicit profile only
when their real source exists. New production adapters and colocated tests require explicit boundary ownership;
new domain/application source inherits the existing protected layer roots.

pnpm 11 reads overrides from `pnpm-workspace.yaml`; the existing security pins
were moved without changing their values. `verifyDepsBeforeRun: false` keeps
checks read-only; run a frozen install explicitly when dependencies change.
The three exact Foundation package release-age exceptions are reviewed pins,
not a general disablement. Local bootstrap validates the supported Node interval
and exact pnpm version. CI and Docker preserve Node 26.11.1 and pin pnpm 11.28.7.

Build permissions use pnpm 11's supported `allowBuilds` map. The removed
`onlyBuiltDependencies` setting is not effective in pnpm 11. The runtime
permission matches only its reviewed full codeload URL and commit; Prisma and
esbuild retain narrowly versioned approvals. No repository-wide or unpinned
Git build permission is granted. A normal install must exercise Git preparation;
`--ignore-scripts` does not qualify that boundary.
