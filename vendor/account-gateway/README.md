# Account Gateway SDK artifacts

The current private provider-connections SDK is
`agent-teams-account-gateway-0.1.0-dynamic-models-d3c310431c0c.tgz`.
`provider-connections-provenance.json` binds the archive to committed SDK source
and records its qualification boundaries. API and web use the same archive.
The hash-named runtime and RR qualification receipts separate the controlled
SDK/Gateway/native execution proof from consumer checks and production rollout.
The payload-comparison receipt records the final documentation-only repack;
runtime, declaration, and package-manifest bytes match the qualified candidate.

OpenRouter and Codex reuse account-scoped model discovery and admission. The SDK
owns the qualified profile/protocol/authentication mapping. OpenRouter supports
up to 2,048 text-model rows from the native public-catalog adapter; Codex retains
its 128-row contract. Catalog clients explicitly opt into a bounded 2 MiB
response. Other client defaults stay at 64 KiB. OpenRouter does not inherit
Codex effort aliases or invented reasoning/fast capabilities. Explicit
OpenRouter `supported_efforts` and `default_effort` metadata can qualify
reasoning controls within the existing wire contract; a parameter name alone
does not enumerate supported levels.

The configured enrollment model stays immutable as account identity. It is not
the list of selectable review models. Gateway and native validate the requested
model against a current account snapshot and retain their owner, epoch,
generation, credential, and dispatch fences. Unknown, malformed, expired, or
unsupported observations cannot become an authorized static fallback. Only an
explicit unavailable result can retain the previously qualified anchor under
its conservative rules.

Set the server-only `REVIEW_ROUTER_ACCOUNT_MODEL_CATALOG_ENABLED=1` in API and
web after deploying the compatible Gateway/native source revisions recorded
in provenance. Explicit `0` disables discovery. During the coordinated rollout,
the old `REVIEW_ROUTER_CODEX_ACCOUNT_MODEL_CATALOG_ENABLED` value is read only
when the generic flag is absent; remove that alias from the provider-accounts
composition after both deployment configurations have migrated. Installing
this archive alone does not activate production discovery.

After enabling the compatible catalog during the coordinated upgrade, reopen
existing OpenRouter selections only if a saved control is no longer qualified by
the refreshed snapshot. Still-qualified values remain valid. Save unavailable
controls with provider defaults before resuming their reviews. A null
catalog capability means the control is not qualified by Gateway; it does not
claim that the provider lacks that capability. The old fixed descriptors are
not used to manufacture effort levels for the dynamic catalog, and explicit
saved values are not silently dropped at execution time.

The previous Codex SDK archive
`agent-teams-account-gateway-0.1.0-codex-models-6eb715faf907.tgz`, its hash-named
provenance, and its consumer receipt retain their original evidence. Historical
qualification does not prove the new OpenRouter runtime or a live provider call.

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
