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
- Implementation reference: squash commit `349d2cec` of #953 on `main`.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: `2026-11-21`.

## Environment status

| Environment / target | Status     | Actual deployed version / image      | Last verified (UTC) | Evidence / next step / blocker                                                      |
| -------------------- | ---------- | ------------------------------------ | ------------------- | ----------------------------------------------------------------------------------- |
| staging              | `pending`  | Not verified                         | Not verified        | Ordinary Web rollout                                                                |
| production           | `deployed` | `a02b1607`, image `sha256:8d9dd8f3…` | 2026-11-21 12:30    | [Bundle 5](2026-11-21-bundle5.md); checked live at 390 px and 1440 px (see the log) |

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

| Time (UTC)       | Environment | Operator   | Actual version / image               | Step and observed result                                                                                                                                                                                                                                                                                                                                                                          | Evidence                          | Next action              |
| ---------------- | ----------- | ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------ |
| Not executed     | staging     | Unassigned | Not verified                         | Not deployed yet                                                                                                                                                                                                                                                                                                                                                                                  | None                              | Next bundled Web rollout |
| 2026-11-21 12:30 | production  | D5         | `a02b1607`, image `sha256:8d9dd8f3…` | Web swapped at 12:28. Live https://reviewrouter.org: the served CSS sets `justify-content:center` on `.rr-home-providers`; no `rr-home-hero__divider`; at 390 px the nine providers wrap 4/4/1 with equal gaps on both sides of every row (10/10, 31/31, 125/125 px), at 1440 px one row centered on the viewport with "POWERED BY OpenCodeReview" above it; no horizontal scroll at either width | [Bundle 5](2026-11-21-bundle5.md) | None.                    |
