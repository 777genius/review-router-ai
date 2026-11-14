# ReviewRouter V7 — new visual architecture and production plan

**Scope:** Rebuild visuals from scratch; preserve V6 story and verified claims; isolate V7 in `feat/reviewrouter-video-v7`; keep `ReviewRouterV6`, `render:latest`, and all unrelated files unchanged. Research baseline: `V7-DEEP-MOTION-RESEARCH.md`. Current baseline source uses Remotion `4.0.543` at 1920×1080, 30fps. Native rendering must be proven separately from authored code.

## Why Remotion Studio still matters with AI

- **Code is source of truth**: React + frame-based interpolation/spring; CLI handles rendering, assertions and CI.
- **Studio is visual QA**: timeline, keyframes/easing, layout guides, DOM geometries, sound playback, camera framing, render jobs. `Interactive` and direct `style.translate/scale/rotate/opacity` permit supported visual edits written back to code.
- **WebMCP is agent I/O**, not a substitute for art direction or a video reviewer. Available in this repo's 4.0.543; official support presently centered on Codex. When unsupported, use Studio manually or Playwright screenshots and CLI render.
- **RemotionUI**: source components are copied into repo. First browse, read exact source, install selected components (with license), then adapt. Avoid importing an uninstalled `remotion-ui` package.
- **React/Remotion for content**; restrained 2.5D for cinematic UI camera; one optional 3D opening only if GPU smoke test works. Rendering in GitHub-hosted Linux without GPU must not depend on `--gl=angle`: official Remotion docs recommend `swangle` there.

## Production invariant: preserve V6 narrative

0. **Intro:** free, open-source CI-native AI review — avoid implying that source leaves CI.
1. **GitHub entry:** authorize / sign in.
2. **AI providers:** Codex, Claude Code, MiMo, OpenRouter, Kimi Code, NVIDIA **via OpenRouter**, plus “and more” as roadmap, never as current verified providers.
3. **Repository selection:** one recognizable GitHub repository.
4. **Setup:** choose repo → create setup PR → merge setup PR → enable review → ready. Demo stages, no mutation.
5. **Review finding:** one precise finding with ReviewRouter avatar and code line.
6. **MCP and review skills:** optional context and routing as implemented; don't invent capabilities.
7. **Insights:** usage and findings, with clearly marked illustrative figures.
8. **Benchmark:** OpenCodeReview upstream AACR-Bench, ~9.5× faster time (1:23 vs 13:06) and ~14.7× fewer tokens (385K vs 5,664K), **not a benchmark of ReviewRouter**.
9. **CTA:** ReviewRouter, reviewrouter.org, free service subject to applicable provider usage costs.

## Story / frame budget (30fps, target ~32s)

| Shot | Intent | Motion grammar | Rest |
|---|---|---|---|
| 0 Intro | Bold editorial promise and floating product UI | A physical layered browser card resolves to sharp UI | >0.5s |
| 1 Sign in | One GitHub action | Precise cursor path + brief physical click | >0.4s |
| 2 Providers | One AI is chosen | Grid select; others dim; line becomes continuity motif | >0.5s |
| 3 Repositories & setup | One selected repo; five logical steps | Camera follows line then progress accelerates into Ready | >0.5s |
| 4 Review | Code and one anchored finding | Zoom into code line, reviewer comment appears | >1.2s |
| 5 Tools | MCP/skills feed into review, not a feature promise | Two slim converging routes | >0.4s |
| 6 Stats | Real visual family of product dashboard | One number ticks, line/bar chart draws, then settles | >1s |
| 7 Benchmark | Exact source attribution | Pairwise comparable bars, each with own metric | >1s |
| 8 Outro | Brand lockup and CTA | Resolved route and short slow 3D-like tilt | >1s |

## Motion system and design tokens

