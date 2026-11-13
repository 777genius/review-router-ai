# ReviewRouter landing template research — 2026-11-13

## Goal

Reuse a real open-source landing layout while keeping ReviewRouter's current dark graphite/cyan/lime/magenta cyberpunk style, actual logo, typography, full live dashboard and server-side GitHub App install flow. The problem is too much copy and too little separation: visual hierarchy, purposeful whitespace and genuine product imagery matter more than effects. The hero should show 3–4 finding SEVERITIES and SHORT TITLES, not raw code or full AI-generated comments.

The product story: open source, free hosted start under fair-use limits, OpenCodeReview engine, user's supported AI subscription or provider key, transparent token and known-cost metrics and review statistics, hosted or self-hosted. Never promise that code cannot leave the customer's selected AI provider, or that unknown costs equal zero.

Upstream OpenCodeReview benchmark reports about 1/9 of the tokens versus Claude Code and faster processing under its test conditions, with lower recall. It does NOT prove ReviewRouter runs 9× faster in wall time or guarantees 9× lower subscription spend. Source: https://github.com/alibaba/open-code-review#benchmark

## Verified shortlist

| Template | GitHub stars (snapshot) | License | Stack | ReviewRouter fit /10 | Finding |
| --- | ---: | --- | --- | ---: | --- |
| [Launch UI](https://github.com/launch-ui/launch-ui) | 874 | MIT, 9 free public sections; extras paid | Next.js 16, React 19, Tailwind 4 | 9.1 | Best complete free structural base, design-first hero, spacious Section (desktop 96–128 px), screenshot frame, FAQ, CTA and stats; active Nov 2026 |
| [ShadcnStore Frontier](https://github.com/shadcnstore/shadcn-dashboard-landing-template) | 1263 across dashboard+landing | MIT free landing, some premium blocks separate | Next.js 16, Tailwind 4, Base UI | 8.4 | Strong separated feature rows and full product screenshot; copy only landing sections, not its dashboard, Base UI layer or global theme |
| [Velora UI](https://github.com/ColorlibHQ/velora-ui) | 62 | MIT, complete free site and 31 free blocks | Next.js 16, Tailwind 4, Motion | 8.2 | Excellent screenshot sections and 96–128px section rhythm; lower adoption, full page animation-heavy; optional one feature block, not full rewrite |
| [Leo Miranda Shadcn Landing](https://github.com/leoMirandaa/shadcn-landing-page) | 1988 | MIT | Vite/React/Tailwind | 6.7 | Popular, but default design is conventional, too many icon cards and sections |
| [Startup Next.js](https://github.com/NextJSTemplates/startup-nextjs) | 1688 | MIT free core | Next.js 16/Tailwind 4 | 6.5 | Easy stack fit but too generic to solve current design issue |
| [TailGrids Play](https://github.com/TailGrids/play-tailwind) | 1161 | MIT | Static Tailwind HTML | 6.0 | Complete marketing pages, but porting HTML adds work |
| [Cruip Open](https://github.com/cruip/open-react-template) | 4717 | README: GPL and redistribution limits | Next.js/Tailwind | Do not copy | Design inspiration only; incompatible licensing risk for our Apache-2.0 reuse |
| [Magic UI SaaS](https://magicui.design/docs/templates/saas) | n/a | Full template paid | Next.js/Tailwind | Not eligible | Free components are not a free complete template |
| [ChatDeck](https://github.com/ShadcnDeck/chatdeck-shadcn-saas-landing-page-template) | 69 | Public repo; no GitHub license metadata | Next.js/shadcn | 5.9 | Licence verification required, more testimonials/pricing than product visuals |
| [ixartz SaaS Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) | 7489 | MIT | Full Next.js SaaS | 5.1 | Auth/DB/payment framework would duplicate existing system |

Scores are task-specific expert judgments, not Lighthouse, E2E or measured conversion scores. Stars and last-push timestamps checked through GitHub API 2026-11-13. Public sites/READMEs and source component composition inspected. Official external demo screenshots have NOT been browser-tested here.

### Best option: Launch UI free template

Demo https://www.launchuicomponents.com ; source https://github.com/launch-ui/launch-ui ; only free 9-section version is within scope. Reuse its split-spacing and screenshot framing without copying global CSS, auth, nav or product data. Use existing ReviewRouter frontend wrappers and Next Server Component. Keep original branding, link hierarchy and legal navigation.

Runner-up if more alternating image/text sections desired: Frontier live preview https://shadcnstore.com/templates/dashboard/shadcn-dashboard-landing-template/landing . Beware Base UI vs our Radix. Optional visuals from Velora https://velora.colorlib.com/templates/saas .

## Layout to implement after user picks

1. One quiet hero: Open-source AI review. Your AI. Your budget. Two real CTAs and one large illustrative list of 3–4 severity titles with short labels, no diff or paragraphs.
2. Strongly isolated efficiency section: ~9× fewer tokens in Alibaba's upstream benchmark, one side-by-side graphic and short source disclosure; no 9× faster claim.
3. One full-width REAL dashboard screenshot: model/subscription choice, known token/cost data and usage/statistics. Preserve honest missing-data handling.
4. Three stages displayed visually: connect → choose provider + review in GitHub Actions → see findings + statistics. The AI provider receives permitted review context.
5. Hosted and self-hosted choices, open-source/source-link CTA; slim FAQ. Link complex competition comparison to existing /compare page instead of duplicating the table.

Large visual breathing room: 96–128px desktop between main sections, 64–80px on mobile, no unnecessary nested cards or one-page collage. Use current ReviewRouter logo. Minimal motion: hero one-shot, benchmark bar reveal, dashboard screenshot reveal, hover/focus feedback, reduced-motion fallback. No perpetual waves or fictitious counters.

## Integration and shipping safety

Only port marketing sections from the selected pinned commit, preserve MIT notices and audit assets. Do not replace package.json, the app's auth, the existing @reviewrouter/ui controls or global theme. Preserve server CTA, SEO/JSON-LD, GitLab pathways, nav/footer/legal. Check mobile/tablet/desktop in both themes, focus/keyboard, contrast, no overflow and reduced motion. Then run focused typecheck and browser E2E plus actually installed Impeccable critique/distill/audit before marking ready. Draft PR stays unmerged until template decision and real tests.

Indicative size: ~500–900 meaningful UI lines. Complexity 5/10; reliability expectation 8/10, confidence 8/10 before implementation; these are planning estimates, not test results.
