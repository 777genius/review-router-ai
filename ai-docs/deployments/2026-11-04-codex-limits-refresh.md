# Codex quota refresh and connection UX

Implementation: [working checklist](../plans/2026-11-04-codex-accounts-e2e-ux.md), Gateway [#100](https://github.com/agent-teams-ai/account-gateway/pull/100), native credit-aware admission [#92](https://github.com/agent-teams-ai/sub2api/pull/92), native quota-only refresh [#93](https://github.com/agent-teams-ai/sub2api/pull/93).

Staging: `pending`. Production: `pending`. The prior installed baseline remains d184/image6d8 and compatible Action230/registry58. Source merge and focused tests do not establish installation.

The batch adds an owner-authorized Codex quota GET with live binding/generation fencing, automatic first observation for missing snapshots and explicit refresh, restores missing workspace projections after tab changes, adds shared avatars and clear workspace identity to Access, and reuses Test connection in provider Edit. Validated private preparation refusals retain their safe diagnostic. Exhausted cached subscription limits alone no longer deny credit-funded Codex requests. Credit balance is not fabricated or claimed by the limits UI.

No SQL migration or new public Action is required. Existing cached-only quota reads remain unchanged. Upgrade the paired native/Gateway artifact before enabling the new SaaS refresh client. Retain existing native custody, management credentials, runtime profile identity and producer registry. Preserve old release artifacts and test stands.

Ordered rollout:

1. Merge exact reviewed sources after relevant successful checks; build paired native/Gateway once on Hetzner and replace through the existing service release path.
2. Build the exact merged SaaS source once, then perform the documented coherent fleet swap and readiness verification. Preserve Action230 and registry58 settings.
3. Verify native capability negotiation and owner-authorized fresh Codex quota observations without inference. Preserve old observation timestamps on refresh failure; verify recipients cannot access owner limits.
4. Freeze the test repository's complete prior provider selection/version. Temporarily select Seventeen only for that repository, perform exactly one fresh review, and restore the prior selection through the supported CAS writer even if the review fails. Never change all-workspace defaults merely to run this test.
5. Verify actual review publication and truthful unique Usage/Statistics. Preserve prior unknown attempts; do not replay uncertain effects. Update this record and baseline with actual source/image/receipts.

Rollback: retain the former paired service release and app image. No schema rollback is needed. Disable unsupported explicit refresh by capability negotiation; old cached-only reads remain available. Reconcile a model request with unknown outcome before considering another request. Restore the test-provider override regardless of outcome, without overwriting concurrent owner changes.

Qualification checkpoint: 73 combined UI/sharing tests, 72 focused server/domain/action/SDK tests and independent source review passed. 103 API preparation regression tests, combined production type checks and formatting also passed. No new rollout or Seventeen model call is claimed here.
