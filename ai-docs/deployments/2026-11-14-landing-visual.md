# ReviewRouter homepage redesign: web rollout

- Task ID: 2026-11-14-landing-visual
- Goal: replace dense marketing homepage with a source-backed five-chapter visual flow while retaining dashboard and auth behavior.
- Targets: Web homepage/navigation only; no API, worker, Action, migration or flag change.
- PR: https://github.com/777genius/review-router-ai/pull/870
- Plan: ai-docs/design/landing-implementation-plan-2026-11-14.md
- Research: https://github.com/777genius/review-router-ai/pull/863
- Video: https://github.com/777genius/review-router-ai/pull/864
- Last updated: 2026-11-14.

## Environment status

| Target | Status | Actual deployed version/image | Last verified | Next |
| --- | --- | --- | --- | --- |
| staging | pending | Not verified | Not verified | Exact-head browser E2E and visual approval |
| production | pending | Not verified | Not verified | No deployment authorized, follow approved release process |

Pending does not assert that an environment is uninstalled.

## Applicability and prerequisites

Confirm precise source revision, the active Web release, all unfinished tasks in the deployment index, and release authorization before any rollout. The code is a public Web presentation change only. No database migration, worker/API rollout, Action pin, new secret, feature flag or activation step is required.

## Ordered rollout

1. Qualify the Draft PR at 390/768/1440 in both themes, with interactive findings and keyboard selection, HTTP/links, browser errors and no horizontal overflow. Visually inspect real screenshots, then obtain design feedback.
2. Before merge, pass mandatory source/build/type checks and address review feedback. Neither queued nor skipped checks count as PASS.
3. Only after explicit authorization, deploy the approved Web image through the existing release process and record its SHA/version.
4. Verify live anonymous homepage, authenticated GitHub CTA, links to /compare, fair-use/security/self-hosted, SEO/structured data and user-perceived performance. Record evidence separately per environment.

## Retry, rollback and evidence

Reconcile current fleet, PR HEAD and related releases first; do not replay stale evidence. Follow ai-docs/operations/07-environments-and-release-management.md for approved rollback of Web. No data migration to reverse. Real post-deployment verification is required to mark a target deployed.

## Execution log

| UTC | Target | Operator | Observed outcome | Next |
| --- | --- | --- | --- | --- |
| 2026-11-14 | staging/production | Unassigned | Draft source-only candidate, not verified as deployed | Browser QA and visual review |
