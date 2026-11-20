# Centered provider row on the landing hero: deployment

- Task ID: `2026-11-21-landing-centered-providers`
- Goal: on reviewrouter.org the strip at the bottom of the hero shows
  "POWERED BY OpenCodeReview" on its own line with the nine supported providers
  centered below it. Wrapped rows, including a short last row, stay centered on
  desktop, tablet and phone. Before, the strip was left-aligned and a wrapped
  last row (NVIDIA Build on a phone) sat alone on the left.
- Affected target: Web only (`apps/web/app/home-hero.tsx`,
  `apps/web/app/home-landing.css`). API, worker, Gateway, native, the database
  and the public Action are unchanged.
- Implementation PR: [#952](https://github.com/777genius/review-router-ai/pull/952).
- Implementation reference: the squash commit of #952 on `main`.
- Dependencies: none. No migration, configuration or feature flag.
- Not included: the hero video still plays V9.3. The rebuilt V9.4 (Grok, GLM
  and MiniMax among the providers) was rendered on 2026-11-16 but never uploaded
  to Mux; switching to it is a Mux upload plus one constant
  (`homeHeroVideo.muxPlaybackId` in `apps/web/app/home-hero-video.tsx`).
- Last updated: 2026-11-21.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------ |
| staging              | `pending` | Not verified                    | Not verified        | Ordinary Web rollout           |
| production           | `pending` | Not verified                    | Not verified        | Rides the next bundled rollout |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Ordered rollout

Ordinary Web rollout through the
[release process](../operations/07-environments-and-release-management.md).
No migration, data conversion or activation step applies.

## Verification and completion

Open https://reviewrouter.org at 1440 px and at 390 px: "POWERED BY
OpenCodeReview" is centered above the provider row, the nine providers are
centered, and on the phone the last row (NVIDIA Build) is centered too. No
vertical divider remains in the strip and the page has no horizontal scroll.
The served CSS contains `.rr-home-providers{...justify-content:center`.

## Retry, partial completion, and rollback

Nothing is stored or migrated; a retry repeats the Web rollout. Rollback is the
previous Web image.

## Related links

- [#952](https://github.com/777genius/review-router-ai/pull/952); the provider
  row came from [#878](https://github.com/777genius/review-router-ai/pull/878),
  the hero player from
  [#875](https://github.com/777genius/review-router-ai/pull/875) and
  [#876](https://github.com/777genius/review-router-ai/pull/876).
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action              |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ------------------------ |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet         | None     | Next bundled Web rollout |
