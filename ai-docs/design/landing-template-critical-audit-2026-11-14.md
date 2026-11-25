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


## November 14 follow-up: two previously missed complete-site sources

### Forge by freedesignmd: unusually relevant, check it before selecting Dusk

- [Live developer-tools/code-review demo](https://freedesignmd.com/landingpage/forge-devtool) and [MIT source](https://github.com/tammo1007/freedesignmd-library/blob/main/landingpages/forge-devtool/Page.tsx). Source is a single **1,571-line / ~83.8 KB TSX** file importing only React plus a matching `DESIGN.md`. The parent GitHub project is small (~12 stars on Nov 14 2026) with a MIT license and no conventional CI workflow located in the tree; vendor "pixel-perfect" claims were not independently verified.
- Genuine product-motivated animations: terminal typing, scroll-drawn PR timeline, staged findings, scroll-scrubbed execution graph and cursor-lighted integration borders; uses 7 `useEffect` calls, `IntersectionObserver` and rAF throttling with explicit cleanup for relevant event listeners, and `prefers-reduced-motion` CSS. Not a measured Core Web Vitals result or functional live ReviewRouter demo.
- Critical fit problem: default hero is a **terminal**, plus an annotated **diff with text comments**, both explicitly unwanted. It claims unverified "merge in ~90 seconds", 2.1 million PRs/month, 3,400 customers, 96.4% cache hits, and has unrelated per-seat billing calculator and photos. **All must go.** No customer logos or fake success metrics may carry over.
- Architectural fit problem: TSX file has React state/hooks but no Next.js App Router `"use client"` directive; copying it directly into the server root page would break the boundary. Prefer extracting only product animation primitives as small isolated client islands. It includes its own `Nav`, `<main>`, `Footer` and embedded styles and would duplicate the real app shell.
- Provisional **whole-layout fit ~7.70/10** under the same subjective weights as above (hierarchy 9.5, integration 6, reusable code 7, functional motion 9, license/maturity 6). **Launch UI was 7.75** and Tailark Dusk shell 7.55, within evaluation noise. Thus Forge joins the head-to-head prototype shortlist; the rankings are not proven without renders.

### InstaLanding.ai: visual diversity, poor direct Next.js integration

- [Live gallery](https://instalanding.ai/pages) and [MIT source](https://github.com/RayVelez27/instalanding.ai); **95 complete single-file HTML page directories** in the November 9 2026 GitHub README (library has ~136 stars on Nov 14), including `mirador-observability-page`, `hazard-terminal-security-page`, `corelane-build-cluster-page`, `monax-analytics-landing-page`, and `tessel-ai-infrastructure-page`. There are also motion studies and design-token system references.
- These are visually interesting because they demonstrate moving product interfaces, not just generic SaaS logos. However some include Google Fonts, GSAP/ScrollTrigger and Lenis over CDN; "one HTML file/no build" does **not** necessarily mean zero network or zero JS dependencies.
- Source audits found examples of **~81 KB** (`tessel`), **~99 KB** (`hazard-terminal`), **~133 KB** (`monax`), **~169 KB** (`mirador`) and a **~459 KB** single-file `corelane` HTML. These are **source file sizes, NOT compressed transferred assets**. A network-free local render and bundle measurement are still required.
- These pages are **reference-only** until selectively ported to React/Next and checked for accessibility, authorship/asset provenance, responsive behavior and performance. The repository README itself notes that some demos incorporate external third-party works and their own terms.
- Ranking: best for **original visual inspiration** but below Forge/Tailark/Launch as direct implementation source for a mature React monorepo.

### Revised short experiment

Build three **same-brand/same-content** isolated preview routes using the true ReviewRouter product, not template marketing examples: **A) Launch UI shell**, **B) Tailark Dusk 7 shell**, **C) freedesignmd Forge's review/CI interaction architecture with code/diff/terminal removed**. Add a fourth baseline only if the native existing page refactor remains plausible. Run the same a11y/performance and real CTA tests, then select; don't infer a winner from popularity or source scores. Velora remains optional motion donor. All must keep the actual logo, ReviewRouter typography and palette, real user install/auth flow, and accurate upstream benchmark and usage limitations.


## Second independent audit — 2026-11-14, latest main and public homepage

**Inputs:** public page https://reviewrouter.org opened as rendered-page text (NOT a visual/interactive browser capture); ReviewRouter GitHub main `b0b47c82d422289ff966d92660ddb037ec0448f8`, specific `apps/web/app/*` paths read through the connected GitHub account; template sources and primary UX/accessibility/performance references.

### A. Why the live page is cognitively crowded (verified content structure)

