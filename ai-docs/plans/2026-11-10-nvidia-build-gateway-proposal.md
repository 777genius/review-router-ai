# Proposal: NVIDIA Build as a separate ReviewRouter provider

**Status:** PROPOSED — discussion only; OWNER APPROVAL REQUIRED before implementation, credentials, production exposure, or deployment  
**Date:** 2026-11-10  
**Primary repository:** [ReviewRouter](https://github.com/777genius/review-router-ai)  
**Dependency owners:** [Account Gateway](https://github.com/agent-teams-ai/account-gateway) and [Sub2API native fork](https://github.com/agent-teams-ai/sub2api)  
**Intent:** An independent NVIDIA Build / NIM connection and account, not NVIDIA models hidden under an OpenRouter account.

## Executive decision

**Recommend a Gateway-first, independently qualified NVIDIA API-key connection using the existing accounts and execution stack.** Reuse ReviewRouter Providers/Connections UX and workspace/model policies, Account Gateway ownership and SDK, and Sub2API native custody, rate-limit observations, durable request effects and protected execution. **Do not assume Chat translation is required:** first prove whether these exact NVIDIA-hosted models support a working OpenAI Responses endpoint. If yes, reuse native Responses dispatch. If not, reuse the existing pure Responses ↔ Chat codec inside the protected native execution path, **not** an independent provider client.

**Do not** add a parallel account system, a generic arbitrary-base-URL proxy, a second quota scheduler, a new public secret store, a new feature flag, or implicit NVIDIA/OpenRouter failover. No operational action is authorized by this proposal.

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

**Small reusable design, not a generic plugin platform:** a fixed native `QualifiedUpstreamProfile` (profile ID, endpoint, upstream wire, bounded model policy and validated capabilities), a reusable proven `Responses/Chat` converter, and one qualified connection in Gateway. Extract shared code only in the specific hardcoded branches exercised by NVIDIA; avoid broad provider rewrites, migration, new scheduler, dynamic endpoint registry or feature flags.

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
- The ordinary [Responses-to-Chat fallback](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/service/openai_gateway_responses_chat_fallback.go) already uses pure **apicompat** request and stream codec functions, including tool conversion. **Reuse the pure conversion pieces only.** Do not call the stock forwarding path wholesale: ordinary retries, routing/account selection and logging are not the private native custody/one-dispatch contract.
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
2. **Protected Chat fallback:** otherwise strictly validate the Responses input **before entry**, then reuse existing pure `apicompat.ResponsesToChatCompletionsRequestWithOptions` and `ChatCompletionsToResponses` stream state inside a protected native transport, not the ordinary forwarding path. Validate SSE terminal, schema/tool fidelity, history and usage. A model unable to support required semantics is unsupported, not silently downgraded.
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
- Inspect license/trial restrictions and assign use only to synthetic/public disposable code; no existing customer/project source.
- Only where hosted Responses fails or lacks capabilities, prove existing pure codec fitness: Responses→Chat (instructions, messages, tool schema, functions, strict JSON) and Chat→Responses (stream chunks, usage, terminal state). Negative fixtures must reject unsupported client features pre-entry. Do **not** spend effort creating a bridge when an existing qualified Responses path works.
- Record upstream headers/error evidence without response content, bearer tokens, private source, or traceable prompts; capture precise capabilities, not guessed.

**Exit:** explicit protocol and legal matrix; if required code review behaviors are unsupported, return a no-go.

### P1 — Sub2API native source (separate PR in agent-teams-ai/sub2api)

- Add a **fixed and optional NVIDIA API-key qualified profile** in existing native registry/bootstrap, not a generic URL or another Coding Plan. Pin host, auth, model anchors, modality and bounded request/response limits.
- **Prefer existing native Responses dispatch if P0 proves exact hosted-model compatibility.** Otherwise reuse the pure `apicompat` Chat converter **behind the same protected native dispatch**, preserving call IDs, tool history, terminal evidence, cancellation and usage. Extract a small common `protected Chat upstream` path only if its behavior is demonstrably reusable; do not create a vendor-specific HTTP client or copy ordinary retry logic.
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

- [ ] **A — Architecture/scope:** Approve **Gateway-first only**, one new NVIDIA provider with independently owned account; no GitHub Secrets/direct route in v1.
- [ ] **B — Usage/legal:** Confirm that the initial use is **evaluation in a disposable sandbox on synthetic/nonconfidential code only**. Production/customer/private repository use is NOT approved by this plan and requires permitted commercial terms plus security/legal review.
- [ ] **C — Models:** Approve evaluating **DeepSeek V4.1 Flash and GLM 5.3 Flash** only when programmatic access and required review features are proven; **Kimi K3.1 Pro stays preview/unavailable** until an actual supported API exists.
- [ ] **D — Model catalog & capabilities:** Approve **small static qualified allowlist first**, no generic model URL, no dynamic catalog before evidence, no invented tool/quota capabilities.
- [ ] **E — Spike credential:** Explicit authorization and provision of a **disposable NVIDIA key** for permitted synthetic/public test requests when ready; otherwise fixtures only. Do not borrow or inspect existing production keys.
- [ ] **F — Execution:** Approve opening implementation PRs in Sub2API, Account Gateway and ReviewRouter **after** P0 evidence and a reviewed narrowed diff plan. The current draft PR changes documentation only.
- [ ] **G — Activation:** Separate future approval for live canary, customer availability, production credentials/terms and deployment. Do not equate merge/green CI with a production enablement.

No gate is pre-approved by creating or merging this documentation PR.

## 7. Verification matrix

| Scenario | Expected result |
| --- | --- |
| Add NVIDIA account, reconnect, remove | Credential is write-only; exact owner/physical generation; stale revision rejected |
| Two different NVIDIA accounts + OpenRouter | Independent identity and quotas, no silent cross-routing, wrong binding denied |
| Same NVIDIA account selects DeepSeek then GLM; unsupported model; Kimi preview | Both certified choices must pass independently fenced account-model admission; unavailable second model fails before upstream; preview remains unavailable |
| 2+ turns, tool call + result, reasoning/replay, structured review output | Context/tool IDs preserved or rejected before entry; no lossy evidence or fake JSON certification |
| SSE malformed/incomplete, early close/cancel | No false successful completion, correct closure/UNKNOWN, no replay |
| Upstream 400/401/429/5xx | Typed safe failure; native cooldown only from confirmed evidence; no guessed reset or retry |
| Rate/usage metadata absent | “Unknown”, not 0 or unlimited; no arbitrary daily quota claim |
| Private/customer PR under trial terms | Ineligible trial route denied; no code leaves to NVIDIA |
| Real App-first disposable PR | Review points at exact SHA, bot authorship valid, findings match source and schema |
| Existing OpenRouter/Codex/Kimi/GLM | No behavior changes, CI and integration regressions pass |
| Rollback/disabled new NVIDIA traffic | Existing unknown effects/receipts persist, no duplicate upstream calls |

## 8. Engineering budget and explicit non-goals

**Revised estimate, including tests, provisional until exact model P0:** if NVIDIA-hosted **Responses works** with our tools/stream: approximately **800–1,800 changed LOC across all repositories** (complexity **4–5/10**); if **protected Chat translation is required**: approximately **1,700–3,400 LOC** (complexity **6–7/10**). A small synthetic protocol spike is around **100–300 LOC** of disposable fixtures/harness if existing test utilities suffice. These are estimates, not verified diff sizes. The cost centre is model authority, end-to-end/negative evidence, codec correctness and three independent trust-boundary releases; merely adding a visual card is small.

Three review passes conducted for this proposal:

1. **Architecture critique:** A direct ReviewRouter adapter would duplicate account, custody and scheduling responsibilities. Replaced with existing Gateway-first slice and explicit native profile.
2. **Security/protocol critique:** A simple base-URL change or reusing the ordinary Chat fallback would bypass strict private native guarantees. Required pure codec reuse behind one-entry native transport, bounded host and negative pre-entry tests.
3. **Product/E2E critique:** Catalog badges and free-tier anecdotes do not prove callable API, review-capable tools or daily quota; Kimi preview and confidential-data restrictions demand explicit “unsupported” UX and owner-gated sandbox acceptance. Closed issue #85 still warrants replay regression tests.
4. **Model admission critique:** A second model cannot be admitted on a single fixed-profile account solely by editing the UI catalog; native model membership currently handles only Codex/OpenRouter. Clarified the independent NVIDIA static account-model snapshot requirement and the one-anchor fail-closed fallback.
5. **Minimal-change/protocol critique:** The API is largely compatible but the hosted model may be Chat-only. Test Responses first (potentially much smaller diff), use existing pure Chat codec only if necessary. Keep a finite upstream wire strategy and trusted capability-driven UI. No generic provider plugin infrastructure, new account scheduler or speculative protocol translation.

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

**Stop condition for this PR:** obtain recorded owner decisions A–F in PR review. Do not implement or deploy until those approvals; G requires fresh approval at activation time. **Open product question:** Is the first NVIDIA use case a disposable evaluation/synthetic test (compatible with trial constraints), or must it support real private/customer code immediately? The latter is a separate vendor/terms negotiation, not a safe trial launch.
