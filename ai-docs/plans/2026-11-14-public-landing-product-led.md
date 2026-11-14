# ReviewRouter public landing — product-led rebuild

Date: 2026-11-14. Base: `b0b47c82d422289ff966d92660ddb037ec0448f8`. Scope: public landing route only, plus broken `/#compare` links and opt-in design tooling. No deployment without approval.

## Goal, evidence and hard constraints
The current dashboard's cyberpunk palette, locally hosted Space Grotesk/JetBrains Mono, actual ReviewRouter logo, shared `@reviewrouter/ui`, Next.js App Router auth and theme semantics remain unchanged. Do NOT blindly copy Tailark/Launch UI/Forge; borrow only their rhythm, screenshot framing and meaningful transitions. Preserve working installation states, permission dialog and SEO/JSON-LD. Avoid extra marketing libraries and long code diffs / AI comments in the first viewport.

One visitor's progression: "What is it?" (first 5 seconds) → "Why different?" (engine efficiency) → "What do I control?" (own provider + known tokens/costs) → "How does it run?" (GitHub Actions) → "How do I start?" (hosted or self-hosted).

Trusted product source: `README.md`, `docs/capabilities.md`, `ai-docs/product/08-visual-direction.md`. Video storyboard: `artifacts/reviewrouter-video/V8-POSITIONING-AND-STORYBOARD.md` on PR #864 head `1c854068fc8730ab5aa7b1713081e83e58ef85ca`. Upstream benchmark: `https://arxiv.org/abs/2608.09290` and OpenCodeReview README (Claude 4.6 Opus, 1:23 versus 13:06; 385K vs 5,664K tokens). **9.5× faster/14.7× fewer tokens are upstream same-model benchmark rows, not a guaranteed ReviewRouter service-level or invoice saving.** Free platform usage subject to fair use, provider API/subscription and CI charges are separate; selected model provider still receives review context.

## Proposed vertical journey: one central visual per chapter

| Section | Visitor sees | Key components (existing/reusable) | Motion (reduced-motion fallback) |
| --- | --- | --- | --- |
| 1: Hero, ~first viewport | Big H1 "Open-source AI code review. Your models. Your rules.", brief copy, actual logo in global header, one primary GitHub action + source link, and four *short finding titles* by severity. No code. | Existing global header/LogoMark and HomeCtaCluster; new small HomeReviewDemo client island with button selectors, screenshot-style frame | Short 250–350ms introductory entrance. Selecting severity moves visible focus/highlight, 160–220ms; no autoplay |
| 2: Proof, one independent section | `9.5× faster` and `14.7× fewer tokens` as legible two-column benchmark bars with original time/token denominators and upstream source/caveat; no money equivalence | Server static markup + CSS bars; link to paper | One-time bar fill at scroll view where supported, never hide baseline facts |
| 3: Control | Huge real-product-inspired analytics preview with provider choices, known usage/unknown coverage and a few illustrative review statistics; short heading and one line of copy | Server marketing-only presentation with illustrative label, no private dashboard React Query imports or fake user accounts | Subtle tab-like highlight/focus, no auto-counting fictional statistics |
| 4: Flow | Three spacious GitHub → user CI / OpenCodeReview + selected AI → PR findings & dashboard stages, visually connected; AI provider data boundary explicit | Original graphic with semantic HTML/SVG or CSS, no heavy chart/animation SDK | Tracing signal on hover/focus and optional CSS once-only scroll reveal |
| 5: Choice and final CTA | Two large **Hosted** (free under fair-use) / **Self-hosted** (own infrastructure) choices; open-source repo + guides, compact FAQ, final installed-state CTA | HomeCtaCluster reused, native `details` FAQ, existing docs/security links | Only hover/focus feedback |

## Visual system
Use current tokens and dark/light modes. Preserve existing header/logo/site footer: **never duplicate navigation in landing components**. Primary accent cyan with a single lime benchmark moment and restrained magenta. No generic 3-up icon cards and no nested cards for the sake of decoration. Width max 1200–1240px, side padding 24px desktop / 20px mobile; section breaks ~100–144px desktop / ~64–88px mobile; body measure ~55–70ch; large distinct headings, no eyebrow on every section. The hero visual is a product artifact, not decorative code art. All sample findings/usage are explicitly illustrative; never advertise fictional real data.

