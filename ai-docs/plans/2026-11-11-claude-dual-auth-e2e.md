# Claude Code: subscription + API key, no duplicated execution

Date: 2026-11-11. Status: implementation plan; **not** an assertion of production support.
Owner scope: ReviewRouter SaaS, ReviewRouter Action, Account Gateway, pinned Sub2API fork.

## Outcome and explicit boundaries

Offer **one Claude Code provider identity** with separately labelled credential methods:
1. **Claude subscription in the user's CI**: unmodified official Claude Code binary, `CLAUDE_CODE_OAUTH_TOKEN` stored by the user in GitHub Actions Secrets; no upstream token in SaaS/Gateway.
2. **Anthropic API key in the user's CI**: same official Claude Code binary and ReviewRouter review pipeline, selected `ANTHROPIC_API_KEY` GitHub Actions Secret, and explicit mutually exclusive auth selection.
3. **Anthropic API key in ReviewRouter**: existing Account Gateway encrypted custody, binding, execution authorization and Sub2API's protected Messages/streaming transport after qualification of an **API-key profile**. No token in CI; checkout, tools, reviews and publication stay in the existing runtime.
The product may continue to display an existing Claude OAuth Gateway account for legacy/diagnostic reads, but MUST NOT offer third-party Claude.ai subscription login or token custody as a new customer path without explicit Anthropic authorization. An existing technical OAuth implementation does not grant permission.

No new CLI runner, secrets vault, provider scheduler, proxy, workflow publication mechanism, credentials table, generic provider framework, or feature flags. No production deployment, paid canary, owner secrets, or user project traffic in this task.

## Existing seams to reuse (verified source)

- Action `src/providers/claude-code.ts`: Claude CLI with sanitized env, stdin prompt, read-only tool policy and strict JSON review parsing.
- Action `src/providers/prepared-invocation.ts`: separated runtime and credential lease, immutable prepared invocation.
- Action `src/control-plane/provider-cli-plan.ts`: selects Claude binary from server-authorized execution policy.
- SaaS `apps/web/src/features/provider-setup/setup-provider.ts`, `provider-setup-model.ts` and `provider-setup-dialog.tsx`: one provider identity with source/storage choices.
- SaaS `packages/features/review-config/src/domain/workspace-provider-profile.ts` and `packages/features/review-providers/src/domain/provider-catalog.ts`: credential kind/auth mode validation; add only narrow explicit Anthropic API key variants if necessary.
- SaaS `apps/web/src/server/account-gateway-accounts.ts` and `account-connection-catalog.ts`: configured profile projection and exact gateway binding.
- Gateway `services/account-gateway/src/provider-connections.ts`: one canonical versioned profile tuple registry. `provider-connection-capabilities.ts`, `native-client-accounts.ts`: validated projection and native custody.
- Native `backend/internal/gatewaytransport/public.go`: already supports qualified `/v1/messages`, SSE, settlement and denial. Reuse authorization/tenant/credential generation fence, not OAuth token exchange for API keys.
- Gateway+native controlled E2E `services/account-gateway/test/native-claude-joined.ts`, `backend/internal/gatewaytransport/public_messages_test.go`: already cover a synthetic Claude-shaped provider. Extend profiles rather than adding new infrastructure.

## Critical implementation discovery: subscription runtime divergence

Source inspection shows two *different* existing Claude subscription consumers:

- `777genius/review-router/src/providers/claude-code.ts` uses the **unmodified official CLI** with a scoped process environment.
- `777genius/review-router/src/codex-oauth/subscription-model-runtime.ts` calls `prepareClaudeSubscriptionModelRoute` → `startRunnerLocalAnthropicModelTransport`. The latter uses `fetch('https://api.anthropic.com/v1/messages')` with a subscription OAuth bearer token and `anthropic-beta: oauth-2025-04-20`, instead of launching Claude CLI. The SaaS `renderReviewRouterClaudeSubscriptionCaller` and setup action can provision this prepared route. It is NOT evidence that subscription reviews are all using the official CLI.

**Mandatory before shipping:** stop provisioning the direct-OAuth-over-HTTP subscription path as a supported customer option; use the existing official CLI GitHub Secrets workflow. Preserve the protected model-dispatch route only if a separately authorized non-subscription credential/profile qualifies it. Do not expose prepared native Claude as subscription support based solely on synthetic fixtures. This must be proved with a negative integration test (the selected subscription path invokes the official CLI and does not send its token through `fetch` or Account Gateway). Any divergence between producer claims and installed workflow denies, never falls back.

This finding increases the scope of the existing subscription migration and therefore invalidates any assumption that simply setting `REVIEW_ROUTER_ACCOUNT_GATEWAY_CLAUDE_OAUTH_PROFILE_ID` finishes the integration.

## Ordered implementation