- **Layout:** 1920×1080, common outer margin 112px, title zone y~150, primary content y~310; common footer at y~1000.
- **Fonts:** Space Grotesk headlines and body; JetBrains Mono numeric/diff/meta. Use the repo's OFL-licensed WOFF2, never distribute font files with video artifact. Prepare fonts from `apps/web/app/fonts` at build time.
- **Colors:** original product `#05070d` void, `#070b14` page, `#0b1020` surface, `#e6f7ff` text, `#8ea4b8` muted; `#00e5ff` cyan, `#a6ff00` lime, `#ff2bd6` magenta, `#ffb000` amber; never glow everything.
- **Focus:** one primary action per shot; max three distinct motion types: (1) user pointer/action, (2) system progress route, (3) camera move.
- **Camera:** entrance/push lasts 18–36 frames; no springy wobble in precise UI; hold after subject settles.
- **Transitions:** match routes + directional camera; no generic opacity+X+scale panel entrance across all shots.
- **Audio:** calm original synthetic bed (existing `music.m4a`) mixed under isolated short UI click/success/finding cues. Also render SFX-only version; check actual final audio for clipping.

## Three critique cycles

**Round A — replicate V6 with polished fades.** Complexity 3/10, improvement 4/10, reliability 9/10. **Rejected:** preserves alternating-slide feeling and inconsistent V6 grid; low ceiling.

**Round B — remake in full 3D with laptop, global routes, 3D text throughout.** Complexity 9/10, visual spectacle 8/10, product fidelity 3/10, rendering reliability 4/10. **Rejected:** tiny code and settings become hard to read; WebGL in Linux CI is costly; globe has no product meaning.

**Round C — use a composited 2.5D product camera with a continuous signal route, fewer true UI states, single focused code finding.** Complexity 6/10, visual impact 9/10, product fidelity 9/10, reliability 8/10. **Accepted, subject to proof QA.** Revision: retain actual product typography and no unrelated cinematic motif; add explicit ~9× benchmark attribution; avoid generic onboarding state that cannot occur in app.

**Round D — production gate review.** Identified four residual problems: inconsistent source assets, manual "looks good" approvals, risk of all-pulse no reading pauses, and accidental V6 overwrite. **Fixes:** use real logo and provider marks, deterministic seed data and scene boundaries, 7.2s proof video + full export QA, isolated branch and V7 compositions. Native CI/render artifacts are required before calling the video complete.

## Implementation stages, acceptance and rough effort

| Phase | Scope | Approx LOC | Acceptance |
|---|---|---:|---|
| A | Research & storyboard plus stage-by-stage critical revisions | 150–250 md | Reference links, decisions, adverse effects |
| B | Shared V7 design system, paths, camera, cursor, utility components | 180–280 TSX | No layout jumps and correct click hotspot |
| C | 7.2s proof `providers→repo→finding` | 180–300 TSX | Reproducible 216 frames, context held >1.2s, visually inspected |
| D | Full V7 nine-scene story | 350–650 TSX | Story parity and truthful claims |
| E | Sound, QA stills/contact sheets, full MP4 | 80–150 scripts | Parseable streams, no blank frames, 1080p/30fps, legible at half size |

Total new production source target ~800–1300 meaningful LOC plus docs, but prefer less if maintainable. Complexity **7/10**, reliability target **8/10**, confidence in motion/design direction **9/10**, confidence in a *native* rendered output without CI or local npm **4/10** until executed.

## Acceptance checklist

- V6 composition and script unchanged; branch isolated.
- Source remains deterministic for any frame. No CSS keyframe/transitions for timed animation; no Math.random.
- Exact code, comment, animated state and provider identity visible and aligned; no misleading auto-fix, provider, security or benchmark claims.
- SFX and timings mapped to actual frame indices; no random stutter.
- Responsive at **1920×1080** and readable scaled to **960×540**; safe margins retained.
- Render 7.2s proof first, inspect key stills (entrance, active, settled), then full V7; check audio/video with ffprobe and actual playback; do not call unrendered code "video complete".
- README explains how to run studio, proof, and full render; pin dependencies.
- Do not merge/replace V6 without user approval.

References: Remotion Studio https://www.remotion.dev/docs/studio ; Studio Interactivity https://www.remotion.dev/docs/studio/interactivity ; WebMCP https://www.remotion.dev/docs/ai/webmcp ; RemotionUI https://remotionui.com/docs/components/browse ; RemotionUI MCP https://remotionui.com/docs/mcp ; video-shotcraft https://github.com/Vincentwei1021/video-shotcraft ; rendering options https://www.remotion.dev/docs/gl-options ; Canvas Capture https://www.remotion.dev/docs/canvas-capture/how-to-use .