## Architecture (SOLID/DRY, no overengineering)
- Keep `apps/web/app/page.tsx` as an async Server Component; keep signed-in/connected install resolution and JSON-LD.
- Add `apps/web/app/home-landing.tsx` for server-rendered chapters, plus `home-landing.module.css` to isolate new marketing styles from dashboard globals. Keep copy close to components; no schema/CMS/animation abstraction.
- Add `apps/web/app/home-review-demo.tsx` as the **only** new Client Component: 4 short finding-select buttons, typed immutable fixture; no remote fetch or long comments.
- Extend `HomeCtaCluster` with a default-preserving opt-out of visually prominent disabled GitLab CTA; show a subdued "GitLab in development" note in supporting section.
- Preserve existing `/compare` route, remove full matrix from home and update header/footer `/#compare` links to `/compare`. No change to comparison content.
- Keep platform source CTA separate from `reviewRouterGitHubRepoUrl` (which points to the action repo); don't change support issue link targets.
- Opt-in Impeccable CLI `4.9.1`: documented npm scripts install/detect on landing, pinned and scoped to project; **do not enable live Apply agent fallback**. Apply `critique, distill, layout, adapt, audit, harden, polish` guidance, then use detector where available. No runtime dependency.

## QA gates and proof limits
1. Source review: no unsupported financial/privacy claim, fake testimonials, insecure external scripts/assets, href='#', duplicated main/nav, wrong link to Action when claiming platform.
2. Visual/browser: inspect actual 1440×900 desktop, 1024, 768 and 390 mobile in dark + light; 200% text zoom, no horizontal scrolling, focus order, keyboard selectors, reduced-motion, hover/touch.
3. Function: signed-out install, missing appInstallUrl → /setup, connected account → /dashboard, GitLab non-prominent unavailable state; nav /compare and SEO/JSON-LD; no private API requests on homepage.
4. Build/typecheck and focused UI tests on applicable GitHub runner; Impeccable detect/audit on rendered page if local engine available. **Never count queued/skipped as passing**. Rendered isolated local static preview tests are not qualified as Next.js E2E; distinguish them in PR.
5. User screenshot review before merging/deployment to hosted website. No external model invocations or spending; no database migration.

## Plan critique: rounds and corrections before implementation
- **Round 1 — marketing/legal:** original slogan "9× cheaper" rejected. Corrected to exact 9.5× time and 14.7× tokens *in a specific upstream benchmark*, with original denominators and lower-recall caveat. Free control plane vs AI/CI external spend separated. Budget management not falsely promised.
- **Round 2 — UX/visual:** original hero had 3 setup paragraphs, 3 signal blocks and 2 equally dominant actions. Reduce to one CTA, concise hero and four short findings. Prior mockups crowded all sections in one screenshot; instead chapters get independent spacing and distinct compositions.
- **Round 3 — integration:** avoid copying Tailark/Launch theme, global header, tokens, providers, code and asset licenses; preserve server-first and shared CTA. Client boundary only where selection changes UI. Remove `/#compare` anchors safely by updating both navigation and footer links.
- **Round 4 — reliability:** static demo shows illustrative data only; reduced-motion and no-JS still readable. No network/video/downloaded fonts/GSAP/Three. Theme and SEO untouched beyond landing-specific metadata; screenshots and E2E must be evidenced separately.

## Size and risk estimate
Meaningful original production code ~450–850 LOC + ~450–700 scoped CSS + 1 small UI test/check, depending on final visual rhythm. Complexity **5/10**; expected reliability **8/10** with gate completion; confidence **8/10** in architecture, **6/10** in exact aesthetics before browser inspection. Keep work as **Draft PR** pending screenshot feedback; push every coherent commit immediately. If runtime cannot be obtained locally due no GitHub/npm DNS, use best-effort browser-rendered static approximation and remote GH CI, clearly label non-E2E evidence; do not claim release.
