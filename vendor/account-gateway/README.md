# Private Account Gateway SDK artifact

Internal private SDK0.1.0 from accepted Gateway source
`0d12d3a81336944a92ff29ad637cd233b44554aa` (preserved `21fb2f0` ancestry).
This artifact is not an npm publication or a release. The prepared 14-entry,
13925-byte public package includes protected OAuth Begin contracts and the
server-only client; production SDK/source are unchanged. The existing pinned
build produces packaged dist and declarations; provenance.json records exact
public source hashes and tarball integrity. Rebuild with the library's existing
`node scripts/build.mjs` and `npm pack --ignore-scripts` in an isolated workspace.

RR backend consumes `/contracts` and server-only `/http`. Neither upstream key
nor private execution/run-control bearer is part of this artifact or frontend API.
A future published package can replace this file dependency without changing ports.

OAuth enrollment is opt-in for the exact `openai-codex-oauth-responses-v1`
profile. Trusted native callback forwarding to the fixed
`http://localhost:1455/auth/callback` is a prerequisite owned elsewhere.
This repin does not qualify a live OAuth provider or introduce a public callback.
