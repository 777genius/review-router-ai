# ReviewRouter landing template — deeper research

Updated 2026-11-13. **Research only; no template selected, no homepage integration or visual E2E performed.** This document supersedes the earlier preference for Launch UI.

## Brief and product truth

Preserve existing ReviewRouter cyberpunk branding, colors (graphite, cyan, lime and restrained magenta), local fonts, actual logo, navigation, authentication-aware GitHub App CTA, theme system and shared Radix components. The need is not a rebrand: it is a better-paced, high-contrast, image-led public homepage, with distinct full-width sections, less copy, and one or two meaningful interactions.

Messages in priority order: open-source and free-to-start under fair use; Alibaba OpenCodeReview's focused review engine; user's own supported subscription/provider key; known token and cost data and review statistics; hosted and self-hosted deployments. The hero shows 3–4 severity badges with **short finding titles only** — no raw code or long AI comment bodies. Keep open-source source/license links visible.

**Benchmark:** Alibaba OpenCodeReview reports roughly 1/9 token consumption compared with Claude Code in its benchmark and faster review, with lower recall. Do not claim 9x faster wall-clock, 9x lower actual invoices or independent ReviewRouter verification. Source: https://github.com/alibaba/open-code-review#benchmark ; ReviewRouter source: README.md#review-engine.

## What exists in source (MIT candidates)

