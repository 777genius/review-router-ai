# ReviewRouter landing — critical template audit
As of 2026-11-14. **This is source-level research, not a rendered browser audit.** Read [deep candidate comparison](./landing-template-deep-research-2026-11-13.md) first.

## Decision to reconsider

Previous reports ranked Tailark Dusk 7 as if it were already a "living" ready-to-deploy website. This overstates what is shipped: hero 7 is a mostly static React Server Component whose product is an image. It has two example links with `href="#"`, a generic `/mail2.png` screenshot, an external Unsplash image and a logo cloud. Its full landing composition imports pricing, generic stats and other marketing blocks. User wants **a live product story with minimal text**, not a generic CRM landing with new colors. Therefore the exact complete page is **not** a drop-in replacement. Treat it as a high-quality layout reference and reusable shell.

Other previously overstated facts:
- Velora free has **one complete SaaS landing design across nine routes**, not nine alternative landing designs; marketing claims about "perfect Lighthouse" are not independently verified.
- Launch UI has one free site with 9 marketing sections, not 9 separate template worlds.
- Actual browser-rendered and keyboard comparisons of vendor demo sites have not yet been performed because the available GitHub source connection cannot run their pages, and local container DNS cannot reach external sites.
- No normal `.test.`/`.spec.` checks and no CI workflows were found in the inspected repo trees of Tailark, Launch UI, Velora or Page UI (not proof tests don't exist elsewhere). ShadcnStore has deployment workflow. ReviewRouter itself has extensive tests; template labels saying "production-ready" are not release evidence.
- Commons Clause libraries (React Bits, Animate UI) explicitly allow embedding in applications but restrict selling/redistributing the **component libraries themselves**. This is nuanced; not a categorical ban on using them in an OSS app, but reviewing redistribution in a public repo is necessary.

## Proof from specific source files

**Tailark Dusk hero 7:**
`registry/bases/radix/dusk/blocks/hero-section/seven/hero-section.tsx`
- 84 LOC; server component, no state/JS interaction; contains a CRM headline, two placeholder `#` CTAs, product image `/mail2.png`, one Unsplash image and logo cloud.
- It returns its own header AND `<main>`; copying directly into ReviewRouter's existing `<main>` and global header would duplicate landmarks and navigation.
- Page 7 composition imports 9 blocks incl. pricing, FAQ, call-to-action and footer. Porting the entire page adds filler or false claims; copy layout scaffolding rather than every block.
- Some other Dusk features import `dotted-map` and `recharts`; avoid bringing irrelevant map/chart dependencies. Hero 2 has `max-sm:-mr-56` intentional mobile crop; should not hide the product preview or its meaningful status labels.
- Dusk may be installed with Radix UI registry (not default Base UI), but shadcn init and arbitrary global token injection would clash with the existing product. Use isolated staging and selective integration.

**Velora complete SaaS:**
`src/app/templates/saas/page.tsx` ~673 LOC; imports many decorative pieces (Aurora, blur reveals, animated text, marquee, Dock, Bento, NumberTicker) and sample testimonials, numbers, pricing and logos. Good full landing example, poor drop-in: you'd delete large parts.
- Core `src/components/velora/blur-fade.tsx` and `number-ticker.tsx` use `useReducedMotion`; this is a positive real implementation detail, but it doesn't guarantee accessibility for the whole page.
- `src/components/blocks/hero-screenshot.tsx` is ~334 lines and demonstrates a FAKE analytics screen, not an authenticated ReviewRouter preview. Importing this along with real dashboard components creates duplicate UI and risks invented data.
- Repository docs supply compressed per-component sizes but those are not **measured full-page bundle/LCP/INP** in the ReviewRouter build. Avoid conflating.
- Current repo Next/React versions differ slightly; copying individual TSX patterns avoids needless runtime upgrades.

**Launch UI:**
`components/ui/section.tsx` establishes clear `py-12 sm:py-24 md:py-32` spacing, while `components/sections/hero/default.tsx` is ~130 LOC, mostly server-rendered screenshot + CTA with existing section organization. Good selective donor for breathing room and semantic layout. But static; not a ready-made dynamic product demo.

**Page UI Gnomie AI:**
`components/landing/LandingProductTour.tsx` uses Radix Tabs; the template's `3-product-tour.tsx` includes actual selectable video panels, which is the best end-user UX reference. The full `gnomie-ai.tsx` forces its own theme to light via `useThemeStore/useThemeSwitch`, introduces `BrickProvider`, and uses videos on `cache.shipixen.com`. Port only tab interaction idea, never global theme or external demo assets. Product-tour source is not a universal runtime dependency of ReviewRouter.

## Product-claim gate

Existing ReviewRouter `docs/capabilities.md` supports provider selection, review statistics and **known** token/cost data, but coverage can be incomplete and optional features vary by rollout. The account-limit docs explicitly distinguish observed quotas/estimated usage from enforceable dollar spending limits. **Do not advertise "enforced budgets", absolute "full cost control" or exact zero dollars unless implemented and proven.** Preferred copy: **Bring your AI. Choose the model. See known tokens and estimated costs.** Point to details for missing coverage.
- Free-to-start is under `/fair-use` quotas; AI/CI charges are external.
- Default self-managed CI executes the review, but selected model provider receives review context; avoid "code never leaves the network".
- Alibaba upstream benchmark reports roughly 9× fewer tokens than Claude Code in test conditions, faster average time and *lower recall*; not ReviewRouter's own 9× wall-clock or cost measurement.

## Revised decision matrix

Subjective engineering/product-fit assessment (1–10, source-backed where noted, unmeasured UX columns marked subjective). WEIGHTS: visual comprehension/section hierarchy 30%, compatibility/risk 25%, ready-made usable source 20%, functional motion 15%, license/maintainability 10%. These are not Lighthouse scores or comparative controlled browser tests.

| Candidate | Hierarchy 30 | Fit/integration 25 | Reuse 20 | Motion 15 | License/maturity 10 | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Tailark Dusk 7 **as complete page** | 8.5 | 6.5 | 6 | 2 | 7 | Not an actual ready dynamic site; includes CRM filler |
| Tailark Dusk 7 **as section shell** | 9 | 8 | 8 | 3 | 8 | **Preferred shell donor** |
| Tailark Dusk 2 **as hero shell** | 9 | 8 | 8 | 2 | 8 | Good wide screenshot alternative, check mobile crop |
| Launch UI sections | 8.5 | 9 | 8.5 | 3 | 8 | Safest engineering/SEO donor |
| Velora **whole SaaS site** | 7 | 5 | 5.5 | 9 | 6.5 | High decoration and code/UX clean-up |
| Velora **selected screenshot/motion blocks** | 8 | 7.5 | 7 | 8 | 6.5 | Good selectively, avoid duplicate dashboard |
| Page UI Gnomie **whole site** | 7 | 3.5 | 5 | 6.5 | 7 | Theme and externally hosted video problem |
| Page UI **product-tour interaction only** | 9 | 8 | 7 | 8.5 | 7 | Most effective single product-UX pattern |

Scores are illustrative evaluations to make trade-offs explicit. Do not cite them as benchmarks.

## What could beat every template?

A **zero-template baseline** is worth comparing: rewrite only `home-hero`, `home-features` and section ordering in existing Next App Router, using real ReviewRouter components, tokens and logo, while using Dusk 7/Launch UI for spacing references. This may yield fewer dependency, auth, nav, theme and legal risks than installing any external page. It also forces custom design effort and should be compared in actual side-by-side browser prototypes, not assumed winner.

Proposed AB/C proof-of-concept within same local branch:
A. Tailark Dusk 7 **shell-only** + own severities UI.
B. Launch UI **section-only** + own severities UI.
C. Existing ReviewRouter restructured to the same content with zero copied code.

Use **exactly the same** copy, screenshots, sections and palette in all 3. Only then can we compare spacing, scanability, interaction feel, mobile behavior and measured runtime fairly. Velora's free Motion primitives can be considered for one interaction AFTER choosing a page structure. The comparison should not introduce mock customer stats or external placeholder assets.

## UX rules not solved by a template

- First 5 seconds: visitor understands product + open-source/free-to-start + own AI; primary CTA unambiguous.
- Hero: H1, <=2 lines of explanation, 3–4 compact **severity + title** labels, no code diff or multi-line comment; labeled sample illustration.
- Large vertical separation between hero, benchmark, product dashboard, 3-step CI diagram and hosted/self-hosted choice. Use separate surfaces/spacing and composition rather than endless equal-height cards.
- Product tour: one click or keyboard selection swaps relevant sample view, but controls use actual buttons/tabs with focus, arrow keys, visible selection and reduced-motion. Avoid fake live/production data.
- Data: show authenticated/real approved screenshot OR static example values explicitly labeled; avoid exposing private customer workspace data.
- CTA: re-use auth-aware `HomeCtaCluster`, existing GitHub App permissions dialog, signed-in dashboard routing and GitLab secondary behavior. Do not copy template `href="#"`.
- Never replace the app's theme initialization, root layout, SEO/JSON-LD, legal/footer, fonts or shared Radix primitives. No premature i18n for landing copy.
- Runtime targets (goals, not measured): LCP <= 2.5s, INP <= 200ms, CLS <= 0.1 at 75th percentile across devices; no auto-playing large video or heavy WebGL by default. Google: https://web.dev/articles/vitals.
- Validate 390/768/1024/1440 viewports and both themes; keyboard/zoom, motion disabled, real long labels; actual screenshots and browser E2E before merge.
- Check external asset licenses per image/video/font; pin source commit and preserve MIT copyright notice. A repository MIT license does not automatically license arbitrary imported third-party artwork.
- After page selection: run `impeccable audit` and `detect` with target and 390 mobile viewport as a **supporting QA tool**, never treat its score as evidence of conversion or user comprehension.


### Weighted-score sanity check (important correction)

Using the declared 30/25/20/15/10 weights above and the subjective 1–10 category scores, the **computed** full-shell scores are: **Launch UI 7.75; Dusk 7 shell 7.55; Dusk 2 shell 7.40; Tailark Dusk 7 complete site 6.38; Velora whole site 6.45; Page UI whole site 5.65**. Velora selected screenshot/motion blocks score 7.53, but this is a **component-donor** evaluation rather than a complete page candidate; likewise the Page UI product-tour interaction is not comparable with a full layout. These ratings have no controlled user-study or browser-performance evidence.

This reverses the earlier unconditional “Dusk wins” narrative: **if integration risk and clarity carry the declared weights, Launch UI narrowly leads**. Tailark may still win a *visual-authenticity* evaluation after real side-by-side prototypes, but it is not proven from the source alone. Our recommended next decision is therefore **compare Launch UI vs Tailark Dusk 7 visually with the same real product assets and content**; keep Velora as the animation-only fallback rather than assuming a full-site transplant is better.

## Updated recommendation

**Do not clone one full marketing site into ReviewRouter.** Compare **Launch UI and Tailark Dusk 7 as alternative layout donors**, implement one bounded 4-state findings demo using existing React/Radix UI, show one real analytics dashboard preview, and use custom CSS or a single MIT Motion primitive for animation. This best balances visual originality, shipping safety, accessibility, and reusability. The current Draft PR is research-only; no candidate has an E2E-qualified implementation and none should be merged as a landing change.
