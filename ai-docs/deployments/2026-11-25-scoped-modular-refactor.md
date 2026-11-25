# Scoped dashboard, worker, and modular refactor: deployment

- Task ID: `2026-11-25-scoped-modular-refactor`
- Goal: retain dashboard setup and review-worker behavior while moving the changed responsibilities into focused modules and enforcing the accepted new-feature composition policy.
- Affected services/targets: Web and worker; provider catalog composition and repository verification tooling.
- Implementation PR: [#998](https://github.com/777genius/review-router-ai/pull/998), consolidating #999, #1000, #1001, #1002, and #1004.
- Implementation reference: consolidation `284c4a8b9ba76020d1e507ec49f4f29713e7fd3b`; correction checkpoint `5f4e6db90cd3072489d8c2ffb49ce7a2e397a6fc`. Later qualification commits remain in #998. Neither checkpoint is evidence of merge or installation.
- Dependencies: the normal authorized application release and its required checks. Parallel provider work #959 and observation recovery #1003 are outside this implementation batch.
- Last updated: `2026-11-25`.

## Environment status

| Environment / target | Status | Actual deployed version / image | Last verified (UTC) | Evidence / next step |
| --- | --- | --- | --- | --- |
| staging | `pending` | Not verified | Not verified | Qualify the exact merged source, then select it in an authorized ordinary rollout. |
| production | `pending` | Not verified | Not verified | Reconcile the installed version and applicable release tasks before an authorized rollout. |

This record does not authorize deployment. A pending status records an absence
of verified completion, not an observation that the code is absent.

## Applicability and prerequisites

- Preserve the existing server-action authorization, provider-secret statuses,
  organization ruleset form behavior, worker configuration errors, and startup order.
- Keep Get Modular Core/Assembly 0.8.0 and Engineering Foundation 3.1.0 at their
  accepted pins. The 43-package historical composition baseline and six documented
  legacy suppression gaps are not claims of complete legacy conformance.
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

Bounded local checks before the runtime became unavailable:

- Config plus signed-capabilities tests: 13 passed with process exit 0; published
  in `4255d857ce0a0ce0420a213fd73f74559b4d3cd6`.
- Catalog composition: three tests passed with exit 0 on that checkpoint,
  including real loopback HTTP and independent Host instances. The subsequent
  clock refinement printed three passing assertions but exited 137; its complete
  current-source rerun remains required.
- Provider package native TypeScript 7.0.2 and scoped worker/catalog ESLint passed
  before the later test-only clock refinement.
- Dashboard and broader catalog attempts exited 137 and are unqualified.
  The execution environment then reported unavailable. PostgreSQL 17.12 binaries
  were prepared, but no local PostgreSQL E2E was executed in this continuation.

These are bounded observations, not complete E2E or exact-final-head acceptance.
CI and browser receipts must bind to the final reviewed source. Queued, skipped,
cancelled, neutral, and rate-limited checks are not successful qualification.

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

| Time (UTC) | Environment | Operator | Actual version / image | Step and observed result | Evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| Not executed | staging / production | Unassigned | Not verified | No deployment requested or performed. | PR #998 | Complete implementation qualification, then join an authorized rollout. |