1. **Action (small, isolated PR)**: introduce an explicit `claude-api-key` runtime authorization mode sharing `ClaudeCodeProvider`. Capture selected mode before execution, inject **exactly one** of `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` into the sanitized child environment, isolate config, reject wrong/blank/command-shaped key before spawn, never log credentials or echo raw provider errors. Preserve existing OAuth semantics. Tests include both modes, both keys present, missing selected key, invalid value, prepared invocation and read-only agentic/fork behavior.
2. **Native and Gateway (paired bounded PRs)**: qualify official API-key Anthropic Messages on the existing protected gateway by adding one API-key profile, fixed origin, exact model, credential kind / account-owned custody and native response/tool semantics. Reuse existing profile/limits/usage/stream closure, no repeated converter. Run invalid credential, wrong profile/model, replay, ambiguous effect, revoke/refresh, stream/cancel and ownership tests.
3. **SaaS (one bounded PR)**: retire the prepared raw-OAuth HTTP subscription workflow as a customer enrollment path in favor of existing official CLI CI workflow, with verified review/verification capability and current release claims. Map the qualified Anthropic API-key profile to the same visible Claude Code identity; direct API key GitHub Secret route is distinct from subscription GitHub Secret route, and Gateway API-key storage appears only for a trusted qualified profile. Keep workspace/repository assignment, account enrollment continuation and model settings intact. No silent fallback between modes; no unqualified default. Central OAuth subscription option must not be advertised to customers.
4. **E2E**: use synthetic private CI repository, controlled local Anthropic Messages server and fake setup-token/API-key strings. Run the *real* compiled Action/CLI through both selected authentication modes and strict mock reply/failure cases; run native+Gateway+SaaS with isolated PostgreSQL and user-namespace checks; exercise workspace default, repository override, revocation, no-credentials state, model mismatch, empty result, nonterminal SSE, invalid JSON, rerun dedup and GitHub App publication against synthetic PR. Run visual browser/keyboard checks. Collect immutable exact HEAD/CI receipts. Do **not** call paid upstream or claim authenticated live Anthropic success.
5. **Release**: only after exact-source CI and review; production activation/rollout and a real-account canary require separate authorization. Update deployment registry with remaining gates; merge code does not deploy it.

## Acceptance constraints

- Single Claude Code visible provider, with explicit subscription vs API-key auth and GitHub Secrets vs ReviewRouter storage where *actually permitted*.
- No new cross-product credential copy; no secrets in action logs/URLs, SaaS DB, workflow outputs, saved route or environment snapshots.
- Official CLI used on CI for subscription/direct API key, not a reimplementation. The prepared subscription raw-OAuth HTTP path must not be newly provisioned or silently selected. Gateway mode uses one native transport; producer must actually qualify the agent/profile pair.
- Credential selection frozen on invocation; a wrong/missing credential **fails closed**. No silent downgrade to ambient auth / another provider / OAuth-to-API substitution.
- Offline E2E has a hard firewall/loopback-only upstream, explicit synthetic identity, and proves outputs through actual review publication. A fake response is *not* evidence of live account access.
- No migrations except if the existing closed credential/auth-mode DB constraints require additive changes; document them precisely before writing.
- Unit, TS typecheck, architecture, native Go tests, PostgreSQL, packaged E2E and visual UI PASS on the final source refs. PR review observations fixed before merge.

## Review rounds

- **Architectural round 1:** Reject a second Claude execution engine; same CLI for subscription/API key. Distinguish vendor, credential, transport, engine and repository binding.
- **Security round 2:** Reject central collection of Claude subscription OAuth; preserve explicit allowlisted credentials, no fallback on missing auth, no real keys in tests; no inference replay on unknown effect.

## Size estimate (additional work, not completion)

- Action explicit direct-key mode and tests: 180–450 LOC.
- Sub2API/Gateway API-key profile, native qualification and tests: 650–1,500 LOC.
- SaaS profile/mode/forms/workflows, DB-constraint adjustment if needed, UI and tests: 500–1,250 LOC.
- Synthetic cross-component E2E, docs and deployment entries: 350–850 LOC.
- Total ~1,680–4,050 changed LOC; revise after source-level spikes. Do not count already implemented Claude CLI, OAuth PKCE, DB custody or review worker again.

## Sources

- [Anthropic legal/compliance](https://code.claude.com/docs/en/legal-and-compliance): do not collect/intermediate subscription OAuth as an unauthorised third-party SaaS.
- [Official Claude Code Action setup](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md): two supported CI credentials.
- [ReviewRouter native Claude Gateway E2E](https://github.com/agent-teams-ai/account-gateway/blob/main/services/account-gateway/test/native-claude-joined.ts) and [native Messages test](https://github.com/agent-teams-ai/sub2api/blob/main/backend/internal/gatewaytransport/public_messages_test.go).

