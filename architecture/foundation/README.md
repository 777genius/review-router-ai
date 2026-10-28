# Provider and memory boundary tooling

The root `foundation.config.yaml` adopts bounded provider catalog, provider usage
and memory source boundaries. Foundation 2.1.0 is a development dependency; Get Modular
Core and Assembly are currently pinned to 0.7.0. The recorded isolated packed
consumer qualification below covers the historical 0.2.0 generation only.
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
v2 portable topology or repository-wide adoption. The historical 0.2.0 consumer's registry exports
and SRI are retained in `scripts/provider-foundation/registry-artifacts.json`.
That artifact does not qualify the currently installed 0.7.0 packages.

Run `pnpm foundation:check`, `pnpm foundation:assert-dev-only`, and
`pnpm foundation:assert-registry`; all are included in `architecture:check`.
`pnpm foundation:qualify` also downloads and verifies the recorded Core/Assembly
0.2.0 packed artifacts, builds an isolated ESM consumer with TypeScript 6.0.3 and
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

Memory domain/application own neutral approval, source, revision, command,
maintenance and deletion contracts. The selected Hindsight implementation owns
native bank mapping, SDK calls, operation semantics and signed cleanup evidence.
This is a bounded v1 source policy; runtime code does not import Foundation, and
it claims neither v2 portable topology nor whole-workspace conformance.

- Only `memory.hindsight` may import `@vectorize-io/hindsight-client`.
  Domain/application, public exports and Prisma metadata persistence cannot import
  or re-export its values or types. Infrastructure cannot import the concrete
  provider. The public root exposes neutral contracts.
- `memory.composition` owns Get Modular provider construction. Configuration is
  local, and host startup performs no native readiness or migration I/O.
- Production infrastructure and colocated tests have explicit ownership. New
  unclassified infrastructure files fail the check; protected domain/application
  roots inherit dependency direction. Removed custom search/projection/Infinity
  sources have no active policy boundary.
- Foundation permissions are package-granular; permitting the SDK does not claim
  per-subpath restrictions inside that package.

Foundation v1 governs directory roots. Governing entire API/worker hosts would
widen this adoption beyond memory, so a supplemental TypeScript AST guard scans
all actual API/worker source for SDK and concrete native-provider imports. It
handles value/type imports, re-exports, import types, dynamic imports, require,
require.resolve and simple statically resolvable module-name constants. It does
not evaluate arbitrary computed JavaScript. Hosts use neutral public/composition
contracts and approved infrastructure helpers. One exact operator-proof test is
an explicit native test exception; production imports of that exception fail.

`pnpm foundation:qualify-memory` defines 23 sequential real-workspace cases: 16
exercise the installed Foundation CLI and seven exercise the supplemental host
boundary behavior. Cases cover allowed neutral imports, SDK value/type/re-export/
dynamic leakage, outward core imports, concrete-provider exports, Get Modular
outside composition, unknown sources, host SDK edges and attempted production
imports of the test exception. Diagnostics record Foundation and host-guard exit
codes separately. A clean baseline is required before and after the run.

Fixtures create new source exclusively and restore appended files only if their
bytes still match the expected mutation. Do not run this qualifier, another
Foundation qualifier or architecture checks concurrently. The existing
`architecture:check` quality lane invokes this qualifier sequentially. Generated
full evidence is written to ignored
`tmp/memory-foundation/boundary-qualification.json`, including the policy digest.
The committed checkpoint records only checks actually completed against its
policy bytes; a defined fixture count is not a claimed qualification pass.

Native image/API/worker/PostgreSQL behavior, physical cleanup proof and selected
model quality have separate qualification gates.

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
