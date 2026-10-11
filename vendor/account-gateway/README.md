# Private Account Gateway SDK artifact

Internal private SDK0.1.0 from Gateway source
`d96569febce760fda025f917aa076aeb6b54d117`, tree
`589d7359be90da5977c59aab3df4c7027167eb00`.
The independently reviewed source passed the existing frozen install, SDK build,
facade ingress fixture, strict service typecheck and normal package command.
This 15907-byte private archive is not an npm publication or a release.
`provenance.json` records source/build/package hashes and tarball integrity.
Rebuild using the library's existing `node scripts/build.mjs` and normal
`pnpm --dir packages/account-gateway pack` in an isolated workspace.

RR backend consumes `/contracts` and server-only `/http`. The archive includes
protected OAuth Begin and callback-completion contracts and the existing
consumer-control factory. Upstream keys and private execution/run-control
bearers are absent from the artifact and frontend API.

OAuth enrollment remains opt-in for `openai-codex-oauth-responses-v1`.
The ordinary Accounts form submits the fixed `http://localhost:1455/auth/callback`
URL once through the authenticated server adapter and scoped Gateway management
path. The URL is secret input and is never fetched or retained in client caches.
This source repin does not qualify a live OAuth provider or production custody.
