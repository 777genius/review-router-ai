# Release-gate proof across partial CI reruns

- Task ID: `2026-11-06-release-gate-rerun-evidence`
- Goal: preserve exact successful PG17 release-gate evidence across partial GitHub Actions reruns.
- Affected targets: GitHub Actions verification, automatic public Action sync and GitLab runtime image gates.
- Implementation: follow-up to merged [PR #819](https://github.com/777genius/review-router-ai/pull/819).
- Incident: [main CI #42148086792](https://github.com/777genius/review-router-ai/actions/runs/42148086792), attempt 2.
- Last updated: 2026-11-06.

## Environment status

| Environment / target       | Status    | Actual version | Verified UTC | Evidence / next step                |
| -------------------------- | --------- | -------------- | ------------ | ----------------------------------- |
| GitHub Actions / main      | `pending` | Not verified   | Not verified | Exact-head CI and gate proof        |
| Staging                    | `pending` | Not verified   | Not verified | Reconcile deployed version          |
| Production / Action / GHCR | `pending` | Not verified   | Not verified | Separate authorization and evidence |

`pending` does not assert the code is absent. The registry does not authorize deployment.

## Applicability and prerequisites

Keep the exact main SHA, repository, successful workflow and mandatory jobs, artifact run
identity, SHA-256 digest, and strict JSON manifest. Verify the actual originating
job execution rather than trusting a synthetic attempt number carried by GitHub.

## Ordered rollout

1. Test successful mixed-attempt evidence and fail-closed cases for stale, failed,
   ambiguous or unrelated jobs and artifacts.
2. Merge only after exact-head PR CI, E2E and review pass.
3. Observe post-merge main CI and automatic publication workflows. Check exact
   source/artifact identities and publication results; do not initiate a separate
   release, deploy or unsafe replay.
4. For later staging/production rollout, reconcile current fleet and unfinished
   deployment tasks before separately authorized release procedures.

## Verification and rollback

The artifact must belong to the same successful physical job, source SHA and
originating attempt. A later rerun of the mandatory job cannot reuse old proof.
Failed or skipped jobs and ambiguous artifacts remain rejected. A green PR or
merged source is not an installed runtime. Preserve prior immutable releases
if any verification fails; use the existing release rollback procedure.

## Related links

- [Release procedure](../operations/07-environments-and-release-management.md)
- [Review execution source task](2026-11-06-review-execution-boundaries.md)
- [Main CI evidence](https://github.com/777genius/review-router-ai/actions/runs/42148086792)

## Execution log

No staging or production rollout has been performed for this change.
