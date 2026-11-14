# ReviewRouter landing V1 — animation-led, product-first design

Status: **implementation Draft**, 2026-11-14. Base `main`. Scope: **only public `/`** and its local marketing components/style/tests; no dashboard, provider, billing, runtime, deployment or video PR changes.

## Product story (locked by user)

Open-source / free-to-start **platform**, not generic AI review SaaS. Powered by Alibaba OpenCodeReview; supported model subscriptions or API keys; see token usage and **known/estimated** cost and review statistics; hosted control plane or guided self-hosted; clear CI execution boundary. Keep real ReviewRouter symbol/wordmark from `LogoMark`/`layout.tsx`, true brand surfaces (graphite, cyan, lime, restrained fuchsia), local Space Grotesk/JetBrains Mono, both themes. No fake stars, invoices, customer names or AI performance results.

Primary hero `Open-source AI reviews. Your model. Your budget.` with the existing installation-aware GitHub CTA (`HomeCtaCluster`) and source link. No raw diff in hero. Findings visual: **3 short severity titles only**, no verbose paragraphs or fake comment body. Findings are explicitly `Illustrative`; screenreader sees the same semantic content.

### Benchmark treatment

The video PR [#864](https://github.com/777genius/review-router-ai/pull/864) cites the upstream AACR-Bench, same Claude 4.6 Opus: OpenCodeReview 1:23 / 385K tokens vs Claude Code 13:06 / 5,664K. These results are **for upstream engine under test configuration**, not ReviewRouter deployed performance or guaranteed subscription cost. Marketing highlight: `~9.5× faster in upstream test` and `~14.7× fewer tokens` *only with adjacent source and caveat*. If the precise numbers become disputed, use the peer-reviewed paper's broad `5–15× fewer tokens`. Avoid `9× cheaper`, `unlimited`, always-enforced dollar budgets, and `code never leaves CI` as an absolute: authorized external model providers do receive allowed review context.

## Sections, layout, and timing (not a collage)

| Block | Desktop composition | Mobile | Motion (only if visible, respects reduced-motion) |
| --- | --- | --- | --- |
| Header | Existing global header and real `LogoMark`, no new copy or duplicate brand | Reuse existing compact/mobile nav | Existing nav effects only |
| 01 Hero | 12-col split: 5-col heading/CTA, 7-col product finding board; 96px top breathing room; h1 has white/lime hierarchy | Single column, text then finding list; CTA wraps | One short headline/board reveal (300–500ms); **findings count + stacked entries** arrive 1→2→3 at 140ms separation then stop; no endless looping |
| 02 Engine proof | Separate full-width large typography `OpenCodeReview`, two benchmark metrics with simple visual ratio bars and tiny cite; 112–128px separation | Metrics stacked; source visible without hover | Bar expands once on entry, not animated live counters |
| 03 Ownership | One wide genuine-looking dashboard **example** using existing tokens, model choices/usage bar/cost coverage, backed by presentation-only example data (explicitly not real account data) | Dashboard columns collapse, no code/horizontal scroll | Chart/counters reveal on entry, no fabricated realtime or excessive sparkles |
| 04 Your workflow | Three numbered steps in one slim timeline: install app→choose provider/run in customer CI→inline findings + dashboard. Privacy footnote below | Vertical steps with connecting line | One anchored light pulse moves along connector once as each section enters, inspired by PR #864 match-cuts |
| 05 Choose hosting | Two large, visually distinct side-by-side cards: Hosted/free under fair use and Self-hosted/full infrastructure choice. Integrate icons with headings | Single column cards | Subtle hover border + translate up ≤2px; no autoplay |
| 06 End | Existing compact FAQ (3–4 questions) plus short final CTA and existing global footer | Accessible disclosure, no flood | No motion beyond hover/focus |

Section transitions: each has its own background contrast/separator + **96–128px desktop / 64–80px mobile vertical rhythm**, headings aligned with section content. No equal-size feature grid repeated. No ever-moving background waves, 3D/WebGL, mouse trails or extra libraries for decorative effects.

### React Bits / animation implementation boundary

The requested [React Bits Pro blocks](https://pro.reactbits.dev/docs/blocks) provide useful **patterns** (Hero / Showcase / Stats / How It Works / CTA). However its Sept 2026 [license](https://pro.reactbits.dev/license) explicitly disallows publishing the Pro Product or substantial source, including in public GitHub repos; this repo is public. No paid key is present; no protected code may be fetched or committed. Free React Bits uses MIT+Commons Clause, so **do not transplant a shareable standalone component library into this Apache-2.0 repo without legal confirmation**. Implement a few scoped, original motion pieces (CSS transition + `IntersectionObserver` once-only) that achieve the same interaction purpose. If licensing is cleared in writing, later substitute eligible Pro blocks in a licensed private delivery without exposing their sources.

No new dependencies; `home-motion.tsx` client enhancement may use built-in IntersectionObserver and `matchMedia`, with static SSR fully readable as fallback. One observer for all reveal sections; disconnect; no memory leaks; hidden content must never stay hidden when JS is off. CSS bounded to the landing. `prefers-reduced-motion: reduce`: no reveal, no bar motion, no pulsing.

### Video #864 design influence, NOT copied implementation

- 1→2→3 review findings in a growing stack, **short labels** not comment paragraphs.
- Provider choices shown simultaneously with real project provider marks if reused. One selected provider appears emphasized; avoid multiple animated choices at once.
- Review→run stats semantic continuity: a single accent travels between related surfaces, not random wipes.
- Incremental review visualization optional only if remaining scope allows; source PR #864 only guarantees compatible completed snapshots, so don't promise universal changed-files-only behavior.
- Actual ReviewRouter logo in header/global footer; no duplicated fantasy logos; no fake download of video assets.
- Never mount Remotion or video runtime in the public site.

## Files / implementation boundaries

- Modify `apps/web/app/page.tsx`: retain server auth evaluation, `ctaContext`, JSON-LD and meta; replace old home sequence with new hero + proof + dashboard + workflow + hosting + FAQ + final CTA; move big `CompareSection` to its existing dedicated route, link via public nav/CTA.
- Replace/reshape only `home-hero.tsx`, `home-features.tsx`, `home-final-cta.tsx` if necessary. Keep existing `HomeCtaCluster` unchanged to preserve GitHub permission dialog and GitLab beta action.
- New `home-visual-preview.tsx`: small isolated client component showing the hero findings and display-only usage examples, no API or auth.
- New `home-landing.css`: scoped layout, motion + reduced-motion and light-theme overrides. Import only where needed; avoid modifying global dashboard tokens or app header.
- New focused SSR semantics / CTA path tests and a simple visual QA checklist (only count actual CI/browser runs as pass).

### Source/logo handling

Use `LogoMark`, `/review-router-logo.png`, existing `SourceProviderLabel`/`ProviderLogo` for supported marks (verify exports before using), no generated/imitated logo. `src` public assets remain the source of truth. Do not add third-party branded art without license.

## E2E gates

1. Review code for scope, claims, legal assets, interactive semantics, focus/keyboard, redundant text and missing motion fallback.
2. Typecheck/build `@reviewrouter/web` using repository's native script; run focused tests; no skipped/queued = success.
3. Browser screenshots at 1440/768/390, both themes; focus/keyboard navigation; no overflow, no hidden essential text, reduced motion, low-power behavior and contrast. GitHub signed-out/install and signed-in/dashboard CTA branches need real/path-aware tests.
4. Verify source citation for upstream metrics; compare actual 1:23 / 13:06, 385K / 5,664K; avoid claiming ReviewRouter's independent benchmark.
5. CI green and review threads addressed; merge only when **real** checks and visual E2E pass. Do not merge an untested design-only branch.

## Critique/revision passes (plan itself)

**R1 — Marketing:** An earlier concept lead with generic review findings. Fix: platform freedom/open source/own AI and tracked spend first; findings are proof, not the offer. Show hosted vs self-hosted as a genuine choice. No exaggerated budget enforcement.

**R2 — Art direction:** Earlier mockups packed everything into one viewport. Fix: five deeply separated product sections plus FAQ; no other UI palettes; fewer than 3 animated focal regions per viewport; 96–128px whitespace.

**R3 — Animation/UX:** Video transitions do not directly suit scroll pages. Fix: stateful 1→3 findings once, one benchmark bar, one connector light; no time-dependent essential meaning and no perpetual attention-grabbing effects; reduced-motion and offscreen pause.

**R4 — Engineering/legal:** Pro registry not publicly redistributable; SSR and auth risky. Fix: zero Pro code in public repo, no new packages, live CTA untouched, scoped CSS, SSR-first and clear E2E acceptance.

**R5 — Accuracy:** Upstream benchmarks differ by model; known spend is partial and provider may process code. Fix: explicit source/conditions, no automatic invoice guarantee, coverage label, honest CI/provider boundary.

Estimated net new code: **450–850 TSX/CSS lines**, delete/reduce ~300–700 existing landing lines only as required, complexity **5/10**, expected reliability **8/10**, design confidence **8/10**, implementation confidence before E2E **6/10**. Do not expand into dashboard redesign or pricing/billing.

**R6 — Navigation regression (implementation review):** Removing home-embedded compare left global nav/footer and two information pages pointing at `/#compare`. Fix the four real links to existing `/compare` route, retaining `activePath` semantics; this is a scoped navigational repair, not a dashboard refactor.

**R7 — Existing deployed web smoke contract:** `scripts/check-web-pages.mjs` still asserted the removed hero text `Free privacy-first` and `that stays inside your CI`. These are intentionally superseded. Updated the smoke oracle to `Your model. Your budget.` and `OpenCodeReview`, retaining install CTA and all existing session/install redirect tests. CI needs to run the real `web:smoke` to qualify it.

**R8 — Hosted web and social preview:** `scripts/check-hosted-web.mjs` contained 3 more old-homepage fallback strings; updated those as well so hosted smoke does not give false failures. Social image still used the obsolete privacy-only slogan, so changed the OG headline to match the product positioning. Global dashboard SEO defaults remain untouched.
