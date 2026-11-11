# Proposal: NVIDIA Build as a separate ReviewRouter provider

**Status:** OWNER AUTHORIZED sandbox-only development/E2E on synthetic PRs (2026-11-11 continuation); production/customer use and deployment forbidden. Merge only after actual required E2E acceptance, not documentation/fixture-only proof.  
**Date:** 2026-11-10  
**Primary repository:** [ReviewRouter](https://github.com/777genius/review-router-ai)  
**Dependency owners:** [Account Gateway](https://github.com/agent-teams-ai/account-gateway) and [Sub2API native fork](https://github.com/agent-teams-ai/sub2api)  
**Intent:** An independent NVIDIA Build / NIM connection and account, not NVIDIA models hidden under an OpenRouter account.

## Executive decision

### Current qualified design and acceptance (2026-11-11; overrides earlier two-model P0 notes)

**Owner-approved scope:** implement and E2E-test a **single independent NVIDIA Build account** using only invented/synthetic PR material in the disposable private fixture. **No production deployment or customer/private business code**, even if the source PRs are merged. The trial secret was installed in the sandbox Actions repository; do not put it in source, logs, comments or production stores, and rotate the chat-shared key after qualification.

**Qualified model:** `nvidia/nemotron-3.5-super-vl-120b-a12b`, at the exact fixed hosted URL `https://integrate.api.nvidia.com/v1/chat/completions`. DeepSeek V4.1 Flash and GLM 5.3 Flash remained **unqualified** because independent 75-second requests returned no HTTP response. They are **not** part of the approved v1 model allowlist. A second-model abstraction or future dynamic source is explicitly deferred until proven necessary.

**Cross-repository implementation (smallest working slice):**
- [Sub2API #94](https://github.com/agent-teams-ai/sub2api/pull/94): one fixed NVIDIA identity and native provider account, encrypted custody, additive PostgreSQL birth guard, existing protected Responses→Chat adapter (not a second client), strict stream/terminal and replay validation, bounded static account model snapshot.
- [Account Gateway #105](https://github.com/agent-teams-ai/account-gateway/pull/105): one trusted provider registry descriptor and optional API-key registration, existing account lifecycle, ownership/fences, SDK `provider-connections/v1` and account-model read with **no missing-catalog anchor fallback**.
- [Review Router #854](https://github.com/777genius/review-router-ai/pull/854): existing provider picker, SDK archive pinned by SHA-256 in all three consumers, account catalog, NVIDIA vendor identity, trial checkout restricted to the exact disposable test repository and conversation disabled for trial profiles.

**Late security refinement (2026-11-11, [ReviewRouter #854](https://github.com/777genius/review-router-ai/pull/854)):** Checkout-based source restrictions alone do not cover every inference entry. Commit `bbfbe6e` adds a second independent **relay-entry** source check using the already-trusted `readCheckoutTarget` authorization/Prisma resolver, *before* any SDK preparation or dispatch; negative tests verify no admission and no outgoing request for missing/foreign source, while the exact synthetic fixture stays permitted. This is intentional validation across two trust boundaries, **not** a second account manager, provider transport, or generic policy plug-in. Only the single qualified Nemotron model can be used. Current source HEAD after the 13-file exact Prettier fix `9e205f0` and source privacy hardening is `bbfbe6e`; all new exact-head CI remains required before merge.

**Actual provider and native proof (PASS):** [Hosted NVIDIA SSE two-turn tool canary](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/43007767383) recorded 2× HTTP 200, function tool-call/ID, a tool result and follow-up response, with terminal events and `[DONE]`. [Protected native Go→NVIDIA canary](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/43008527694) independently passed 2 protected entries through the existing Chat bridge. [Native PostgreSQL E2E](https://github.com/agent-teams-ai/account-gateway/actions/runs/43008856396) and Account Gateway Checkpoint A/B, full-stack, native-client jobs passed on the functional candidate. ReviewRouter [six viewport/theme browser screenshots](https://github.com/777genius/review-router-ai/actions/runs/43009941246) passed, and the evidence images were inspected.

**Real source-grounded synthetic PR review (PASS, not yet App-authored):** [NVIDIA run #43013571329](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/43013571329) fetched the actual GitHub diff of [sandbox PR #32](https://github.com/777genius/rr-hosted-pool-e2e-20260927/pull/32) and enforced exact head `e48dc2bed0ddb6533217e35be845ee1422ce1d39`, exactly the two inventoried synthetic files, max 8 KiB diff, single hosted Nemotron tool call and structured validation. HTTP 200; model correctly identified the concrete missing-first-line-item bug at `nvidia-sandbox/invoice.mjs:4` with a correction. The run recorded `fileOK=true`, `lineOK=true`, `bugFound=true`, `requests=1`, `noPublication=true` without logs of source/model output or credential. This proves real source-grounded NVIDIA review inference but **does not** prove GitHub App authorship/publication or ReviewRouter orchestration E2E. The first free-text response had no `message.content`; forced function-output resolved that exact source-review schema mismatch without pretending the initial run passed.

**Final gates:** latest **non-Draft** exact-HEAD CI across repos, security/architecture review, rollback/secret hygiene, and **real ReviewRouter GitHub App-authored review** of the synthetic [fixture PR #32](https://github.com/777genius/rr-hosted-pool-e2e-20260927/pull/32) tied to its exact head `e48dc2bed0ddb6533217e35be845ee1422ce1d39`. The latter has **not** yet been observed; synthetic transport proof must not be relabelled App-first E2E. One-shot SDK/visual workflows were removed from final code diffs after artifacts were verified; production remained untouched.

> The original DeepSeek/GLM two-model research below is retained **only as dated historical investigation**. Current implementation/acceptance is explicitly single-model Nemotron. Historical estimates, snapshots and pending E-gate wording are not a representation of current system state.

### Historical hosted inference escalation — DeepSeek/GLM only (not a blocker for Nemotron)

The sandbox's **owner-scoped key is valid for catalog access**, but independent hosted
`POST /v1/chat/completions` attempts on both chosen models returned **no HTTP
headers within 75 seconds**. This is neither an SDK/Chat-bridge proof nor evidence
that the key is unauthorized. Related NVIDIA reports:
[similar two-model timeouts (2026-11-06)](https://forums.developer.nvidia.com/t/chat-completions-hangs-for-deepseek-v4-1-flash-and-glm-5-3-flash-get-v1-models-works/388228)
and [DeepSeek timeout (2026-11-10)](https://forums.developer.nvidia.com/t/deepseek-v4-1-flash-api-inference-timeout-get-models-works-post-chat-completions-returns-no-response/388614).
NVIDIA's [NGC documentation](https://docs.nvidia.com/ngc/latest/ngc-user-guide.html)
states that **Public API Endpoints** permission is required for inference.
NVIDIA forum moderators direct account-access cases to
[help@build.nvidia.com](https://forums.developer.nvidia.com/t/resolving-account-access-issues/345920).
Neither entitlement failure nor backend saturation has been proven for this key.

**Owner support request draft (send from registered NVIDIA account email, only if
the service remains unavailable; never paste the full API key or private source):**

> Subject: NVIDIA Build free hosted inference: catalog HTTP 200, Chat requests
> time out on DeepSeek V4.1 Flash and GLM 5.3 Flash
>
> I am using the free NVIDIA Build developer sandbox for synthetic API tests.
> With a repository-scoped disposable key, `GET /v1/models` returns HTTP 200 and
> lists both `deepseek-ai/deepseek-v4.1-flash` and `z-ai/glm-5.3-flash`.
> But separate minimal `POST /v1/chat/completions` requests to each model
> received no status or body within 75 seconds, with no automatic retry.
> Could you check my Personal Organization's **Public API Endpoints** entitlement,
> account-to-inference routing, and hosted model capacity, and advise an official
> resolution? No confidential inputs or production traffic were sent.
> Reproduction run IDs: 42927092117 and 42927680260 (GitHub Actions).
>
> I can supply my registered account email and sanitized account details via
> your secure support channel; I will not share raw API keys publicly.

Do not trigger further expensive/ambiguous model requests automatically.
Only if the owner later wants DeepSeek/GLM should this support path be used. The already-qualified Nemotron Chat/stream/tool tests proceed independently; App-first review still needs its own acceptance.

### Sandbox vendor catalog and synthetic PR evidence — 2026-11-11

- Owner provisioned `NVIDIA_API_KEY` as a GitHub Actions **repository-scoped secret**; logs mask it. The disposable sandbox's [read-only catalog run #42932552168](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/42932552168) returned **HTTP 200**, with **84 model records** including both exact proposed IDs (`deepseek-ai/deepseek-v4.1-flash`, `z-ai/glm-5.3-flash`). This verifies key acceptance for `GET /v1/models`, **not** permission or operational readiness for inference.
- Two independent minimal hosted **Chat Completions** requests, one per proposed model, each timed out after 75s with **zero HTTP response** (runs [#42927092117](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/42927092117), [#42927680260](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/42927680260)). No retries or customer source. Public NVIDIA Developer Forum posts describe the same catalog-200/POST-timeout behavior in November 2026 and request clarification of the Personal Organization's **Public API Endpoints entitlement**; this is a candidate external issue, **not a proven account root cause**.
- A real **user-authored, private, synthetic-only PR fixture** exists at [sandbox PR #32](https://github.com/777genius/rr-hosted-pool-e2e-20260927/pull/32), with exact head `e48dc2bed0ddb6533217e35be845ee1422ce1d39`. Its invented invoice code intentionally drops the first line item; accompanying tests make the expected review finding verifiable. The PR is Draft and should not be merged. A successful NVIDIA review must provide evidence against this actual PR/head and demonstrate genuine source-based findings, not just a synthetic HTTP 200.
- Review Router [Draft #854](https://github.com/777genius/review-router-ai/pull/854) now pins the source-built NVIDIA SDK archive (SHA-256 `0f674667e17292cdcc3884606e084badd70c3b20b96ce44ee144889cbc67b322`) in all three consumers with a consistent pnpm lockfile. Source and test provenance is separately recorded in `vendor/account-gateway/nvidia-sandbox-sdk-provenance.json`. Do not treat SDK installation as proof of vendor inference.

### Further verified evidence and vendor qualification status — 2026-11-11

- **Real native tool-path fixture (passed):** source-pinned [Gateway CI run #42927921750](https://github.com/agent-teams-ai/account-gateway/actions/runs/42927921750) checked out Sub2API exact source with two NVIDIA model IDs, parsed outbound Chat function-call stream, native one-entry dispatch, final terminal and SSE [DONE], and actual managed PostgreSQL candidate creation. It used synthetic credentials and a stubbed response; **does not prove the hosted provider supports tools**.
- **NVIDIA Build actual inference, first DeepSeek probe (inconclusive/failure):** sandbox [CI #42927092117](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/42927092117) mounted the **masked** owner-installed repository-scoped `NVIDIA_API_KEY` and tried one minimal synthetic Chat Completions call on `deepseek-ai/deepseek-v4.1-flash`. The single call timed out after **75 seconds**, no HTTP status or model output observed; no retry, no confidential source transmitted. NVIDIA Developer Forum reports similar free endpoint timeouts, but this cannot independently distinguish upstream saturation from account entitlement.
- **Independent GLM probe (not a DeepSeek retry):** [CI #42927680260](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/42927680260), same private sandbox secret and only synthetic prompt; completed with a 75-second transport timeout and no response. The result must be inspected before further live inference. Never assume `GET /models` success proves entitlement for a Chat request.
- **Readiness:** absent live Chat + streamed two-turn tool canary, both models remain `tools: none` and disabled in tool-dependent Review Router selection. Do not advertise end-to-end review as qualified. PostgreSQL & offline tests are positive partial evidence, not the missing live provider proof.
- **Review Router trial privacy fence:** PR [#854](https://github.com/777genius/review-router-ai/pull/854) rejects NVIDIA trial checkout unless the resolved GitHub repo is exactly `777genius/rr-hosted-pool-e2e-20260927`; tested with a deny-before-SCM-token synthetic case. Separate approval is needed before any production/private customer code route.
- **SDK packaging:** exact source-built Gateway SDK artifact was verified with SHA-256, but the Review Router manifest/lockfile vendor import remains to be confirmed on CI. Nothing has been published or deployed.

### Additional source-pinned cross-repository and UI evidence (2026-11-11)

1. **Gateway + Sub2API joined real runtime PASS.** [Account Gateway CI run #42945263678](https://github.com/agent-teams-ai/account-gateway/actions/runs/42945263678) performed the real production-native CLI/migration adapter build from **Sub2API exact candidate** `28402d51121ee3f75db74e0416bdce6194a98449`, with Gateway's trusted account/execution kernel and PostgreSQL 17.10, on both Node **24.21.0** and **26.11.1**. Both isolated full-stack **smoke suites PASSED**, correct source SHA, migration and cleanup receipts, external network disabled. This proves SDK/Go/PG integration compatibility, **not a live NVIDIA inference** or a new vendor-specific account invocation through full-stack.
2. **Review Router fail-closed correction.** API checkout only permits NVIDIA trial inference for the exact `777genius/rr-hosted-pool-e2e-20260927` fixture repository. The account-options presenter now also refuses `unavailable` catalog fallback specifically for NVIDIA, aligning it with Gateway's strict no-anchor behavior; test verifies that a model cannot be selected or probed without native model authority.
3. **Visual UX qualification in progress.** A test-only Gateway NVIDIA catalogue and [Playwright screenshot workflow in PR #854](https://github.com/777genius/review-router-ai/pull/854) exercise the real Review Router dashboard picker at widths 390/900/1440 in light/dark. This does not use a provider key or issue inference. Wait for the full screenshot manifest and review its output before accepting.
4. **Third, distinct hosted-model diagnostic.** A single bounded trial canary for the documented free `mistralai/mistral-nemotron` endpoint is queued in the disposable private sandbox. Its purpose is to distinguish generic NVIDIA inference entitlement/connectivity from a simultaneous DeepSeek/GLM issue; it is *not* an automatic fallback and does not change the two-model provider allowlist. Do not repeat either prior ambiguous 75-second model request. Confirm a 200 Chat result before asking NVIDIA to certify actual tool replay. Relevant vendor discussions: [Personal org Public API Endpoints issue](https://forums.developer.nvidia.com/t/public-api-endpoints-enabled-but-chat-completions-times-out-with-0-bytes-received/384673) and [same two-model timeout](https://forums.developer.nvidia.com/t/chat-completions-hangs-for-deepseek-v4-1-flash-and-glm-5-3-flash-get-v1-models-works/388228).

**Merge threshold unchanged:** all native/Gateway/RR CI, genuine provider output and tools/2-turn canary, visual UX and synthetic App-first review must be proven. No production deploy, no paid use, no private/customer code.

### Implementation and E2E evidence — 2026-11-11

Implementation is **in progress**, not merged or production activated. Separate dependency-ordered PRs:
- [Sub2API #94](https://github.com/agent-teams-ai/sub2api/pull/94): fixed NVIDIA Chat profile, reuse protected native Responses→Chat bridge, bounded static two-model policy, additive SQL migration 259, strict shared codec regression tests, and real PostgreSQL candidate creation.
- [Account Gateway #105](https://github.com/agent-teams-ai/account-gateway/pull/105): one trusted provider profile, source-owned API-key profile list, two-model account-source SDK contract and server-side account policy.
- [Review Router #854](https://github.com/777genius/review-router-ai/pull/854): independent NVIDIA Gateway display/selection identity, fail-closed model-catalog handling, no direct GitHub Secrets provider.

**Passed evidence, source-pinned**: [Gateway native PostgreSQL qualification run 42922347760](https://github.com/agent-teams-ai/account-gateway/actions/runs/42922347760) checked out Sub2API PR #94 SHA `282352f3c5009e2b30ebfab0c0f602998eb26fa1`, passed Go 1.27.3 NVIDIA/static/strict-Responses tests, native regressions, PostgreSQL 17 and real private HTTP managed-account birth using a synthetic key. Subsequent native change was formatting-only. Gateway Checkpoint A, Checkpoint B and full-stack E2E also previously passed on the functional candidate (their actual SHA and run IDs must be checked before final qualification).

**Not yet proven**: a live NVIDIA Build request, actual tool calling/2-turn continuation, production-compatible data terms, exact-head three-repository CI, installed pinned SDK + ReviewRouter browser/PR E2E, or release. The SDK candidate was built and artifact SHA-256 checked; its controlled import into Review Router awaits CI. The GitHub secret `NVIDIA_API_KEY` is not confirmed provisioned in the private disposable sandbox. Never infer a test from a supplied chat credential.

**Critical E2E stop gate**: both NVIDIA models currently advertise `tools: none` **until a real synthetic tool-call canary proves tool semantics**; Review Router therefore must keep tool-dependent reviewer selection disabled. Do **not** flip this to `function` just to turn an E2E green. Once proven, update the same native model source and Gateway capabilities + tests; rerun full synthetic App-first review. The feature is not complete until this gap is closed.

**Production stop remains absolute.** No customer/private project diffs to NVIDIA trial, no production deployment, no auto-fallback, and no merge that implies an unsupported fully agentic reviewer.

**Owner decisions (2026-11-10–11):** free NVIDIA Build sandbox, synthetic nonconfidential PRs only. User additionally authorized proceeding through planned engineering and E2E in all three repositories **without production deploy**. An ephemeral test key was supplied in chat, **not installed as GitHub Actions Secret**; do not reproduce it, embed it in any repository, test/log/issue, or forward it to any unrelated tool. Treat chat-shared credential as exposed and rotate after sandbox qualification. GitHub connection here does **not** offer Actions secret management and the current runtime cannot reach external API endpoints, therefore **live provider E2E remains unrun until the secret is securely installed in an isolated test repository by the owner**. Permission to implement != proof that live API or final PR acceptance is complete.

**Recommend a Gateway-first, independently qualified NVIDIA API-key connection using the existing accounts and execution stack.** Reuse ReviewRouter Providers/Connections UX and workspace/model policies, Account Gateway ownership and SDK, and Sub2API native custody, rate-limit observations, durable request effects and protected execution. **Do not assume Chat translation is required:** first prove whether these exact NVIDIA-hosted models support a working OpenAI Responses endpoint. If yes, reuse native Responses dispatch. If not, reuse the existing pure Responses ↔ Chat codec inside the protected native execution path, **not** an independent provider client.

**Do not** add a parallel account system, a generic arbitrary-base-URL proxy, a second quota scheduler, a new public secret store, a new feature flag, or implicit NVIDIA/OpenRouter failover. No operational action is authorized by this proposal. **New source finding:** the native-owned **historical Chat bridge already exists**, so extract/reuse that protected path instead of implementing a second Chat executor.

The free NVIDIA API trial is **not** a safe production default: NVIDIA's API Trial Terms constrain it to evaluation/development, restrict confidential and personal data, and permit described content processing. Do not send private or customer PR diffs to a trial endpoint. A distinct paid, contractually permitted production profile would need independent legal/security approval and qualification.

## Architecture refinement — one provider descriptor, two wire formats, no second account engine

The product expectation is right: OpenAI-compatible providers should be easy to add. The existing account infrastructure is reusable; the **missing reusable seam is a small, finite upstream wire strategy and model-admission policy within native**, not another Account Gateway/ReviewRouter account framework.

**Separate three concerns that already have distinct owners:**

| Concern | Existing authority to reuse | NVIDIA-specific addition |
| --- | --- | --- |
| Provider/account identity and capabilities | Gateway `providerConnectionRegistry`; SDK `provider-connections/v1` | One qualified NVIDIA API-key profile, no new account type or table |
| Execution/custody/limits/UNKNOWN | Native Sub2API public Responses wire, protected transport and durable Gateway effects | Fixed upstream origin and proven wire strategy: `responses` if supported for exact model, otherwise `chat_completions` using existing pure codec |
| Review policy and UI | ReviewRouter Gateway account selection, bindings, model picker and App-first workflow | Show trusted NVIDIA profile returned by Gateway; do **not** create another hardcoded direct-key provider workflow |

**What is already consistent:** Gateway's provider registry already supports the `"openai-chat"` **protocol value**, but `providerConnectionDefinition.protocol` currently describes the **consumer/public profile protocol**. Do not change it to `openai-chat` just because NVIDIA upstream uses Chat: `ReviewRouter → Gateway → Sub2API` currently runs `openai-responses`. In native transport, resolve the upstream wire format from a trusted, fixed profile definition **after** authorization. A browser-supplied base URL, protocol or model list must never select execution behavior.

**Where current hardcoding remains (and why it matters):**
- [Gateway service-config.ts](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/service-config.ts) caps optional `providerProfiles` to three and explicitly enumerates Kimi/GLM/MiniMax. A new NVIDIA API-key profile currently cannot simply be added to the SDK registry and work automatically. Generalize **only this finite optional API-key profile registration** in a checked manner, not an arbitrary plugin endpoint.
- [Gateway facade.ts](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/facade.ts) starts each account with one immutable model anchor; [Gateway native-authority.ts](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/native-authority.ts) rejects any other requested model without account-model qualification. The SDK's [account-model discovery sources](https://github.com/agent-teams-ai/account-gateway/blob/main/packages/account-gateway/src/features/facade-client/contracts/index.ts) currently authorize **Codex/OpenRouter only**. Hence two NVIDIA models on one account need a **source-qualified static multi-model list**, reused through the existing admission/owner fences; no arbitrary UI allowlist.
- [Sub2API gatewaytransport/registry.go](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/gatewaytransport/registry.go) and [native identity dispatch](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_identity.go) independently verify exact profile, origin and model. Retain those independent checks: duplication of *security validation* across trust boundaries is intentional; duplication of account lifecycle, DTOs, provider dialogs or codecs is not.
- [ReviewRouter setup-provider.ts](../../apps/web/src/features/provider-setup/setup-provider.ts) currently enumerates known API key/subscription setup providers and treats only `"openai-responses"` as a Gateway candidate. For Gateway-backed connections, **consume trusted provider capability metadata** instead of hardcoding new vendor branches in every setup/identity component. Keep the existing finite GitHub Secrets provider list separate. The product should not inherit arbitrary unknown provider IDs from user labels.

**Small reusable design, not a generic plugin platform:** a finite native profile definition (profile ID, fixed endpoint, upstream wire, bounded model policy and validated capabilities), **the already implemented protected Chat bridge** when needed, and one qualified connection in Gateway. Extract shared code only where NVIDIA demonstrates an actual duplicate branch; avoid broad provider rewrites, migration, new scheduler, dynamic endpoint registry or feature flags. Do not add a mandatory `QualifiedUpstreamProfile` framework/abstraction if a small existing registry extension suffices.

**Provider bootstrap should reject unknown/unsupported tuples.** Some NIM **self-hosted** backends document `POST /v1/responses`; this does **not** establish support for both selected **NVIDIA Build-hosted** models. The specific hosted endpoint is a **P0 two-model spike**, not an architectural assumption: [NVIDIA NIM self-hosted API reference](https://docs.nvidia.com/nim/large-language-models/latest/function-calling.html) versus [hosted NIM API catalog](https://docs.api.nvidia.com/nim/reference/llm-apis).

## 1. Current findings, checked against source

### ReviewRouter: reuse the existing product and authorization seams

- The [provider connection architecture](../architecture/62-provider-connection-architecture.md) already calls for Gateway-owned qualified profiles, Sub2API custody, product-owned access controls, and no parallel account framework. It expressly separates *provider identity*, *qualified profile*, and *selected model*.
- [Connections UX](../product/10-provider-connections-ux.md) already separates **Review providers** (saved connection/model and defaults), **Connections** (accounts and rights), and **Review settings**. The existing dialog and access decisions must be reused.
- [Provider setup](../../apps/web/src/features/provider-setup/setup-provider.ts) derives Gateway candidates from capability-qualified account profiles. Adding only a display label must not imply account access or a working model.
- [WorkspaceProviderProfile](../../packages/features/review-config/src/domain/workspace-provider-profile.ts) already binds a distinct Gateway connection/profile to a model. NVIDIA does not require a parallel account table or a new policy document.
- [Direct API-key catalog](../../packages/features/review-providers/src/infrastructure/protocol/api-key-providers.ts), [direct protocol descriptors](../../packages/shared/src/review-action-companion-contracts.ts), and [workflow transport](../../packages/features/workflow-provisioning/src/domain/workflow-transport.ts) are a separate, finite **GitHub Secrets / provider_api** lane. It currently assumes known Responses URLs. It is deliberately **out of scope** for the first NVIDIA slice; adding a secret name alone is not a functioning integration.
- The approved [provider transport scope](../operations/provider-transport-scope.md) requires explicit Account Gateway execution and no hidden fallback. Existing GitHub App-first publication and OIDC workflow pins must remain unchanged.

### Account Gateway: the account layer already exists

- [Provider registry](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/provider-connections.ts) is the one trusted map of provider identity, fixed profile, known endpoint, advertised auth methods, model capabilities and connection availability. NVIDIA is **not present** and must be independently named, not represented as OpenRouter, GLM Coding Plan or a user-editable endpoint.
- [Service configuration](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/service-config.ts) already composes explicit qualified API-key profiles and immutable enrollment anchors.
- [Account management](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/account-management.ts), [native candidate client](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/native-client-accounts.ts), and [SDK account-model reading](https://github.com/agent-teams-ai/account-gateway/blob/main/packages/account-gateway/README.md) cover ownership, encrypted custody handoff, generation/revision fences, model reads, safe account scope and lifecycle. Reuse, do not duplicate.
- [Gateway engineering rules](https://github.com/agent-teams-ai/account-gateway/blob/main/AGENTS.md) make **Sub2API the only owner of upstream quota, rate-limit, cooldown and scheduling**, and forbid blind retries of ambiguous provider effects.
- The existing capability projection has an OpenRouter-specific dynamic-catalog path: [provider-connection-capabilities.ts](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/provider-connection-capabilities.ts). NVIDIA is not automatically qualified for dynamic discovery or tools by choosing an OpenAI-compatible API shape.

### Sub2API: reusable codec exists, protected NVIDIA dispatch does not

- [Native profile registry](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/gatewaytransport/registry.go) and [native bootstrap](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/gatewaybootstrap/config.go) have fixed, bounded, independently validated profiles. Existing **CodingPlans** are an explicitly capped subscription family, not a generic NVIDIA API-key slot.
- [Public native ingress](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/gatewaytransport/public.go) already exposes a protected **/v1/responses** consumer wire using execution capabilities. Retain that consumer-facing wire for ReviewRouter.
- [Native Responses transport](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_responses.go) currently constructs upstream Responses URLs and forwards qualified Responses requests. It provides guarded credential entry, cancellation, bounded output, terminal evidence and UNKNOWN-effect semantics.
- **Important refinement after inspecting the full call chain:** the [Responses-to-Chat fallback](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/openai_gateway_responses_chat_fallback.go) is **already used from within protected** [`ForwardGatewayRoute`](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_identity.go) for the historical `GatewayLegacyBridgeProfile`. [`sendCCUpstreamRequest`](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/openai_gateway_cc_pipeline.go) preserves the native context for managed accounts and converts network errors to UNKNOWN; [`checkGatewayNativeDispatch`](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_identity.go) revalidates exact target/account, decrypts only at entry and uses a one-entry CAS. The [legacy strict validator](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_legacy_validation.go) checks finish reasons and tool identities. **Reuse this existing protected path** if hosted NVIDIA needs Chat, with NVIDIA-specific fixed route and pre-entry capability admission. Do not invoke the ordinary unqualified admin/stock account path or fork this bridge just to rename the provider. The historical bridge is not yet an approved standalone NVIDIA profile and must still pass all negative/lifecycle tests.
- [Provider validation](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_provider_responses.go) is conservative: text, bounded tools, explicit stream, service tier and reasoning constraints. An NVIDIA-specific allowlist must be validated before physical entry.
- [Native account models](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_account_models.go) currently qualify Codex and OpenRouter discovery; a NVIDIA live catalog is not automatically valid or an API access entitlement.
- [Sub2API issue #85](https://github.com/agent-teams-ai/sub2api/issues/85) documents an OpenRouter multi-turn/history-replay refusal surfaced as a 502. **The issue is closed as completed (2026-10-31); that is not a certification of NVIDIA's Chat codec.** Reuse the repaired behavior and its regression fixture, rather than reopening or copying an already fixed bug. NVIDIA E2E must explicitly cover replay of tool/reasoning/history items; no assumptions from a simple hello-world test.

## 2. NVIDIA public API and eligibility evidence

- NVIDIA Build hosted samples expose OpenAI-compatible **POST /v1/chat/completions**, base URL **https://integrate.api.nvidia.com/v1** and Bearer API keys. Some **self-hosted** NVIDIA NIM implementations also document **POST /v1/responses**; endpoint support must be checked **for each exact hosted model** rather than inferred from the NIM server's feature table. References: [hosted API catalog](https://docs.api.nvidia.com/nim/reference/llm-apis), [NIM self-hosted reference](https://docs.nvidia.com/nim/large-language-models/latest/function-calling.html).
- Candidate A: [DeepSeek V4.1 Flash on NVIDIA](https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash), documented model ID **`deepseek-ai/deepseek-v4.1-flash`** ([model API reference](https://docs.api.nvidia.com/nim/reference/nvidia-deepseek-v4_1-flash-infer)). Candidate B: [GLM 5.3 Flash on NVIDIA](https://build.nvidia.com/z-ai/glm-5-3-flash), documented model ID **`z-ai/glm-5.3-flash`** ([sample client](https://build.nvidia.com/z-ai/glm-5-3-flash/build)). Per-model tool/stream/schema/Responses support and live account authorization must be proved, not inferred from marketing badges.
- Candidate C: [Kimi K3.1 Pro on NVIDIA](https://build.nvidia.com/moonshotai/kimi-k3_1-pro) is **preview/playground only as currently advertised**, not a callable API model; **do not display it as executable** until NVIDIA publishes actual working programmatic API access.
- [NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf): **§1.2/§1.4** restrict trial use to internal evaluation/nonproduction; **§2.6(a)** bars confidential/sensitive/personal data (unless expressly permitted); **§3.3** allows processing User Content and Generated Content for service/model improvement; **§4.12** may require competition/use-case review. A production paid/partner offering has its own separate terms. These require legal/security review before any real user PR body is sent.
- A universal guaranteed free daily request quota was **not established**. Rate-per-minute anecdotes and trial credits are not an API contract. Do **not** promise “more free requests than OpenRouter,” invent a daily capacity or implement evasion/rotation. Native should expose only account-specific, observed authoritative dimensions; otherwise show **Unknown**.

### Contract-first wire decision

Keep **ReviewRouter/SDK → /v1/responses** as is. Two native strategies, chosen by **qualified model and fixed upstream profile**, not runtime user configuration:
1. **Native Responses first:** if a controlled synthetic probe confirms that the exact hosted NVIDIA model accepts `/v1/responses` with our required tools/stream/replay, use existing Responses path unchanged except its fixed provider policy/endpoint and model admission.
2. **Existing protected Chat bridge:** otherwise strictly validate Responses input **before entry** and extend the historical `GatewayLegacyBridgeProfile` execution branch to accept a separate **qualified NVIDIA profile**, while keeping native account/host/dispatch checks. The current bridge already uses pure `apicompat` conversion, strict terminal/tool checks and UNKNOWN semantics; **reuse instead of clone**. Re-prove SSE terminal, schema/tool fidelity, history, quota and usage specifically for NVIDIA. A model unable to support required semantics is unsupported, not silently downgraded.
3. Real upstream 429 and documented rate metadata → existing native busy/cooldown/usage mechanisms (no new quota scheduler).
4. Provider timeout/disconnect/ambiguous write → existing durable **UNKNOWN**, no new attempt and no implicit fallback.

Conversion must preserve prompt history, call IDs, tool schemas and output schema semantics that are actually supported. Unsupported features must fail **before** native upstream entry. A response “completed” is not enough to prove correct code review; the actual ReviewRouter findings schema and GitHub App evidence must also pass. If the codec cannot preserve required agentic semantics, stop qualification instead of weakening validator or faking tool support.

## 3. Options evaluated

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| A. New direct NVIDIA provider in ReviewRouter/GitHub Secrets | Independent key in GitHub CI | Duplicates provider entry, workflow descriptors, execution/protocol path; no account sharing/limits in Gateway; wrong first layer for the request | **Not first** |
| **B. Add qualified NVIDIA profile in Account Gateway + native Sub2API** | Existing encrypted accounts, distinct connection, model selection, usage, owner/workspace access, E2E route | Native model admission and conditional guarded Chat conversion if Responses is absent, source-pinned release | **Recommended** |
| C. Select NVIDIA-branded models through existing OpenRouter account | No new provider integration | OpenRouter credits/limits/terms; **not** a separate NVIDIA account; different upstream routing | **Does not meet goal** |
| D. Generic URL / arbitrary vendor proxy in Gateway | Potential future extensibility | Host escape/SSRF, model/protocol ambiguity, custody/qualification bypass, unnecessary abstractions | **Reject** |

## 4. Target architecture and behavior

    ReviewRouter (existing Providers / Connections UX)
      ├─ selected provider = NVIDIA Build; independent owned connection
      ├─ model = qualified actual NVIDIA model (not marketing catalog)
      └─ Gateway binding / workspace rights / existing review policy
           ↓ existing server SDK, OIDC/admission
    Account Gateway (existing account, encrypted credential, model/limit capability)
      └─ fixed profile = nvidia-build-chat-apikey-v1
           ↓ fixed provider identifier + immutable native qualification
    Sub2API native (existing owner of one-entry, credits/cooldowns, cancellations)
      ├─ strict model and Responses admission
      ├─ verified upstream /responses (if supported by exact hosted model)
      ├─ OR protected pure Responses↔Chat conversion
      └─ existing usage/terminal/cancel/UNKNOWN, no secret leakage
           ↓ fixed qualified host and model
    https://integrate.api.nvidia.com/v1/{responses | chat/completions}

**Account isolation:** An NVIDIA key belongs to its exact owner/account/physical generation and cannot be silently recycled as an OpenRouter key. UI access must pass existing personal ownership, explicit workspace binding, authorizations, and lease/revision checks.

**Credential storage:** Retain Gateway → native encrypted key custody, write-only submission, rotation via existing replace/re-enrollment lifecycle and one native authority boundary. No cleartext key in ReviewRouter DB, browser reads, CI logs, review artifacts, event payloads or unbounded diagnostics.

**Model selection:** initial explicit bounded allowlist, with each model independently certified for the actual review feature. Do not claim multimodal, 1M context, tool use or JSON Schema adherence merely because catalog describes it. Dynamic NVIDIA *upstream fetching* is a separate follow-up only if its source and account entitlement can be strictly validated.

**Critical two-model account detail:** current native [account models reader](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_account_models.go) returns qualified model snapshots only for Codex OAuth and OpenRouter; other fixed profiles rely on their single immutable birth-model anchor. Merely adding two models in the UI catalog would either reject the second or bypass admission. For one NVIDIA account selecting DeepSeek **and** GLM, extend the **existing** account-scoped model authority with an independently typed, fixed static NVIDIA snapshot (model IDs/capability truth, physical generation, owner/principal version, valid observation/source); independently validate the same set again at native dispatch. The static allowlist is qualified source configuration, **not** a fresh network catalog or entitlement claim. If that cannot safely fit existing admission contracts, the P0 stopgap is one certified anchor/model only, not duplicate accounts or an arbitrary dynamic-catalog bypass. Confirm two-model capability against real API eligibility during the owner-gated canary.

**UX:** reuse existing provider-first enrollment and Connections/Review providers distinction. Display “NVIDIA Build (API key)” separately from OpenRouter and direct vendor GLM/Kimi accounts. Expose **free trial / evaluation only**, limitations and account quota as **Unknown** until observed. Do not offer trial execution for confidential/customer/private PRs. Keep default account unchanged; explicit user action selects NVIDIA. No auto-fallback or multi-account quota pooling.

## 5. Proposed implementation slices (separate, dependency-ordered PRs AFTER owner approval)

### P0 — contract and sandbox spike (no production state)

- Lock down NVIDIA model IDs and exact request/response/stream behavior with redacted official examples or an explicitly owner-authorized, disposable API key. **Before writing a Chat bridge, test whether each selected hosted model actually supports /v1/responses with a sufficient subset of our tool/stream requirements.** Verify 200/400/401/429/stream and finish semantics; replay function results and a 2-turn code-review prompt.
- **Approved scope:** free trial testing only with self-contained synthetic prompts and a dedicated disposable private GitHub fixture. Never send private/customer repo code, PR diffs, screenshots, account metadata or other confidential content to NVIDIA. The private status of a sandbox GitHub repository does **not** make private business source eligible for trial.
- Only where hosted Responses fails or lacks capabilities, prove existing pure codec fitness: Responses→Chat (instructions, messages, tool schema, functions, strict JSON) and Chat→Responses (stream chunks, usage, terminal state). Negative fixtures must reject unsupported client features pre-entry. Do **not** spend effort creating a bridge when an existing qualified Responses path works.
- Record upstream headers/error evidence without response content, bearer tokens, private source, or traceable prompts; capture precise capabilities, not guessed.

**Exit:** explicit protocol and legal matrix; if required code review behaviors are unsupported, return a no-go.

### P0 key onboarding and exact controlled smoke contract

- Owner generates a **NVIDIA Build Endpoints** API key using [Build Settings → API Keys](https://build.nvidia.com/settings/api-keys) (NVIDIA account login / phone verification if required). Do not confuse it with the NGC registry/download key.
- **Never paste key into this PR, ChatGPT chat, source code, an issue, logs or CLI command history.** Use a *repository-scoped* GitHub Actions secret named `NVIDIA_API_KEY` in the private disposable sandbox; not a ReviewRouter production repo/org secret. GitHub UI: Settings → Secrets and variables → Actions → New repository secret. Local alternative: `gh secret set NVIDIA_API_KEY --repo OWNER/DISPOSABLE-REPO` (interactive input). Only the owner can do this; GitHub keeps values unreadable in the API.
- **Prepared sandbox (2026-11-10; security tightening 2026-11-11):** [`777genius/rr-hosted-pool-e2e-20260927`](https://github.com/777genius/rr-hosted-pool-e2e-20260927) — existing **private, unarchived** disposable RR fixture. Its GitHub Actions [manual/specific-push smoke workflow](https://github.com/777genius/rr-hosted-pool-e2e-20260927/blob/main/.github/workflows/nvidia-build-sandbox-probe.yml) was created as commit [`7c9d6c9`](https://github.com/777genius/rr-hosted-pool-e2e-20260927/commit/7c9d6c990820133b8cdc324ab000fada8297a548). Before this workflow, repository had **no workflows and no open PRs**; current repo scopes/collaborators must still be checked before pasting any secret. No key exists in committed files and no provider run was launched. Add the key via [sandbox Actions secrets settings](https://github.com/777genius/rr-hosted-pool-e2e-20260927/settings/secrets/actions) with name `NVIDIA_API_KEY` (or interactive `gh secret set NVIDIA_API_KEY --repo 777genius/rr-hosted-pool-e2e-20260927`). **Only report “secret installed,” never the raw key.** Once owner confirms the secret, trigger only the checked-in controlled workflow (GitHub Actions manually or a single permitted change to `.github/nvidia-sandbox-trigger.txt` in this fixture).
- Probe process is a **manual-trigger/sandbox-only** GitHub Actions workflow, `permissions: contents: read` (or none if no checkout), **no pull_request_target**, no third-party actions, no workflow reuse, no environment dumping, and no account/provider token prints. Hardcode `https://integrate.api.nvidia.com/v1`, only the two proposed exact model IDs and fixed synthetic prompts. No editable external endpoint argument and **no automatic retry**.
- Phase 1, no key: static source/contract checks and synthetic fixtures for existing native `/responses` and managed `Responses→Chat` bridge; mark **fixture-only, not actual provider capability proof**.
- Phase 2, after secret set: at most **four tiny requests** in one manually authorized run, for each of two models try (1) `/chat/completions` as documented and (2) `/responses` only to discover actual hosted-model support. Use small output budgets and timeouts, no file/repository data; do not assume an HTTP 404/405/400 proves an account's daily quota. Never repeat failed/ambiguous dispatches. Optionally attempt a short function/tool + two-turn synthetic replay in a *separate explicitly bounded* run only after successful Phase 2 and quota/account eligibility confirmation.
- Evidence: record only **status code, endpoint kind, model ID, elapsed bucket, safe typed error class, observed rate-limit headers/Retry-After where present, proof of complete response/stream/tool shape, and artifact/test commit SHA**. Never persist request/response bodies, credentials or raw upstream error messages; a 200 alone is not E2E approval.
- Abort on auth error, rate-limit or trial ineligibility. After the spike, owner deletes or rotates the repository-scoped secret (GitHub Actions → secret Delete; or `gh secret delete NVIDIA_API_KEY --repo OWNER/DISPOSABLE-REPO`). Do not recycle a trial credential for production.
- **Go/no-go:** if hosted `/responses` passes the full relevant synthetic contract use existing native Responses transport; otherwise qualify existing protected Chat bridge. If neither preserves tool/history/terminal semantics, stop P1–P4 rather than implementing lossy compatibility.

This onboarding does not request that the owner share the secret value in chat. A confirmation that `NVIDIA_API_KEY` is installed in the selected disposable repository is sufficient to start a permitted controlled smoke.

### Pre-implementation critical review (2026-11-11): corrected failure assumptions and priorities

1. **Observed reuse is stronger than first proposed.** Source `native_gateway_identity.go:ForwardGatewayRoute` already invokes the protected historical `forwardResponsesViaRawChatCompletions` for its legacy bridge. `openai_gateway_cc_pipeline.go:sendCCUpstreamRequest` retains native context and `checkGatewayNativeDispatch` enforces exact target/credential/one-entry. Do **not** implement a second Chat HTTP pipeline. Create a **separate NVIDIA-qualified profile** and reuse the already protected route; the historical MiMo profile is not itself a NVIDIA credential identity.
2. **Response route is distinct from upstream wire.** Gateway's public `openai-responses` remains unchanged; choosing `openai-chat` in its public profile would incorrectly change current admission. Official **hosted** NVIDIA model APIs document Chat Completions; self-hosted NIM Responses support does not guarantee the cloud path. A single permitted API compatibility probe may decide if the native Responses path suffices, but should not become a runtime auto-fallback or endpoint scanner.
3. **Multiple models are a real admission problem.** Gateway `facade.ts` currently requires **one immutable enrollment anchor** per profile, and both facade/native-authority use `configuredAccountModelSource` (currently Codex/OpenRouter). Native `ForwardGatewayRoute` currently permits a model different from the anchor **only for OpenRouter**, and `checkGatewayNativeDispatch` rechecks it under lock. NVIDIA model choice must extend the *same existing* source/fenced model-selection boundary; a UI-only list is unsafe.
4. **Provider list is mostly metadata, not a plug-in system.** Gateway `service-config.ts:captureServiceProfiles` hardcodes three optional API-key profiles and a max-three limit. Extend the bounded trusted profile registration, preserving exact server-defined host/model IDs and native revalidation; do not expose user-controlled endpoint URLs.
5. **ReviewRouter retains its account-layer responsibilities.** Its current `setup-provider.ts` disambiguates direct GitHub Secrets from Gateway sources, but hardcodes several vendor identities. Use trusted Gateway-projected capabilities for the new Gateway account option; do not create new direct provider secrets, dual account records, or duplicate model selection.
6. **Strict protocol tests before merge:** SSE tool-call identity and finish, deepseek-style reasoning replay, 429/401, cancellation, unknown-effect monotonicity, max-byte output, fixed URL/redirect denial, separate NVIDIA vs OpenRouter account and second-model dispatch, actual App-authored review with exact SHA, and evidence redaction. A simple 200 / one-step response isn't sufficient.
7. **Trial eligibility:** NVIDIA terms bar production and confidential/personal content and restrict competitive use; only bounded synthetic text tests are currently authorized. Legal clearance for production is expressly out of scope.
8. **Existing P0 workflow security:** the prior push/sentinel trigger was removed; synthetic probe is manual-only on main and does not checkout repository code. It has a hard cap of four API calls, no retries, no raw provider bodies in output. It is **not** a full ReviewRouter E2E.
9. **No extra abstraction until measured:** extracting a generic `ProviderEngine` / `ModelPolicyPlugin` now would duplicate the existing trusted registry. Prefer the smallest finite config change and reuse existing Go codec/admission; test a second synthetic same-wire provider fixture to verify future extensibility without adding an engine framework.

**Review result:** direct-new-client architecture REJECTED; existing protected Chat path REUSED; generic dynamic endpoints REJECTED; broad migration REJECTED; native multi-model authorization REQUIRED. **Risk:** 6/10 implementation, 8/10 premature production exposure. Full CI and live synthetic provider E2E remain mandatory before non-draft merge. The user authorized implementation and sandbox E2E, not production deployment.

### P1 — Sub2API native source (separate PR in agent-teams-ai/sub2api)

- Add a **fixed and optional NVIDIA API-key qualified profile** in existing native registry/bootstrap, not a generic URL or another Coding Plan. Pin host, auth, model anchors, modality and bounded request/response limits.
- **Prefer existing native Responses dispatch if P0 proves exact hosted-model compatibility.** Otherwise **reuse the historical protected native Chat bridge** already called by `ForwardGatewayRoute`, extending its finite profile selection to NVIDIA and confirming pre-entry validation, fixed target, keyed model selection, call IDs, tool history, terminal evidence, cancellation, 429, usage and UNKNOWN effect. No separate Chat HTTP client, duplicate event pipeline or copied ordinary retry loop.
- Reuse existing native management/custody, 429/cooldown scheduling and usage observation. New observability only safe closed-vocabulary categories and actually supported reset metadata.
- Add fixed account-scoped NVIDIA model authority through the existing native models reader, with source identity, physical-generation/principal fences and per-model capabilities, **or** keep the v1 scope to a single certified birth anchor. Do not silently treat unknown model discovery as confirmation; replay known #85 regression fixtures.
- Extend source/DB allowlists only where truly required after inspection; **no speculative DB migrations**. Preserve retained receipts and source pin.
- Test authentication scope, immutable generation, outbound hostname, 401/403/429, partial SSE, cancellation, UNKNOWN effect, duplicate callback, tool/history replay, output cap and malformed usage. Normal OpenRouter/Codex/Kimi/GLM routes remain unchanged.
- Do **not** bypass native qualification through ordinary Sub2API admin proxy, auto-retry, or arbitrary customer-set upstream URL.

**Exit:** isolated native fixtures + PostgreSQL lifecycle as applicable, exact source and negative test receipts, review of source pin.

### P2 — Account Gateway profile + SDK (separate PR in agent-teams-ai/account-gateway)

- Add finite **nvidia** provider identity/profile in the one trusted provider registry, fixed native endpoint/profile tuple, API-key-only connection and reconnect capability. Generalize the existing finite optional API-key profile list (currently hardcoded Kimi/GLM/MiniMax) **only enough** to add future independently-qualified API-key profiles as data; keep separate native validation, fixed origins and policy fences.
- Reuse existing account creation, replacement, owner sharing, lifecycle, projections, OIDC/capability admission and usage. No duplicate account types or token database.
- Project only proven model IDs/controls. Start with bounded static qualified models via an explicit **NVIDIA account-model source** in the SDK's finite discovery mapping and existing native account-model contract. Without that source, select one immutable anchor only. Model-list **network refresh** is later and must not be confused with a signed/configured static snapshot. Never invent function calls, reasoning efforts, price or quota.
- Reuse native Source-of-Truth 429/limit results; do not add retry, cooldown or account selector to TS. Revalidate owner, binding, generation and credential epoch before/after async reads.
- Pin compatible native Sub2API SHA and SDK contract consumer; extend narrow schema unions only when required. Unit, integration and multi-account wrong-key/wrong-workspace cross-tenant tests.

**Exit:** exact native/Gateway/SDK source pin, account isolation E2E, quotas/unsupported correctly represented.

### P3 — ReviewRouter thin UX/policy adoption (separate PR in 777genius/review-router-ai)

- Reuse current Gateway capability projection and existing account dialog, add NVIDIA identity/logo and select a model only after Gateway confirms qualified availability. Replace the unnecessary Gateway-backed vendor branch in the setup picker with a **trusted capability-driven choice**: new API-key Gateway profiles should not require duplicate additions to the direct GitHub Secrets catalog and the provider UI. Keep native/SDK allowlists and visual identity mappings finite.
- Reuse existing WorkspaceProviderProfile gateway binding and provider policy; keep existing OpenRouter, CLI Direct API-key and workflow pins intact. No second scheduler or direct NVIDIA GitHub Secret in P3.
- Show restrictive trial eligibility notice and prevent unapproved private/customer repo review to trial endpoints. Do not advertise a model as executable just because NVIDIA catalog lists it.
- Preserve GitHub App-first publication, exact review head SHA, redaction, error mapping and immutable account usage evidence.
- Test new/replace/remove key, separate NVIDIA/OpenRouter accounts, workspace permissions, default profile, model change, no secret leaks, UI visual flow and inaccessible/unsupported selection handling.

**Exit:** genuine disposable public/synthetic PR with correct GitHub App-author review comments and evidence; no customer PR touched.

### P4 — qualification, activation, rollback (separate OWNER APPROVAL)

- Source-pin three coordinated PR heads and run unit/type/lint, service/native PostgreSQL and security checks, full UI browser E2E, then a disposable repository App-first CI E2E.
- Verify **head SHA consistency, authorship by configured GitHub App bot**, evidence-schema acceptance, multi-turn tool replay, denial before upstream for unsupported modalities, concurrent-account quota isolation, 429 handling and no fabricated daily limit.
- Test real account only with owner-authorized disposable key and allowed synthetic/public payloads; absent authorization = fixture-only evidence and **not** a live NVIDIA integration proof.
- Release across Sub2API → Gateway → SDK/ReviewRouter in dependency-safe order and use existing deployment task registry if code is later queued for deployment. Keep backup/rollback and durable UNKNOWN/usage evidence; stop new NVIDIA admissions on failure, never replay ambiguous effects.
- A production-grade NVIDIA paid endpoint needs a separately qualified fixed profile, verified terms, privacy/security/data handling and owner production rollout approval; **trial success does not imply production approval**.

## 6. Explicit owner approval gates — STOP HERE

- [x] **A — Architecture/scope:** Approved/implemented **Gateway-first only**, independent NVIDIA provider account, no direct GitHub Secrets/provider_api route in v1.
- [x] **B — Usage/legal (approved 2026-11-10):** **free evaluation in disposable sandbox with synthetic/nonconfidential data only**. No production deployment, customer/private repository source or production API key; any later real-code use requires permitted commercial terms and security/legal review.
- [x] **C — Models:** Qualified **Nemotron 3.5 Super VL 120B** as the sole v1 hosted candidate after real synthetic HTTP, streaming and tool replay PASS. DeepSeek/GLM timed out and are excluded, Kimi remains unqualified.
- [x] **D — Model catalog & capabilities:** One static qualified model, source-owned account model snapshot, tool calling backed by real hosted and protected native canaries; fixed URL, no invented quota, no dynamic generic provider model.
- [x] **E — Spike credential (completed owner action):** User will generate a **NVIDIA Build Endpoints** key and store it as a GitHub Actions **repository secret** `NVIDIA_API_KEY` at [`rr-hosted-pool-e2e-20260927` Actions secrets](https://github.com/777genius/rr-hosted-pool-e2e-20260927/settings/secrets/actions). The [sandbox protocol workflow](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/43007767383) and [protected native run](https://github.com/777genius/rr-hosted-pool-e2e-20260927/actions/runs/43008527694) completed successfully with the masked sandbox-only secret. Never put production keys or customer source in trial; rotate after qualification.
- [x] **F — Execution:** Owner authorized sandbox-only implementation. The three scoped PRs #94, #105, #854 exist and have actual CI/hosted synthetic proof; production deployment separately forbidden.
- [ ] **G — Activation:** Separate future approval for live canary, customer availability, production credentials/terms and deployment. Do not equate merge/green CI with a production enablement.

No gate is pre-approved by creating or merging this documentation PR.

## 7. Verification matrix

| Scenario | Expected result |
| --- | --- |
| Add NVIDIA account, reconnect, remove | Credential is write-only; exact owner/physical generation; stale revision rejected |
| Two different NVIDIA accounts + OpenRouter | Independent identity and quotas, no silent cross-routing, wrong binding denied |
| NVIDIA account selects qualified Nemotron; unsupported DeepSeek/GLM/model ID | Only exact certified Nemotron passes independently fenced model admission; others denied before upstream |
| 2+ turns, tool call + result, reasoning/replay, structured review output | Context/tool IDs preserved or rejected before entry; no lossy evidence or fake JSON certification |
| SSE malformed/incomplete, early close/cancel | No false successful completion, correct closure/UNKNOWN, no replay |
| Upstream 400/401/429/5xx | Typed safe failure; native cooldown only from confirmed evidence; no guessed reset or retry |
| Rate/usage metadata absent | “Unknown”, not 0 or unlimited; no arbitrary daily quota claim |
| Private/customer PR under trial terms | Ineligible trial route denied; no code leaves to NVIDIA |
| Real App-first disposable PR | Review points at exact SHA, bot authorship valid, findings match source and schema |
| Existing OpenRouter/Codex/Kimi/GLM | No behavior changes, CI and integration regressions pass |
| Rollback/disabled new NVIDIA traffic | Existing unknown effects/receipts persist, no duplicate upstream calls |

## 8. Engineering budget and explicit non-goals

**Revised estimate, including tests, provisional until exact-model P0:** if hosted **Responses works** with required tools/stream: approximately **800–1,800 changed LOC across all repositories** (complexity **4–5/10**); if the **existing protected Chat bridge** must be extended: approximately **1,200–2,600 LOC** (complexity **5–6/10**), potentially higher only if model-specific tool/reasoning replay needs real converter changes. A synthetic protocol spike can be about **100–300 LOC** of disposable fixtures/harness if existing utilities suffice. These are estimates, not verified diff sizes. The main work is model authority, negative/E2E evidence and cross-boundary qualification, not a new Chat HTTP client.

Three review passes conducted for this proposal:

1. **Architecture critique:** A direct ReviewRouter adapter would duplicate account, custody and scheduling responsibilities. Replaced with existing Gateway-first slice and explicit native profile.
2. **Security/protocol critique:** A simple base-URL change or reusing the ordinary Chat fallback would bypass strict private native guarantees. Required pure codec reuse behind one-entry native transport, bounded host and negative pre-entry tests.
3. **Product/E2E critique:** Catalog badges and free-tier anecdotes do not prove callable API, review-capable tools or daily quota; Kimi preview and confidential-data restrictions demand explicit “unsupported” UX and owner-gated sandbox acceptance. Closed issue #85 still warrants replay regression tests.
4. **Model admission critique:** A second model cannot be admitted on a single fixed-profile account solely by editing the UI catalog; native model membership currently handles only Codex/OpenRouter. Clarified the independent NVIDIA static account-model snapshot requirement and the one-anchor fail-closed fallback.
5. **Minimal-change/protocol critique:** The API is largely compatible but the hosted model may be Chat-only. Test Responses first; if not supported, **reuse the already existing managed native Chat bridge** and its strict result guards, not merely its lower-level codec. Keep a finite upstream wire strategy and trusted capability-driven UI. No generic provider plugin infrastructure, new account scheduler or speculative protocol translation.
6. **Protected-call-chain critique:** `ForwardGatewayRoute` selects the historical Chat bridge only after the protected credential context/locked physical candidate is established. The Chat upstream call keeps native request context, rechecks exact target and entry CAS and returns UNKNOWN after an ambiguous result. This reduces the intended implementation scope but does not independently certify NVIDIA streaming/tool/reasoning behavior.

### Maintainability success criteria (make the *next* provider cheaper)

- **Account lifecycle remains zero-new-implementations**: no new token tables, owner/binding use cases, quota scheduler, retry/backoff manager, UI account form or second audit journal in ReviewRouter/Gateway.
- **Finite provider configuration, not vendor code copies**: next fixed OpenAI-compatible API-key provider should require one Gateway connection definition, a corresponding qualified native profile tuple/allowed model set, visual identity mapping and tests. A new Go/TS HTTP pipeline should be required **only** for a genuinely new upstream protocol or behavior.
- **Shared protected protocol route**: both native Responses and already-owned protected Chat paths pass the same authorization, encrypted credential, physical generation/one-entry CAS, request effects, cancel, bounded outputs and readback tests. Neither path implements alternative account selection.
- **Model capability authority**: a second model on an existing NVIDIA account uses the current SDK/native account-model contract and independent admission, without UI-owned allowlists; simulated two-model/unknown-model tests demonstrate this.
- **Scope gate for refactoring**: refactor only directly touched duplicate cases and prove through tests that OpenRouter, Kimi, GLM, Codex and existing models are unchanged. Do not pre-build a universal plugin SDK, expose arbitrary URLs or perform a broad registry migration.
- **Future addition quality gate**: in an isolated synthetic provider fixture, the relevant transport and account tests should be reusable without changing their implementation. A real subsequent provider may still need a separate native qualifications and API eligibility proof. Target for a subsequent *same-wire, static-model* provider is **roughly 150–500 changed LOC including focused tests**, **not a guarantee** and not applicable to new OAuth/protocols.

**Non-goals in v1:** direct NVIDIA GitHub Secrets/T0 workflow, multi-provider quorum redesign, rotating free-trial keys to evade limits, generic arbitrary-provider proxy, duplicate quota scheduler, new DB/account framework, broad migrations, new feature flags, paid production activation, secret ingestion from old stores, or deploying any services in this docs PR.

## 9. Research/owner references

- [ReviewRouter connection architecture](../architecture/62-provider-connection-architecture.md)
- [ReviewRouter UX](../product/10-provider-connections-ux.md)
- [Gateway trusted connection registry](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/src/provider-connections.ts)
- [Gateway account/limits ownership rules](https://github.com/agent-teams-ai/account-gateway/blob/main/AGENTS.md)
- [Sub2API protected transport registry](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/gatewaytransport/registry.go)
- [Sub2API pure Chat fallback codec usage](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/openai_gateway_responses_chat_fallback.go)
- [Sub2API native execution](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/native_gateway_responses.go)
- [NVIDIA hosted LLM inference](https://docs.api.nvidia.com/nim/reference/llm-apis)
- [NVIDIA API trial terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
- [Known replay issue #85](https://github.com/agent-teams-ai/sub2api/issues/85)

**Stop condition for this PR:** Owner approvals A–F and the single-model synthetic live protocol qualification are recorded as completed; **G remains unapproved** for production/customer use. Do not imply an App-first review passed merely from unit, SDK or provider HTTP tests. Merge the scoped implementation only after full exact-head CI and independent code-review acceptance. No production deployment or use of private/customer source.
