# Codex quota refresh and connection UX

Implementation: [working checklist](../plans/2026-11-04-codex-accounts-e2e-ux.md), Gateway [#100](https://github.com/agent-teams-ai/account-gateway/pull/100), native credit-aware admission [#92](https://github.com/agent-teams-ai/sub2api/pull/92), native quota-only refresh [#93](https://github.com/agent-teams-ai/sub2api/pull/93).

Staging: `pending`. Production: `deployed`. Native/Gateway, the application, fresh owner quota projections, one live Seventeen review, publication, Usage/Statistics and provider restoration are verified. Preserve test stands and evidence; no repeat deployment is required.

The batch adds an owner-authorized Codex quota GET with live binding/generation fencing, automatic first observation for missing snapshots and explicit refresh, restores missing workspace projections after tab changes, adds shared avatars and clear workspace identity to Access, and reuses Test connection in provider Edit. Validated private preparation refusals retain their safe diagnostic. Exhausted cached subscription limits alone no longer deny credit-funded Codex requests. Credit balance is not fabricated or claimed by the limits UI.

No SQL migration or new public Action is required. Existing cached-only quota reads remain unchanged. Upgrade the paired native/Gateway artifact before enabling the new SaaS refresh client. Retain existing native custody, management credentials, runtime profile identity and producer registry. Preserve old release artifacts and test stands.

Runbook: [environment and release management](../operations/07-environments-and-release-management.md); final SaaS qualification is tracked in [PR #814](https://github.com/777genius/review-router-ai/pull/814).

Ordered rollout (production status is explicit; staging remains pending):

1. **Production complete:** the paired native/Gateway sources were merged, qualified and installed; see the installed checkpoint below. Reconcile the retained activation receipt and live service before any further replacement. This step is not an instruction to rebuild or reinstall the pair.
2. **Production complete:** the application image was installed through one coherent four-role fleet swap and readiness verification. Preserve Action230 and registry58. See the exact source/image evidence below; reuse the installed image rather than rebuilding for verification.
3. **Production complete:** quota-only refresh returned fresh, non-stale snapshots for both Codex targets in personal and workspace contexts. Two explicit refreshes used zero model calls. Recipient privacy was verified by the explicitly fixture-only service check and focused tests.
4. **Production complete:** exactly one fresh attempt 4 used Seventeen only for the existing test repository. The prior repository policy and complete effective configuration are restored; workspace defaults and MCP settings are unchanged.
5. **Production complete:** attempt 4 completed 1/1, published both required outputs, recorded one settled Statistics review and one unique Usage call with 2,887 tokens. Preserve earlier partial/unknown attempts; none were replayed.

Rollback: retain the former paired service release and app image. No schema rollback is needed. Disable unsupported explicit refresh by capability negotiation; old cached-only reads remain available. Reconcile a model request with unknown outcome before considering another request. Restore the test-provider override regardless of outcome, without overwriting concurrent owner changes.

Historical pre-installation qualification checkpoint: 73 combined UI/sharing tests, 72 focused server/domain/action/SDK tests and independent source review passed. 113 API preparation regression tests, combined production type checks and formatting also passed. These checks preceded application installation and the successful Seventeen review; see [final production acceptance](#final-production-acceptance) below for their verification.

## Installed native/Gateway checkpoint

[Sanitized deployment and quota evidence](evidence/2026-11-04-codex-quota-refresh.json) records native #93 `da0d89b28aa6bfba563b9b9ff7310687d00c8b30` paired with Gateway #100 `2a8379dab18607c61bdfc52852d6b00462797b9f`, installed at `/srv/platform/artifacts/review-router/account-gateway/releases/quota-refresh-da0d89b-2a8379d-20261104-r2/release`. The qualified native binary and SDK were reused without rebuilding. Native #92's credit-aware admission fix is included in the installed pair.

The first activation failed because the release parent mode `0700` blocked native re-execution under UID65534. The exact old pair was restored and verified healthy. A packaging-only `0711` traversal repair, with private configuration/receipts retained at `0600`, enabled a new recovery activation. Original failure, rollback and recovery evidence remain preserved. No source rebuild or blind replay was used.

Ingress now permits exactly `/v1/capabilities/account-limits-refresh` and `/v1/account-limits/refresh` in both existing host blocks. Existing paths remain intact; the generator was corrected and one validated graceful Caddy reload applied. The live capabilities GET returned 200 with `account-limits-refresh/v1`, quota-only refresh and Codex support.

One owner-authorized Seventeen quota-only POST returned a fresh snapshot at `2026-11-04T16:13:20.665751562Z`: primary5h100% used, reset `2026-11-04T18:37:23Z`; secondary7d62% used, reset `2026-11-10T22:03:39Z`. This observation used zero model calls. It does not measure or fabricate credit balance, nor imply a model-review outcome.

## Application installation and live verification

SaaS [PR #814](https://github.com/777genius/review-router-ai/pull/814) merged as `4e5cd2133e09da3a9a307d1a2e349b9266f62376`. [Exact-head CI 41904590738](https://github.com/777genius/review-router-ai/actions/runs/41904590738) passed all 13 applicable checks, including E2E and both required gates; the full private PG16-to-PG17 rehearsal is intentionally not a PR lane and was skipped. No SQL migration was added.

The installed image is `sha256:5d8783e366fbbdbd7296f79338e3cf9dd72d7ecb30eeccaf7250ae244df969b5`, compiled from `bb077235730d484f1f390a86f2ba9029c2da45f9`. Qualified head `348c97fb796b1e7aae034617b3f887c2294ecf20` and its squash merge differ from that source only in `.github/workflows/ci.yml` and `docs/CI_RUNNERS.md`; application inputs and artifacts are identical. The image and runtime environment retain their actual compiled-source provenance; they do not claim compilation from the later metadata-only commit. Rebuilding the identical application for CI-routing metadata was unnecessary.

One standard fleet swap used `/srv/platform/projects/review-router/releases/fleet-overlay-bb077235-DTAHKtMZ`. All four roles run the image with zero restarts, worker privilege verification passed all 7 checks, and public readiness returned 200. The preceding d184/image6d8 containers and recovery evidence are retained. Native/Gateway, Action230, registry58, credentials and test stands were preserved.

The final review fixes passed 59 hosted service/query/UI tests, full web TypeScript including tests, lint and formatting. Cached reads bound optional capability discovery to 250 ms; refresh conflict/invalid results retain the saved observation while authorization denial still erases it. The existing Gateway model-refresh button updates both native models and public metadata. CI uses the existing Namespace pool for ordinary checks/builds and an isolated GitHub Ubuntu override only for Docker-sensitive E2E.

The first Seventeen test was run41829266811, attempt3, on the unchanged d184 API and installed native/Gateway pair. It ended at16:49UTC with HTTP503 `relay_saturated` and explicit `not_dispatched`: the API retained16 sessions against its16-session storage bound. Its partial summary was published, with0/1 required work satisfied; Usage and successful-review Statistics correctly remain zero. This is not a successful review or a credit-funded model-call proof.

The controller restored the exact prior test-repository selection in `finally`; workspace defaults remained unchanged. The test repository has zero MCP servers and zero tools, preserved as configured. Root-private capture/apply/restoration receipts and historical unknown attempts remain retained.

An additional preparation-lifecycle fix passed 113 hosted API regressions, focused types and lint: a validated initial admission refusal must not retain a closed no-execution session indefinitely. Preserve unknown effects and the global resource/byte guards. The application batch is installed. One fresh attempt 4 was triggered after this definite pre-dispatch refusal; do not trigger another run or replay any uncertain model effect. Application image/readiness, exact restoration and successful review/publication/statistics readbacks now verify completion; see the final acceptance below. No further trigger or deployment is required.

## Final production acceptance

[Live review 41829266811, attempt 4](https://github.com/777genius/clean_disk/actions/runs/41829266811/attempts/4) completed successfully on the existing [test PR 7](https://github.com/777genius/clean_disk/pull/7), head `fd2b5d7ca610a724948410e02c03841c06dad134`. The current change is a nine-line installation document, not the earlier critical-code fixture: this review found 0 issues. Execution and its linked finalized artifact are completed; required work 1/1, exhausted 0, covered files 1/1. Summary and managed check publication both completed. Statistics contains one settled review and 0 issues. Usage contains exactly one distinct completed/dispatched Seventeen call: 2,758 input + 129 output = 2,887 reported tokens (81 reasoning tokens are included in output). Requested model is gpt-6.1-sol; actual model remains unreported, not inferred.

The initial read-only GitHub watcher lost its TCP connection while attempt 4 was queued. Its `finally` restored the first temporary selection. A fresh capture/CAS selection was applied for the same already-created attempt after proving no authorization/execution existed; no second trigger or model replay occurred. After terminal success, fresh custody restored repository policy version 6 from temporary 5, with workspace version 22 unchanged and full effective settings/MCP settings identical to the capture. All before/apply/restore receipts remain root-private on the host; the test stand was preserved.

Two post-review quota-only refreshes at 21:08:42–43 UTC returned matching fresh personal/workspace snapshots for both targets, all with stale=false. Seventeen reports 5h 0% remaining (reset 23:37:26 UTC) and 7d 22% remaining (reset 10 November 22:03:39 UTC). The restored previous provider reports 7d 0% remaining (reset 9 November 12:10:59 UTC). These are provider observations; credit balance and credit billing are not reported or fabricated. The restored provider's future requests still depend on its upstream quota/credits.

The finite quota verifier initially failed during module loading, before its body or any network/effect calls. A versioned helper with the production Prisma resolution anchor passed an exact no-GO refusal smoke, then performed the two refreshes once. No application rebuild or redeployment was required.

The first readback classifier incorrectly required a terminal live-progress field and a reported actual model. The live-progress projection still reported assembling/null after execution completion, and actualModel remained null because only the requested model was reported. The corrected read-only assessment uses completed execution, its linked finalized artifact, complete coverage and successful required publication, while preserving both unknown observations. Original and corrected reports are retained. No product data was rewritten to manufacture success.

Staging, Memory semantic qualification and GitLab remain separate. Historical attempt3/unknown outcomes remain unchanged. This record closes the selected quota/Access/Gateway-preparation application batch, not all unrelated deployment tasks.
