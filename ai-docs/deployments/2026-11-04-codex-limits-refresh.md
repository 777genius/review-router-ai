# Codex quota refresh and connection UX

Implementation: [working checklist](../plans/2026-11-04-codex-accounts-e2e-ux.md), Gateway [#100](https://github.com/agent-teams-ai/account-gateway/pull/100), native credit-aware admission [#92](https://github.com/agent-teams-ai/sub2api/pull/92), native quota-only refresh [#93](https://github.com/agent-teams-ai/sub2api/pull/93).

Staging: `pending`. Production: `in_progress`. Paired native/Gateway quota refresh is installed and verified; SaaS PR #814 and the one-review verification remain pending. The application baseline remains d184/image6d8 with compatible Action230/registry58. Source merge and focused tests do not establish application installation.

The batch adds an owner-authorized Codex quota GET with live binding/generation fencing, automatic first observation for missing snapshots and explicit refresh, restores missing workspace projections after tab changes, adds shared avatars and clear workspace identity to Access, and reuses Test connection in provider Edit. Validated private preparation refusals retain their safe diagnostic. Exhausted cached subscription limits alone no longer deny credit-funded Codex requests. Credit balance is not fabricated or claimed by the limits UI.

No SQL migration or new public Action is required. Existing cached-only quota reads remain unchanged. Upgrade the paired native/Gateway artifact before enabling the new SaaS refresh client. Retain existing native custody, management credentials, runtime profile identity and producer registry. Preserve old release artifacts and test stands.

Ordered rollout:

1. Merge exact reviewed sources after relevant successful checks; build paired native/Gateway once on Hetzner and replace through the existing service release path.
2. Build the exact merged SaaS source once, then perform the documented coherent fleet swap and readiness verification. Preserve Action230 and registry58 settings.
3. Verify native capability negotiation and owner-authorized fresh Codex quota observations without inference. Preserve old observation timestamps on refresh failure; verify recipients cannot access owner limits.
4. Freeze the test repository's complete prior provider selection/version. Temporarily select Seventeen only for that repository, perform exactly one fresh review, and restore the prior selection through the supported CAS writer even if the review fails. Never change all-workspace defaults merely to run this test.
5. Verify actual review publication and truthful unique Usage/Statistics. Preserve prior unknown attempts; do not replay uncertain effects. Update this record and baseline with actual source/image/receipts.

Rollback: retain the former paired service release and app image. No schema rollback is needed. Disable unsupported explicit refresh by capability negotiation; old cached-only reads remain available. Reconcile a model request with unknown outcome before considering another request. Restore the test-provider override regardless of outcome, without overwriting concurrent owner changes.

Qualification checkpoint: 73 combined UI/sharing tests, 72 focused server/domain/action/SDK tests and independent source review passed. 113 API preparation regression tests, combined production type checks and formatting also passed. This checkpoint does not establish SaaS installation or successful completion of a Seventeen review.

## Installed native/Gateway checkpoint

[Sanitized deployment and quota evidence](evidence/2026-11-04-codex-quota-refresh.json) records native #93 `da0d89b28aa6bfba563b9b9ff7310687d00c8b30` paired with Gateway #100 `2a8379dab18607c61bdfc52852d6b00462797b9f`, installed at `/srv/platform/artifacts/review-router/account-gateway/releases/quota-refresh-da0d89b-2a8379d-20261104-r2/release`. The qualified native binary and SDK were reused without rebuilding. Native #92's credit-aware admission fix is included in the installed pair.

The first activation failed because the release parent mode `0700` blocked native re-execution under UID65534. The exact old pair was restored and verified healthy. A packaging-only `0711` traversal repair, with private configuration/receipts retained at `0600`, enabled a new recovery activation. Original failure, rollback and recovery evidence remain preserved. No source rebuild or blind replay was used.

Ingress now permits exactly `/v1/capabilities/account-limits-refresh` and `/v1/account-limits/refresh` in both existing host blocks. Existing paths remain intact; the generator was corrected and one validated graceful Caddy reload applied. The live capabilities GET returned200 with `account-limits-refresh/v1`, quota-only refresh and Codex support.

One owner-authorized Seventeen quota-only POST returned a fresh snapshot at `2026-11-04T16:13:20.665751562Z`: primary5h100% used, reset `2026-11-04T18:37:23Z`; secondary7d62% used, reset `2026-11-10T22:03:39Z`. This observation used zero model calls. It does not measure or fabricate credit balance, nor imply a model-review outcome.

## Remaining application and review delivery

SaaS [PR #814](https://github.com/777genius/review-router-ai/pull/814) awaits final exact-head CI and rollout. CI41868079429 for cdc was cancelled when the production preparation-lifecycle fix superseded it. Initial head8a CI found two test-fixture errors; those fixtures are fixed, and full web TypeScript including tests,15 focused tests, lint and formatting passed afterward. Final exact-head CI and ordinary merge remain required before the coherent application swap.

The first Seventeen test was run41829266811, attempt3, on the unchanged d184 API and installed native/Gateway pair. It ended at16:49UTC with HTTP503 `relay_saturated` and explicit `not_dispatched`: the API retained16 sessions against its16-session storage bound. Its partial summary was published, with0/1 required work satisfied; Usage and successful-review Statistics correctly remain zero. This is not a successful review or a credit-funded model-call proof.

The controller restored the exact prior test-repository selection in `finally`; workspace defaults remained unchanged. The test repository has zero MCP servers and zero tools, preserved as configured. Root-private capture/apply/restoration receipts and historical unknown attempts remain retained.

An additional preparation-lifecycle fix passed113 hosted API regressions, focused types and lint: a validated initial admission refusal must not retain a closed no-execution session indefinitely. Preserve unknown effects and the global resource/byte guards. Deliver the application batch before one fresh test after this definite pre-dispatch refusal; do not replay any uncertain model effect. Finalize this record only from actual application image/readiness, restoration and successful review/publication/statistics readbacks.
