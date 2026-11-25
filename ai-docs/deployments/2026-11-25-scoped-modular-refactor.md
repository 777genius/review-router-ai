# Scoped dashboard, worker, and modular refactor: deployment

- Task ID: `2026-11-25-scoped-modular-refactor`
- Goal: retain dashboard setup and review-worker behavior while moving the changed responsibilities into focused modules and enforcing the accepted new-feature composition policy.
- Affected services/targets: Web and worker; provider catalog composition and repository verification tooling.
- Implementation PR: [#998](https://github.com/777genius/review-router-ai/pull/998), consolidating #999, #1000, #1001, #1004, and the agent-workflow/suppression portion of #1002. The new global Markdown capability remains a separate candidate in existing Draft [#1002](https://github.com/777genius/review-router-ai/pull/1002).
- Implementation reference: consolidation `284c4a8b9ba76020d1e507ec49f4f29713e7fd3b`; locally qualified implementation checkpoint `ff30c3813a6cd4fb4fe6242c5b385fa2aef81e5c`. These references do not establish merge, browser acceptance, or installation.
- Dependencies: the normal authorized application release and its required checks. Parallel provider work #959 and observation recovery #1003 are outside this implementation batch.
- Last updated: `2026-11-25`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                                       |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| staging              | `pending` | Not verified                    | Not verified        | Qualify the exact merged source, then select it in an authorized ordinary rollout.         |
| production           | `pending` | Not verified                    | Not verified        | Reconcile the installed version and applicable release tasks before an authorized rollout. |

This record does not authorize deployment. A pending status records an absence
of verified completion, not an observation that the code is absent.

## Applicability and prerequisites

- Preserve the existing server-action authorization, provider-secret statuses,
  organization ruleset form behavior, worker configuration errors, and startup order.
- Keep Get Modular Core/Assembly 0.8.0 and Engineering Foundation 3.1.0 at their
  accepted pins. The 43-package historical composition baseline and six documented
  legacy suppression gaps are not claims of complete legacy conformance.
- Keep the global Markdown activation pending in #1002 until its native policy
  can preserve the frozen release-evidence bytes and the full intended roots.
- Require exact-head quality CI, strict native TypeScript 7.0.2, the existing
  production database E2E, and authenticated Next/browser qualification before merge.
- Select a reviewed release containing this implementation under the
  [release process](../operations/07-environments-and-release-management.md).
  No new migration, configuration key, activation step, or feature flag is introduced.

## Ordered rollout

Ordinary application code rollout is sufficient.

1. Reconcile the actual fleet and selected release; inspect the task index for
   any other changes included by that release.
2. Deploy the selected Web/worker application artifact through the existing
   release process and record the actual source and image.
3. Verify repository secret availability/error handling and organization ruleset
   controls using approved test identities. Verify worker startup with the existing
   signed-capability configuration and ordinary review completion.
4. Record environment-specific evidence and completion. Do not infer production
   completion from staging, local tests, a merge, or source ancestry.

## Verification and completion

The combined PR retains existing catalog, worker, database and browser gates.
The targeted browser acceptance must include the organization ruleset card at
390/900/1440 widths in light/dark themes and the existing repository-secret
onboarding flows. GitHub/provider boundaries in that harness are controlled
fixtures; they do not establish a live GitHub App or provider canary.

Completed local processes on implementation checkpoint
`ff30c3813a6cd4fb4fe6242c5b385fa2aef81e5c` all exited 0:

| Check                       | Observed result                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native TypeScript 7.0.2     | Tooling, Web, worker, and provider-catalog configurations passed after the standard shared build.                                                          |
| Scoped regressions          | 257/257 tests across 10 files, including real-HTTP catalog isolation.                                                                                      |
| Formatting and ESLint       | All 33 changed files formatted; changed code passed ESLint.                                                                                                |
| Architecture and Foundation | 695 domain/application files; all three active Foundation capabilities passed with zero diagnostics.                                                       |
| Production PostgreSQL E2E   | 17/17 cases after all 160 ordinary migrations and catalog ownership checks; no failed, pending, or todo cases. Database shutdown and source checks passed. |

The database qualification used PostgreSQL 17.12, Node 24.22.3, pnpm 11.28.7,
and one Vitest thread. GitHub/provider transports were synthetic fixtures,
not live upstream canaries. These results are bound to the stated implementation
checkpoint; later documentation changes do not extend their scope.

Authenticated browser qualification remains incomplete. Its required receipt is
40 screenshots and both repository-secret flows, with semantic checks, clean
network observations, and unchanged source. Playwright startup, page assertions,
and shutdown passed with the official Debian Chromium Headless Shell. Full
harness attempts have not produced the required complete manifest.

A bounded child-process diagnostic on 2026-11-25 recorded the Next worker exiting
with SIGKILL before the dashboard fetch failed and before harness cleanup began.
The source of SIGKILL is unknown; no definite OOM or product-code cause is claimed.
The temporary Webpack concurrency experiment reduced observed memory but did not
resolve the failure and was fully reverted. An unchanged-main comparison also
received SIGKILL during migrations, before Next started; it does not rule out a
browser regression in this PR.

Required GitHub CI and browser jobs remain queued at this checkpoint. Earlier
interrupted attempts remain failures, not acceptance. Final CI and browser
receipts must bind to the actual reviewed source; queued, skipped, cancelled,
neutral, and rate-limited checks are not successful qualification. Current run
links and results remain in [PR #998](https://github.com/777genius/review-router-ai/pull/998).

## Retry, partial completion, and rollback

Before retrying, inspect the current source and the last complete receipts.
Run the existing suites on isolated disposable databases; preserve failed attempts
and distinguish setup, process termination and assertion failures.

No data/schema migration is introduced by this task. If an authorized code rollout
needs reversal, use the release process to restore the previously verified
application artifact and record the result. Preserve existing database state and
do not replay external onboarding effects merely to obtain evidence.

## Related links

- [Implementation and current qualification](https://github.com/777genius/review-router-ai/pull/998)
- [Foundation adoption scope](../architecture/84-foundation-default-adoption.md)
- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)
- [Deployment status contract](README.md#status-contract)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result              | Evidence | Next action                                                             |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | No deployment requested or performed. | PR #998  | Complete implementation qualification, then join an authorized rollout. |
