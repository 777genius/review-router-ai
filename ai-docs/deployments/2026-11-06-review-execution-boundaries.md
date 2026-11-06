# Review execution / API legacy boundary refactor rollout

- Task ID: `2026-11-06-review-execution-boundaries`
- Goal: deliver behavior-preserving owner boundaries for review-execution persistence and qualified selected API Review Action v2 helpers, if implemented.
- Affected services/targets: API and worker Review Execution feature runtime; Web only if optional workflow write packet is justified and implemented.
- Implementation PR: [Draft #819](https://github.com/777genius/review-router-ai/pull/819).
- Implementation reference: initial code candidate [43694373dee4b2827fcd22aac3e896525f108e86](https://github.com/777genius/review-router-ai/commit/43694373dee4b2827fcd22aac3e896525f108e86). This does not mean selected for release or installed.
- Plan: [post-#818 legacy-boundary plan](../plans/2026-11-06-post-818-legacy-boundaries.md).
- Dependencies: repository release/rollback procedures, current deployment registry, exact release image selection, and applicable pre-existing migration/cutover tasks. No new migrations.
- Last updated: 2026-11-06.

## Environment status

| Environment / target                           | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                           |
| ---------------------------------------------- | --------- | ------------------------------- | ------------------- | -------------------------------------------------------------- |
| staging API/worker (+ Web only if in scope)    | `pending` | Not verified                    | Not verified        | Qualify source and select release after separate authorization |
| production API/worker (+ Web only if in scope) | `pending` | Not verified                    | Not verified        | Do not assume main or the PR commit is installed               |

`pending` does not assert absence. An implementation PR or green tests never amount to an installed version.

## Applicability and prerequisites

- Final merged code SHA and exact runtime/release image, not the planning branch's floating head.
- Review [release and git flow source](../operations/07-environments-and-release-management.md) and unfinished registry entries for the target fleet before any deployment.
- Confirm current runtime schema/profile and workflow ABI. This refactor is source-only; do not run PG17/hosted-custody migration or replay uncertain external effects to qualify it.
- Check that existing GitHub App-first/Gateway workflows, provider ownership, leases and publication invariants remain installed/compatible.

## Ordered rollout

1. **Before start:** reconcile current running versions and pending dependencies; review production readiness and rollback constraints. No new schema, secret, data conversion, outbox replay, or activation step is authorized or expected for the selected refactor.
2. **If separately approved:** build/pin exact artifacts using the normal release process, then deploy the relevant API and worker image(s) together as needed. Web is conditional on a later scoped code change.
3. **After release:** verify role readiness, exact image and source identity, no increase in review failures, no duplicate effects, lease/authorization safety, expected review publication and dashboard health. Record concrete timestamp, actor, image, full verification and any remaining hold.

## Verification and completion

- Required code evidence: full applicable exact-HEAD GitHub Actions CI, TS/lint/format/architecture checks, Review Action v2 protocol qualification, Review Execution real PostgreSQL contracts, API paired gateway and self-hosted E2E when touched. A policy-skipped job is _not_ a passing run.
- Required deployed evidence: actual target image/commit, environment health/readiness, a safe fresh disposable test review when permitted and exact App identity for any new comments, audit/usage consistency, and absent duplicate publication.
- Never mark `deployed` on source CI alone. Deployment status updated only after independent release authorization and verification.

## Retry, partial completion, rollback

- Preserve real source/release/installed generation identities, and prior transaction/outbox/lease evidence. Before retry, inspect which release steps completed and what current work is in flight.
- For code rollback, follow the authoritative release rollback procedure using a known compatible prior image; do not roll back DB migrations or old customer data solely to revert this source refactor. Explicitly verify new/old lease, review and publication protocol compatibility.
- If a red test implicates changed authority, stop the rollout and fix source rather than bypassing the test. Do not force uncertain GitHub side effects.

## Related links

- [Draft PR #819](https://github.com/777genius/review-router-ai/pull/819)
- [Current plan](../plans/2026-11-06-post-818-legacy-boundaries.md)
- [Source of truth](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Observation                              | Next                                   |
| ------------ | -------------------- | ---------- | ---------------------- | ---------------------------------------- | -------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Code not released or deployed by this PR | Full E2E and separate release decision |
