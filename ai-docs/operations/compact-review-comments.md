# Compact review comments

The GitHub Action and SaaS/GitLab publisher render findings from validated review
results. The comment starts with status and nonzero severity counts. One to three
findings have a short first-paragraph preview; larger results use compact
collapsible findings. Full bodies remain in the comment and the JSON artifact.
Action coverage, provider failures and active previous threads stay visible;
technical data is grouped under Review details.

## Optional GitHub banner

The native Markdown is complete without images. The banner is off by default.
For a direct Action step, set `REVIEW_ROUTER_REVIEW_BANNER=1` in that step's
runtime environment. It uses the configured trusted ReviewRouter web origin.
Reusable workflows need to provide this value inside the called workflow;
caller environment variables are not an additional workflow input.

The SaaS CLI accepts `REVIEWROUTER_REVIEW_BANNER_BASE_URL` and
`REVIEWROUTER_REVIEW_STATE=complete|incomplete`. Supply the state from trusted
review coverage, never from a model-written summary. No state or an invalid
state means no banner. GitLab stays text-only.

The public `/review-banner/v1.svg` route renders a deterministic SVG from state,
language, theme and severity counts. It has no database access or per-review
storage. It never accepts review IDs, repository names, titles, paths or source
code. Counts must be integers from 0 through 9999. Invalid inputs return 400;
valid responses include an ETag and immutable caching. A visual template change
must use a new URL version.

GitHub receives ordinary HTTPS URLs in a picture element with an img fallback.
Publication never downloads the image first. A failed image does not remove text
or stop publication. The endpoint must be live before enabling the banner.
Base64 data URLs are unsuitable: GitHub removes their image src attributes.
See [the rendering experiment](../spikes/github-base64-image-rendering-20261021.md).

## Presentation canary

Use the existing disposable repository; no new test repository is necessary:

```sh
pnpm exec tsx scripts/compact-review-comment-e2e.ts --publish
```

The script checks the public endpoint, a real publisher comment, full raw text,
exact reviewed-head links, GitHub sanitization, a real Camo load, an unavailable
image, incomplete results, four same-location findings and repeated upsert.
It deletes its own comment after success and saves evidence under
`tmp/compact-review-e2e/`. Pass `--base64-fixture PATH_TO_WEBP` to verify stripping
of a real data URL in the published comment, or `--keep` to retain the canary.
It records the comment ID before additional mutations so a failed run can be
reconciled from `progress.json`. Do not blindly rerun after an unknown outcome.

Deploying the banner or merging Action main does not repin installed hosted
workflows. Exact-SHA installations adopt a new Action through the normal
producer qualification and workflow update/reseed process described in
[release operations](07-environments-and-release-management.md).
