# ReviewRouter landing research — full template and motion comparison
Date: 2026-11-13. **Research/decision only. No template installed, homepage rewritten, browser E2E, or deployed change.**
Companion: [earlier shortlist](landing-template-research.md), [product truth](../../PRODUCT.md), [design baseline](../../DESIGN.md).

## Non-negotiable brief
The existing dark cyberpunk ReviewRouter brand is approved: graphite, cyan, lime and restrained magenta; actual icon and fonts; same dashboard tokens and shared Radix UI. The page needs **far fewer words, stronger visibly separated sections** and product-first proof, not a new gradient/glass design. The hero shows 3–4 severity labels and SHORT finding titles, never a diff or paragraphs of model comments.

Message hierarchy: open source/free-to-start (fair-use terms), OpenCodeReview as the review engine, own supported subscription/API key, measured/known token and cost usage plus review statistics, hosted vs self-hosted. Source-aware note: Alibaba OpenCodeReview reports roughly one-ninth of tokens vs Claude Code in its own benchmark, faster review and lower recall; do not claim **9x faster wall-clock**, guaranteed 9x invoice savings or an independent ReviewRouter measurement. See https://github.com/alibaba/open-code-review#benchmark and this repository's README.

## Selection rubric
Qualitative, task-specific scores /10 (not Lighthouse or verified conversion studies): information hierarchy and real-product emphasis **30%**; integration cost with existing Next.js 16 / React 19 / Radix and server CTA **25%**; completeness of an actual free landing **20%**; purposeful motion and reduced-motion story **15%**; license and maturity **10%**. Stars are current GitHub API snapshots, not design scores. Samples inspected from GitHub trees, LICENSE text and code; no full browser E2E of vendor demos.

