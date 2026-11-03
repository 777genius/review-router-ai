# Dashboard read boundaries: deployment

- Task ID: `2026-11-03-dashboard-read-boundaries`
- Goal: preserve dashboard workspace navigation, repository visibility and
  organization plan guidance while moving their read logic out of the renderer.
- Affected services/targets: Web.
- Implementation PR: [#798](https://github.com/777genius/review-router-ai/pull/798),
  consolidating [#796](https://github.com/777genius/review-router-ai/pull/796) and
  [#797](https://github.com/777genius/review-router-ai/pull/797).
- Implementation reference: original stack head
  `b2cbac2322b9d20afbb4dae3ec57ad02d87f15fe`, integrated with main
  `228cfe7352dd2db65516fbcc8e49be2bb7f2fc62`. Select the final merged implementation
  through the PR before choosing a release; these references are source provenance.
- Dependencies: none beyond the existing Web release prerequisites.
- Last updated: `2026-11-03`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                             |
| -------------------- | --------- | ------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| staging / Web        | `pending` | Not verified                    | Not verified        | Select the exact release containing #798 and verify the dashboard journey. |
| production / Web     | `pending` | Not verified                    | Not verified        | Select the exact release containing #798 and verify the dashboard journey. |

`pending` records no verified completion. Merge and local/CI results do not prove
installation in either environment.

## Applicability and prerequisites

Use the existing [release process](../operations/07-environments-and-release-management.md)
for an authorized Web rollout. Qualify the exact shipping revision through the
existing quality gates and confirm that it includes the consolidated PR. This
change requires no schema migration, environment variable, feature activation or
provider rollout. The organization metadata cache remains bounded and local to
each Web process, with the existing five-minute, thirty-second and five-second
TTLs.

## Ordered rollout

1. Record the selected immutable Web release and its passing checks under the
   release process. Reconcile any other applicable deployment tasks.
2. Deploy Web through the existing release path and record the actual installed
   version. Ordinary code deployment is sufficient for this task.
3. Sign in with the approved verification identities and check workspace
   selection, repository listing and direct repository navigation. Confirm that
   repository-only access does not disclose another workspace's installations
   or repositories, and that direct configuration still requires its separate
   permission check.
4. Check organization plan guidance for the configured GitHub App installation.
   An unavailable or denied metadata request must remain safe presentation
   guidance and must not grant repository access. Record per-environment results
   before marking that environment deployed.

## Verification and completion

The extracted cache, repository access loader and workspace projection must pass
their focused regression tests, the existing rendered dashboard contract tests,
the relevant browser journey and required repository CI. Capture actual commands,
revision, results and fixture boundaries in the PR. Fixture-backed browser runs
prove the UI/read contract rather than live GitHub permissions or deployment.
An environment is complete only after the deployed Web version and the journey
above have been observed there.

## Retry, partial completion, and rollback

Inspect the recorded Web version and completed verification steps before retrying.
The implementation adds no durable state or activation step. Use the existing
release rollback procedure to restore the previous Web image, then recheck
workspace and repository visibility. Preserve verification evidence and record
any failed or unfinished step for the affected environment.

## Related links

- [Consolidated implementation PR #798](https://github.com/777genius/review-router-ai/pull/798).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment      | Operator   | Actual version / image | Step and observed result                 | Evidence | Next action                                         |
| ------------ | ---------------- | ---------- | ---------------------- | ---------------------------------------- | -------- | --------------------------------------------------- |
| Not executed | staging / Web    | Unassigned | Not verified           | Pending; no staging rollout executed.    | PR #798  | Qualify and deploy the selected staging release.    |
| Not executed | production / Web | Unassigned | Not verified           | Pending; no production rollout executed. | PR #798  | Qualify and deploy the selected production release. |