The root App Router page `apps/web/app/page.tsx` renders `HomeHero`, `HomeFeatures`, `CompareSection`, `HomeFaq`, `HomeFinalCta` in sequence. The corresponding 7 TSX source files including `HomeCtaCluster` total ~58 KB **source text** (NOT network payload), and the main public `compare-section.tsx` is ~25 KB source. The page has:
- The hero contains three setup steps with explanatory paragraphs, three extra security/status signals and GitHub/GitLab calls to action. Desktop/mobile step markups both exist in source for breakpoints; do NOT count both as simultaneously visible.
- Six feature rows repeat privacy, keys and source themes, each with explanatory copy, plus a separate boundary diagram.
- A long eight-competitor matrix and execution-boundary comparison consume homepage real estate despite a dedicated `/compare` page already rendering `CompareSection` with heading-level support.
- Six FAQ questions and a separate final CTA repeat many explanations.
- Styling across a ~2,042-line global stylesheet, with `home-shell` grid/glows and extensive `setup-blueprint` classes, makes simple copy replacement alone insufficient. Do not delete a large unreviewed CSS range: dashboard and landing styling are interleaved.

**Recommended highest-value change before ANY template transplant:** remove full `CompareSection` from homepage and link to `/compare`; reduce hero to the proposition + real product preview, move setup explanation to short three-stage visual lower down, keep 3–4 essential FAQs with a full-doc link, and show one benefit per visually separated section. **Update BOTH** primary navigation `/#compare` and footer `/#compare` links to `/compare` before deleting the anchor; otherwise links break.

### B. Actual product flow and marketing truth (important contradictions)

- `HomeCtaCluster` shows a real authentication-aware GitHub App install permission dialog (or workspace dashboard for connected sessions), **and a second prominent solid-style disabled GitLab button**. The underlying `GitLabBetaConnectButton` is explicitly disabled with "In development". This competing dead CTA should not visually equal the primary start action. Reposition as small status info without removing codepath; the current README explicitly says GitLab in development. A code-level GitLab wizard is not evidence that it is ready for public conversion.
- Existing `public-urls.ts` maps `reviewRouterGitHubRepoUrl` to **777genius/review-router** (Action/runtime), not **777genius/review-router-ai** (the full application). Both are valid projects but an "Open source platform" CTA must clearly link to the PLATFORM repository as well; link Action and upstream Alibaba OCR separately. Do not silently repoint support issue links that intentionally use the Action repository.
- Existing dashboard usage code explicitly has `unknown` and `partial` coverage and shows known/estimated costs, not always dollar-accurate bills. "Full spend control" is not the same as an enforceable budget or provider-native quota guarantee. Avoid a fake "set $10 monthly limit" interface if there is no qualified command implementing it.
- The default GitHub code checkout/review runs in customer-authorized CI; the **chosen AI provider** still receives the supplied review context. The optional encrypted hosted-account pool differs in credential/data boundaries. Do not use "100% never leaves your network" language or assume every provider mode is available for everyone.
- Current hosted UI is free-to-start subject to fair-use quotas, while third-party AI subscription/API use and CI may incur charges.
- OpenCodeReview's published benchmark is *upstream*, ~one-ninth the tokens under compared conditions versus Claude Code and faster average time, but has **lower recall**; it does not certify 9× wall-clock speed or guaranteed ReviewRouter billing reduction.

### C. Newly discovered competitor pitfalls

