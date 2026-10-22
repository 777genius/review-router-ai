# Provider and memory boundary tooling

The root `foundation.config.yaml` adopts bounded provider catalog, provider usage
and memory source boundaries. Foundation 2.1.0 is a development dependency; Get Modular
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
ownership and unknown files within the three explicit governed roots. It does not claim
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

## Memory adoption

The memory adapter delivery explicitly adds `packages/features/memory/src` to
the same v1 source policy, preserving the provider catalog and usage boundaries.
This is a scoped extension, not a whole-workspace FMS or Foundation conformance
claim. Runtime code does not import Foundation.

- Domain and application own their existing contracts. Their current
  `@reviewrouter/shared`, `node:crypto` and application `node:buffer` imports
  remain explicitly allowed; the adapter delivery does not migrate them.
- `memory.infinity` alone may import `@infinity-context/sdk`. The application,
  domain, interface and public package root cannot import or re-export its
  values or types. Tests call the real SDK through the adapter.
- Only `memory.composition` may import Get Modular. Configuration stays in a
  separate infrastructure boundary, and Prisma receipt persistence consumes the
  infrastructure-owned receipt contract without pulling SDK types inward.
- Existing production infrastructure files and colocated tests have explicit
  ownership. New unclassified files fail the check; new adapter entrypoints
  require a reviewed policy change. The Infinity directory is a production
  boundary, so its tests live in `src/tests`.
- Foundation permissions are package-granular. Allowing an SDK package does not
  claim per-subpath restrictions within that package.

`pnpm foundation:qualify-memory` runs the installed public Foundation CLI against
the real workspace, with two allowed fixtures and eight rejecting fixtures.
The forbidden cases cover SDK value/type/re-export leakage, outward application
imports, domain-to-application imports, Get Modular outside composition and an
unclassified source. Each expected diagnostic is bound to the fixture path and
its actual exit code; a clean baseline is required before and after the run.
`architecture:check` runs this qualification sequentially after the existing
Foundation checks, so the existing required CI quality lane executes it.

Do not run `foundation:qualify-memory`, `foundation:qualify` or another
architecture check concurrently: fixtures intentionally violate the live source
policy. Exclusive creation and unchanged-byte cleanup protect existing source.
Evidence is written to ignored
`tmp/memory-foundation/boundary-qualification.json`, including the policy digest.
This proves the declared boundary behavior; it does not prove SDK runtime
semantics, retrieval quality or live Infinity service qualification.

## Package manager and bootstrap

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
