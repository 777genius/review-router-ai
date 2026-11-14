# Release-gate proof across partial CI reruns

## Current GitHub publication evidence (2026-11-14)

Normal exact-main [CI 43558212571](https://github.com/777genius/review-router-ai/actions/runs/43558212571) succeeded on `ebeee1710f497b1953492efd67dca9055bc8f047`, with both mandatory PG release gates. The matching normal signed private 234 [Release 43561561896](https://github.com/777genius/review-router-ai/actions/runs/43561561896) succeeded and published the source-bound runtime image; signature/source/workflow verification is retained in the [FILE record](2026-11-14-producer-registry-file.md#234-final-rollout-and-canary-evidence). GitHub release authority/publication is therefore verified for this exact release; no extra fleet deployment is required for the workflow verifier itself. This is not a claim that 234 is live, that the current release used a mixed-attempt path, or that a separate GitLab/staging runtime is qualified. The original mixed-attempt incident and refusal invariants remain historical evidence.

- Task ID: `2026-11-06-release-gate-rerun-evidence`
- Goal: preserve exact successful PG17 release-gate evidence across partial GitHub Actions reruns.
- Affected targets: GitHub Actions verification, automatic public Action sync and GitLab runtime image gates.
- Implementation: follow-up to merged [PR #819](https://github.com/777genius/review-router-ai/pull/819).
- Incident: [main CI #42148086792](https://github.com/777genius/review-router-ai/actions/runs/42148086792), attempt 2.
- Last updated: 2026-11-06.

## Environment status

| Environment / target      | Status     | Actual version                | Verified UTC | Evidence / next step                                                          |
| ------------------------- | ---------- | ----------------------------- | ------------ | ----------------------------------------------------------------------------- |
| GitHub Actions / main     | `deployed` | Exact main Ebe CI 43558212571 | 2026-11-14   | Mandatory PG gates and signed publication succeeded                           |
| Staging                   | `pending`  | Not verified                  | Not verified | Reconcile deployed version                                                    |
| GitHub publication / GHCR | `deployed` | Signed private 234 image 9b62 | 2026-11-14   | Release 43561561896 and signer/source binding PASS; fleet activation separate |
| GitLab runtime            | `pending`  | Not verified                  | Not verified | Separate external cohort, not inferred from GitHub publication                |

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

The historical source task performed no fleet rollout. Current exact GitHub CI/publication is verified above; staging, actual 234 fleet activation and GitLab retain their own statuses.