- [Shadcnblocks Mainline GitHub](https://github.com/shadcnblocks/mainline-nextjs-template) has ~374 GitHub stars and a real complete multi-page design. Its public marketing page describes **Next.js 16** but the current source package specifies **Next.js ^15.5.5**. LICENSE is **MIT + Commons Clause** (main restriction: not selling template substantially unchanged). Extra `next-themes`, MDX, forms, server-actions and Motion would duplicate our app infrastructure. This is not automatically ineligible, but scores below Launch/Tailark for reuse.
- [Kairo UI](https://www.kairoui.online/templates) presents ~13 published designs and MIT/source-install claims through mutable shadcn registry JSON endpoints. An independently pinned public GitHub source repository for these specific templates was not established here; the author says some designs are inspired/adapted from others. **No automatic copy until exact license, author provenance and content hash are captured.** Interesting reference, not a stronger production candidate on current evidence.
- **Tailark source-to-site drift:** the OSS GitHub tree's last push observed July 29 2026, while its official site changelog mentions further September 2026 content. Version matching between web preview/registry and GitHub source is not established. Pin exact source commit instead of treating newest site preview as matching repository files.
- **Velora source-to-platform drift:** full SaaS page has many example testimonials, pricing, logos and gradient/marquees; importing its page and replacing everything is likely more work than porting 1–2 selected screenshot/motion blocks. No controlled Lighthouse results verified.
- **Forge** has stronger PR/CI animation than generic SaaS templates, but its React-only single-file code has its own header/footer/main, includes hypothetical company numbers/pricing and needs client/server separation. Treat Forge as an interaction reference, not a literal site.
- **Mainline, Kairo, React Bits, Animate UI** include permissions or additional non-standard redistribution constraints not implied by "open source" alone; treat embedded application use and component-library redistribution separately. Read final license at the pinned version.

### D. Independent usability/performance evidence and consequences

- [NN/G progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): initially show essential choices, put advanced features behind clearly labeled paths. **Applying here:** review sample, own AI and source link on first screen; comparison, privacy/legal detail and long FAQ elsewhere. But don't delete all descriptive copy: the headline must say "AI code review for pull requests" plainly, not merely "On your terms".
- [NN/G information scent](https://www.nngroup.com/articles/information-scent/): too little introductory context behind generic imagery makes users leave before scrolling. **Applying here:** one H1 with category/value + one short sentence + recognizable PR/finding UI and labeled action. "Free" needs scope: free platform, not necessarily free inference.
- [NN/G motion](https://www.nngroup.com/articles/animation-purpose-ux/) and [scroll animation study](https://www.nngroup.com/articles/scroll-animations/): motion is attention-grabbing; animate meaningful state changes only, never require visitors to wait for each paragraph to appear. Effects triggered by scroll should appear once on supplemental graphics, not primary H1/copy.
- [W3C WCAG 2.2 animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions) (AAA) advocates disabling non-essential motion, e.g. `prefers-reduced-motion`; [web.dev](https://web.dev/articles/css-web-vitals) discourages layout-affecting animation. User can understand static/frozen page equally well.
- [Chrome UX Report thresholds](https://developer.chrome.com/docs/crux/guides/pagespeed-insights): evaluate LCP <=2.5 seconds, INP <=200 ms, CLS <=0.1 at 75th-percentile *field data*. Lighthouse lab measurements are diagnostic and CANNOT prove field p75.

### E. Do not overpay for proving a template

Previous plans suggested three **complete** template prototypes; that would be inefficient given a mature Next.js production app. Instead:
1. Record screenshots/current behavior of baseline (not yet done). Freeze same brand, copy, logo and sanitized fixture in each candidate.
2. Build only **two first-viewport prototypes**: native-layout simplification vs Launch UI section shell. Dusk 7 is challenger if it materially improves hierarchy/visual identity in source/wireframe evaluation; Forge only donates one interaction concept.
3. Run one desktop+one mobile accessibility/legibility pass; show user the two actual browser captures. Short 5-second comprehension review by non-contributor readers (what is it, free vs paid, what CTA does) helps judge hierarchy; tiny samples are qualitative, not statistical A/B results.
4. Lock a single layout, implement all 5 major sections in a single route with existing Server Components. Add one isolated Client Component for selectable severity findings (button with `aria-pressed`, keyboard focus) and possibly simple CSS graph animation.
5. End-to-end test signed-out, auth-connected, install-url unavailable, reduced motion, both themes, navigation `/compare`, GitLab disabled, self-host links and source license links; run actual browser screenshot comparison and focused typecheck/lint. No queued or skipped CI counts as success.

**Selection principle:** choose smallest change that demonstrably improves first-viewport comprehension, real product visibility and responsive design. There is *no verified winner* from source stars/subjective 7.75 scores. Native re-layout is a real candidate; if layout-donor source does not prove better, don't copy it.

### F. Suggested architecture sketch (no code committed)

- `page.tsx`: retain async server auth/installation computations, JSON-LD and metadata.
- `home-hero.tsx`: small Server Component with headline, primary CTA and sample visual.
- `home-review-demo.tsx`: single tiny client island with four short severity titles, no code diff/comment paragraphs, no auth API and no private workspace queries; label it *illustrative*.
- `home-efficiency.tsx`: static, sourced ~9× tokens chart and caveat. Use SVG/CSS, not a new charts dependency for two bars.
- `home-product-proof.tsx`: approved, sanitized actual dashboard image(s), one changeable tab only if useful; private authenticated dashboard React Query components are NOT marketing primitives and must not be imported wholesale.
- `home-how-it-works.tsx`: three-step review pipeline, source boundary labels and CI/provider split.
- `home-hosting.tsx`: two choices hosted/fair use and guided self-hosted, + source CTA.
- `/compare`: retain full existing comparison content, independently accessible; adjust nav and footer links.
- Shared UI and CSS only; preserve `next/font/local`, existing global header/footer and all other private feature routes.

**Estimate before actual implementation:** native refactor 400–900 lines of meaningful UI/CSS change (including careful cleanup of old `setup-blueprint` CSS), selected Launch UI shell 500–1,000, Dusk shell 650–1,200, Forge copy-and-refactor 800–1,600; these are **planning ranges, not measured diffs**. Complexity native 4/10, Launch 5/10, Dusk 6/10, Forge 7/10. Confidence in *ranking* medium until actual browser render. No production deployment authorized by research task.