### Ready-made Next/React sites and marketing kits
| Source | License | Stars Nov 13 | Complete site? | Fit | Decision rationale |
| --- | --- | ---: | --- | ---: | --- |
| [Tailark Dusk](https://github.com/tailark/blocks) | MIT, free OSS | 2,343 | **10 separate free Dusk pages + 39 blocks**, Radix + Base UI | **9/10** | Best complete section/layout system; Dusk 7 split hero and Dusk 2 wide product screen are closest to selected aesthetic. Moderate motion, needs purposeful extra product interaction. |
| [Velora UI](https://github.com/ColorlibHQ/velora-ui) | MIT, free site | 62 | **1 complete SaaS site covering 9 routes**, 31 free section blocks, ~100 animated components | **8.5/10** | Best animated full-site alternative, Next.js 16 + Motion, reduced-motion documented; many unused sections and extra dependencies to prune, smaller adoption history. |
| [Launch UI](https://github.com/launch-ui/launch-ui) | MIT, free sections | 874 | 1 site, 9 free marketing sections | **8.5/10** | Fastest straightforward transplant, strong spacing/screenshot frame, Radix; motion more limited and unmodified design feels generic. |
| [Page UI — Gnomie AI](https://github.com/PageAI-Pro/page-ui) | MIT | 1,698 | 7 branded template directories, Gnomie AI has a real product tour | **7.5/10** | Great video-tab mechanism, carousel and product narrative; Tailwind v3 only in README, and demo manipulates global theme state. Port just interaction pattern; never external sample videos. |
| [ShadcnStore Frontier](https://github.com/shadcnstore/shadcn-dashboard-landing-template) | MIT | 1,263 | Landing + unrelated dashboard, Next + Vite versions | **7.5/10** | Strong screenshot/feature sequencing but uses Base UI; do not transplant dashboard or theme. |
| [Gonzalo SaaS Landing](https://github.com/gonzalochale/saas-landing-template) | MIT | 186 | 1 ready Next.js 16 site | **7/10** | Framework match, generic visual hierarchy; little differentiation. |
| [Leo Miranda shadcn landing](https://github.com/leoMirandaa/shadcn-landing-page) | MIT | 1,988 | 1 Vite React page | **6.5/10** | Popular but icon-card and text-heavy default architecture reproduces the problem. |
| [Startup Next.js](https://github.com/NextJSTemplates/startup-nextjs) | MIT free core | 1,688 | 1 marketing site + supporting pages | **6.5/10** | Structured, conventional SaaS marketing, less native to this cyberpunk identity. |
| [Nextplate](https://github.com/zeon-studio/nextplate) | MIT | 518 | Multi-page marketing/blog starter | **6/10** | Useful publishing/i18n infrastructure but unnecessary for a homepage refresh. |
| [ixartz Next.js Landing](https://github.com/ixartz/Next-JS-Landing-Page-Starter-Template) | MIT | 2,141 | 1 marketing starter | **6/10** | Tailwind 3 and ordinary starter design; mature but offers little reduction in UI work. |
| [karthikmudunuri SaaS template](https://github.com/karthikmudunuri/saas-landing-page-template) | MIT | 255 | 1 dark animated Next.js 14 page | **6/10** | Attractively dark, older stack and Aug 2024 last push. |
| [PaulleDemon awesome landing pages](https://github.com/PaulleDemon/awesome-landing-pages) | GitHub API says MIT; locate notices before reuse | 1,068 | ~21 HTML templates incl. SaaSyDark | **5.5/10** | Good diverse visual reference, but static HTML → React requires rebuilding interactions and styling. |
| [8bsite App Landing](https://github.com/8bsite/app-landing-page-template) | MIT | 6 | 1 HTML page, optional GSAP | **5/10** | Fast static inspiration but little evidence of maintenance, no Next integration. |
| [7ovr Next starter](https://github.com/7ovr/shadcn-next-starter) | MIT | 3 | 1 Next.js/Base UI starter | **5/10** | Good SEO/test claims, not proven marketing design. |
| [Cruip Open](https://github.com/cruip/open-react-template) | GPL/redistribution restrictions in README; no clear permissive metadata | 4,717 | 1 complete professional landing | **reference only** | Do not reuse in our Apache-2.0 OSS code without separate license review. |
| [Wasp Open SaaS](https://github.com/wasp-lang/open-saas) | MIT | 16,311 | Full SaaS product, auth, DB, billing | **not a landing fit** | Massive duplication of existing backend/application. |
| [Astroship](https://github.com/surjithctly/astroship) | GPL-3.0 | 2,000 | Full Astro site | **not a code fit** | Framework and licensing mismatch. |

### Cinematic and unusual full websites — visuals before reuse
| Source | License | Stars | Full pages | Why it ranks below the above |
| --- | --- | ---: | --- | --- |
| [Lumen SaaS](https://github.com/MiddleSugar7000/lumen-saas-landing-page-template) | MIT | 4 | 1 cinematic Three.js/GSAP/Lenis HTML page | Stunning visual reference; custom WebGL, manual React conversion, accessibility/performance concerns; tiny support base. |
| [Volt Arc](https://github.com/MiddleSugar7000/volt-arc-landing-page-template) | MIT | 3 | 1 HTML product launch | 3D/GSAP visual inspiration; not for developer SaaS without a major rewrite. |
| [GSAP Vault Free](https://github.com/jaydickinson/free-gsap-effects) | MIT for templates; GSAP runtime separately licensed | 9 | 8 HTML template folders in Git tree | Most examples are CVs, charity, profiles, restaurant menus and waitlists, not SaaS. Its bounded interaction patterns are more useful than complete templates. |
| [Landing Page Atlas](https://github.com/vezeqs/landing-page-atlas) | MIT | 0 | 57 hand-built HTML designs | Great breadth for visual research, no adoption and HTML-to-TSX conversion. |
| [Velox](https://github.com/sadeniemela/velox) | README says MIT, no root LICENSE found | 0 | 1 Next.js 15 personal learning project | Strong pinned panels and GSAP/Lenis, but license evidence and production maturity insufficient. |
| [Lucid Motion](https://github.com/aniltanriverdiler/lucid-motion) | README claims MIT, no GitHub license metadata | 0 | 1 cinematic Next.js 16 page | Educational Zentry-inspired concept, not reusable production-ready core. |
| [Ainspire Studio](https://github.com/xxhyeonn/ainspire-studio-landing) | no explicit license identified | 0 | 1 3D Next.js 16 page | No verified redistribution license; don't copy. |
| [msrbuilds SaaS website](https://github.com/msrbuilds/saas-website-nextjs) | MIT | 7 | 1 GSAP Next.js 16 page | New and readable but narrow maintenance record. |
| [Pedro Estevão AI landing](https://github.com/pedroestevaodev/stunning-ia-lp) | MIT | 15 | 1 Next.js 14 page | Simple Framer Motion demo, no strong advantage. |

### Component-only sources — NOT full site templates
| Kit | License source | Stars | Appropriate use |
| --- | --- | ---: | --- |
| [Motion Primitives](https://github.com/ibelick/motion-primitives) | MIT | 6,948 | Best small purposeful transitions for selected findings/screenshot; not a whole site. |
| [Cult UI](https://github.com/nolly-studio/cult-ui) | MIT | 7,179 | One unusual tactile interaction (selection hover or spotlight), not a new component system. |
| [Magic UI](https://github.com/magicuidesign/magicui) | MIT for free components | 23,262 | Optional accent beam or product screenshot reveal; paid full templates separate. |
| [Hacktemplates](https://github.com/diiviikk5/Hacktemplates) | MIT | 58 | 70 moving WebGL hero references, not complete Next marketing pages; high motion cost. |
| [React Bits](https://github.com/DavidHDev/react-bits) | MIT **plus Commons Clause** | 51,889 | Attractive interactions, but additional redistribution restrictions make copying source into our public repo legally sensitive. |
| [Animate UI](https://github.com/imskyleen/animate-ui) | MIT **plus Commons Clause** | 4,989 | Same caution; restrictions differ slightly, read exact LICENSE.md before any use. |
| [motion-primitives-website](https://github.com/itsjwill/motion-primitives-website) | no verified root license identified | 43 | Animated SaaS and 3D demos are references only unless redistribution permission is confirmed. |

The React Bits and Animate UI terms explicitly allow many app uses; they are not ordinary MIT grants for redistributing their component source. This is a risk assessment, not a declaration that all app use is prohibited.

## Source-level investigation relevant to ReviewRouter

- **Dusk 7:** `registry/bases/radix/dusk/pages/landing/seven/landing-page.tsx` imports hero 7, content 3, two feature blocks, stats, pricing, FAQ, CTA and footer. Hero file `blocks/hero-section/seven/hero-section.tsx` has a split grid and large product image. Remove sales pricing, fake logos, testimonials and entire duplicated footer; keep composition and responsive decisions.
- **Dusk 2:** `registry/bases/radix/dusk/pages/landing/two/landing-page.tsx` and `blocks/hero-section/two/hero-section.tsx` place one dominant wide product screenshot below a short heading. Better when a real approved dashboard capture is the strongest proof.
- **Velora:** full SaaS landing is in `src/app/templates/saas/page.tsx` (~673 source lines), references many Motion effects and unrelated testimonials/pricing. Specific free `hero-screenshot` and `features-split-screenshot` blocks are stronger candidates than its full page if porting into ReviewRouter. One free full site, not every Pro template. Source migration avoids importing MDX/blog/auth.
- **Launch UI:** `components/ui/section.tsx` applies explicit separated rhythm `py-12 sm:py-24 md:py-32`; `components/sections/hero/default.tsx` uses a large screenshot frame and real CTA targets. Source is small and easy to transplant.
- **Page UI Gnomie AI:** `templates/landing-page-templates/template/gnomie-ai/bricks/3-product-tour.tsx` has tab-selectable videos and interactive feature steps; excellent concept for explaining ReviewRouter, but its parent `gnomie-ai.tsx` calls custom global theme/font store and forces light theme, and videos reference Shipixen URLs. Never transplant full theme code or third-party marketing videos. README states Tailwind v3.
- **ReviewRouter main:** Next.js 16.2.11, React 19.2.5, existing `@reviewrouter/ui` and Radix wrappers. No Motion, GSAP or Three.js in the web app dependencies. It has a custom light/dark implementation. Don't replace root `layout.tsx`, `globals.css`, `package.json`, `page.tsx` server install/auth logic or the shared component layer.

## Recommended design, deliberately not a collage

**Winning direction:** Tailark Dusk 7 layout + own real ReviewRouter screen + one self-contained Motion Primitives-style interaction. Tailark 2 is alternate if the first hero needs a full-width screenshot. Optional small Velora screenshot product-tour block if it passes measured runtime cost; no broad UI-kit installation.

One meaningful interaction: **finding-list selector** with 4 severity chips and short titles, selected finding changes a small info/detail graphic or CI state. No raw code and no AI comment paragraphs. Could implement simply with React state, CSS transition and a reduced-motion branch; don't add a dependency until it clearly helps.

Page sequence (no 900px collage):
1. Hero at near-full-viewport scale: bold one-sentence message, open source/free identity, authentic logo, existing auth-aware CTA, concise review findings visual.
2. Separate visible break; benchmark proof: one comparison graphic (~1/9 tokens upstream vs general Claude Code agent), honest source and lower-recall caveat.
3. Separate large screenshot section: actual dashboard provider connections, usage + known costs, review statistics; no fake telemetry or fictitious users.
4. One simple three-step CI architecture flow using correct provider boundary.
5. Hosted vs self-hosted choice, source link, lean FAQ and final CTA; link comparison details to existing /compare.

Motion budget: <=3 orchestrated moments: (a) hero finding selection 150–220ms, keyboard controlled; (b) benchmark bars animate once on entry ~450ms; (c) dashboard screenshot reveal 300–500ms. No infinite WebGL, scrolljacking, smooth-scroll hijack or mandatory animation; respect `prefers-reduced-motion`, low-end/mobile and data-saver users.

Minimum top-level vertical spacing guideline: about 96–144px desktop and 64–88px mobile, plus contrasting section surfaces/edges where they genuinely improve scanning. Avoid nested cards and paragraph-heavy icon features.

## Next validation gate (NOT performed here)

Choose a template/layout, pin upstream commit SHA, keep MIT notice and audit all image/video/font licenses; stage a disposable Next.js preview of Dusk 7 and Dusk 2 using only selected marketing code; inspect 1440/1024/768/390 dark/light captures and keyboard/focus; then port selected components into ReviewRouter's existing server-first homepage. Run TS/native compiler, lint, focused tests, browser CTA/SEO E2E and Impeccable detector/critique after actual installation; record results and only then merge the landing. None of these E2E results exist yet.

### Final judgment
**Best for ReviewRouter overall:** Tailark Dusk 7 (9/10). **Best all-in-one animation-ready fallback:** Velora UI (8.5/10). **Safest quickest integration:** Launch UI (8.5/10). **Best single UX pattern:** Page UI Gnomie AI's tabbed product tour (not its full theme). **Best avoid:** generic card-heavy templates, obscure full-page Three.js projects and unclear source licensing.
