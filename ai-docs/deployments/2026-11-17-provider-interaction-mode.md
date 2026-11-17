# Reviewer roster mode (together or fallback in order): deployment

- Task ID: `2026-11-17-provider-interaction-mode`
- Goal: a workspace or repository reviewer roster can be set to "Together, in parallel" (unchanged default) or "Fallback in order": reviewers run one at a time in the saved order, and the next one starts only when the one before could not finish (quota, sign-in, an unavailable reviewer, used-up attempts). The first reviewer that finishes decides the review.
- Affected services/targets: Web, API and database (migration `000159_producer_reviewer_plan_v2`), the public Action/runtime (reviewer plan v2), producer registration and the `workflow-v1` channel.
- Implementation PR/issue: delivery 1 [ReviewRouter AI PR #890](https://github.com/777genius/review-router-ai/pull/890); delivery 2 [ReviewRouter AI PR #892](https://github.com/777genius/review-router-ai/pull/892) and [public runtime PR #396](https://github.com/777genius/review-router/pull/396).
- Implementation reference: plan [67](../architecture/67-provider-interaction-mode.md).
- Dependencies: [provider quota non-fatal](2026-11-17-provider-quota-nonfatal.md) (migration 158, runtime #394) ships first. Do not deploy delivery 1 (#890) without delivery 2.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                 |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Paired rollout below.                          |
| production           | `pending` | Not verified                    | Not verified        | No deployment authorized by the source merges. |
| Action runtime       | `pending` | Not released                    | Not verified        | Source only; release after Web/API, step 2.    |

`pending` means no verified completion is recorded. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

- Web and API run the same release; both read and write the stored policy documents and the shared `review-config` package.
- Migrations 158 and 159 are applied before the new API starts. 159 only widens the producer profile CHECK to `planVersion` 1 or 2; existing rows stay valid.
- Parallel rosters and single reviewers keep byte-identical configuration and digests.

## Ordered rollout

1. Apply migrations `000158` and `000159` through the [release procedure](../operations/07-environments-and-release-management.md); deploy Web and API from the same source.
2. Cut the exact runtime release from runtime `main` through the existing release process. Runtime PR #396 merges with the protocol exported from the merged #892 commit (`pnpm protocol:export-public`, handoff manifest `saasSourceCommit`) and a rebuilt `dist`; no release, tag or `workflow-v1` move came with the source merges. If a later ReviewRouter change touches `packages/protocol-review-action-v2/src/generated`, export again from the commit being deployed before the release. The release manifest declares `reviewerPlanProfile` `{ planVersion: 2, descriptorDigest: sha256:53ad81ad… }`.
3. Register the new producer (release manifest check, attestation, registry) and only then promote `workflow-v1` to it. Until then a fallback roster with two or more reviewers is refused at admission with `reviewer_fallback_unsupported`; parallel reviews are unaffected.

## Verification and completion

1. A workspace with two Gateway reviewers in "Together, in parallel" still runs both.
2. Switch to "Fallback in order" and save: a pull request runs only the first reviewer; the review is complete and the check passes as usual.
3. Make the first reviewer unusable (for example an account out of quota or signed out) and push a new commit: the second reviewer runs and the review is complete; the summary reports one failed reviewer.
4. With every reviewer unusable the review is incomplete, as today.
5. Saving workspace review settings keeps the mode; switching back to parallel restores the saved limits.

## Retry, partial completion, and rollback

All writes are normal dashboard saves and can be repeated. Before the v2 producer is registered, rolling back Web/API is an ordinary image rollback (documents saved with "Fallback in order" then ask for a resave in the old code). After registration the old code cannot read the v2 producer row and refuses its plan: first move `workflow-v1` back to the last version 1 producer, then roll back, or roll forward. Do not switch fallback rosters to parallel as a rollback step: that starts every reviewer and multiplies provider usage.

## Related links

- [Plan 67](../architecture/67-provider-interaction-mode.md) and its review record; [plan 69](../architecture/69-provider-quota-nonfatal.md).
- [Several Gateway reviewers plan](../plans/2026-10-28-gateway-multi-reviewers.md).
- [Release process](../operations/07-environments-and-release-management.md).
