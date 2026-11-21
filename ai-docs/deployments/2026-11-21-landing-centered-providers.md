# Centered provider row on the landing hero: deployment

- Task ID: `2026-11-21-landing-centered-providers`
- Goal: on reviewrouter.org the strip at the bottom of the hero shows
  "POWERED BY OpenCodeReview" on its own line with the nine supported providers
  centered below it. Wrapped rows, including a short last row, stay centered on
  desktop, tablet and phone. Before, the strip was left-aligned and a wrapped
  last row (NVIDIA Build on a phone) sat alone on the left.
- Affected services/targets: Web only (`apps/web/app/home-hero.tsx`,
  `apps/web/app/home-landing.css`). API, worker, Gateway, native, the database
  and the public Action are unchanged.
- Implementation PR: [#953](https://github.com/777genius/review-router-ai/pull/953).
- Implementation reference: branch commit `eb0957c41` plus the review fix on
  the same branch; replace with the squash commit of #953 on `main` after merge.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: `2026-11-21`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------ |
| staging              | `pending` | Not verified                    | Not verified        | Ordinary Web rollout           |
| production           | `pending` | Not verified                    | Not verified        | Rides the next bundled rollout |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

Any Web image built from a `main` commit that contains #953. No schema,
configuration, credential or dependent task applies.

## Ordered rollout

Ordinary Web rollout through the
[release process](../operations/07-environments-and-release-management.md).
No migration, data conversion or activation step applies.

## Verification and completion

Open https://reviewrouter.org at 1440 px and at 390 px: "POWERED BY
OpenCodeReview" is centered above the provider row, the nine providers are
centered, and on the phone the last row (NVIDIA Build) is centered too. No
vertical divider remains in the strip and the page has no horizontal scroll.
The served landing CSS sets `justify-content:center` on `.rr-home-providers`.

## Retry, partial completion, and rollback

Nothing is stored or migrated; a retry repeats the Web rollout. Rollback is the
previous Web image.

## Related links

- [#953](https://github.com/777genius/review-router-ai/pull/953); the provider
  row was introduced in
  [#874](https://github.com/777genius/review-router-ai/pull/874) and extended to
  nine providers in [#878](https://github.com/777genius/review-router-ai/pull/878).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action              |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ------------------------ |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet         | None     | Next bundled Web rollout |
