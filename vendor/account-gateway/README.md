# Private Account Gateway SDK artifact

Internal pinned SDK0.1.0 from reviewed Gateway source `bdba815f`, same merged
`c7549d1e` tree. This artifact is not an npm publication or a release.
The six SDK source files and package exports are unchanged. The existing pinned
TypeScript7 build produces the packaged dist and declarations; provenance.json
records source hashes and tarball integrity. Rebuild with the library's existing
`node scripts/build.mjs` and `npm pack --ignore-scripts` in an isolated workspace.

RR backend consumes `/contracts` and server-only `/http`. Neither upstream key
nor private execution/run-control bearer is part of this artifact or frontend API.
A future published package can replace this file dependency without changing ports.