| Candidate | Verified free scope | Fit /10 | Adoption/integration notes |
| --- | --- | ---: | --- |
| [Tailark Dusk](https://github.com/tailark/blocks) | **10 separate full Radix landing pages**, 39 Dusk blocks, MIT; no account or API key | **9.4** | Best page structure and strongest match for existing dark technical brand; shadcn registry requires controlled staging, not full init in this repo. ~2,343 stars; last repository push July 2026, site kit updated July 2026. |
| [Velora UI](https://github.com/ColorlibHQ/velora-ui) | Full multi-page MIT SaaS site plus ~100 animated components, Next.js 16/React 19/Motion | **9.0** | Best full-site-with-motion option; but site includes many decorative effects, redundant auth/pricing/blog and newer React/Next package versions. ~62 stars, pushed November 2026. |
| [Launch UI](https://github.com/launch-ui/launch-ui) | MIT free source has 9 marketing sections, screenshot frame and stats; many polished extras are paid | **8.7** | Very easy section/layout reuse, restrained motion, good section spacing. Less distinctive when used unmodified. ~874 stars, pushed November 2026. |
| [ShadcnStore Frontier](https://github.com/shadcnstore/shadcn-dashboard-landing-template) | MIT full landing plus dashboard in Next/Vite versions | **8.3** | Great screenshot-first feature rows, but uses Base UI and has an unrelated dashboard; port only marketing layout. ~1,263 stars, pushed October 2026. |
| [Gonzalo Chale SaaS Landing](https://github.com/gonzalochale/saas-landing-template) | MIT Next.js 16/Tailwind 4/shadcn full landing | **7.0** | Newer stack and low integration barrier, but generic visual narrative; ~186 stars. |
| [Precedent](https://github.com/steven-tey/precedent) | MIT Next.js components and marketing starter | **6.5** | ~5,118 stars, but last pushed October 2024; older dependencies. |
| [Lumen SaaS](https://github.com/MiddleSugar7000/lumen-saas-landing-page-template) | MIT full dark HTML landing with Three.js, GSAP, Lenis | **6.2** | Visually unusual and cinematic, but HTML-to-React conversion, performance budgets and ~4 stars make it unsuitable as production foundation. |
| [Cruip Open](https://github.com/cruip/open-react-template) | Complete popular dark landing; GPL/redistribution caveats | **reference only** | Do not port code into Apache-2.0 ReviewRouter without explicit license review. |
| [Magic UI App Template](https://github.com/magicuidesign/app-template) | Full small landing is public but repository contains no explicit LICENSE file | **reference only** | No reliable broad reuse license identified; official premium Startup template is paid. |

Popularity is a GitHub API snapshot, not a quality score. Ratings are comparative professional judgments of fit, not browser measurements, Lighthouse results or conversion data. Source trees and selected page components were inspected; official live demos were not captured in an actual browser in this session.

## Specific Tailark Dusk pages verified in the free Radix source

Source paths under registry/bases/radix/dusk/pages/landing/{one,...,ten}/landing-page.tsx confirm ten separate complete TSX page compositions.

- **Dusk Landing 7:** split hero, short left headline and CTA, large product image to the right. Most similar to the user's preferred ReviewRouter variant A, but with better whitespace. See https://github.com/tailark/blocks/blob/main/registry/bases/radix/dusk/pages/landing/seven/landing-page.tsx and blocks/hero-section/seven/hero-section.tsx.
- **Dusk Landing 2:** large headline and a wide screenshot-led hero below, stronger one-big-product-screen presentation. See https://github.com/tailark/blocks/blob/main/registry/bases/radix/dusk/pages/landing/two/landing-page.tsx and blocks/hero-section/two/hero-section.tsx.
- **Dusk Landing 10:** large product montage under simple split headline; more visual, but layered screenshot montage needs content cleanup. See https://github.com/tailark/blocks/blob/main/registry/bases/radix/dusk/pages/landing/ten/landing-page.tsx.
- **Dusk Landing 5:** full-video hero. Gorgeous, but only acceptable when a real production-recorded demo exists and the video can be lazy-loaded with a still fallback. Otherwise skip.

The template compositions also include sales pricing, testimonial or logo-cloud sections; **delete these instead of inventing customers, prices or GitHub-star counts**. Dusk uses default zinc shadcn tokens, so mapping to ReviewRouter's existing CSS is required.

Official page gallery: https://tailark.com/pages ; Dusk hero gallery: https://tailark.com/blocks/dusk/hero-section ; docs: https://tailark.com/docs ; license https://github.com/tailark/blocks/blob/main/LICENCE.md . Free OSS registry: https://oss.tailark.com (choose /r/radix/ for Radix, not default Base UI). Tailark Pro/Quartz is paid and is **not** part of the recommended free source.

## Add purposeful motion: genuinely permissive companion choices

| Motion source | License check | Use scope |
| --- | --- | --- |
| [Motion Primitives](https://github.com/ibelick/motion-primitives) (~6,948 stars) | MIT verified | One hero entrance, reveal of screenshot, tab or small chart transition; clean components, but beta API |
| [Cult UI](https://github.com/nolly-studio/cult-ui) (~7,179 stars) | MIT verified | At most one distinctive hover/focus interaction: finding selector, focus treatment or stat reveal |
| [Magic UI](https://github.com/magicuidesign/magicui) (~23,261 stars) | MIT verified for component library | One optional focused animated border/beam; full polished template remains paid or separately licensed |
| [React Bits](https://github.com/DavidHDev/react-bits) (~51,888 stars) | MIT **plus Commons Clause** | Avoid transplanting source into publicly redistributed ReviewRouter without a legal review |
| [Animate UI](https://github.com/imskyleen/animate-ui) (~4,989 stars) | MIT **plus Commons Clause** | Same concern, especially for redistributing copied primitives |
| [motion-primitives-website](https://github.com/itsjwill/motion-primitives-website) (~43 stars) | No explicit license found in root tree | Complete animated SaaS/agency/3D demos are inspirational only until license permission verified |

Not every animated element needs a runtime. CSS-only hover/focus plus a single optional Motion dependency may give a better UX/performance ratio than GSAP + Three.js. No uncontrolled continuously moving grid or counter statistics displaying made-up values. Full site and every meaningful control must be usable with prefers-reduced-motion.

## Integration choice: preserve the existing Next.js application

The actual ReviewRouter web package uses Next.js 16.2.11, React 19.2.5, existing @reviewrouter/ui and limited Radix components. Root does **not** have a shadcn components.json, and the web package currently has **no Motion/GSAP/Three dependency**. Copying full template dependencies, replacing globals.css, initing shadcn directly in the monorepo or replacing the layout will cause avoidable churn.

Safest integration sequence:

1. Make a temporary isolated Next staging app to inspect the chosen free Dusk page using its correct Radix registry; capture screenshots at desktop/tablet/mobile before importing.
2. Freeze upstream repo commit and license notice. Choose Dusk Landing 7 as the current default; keep Landing 2 as the alternate if full-width product screenshots look better.
3. Extract only its layout and responsive section scaffolding into the public landing route. Replace its Button/Badge/Header/Footer with existing ReviewRouter shared UI and real auth-aware CTA. Do not ship another component system.
4. Use ReviewRouter's actual logo and approved screenshots or safe representative fixture data; only labels/severities in the sample review area, no code diff or long comment text.
5. Create 5 clearly separated sections: hero + review findings; standalone upstream token comparison; full-width dashboard usage/stats; CI flow; hosted/self-hosted + FAQ/open-source CTA. Link complex comparison to /compare.
6. Add purposeful, bounded motion: one hero entrance (~350 ms), click/keyboard-selectable finding severity list (~180 ms), once-only benchmark comparison bar (~500 ms), and subtle dashboard-hover tooltip. Reduced motion shows all content immediately.
7. Preserve existing SEO/JSON-LD, full auth/install states, GitLab paths, legal/privacy links, light/dark theme and navigation. Validate with keyboard, screen readers, 1440/1024/390 and browser E2E.

Design composition guardrails: 96–144px between major desktop sections and 64–88px on mobile; no more than one main visual per section, no identical row of icon cards, no excess paragraph content. Avoid filling a single 900px screenshot with hero, token benchmark, 3 features, pricing and dashboard at once.

## Decision and delivery status

Current recommendation: **Tailark Dusk Landing 7 + restrained Motion Primitives**. More animated alternative: **Velora UI's complete MIT SaaS site** pruned down to the same five sections. Simpler fallback: **Launch UI**.

The user has not approved a specific source yet. This research only updates documentation on Draft PR #863; it does not install code, change the production page, run any browser E2E or authorize a merge.

Estimated integration scope: ~600–1,100 meaningful UI lines for Dusk select-and-adapt; complexity 5/10, expected reliability 8/10, confidence 8/10 based on source review. Risk assessment to revise after first rendered local Next build.
