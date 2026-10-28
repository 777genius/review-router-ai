# Account Gateway SDK artifacts

The current private provider-connections SDK is
`agent-teams-account-gateway-0.1.0-codex-models-6eb715faf907.tgz`.
`provider-connections-provenance.json` binds the archive to committed SDK source
and records its qualification boundaries. API and web use the same archive.
Codex model discovery is scoped to an authorized account and keeps the enrollment
model immutable. Native and Gateway admission validate requested models before
Responses entry; this archive alone does not activate production discovery.
RR keeps configured profile model choices by default. Set the server-only
`REVIEW_ROUTER_CODEX_ACCOUNT_MODEL_CATALOG_ENABLED=1` in API and web only after
the Gateway/native deployment supports account model discovery and admission.
When enabled, unknown or unsupported discovery does not authorize legacy models;
only the Gateway's explicit unavailable response permits the configured anchor.

`grok-code-130ca3f00dcc-provenance.json` and
`grok-code-130ca3f00dcc-sdk-receipt.json` retain the previous archive's identity
and installed qualification. Grok shows one plain authorization-code field;
the saved original provider selects its SDK-owned code grammar. Legacy Grok callback
URLs and Claude code#state completion remain supported.

Historical EF888 SDK bytes, provenance, installed receipt and controlled runtime
qualification retain their original hash-named identities. The historical
`provider-connections-qualification.json` is also still EF888 evidence; it is not
qualification of the new code-only SDK or a new native/Gateway runtime. New RR
and code-only runtime qualification are recorded separately in current provenance.
No archive is published to npm, and deployment/live account proof stays separate.

The previous Codex/Claude Accounts SDK is
`agent-teams-account-gateway-0.1.0-claude-limits-ef19e228.tgz`.
`account-limits-provenance.json` binds it to committed Gateway and native source,
including the Claude lifecycle migration. It carries `account-limits/v1` cached
reads for qualified Codex and Claude observations, plus Claude's explicit browser
code completion. Quota-only refresh remains unavailable.

Claude uses a separate qualified account/organization principal and encrypted
credential lifecycle. A legacy admin account or an API key cannot manufacture
subscription quota. Closed canonical windows keep global and model limits apart;
missing observations remain unknown. Ordinary Accounts reads never call a provider.

See [Claude account limits](../../ai-docs/architecture/61-claude-account-limits.md)
for profile configuration, source ownership and operational scope. Controlled
provider/PG/browser qualification does not prove production activation or a live
Claude login. This archive is private and is not an npm publication.

## Historical lifecycle SDK checkpoint

The historical local Accounts candidate used
`agent-teams-account-gateway-0.1.0-lifecycle-f9e0d304.tgz`.
`lifecycle-provenance.json` binds the archive to exact SDK source-file hashes
on Gateway base `ae96a3218cdaffad87ec11fd340c890596af1cc7`.
The Gateway worktree is uncommitted; this is a private checkpoint, not a release
or npm publication. The v2 contract supports suspend/resume and compatible
readback while writes are closed. Both SDK compatibility lanes and controlled
actual Go/Gateway/PostgreSQL retained-custody qualification passed.

Historical SDK provenance and archives below retain their original identities.

## Previous private Account Gateway SDK artifact

The earlier private SDK0.1.0 archive is
`agent-teams-account-gateway-0.1.0-28d6da0.tgz` (17155 bytes), packed from normal
Gateway main `28d6da0539fc7b879e3c2b9a955b7ef91ba4ecd1`, tree
`fe29e0e880f46fbbbbf2abfeba5309ac2d0d0b46`. Reviewed source is
`7c278c0087b03b34fca88882deb66bb76c34ac6f`. The normal pack reused the qualified
build with Node26.11.1/pnpm11.28.2. It is not an npm publication or a release.
`provenance.json` records exact source/archive hashes, integrity and qualification.
Historical archives retain their original bytes and source identity.

RR backend consumes `/contracts` and server-only `/http`. The archive retains
protected OAuth Begin/callback completion and normal consumer-control clients,
and adds authoritative account `retirement` and policy-cohort `policyClosure`
readbacks. Upstream keys and private execution/run-control bearers are absent
from the artifact and frontend API. Older SDK archives are not lifecycle fallbacks.

The actual controlled Go/Node/PostgreSQL joined acceptance passed held transport
closure, borrower deletion without owner disable, 102 scoped fences, one owner
disable despite a lost caller ACK, normal credential erasure and two tombstones.
No provider or production effects occurred. This does not apply RR migration127
or prove production deletion.

OAuth enrollment remains opt-in for `openai-codex-oauth-responses-v1`.
The ordinary Accounts form submits the fixed `http://localhost:1455/auth/callback`
URL once through the authenticated server adapter and scoped Gateway management
path. The URL is secret input and is never fetched or retained in client caches.
Rebuild only through the library's existing `node scripts/build.mjs` and normal
`pnpm --dir packages/account-gateway pack` in an isolated workspace.
