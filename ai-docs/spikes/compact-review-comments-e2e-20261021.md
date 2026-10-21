# Compact review comments: presentation E2E

Observed 2026-10-21. Both real GitHub publisher paths passed against the existing
disposable repository `777genius/rr-selfhost-direct-v2-e2e-20260730t120036z`.
These presentation canaries made no model calls and did not change repository
files. They are separate from a normal runtime workflow review canary.

## Observed behavior

| Case                                      | Result                                                     |
| ----------------------------------------- | ---------------------------------------------------------- |
| GitHub picture and img fallback           | Kept by GitHub sanitization                                |
| Light and dark HTTPS SVG                  | Both loaded through real Camo with HTTP 200                |
| Actual WebP data URL in a PR comment      | Raw body kept data; rendered img lost src                  |
| Unavailable banner path                   | HTTP 404; publication and full native text remained usable |
| Zero findings with incomplete review      | Visible incomplete warning; no All Clear                   |
| Four findings at the same location        | Four balanced disclosures retained                         |
| Repeated publication                      | Same comment ID; no extra summary                          |
| Exact reviewed-head links                 | Matched the immutable PR head and real file                |
| Action previous threads/provider/coverage | Visible warnings preserved                                 |
| Existing comments                         | Preserved; test comments deleted after proof               |

SaaS canary: PR 2, head `cdf5c9ae068c2019516ca70b3ad151366d9e0ca5`,
comment 6323721307. Action renderer→CommentPoster canary: PR 16, head
`1fd8310b24c85be679d0c94350b58baa6ad3dcf3`, comment 6323720986.
The Action posted complete/incomplete bodies of 1808/1901 UTF-8 bytes and updated
one ID. The SaaS base64 probe used a real 7766-byte WebP. It was appended directly
to the canary comment for the transport test; the product finding-body limit was
preserved. Earlier API-only PNG/WebP experiments are recorded in
[the base64 spike](github-base64-image-rendering-20261021.md).

## Endpoint and implementation evidence

The public `https://reviewrouter.org/review-banner/v1.svg` endpoint returned the
SVG MIME type, ETag, 304 for a matching validator and 400 for invalid counts.
The unrelated quoted validator `"other,*,also"` returned 200. 33 route tests cover
validation, all 11 locales, both themes and cache edge cases. Publishing and
Action focused suites, typecheck, lint, builds and exact-head CI passed.

Web-only production image:
`sha256:e80140d0e056e1efa73ac87c78d0bf516d1c6ba418d4923b9959aeb56dd865be`.
It derives from installed image c42d7e23 plus only the versioned route files at
`f55e37f0edc992aea1403749d9263f7cad8f217f`. The normal protected PR is
[review-router-ai#636](https://github.com/777genius/review-router-ai/pull/636),
merged as `665eade2838c10d930dbd195ac69d9f6b7ff60df`. The finite web-only operator
proved unchanged web settings and exact API/worker identities. API health passed;
there were no database migrations or provider calls in this operation.

The public Action change is
[review-router#298](https://github.com/777genius/review-router/pull/298), merged as
`b4d8bd5676841b5a1967618bab460a5046bcbf30`. Version/channel publication and installed
workflow adoption follow the normal release procedure; a merged source change
does not imply every exact-SHA installation has updated.

Local disposable proof lives under `tmp/compact-review-e2e/`,
`tmp/compact-review/action-live/` in the Action checkout and the web release
worktree's `tmp/banner-production-apply.json`. The repeatable SaaS canary is
`scripts/compact-review-comment-e2e.ts`. It writes progress before further effects
so an interrupted run can be reconciled without blind replay.

## Visual QA

Sanitized HTML returned by GitHub was rendered locally with GitHub-like CSS at
320,390 and1440 px in light/dark themes, with disclosures closed/open:60 states.
Native summary clicks opened details, images loaded, no nested disclosures or
horizontal overflow occurred. Representative screenshots were inspected by hand.
This checks the returned comment content and layout; it is not a screenshot of
the authenticated GitHub page. Files and receipt: `tmp/compact-review-e2e/visual/`.
