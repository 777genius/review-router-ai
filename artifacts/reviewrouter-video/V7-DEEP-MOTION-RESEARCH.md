# ReviewRouter V7 — research: Remotion, RemotionUI, AI production & shot recipes

Date: 2026-11-14. Scope: **research and V7 design proposal only**. V6 must remain intact and comparable. This research does not claim that V7 has been rendered.

## 0. Current production baseline

Source branch: `feat/reviewrouter-video`, handoff commit `ba04f17bbb60aba85711c2a170511e9b94095a2a`. Read `README.md`, `VISUAL-RESEARCH.md`, `src/video-v6.tsx`, `src/video-v6.css` and `src/root.tsx` first. `ReviewRouterV6` is an 811-frame composition at 30 fps, 1920×1080 (~27.0s). `npm run render:latest` currently renders V6. The MP4 in the user's macOS path is **not in Git** and was not available in this research environment. The analysis here is of source and published references, **not** a full playback QA of that file.

V6 problems visible in source: repeated panel fade + translateX + scale for almost all transitions; duplicated per-scene offsets rather than a stable grid; Inter for video where product uses Space Grotesk and JetBrains Mono; several states compete for attention; repo setup displays an oversized icon per stage rather than an actual product flow; review displays three synthetic PRs at once when a single real-looking comment would be clearer.

Keep storyline: simple entry → providers and “and more” → GitHub repository selection → rapid setup stages → reviewer avatar + one anchored finding → statistics and graphs matching the app → carefully attributed OpenCodeReview benchmark (~9× *time*, not measured by ReviewRouter). Use clearly synthetic data, real product surfaces where available, no live account or repository mutation. Preserve V6 and create **`src/video-v7.tsx`**, **`src/video-v7.css`**, **`ReviewRouterV7Proof`** and then **`ReviewRouterV7`** registrations; don't repoint `render:latest` until V7 passes QA.

## 1. Findings: the actual tool ecosystem

| Tool | What it really provides | Fit for this video | Guardrail |
|---|---|---|---|
| **Remotion 4.0.543** (already pinned) | React frame-based animation, sequences, render, Studio | **Foundation** | Animate from frame, avoid CSS keyframe animations and non-deterministic randomness |
| **RemotionUI** (217 components as of research) | Copy-to-repo React source for scenes, primitives, 3D, shaders, graphs, transitions, compositions | **High**: use 4–8 carefully selected pieces | `npx remotion-ui@latest add ...` copies source and may register compositions/change dependencies. Inspect Git diff and version compatibility; don't import from `remotion-ui` npm |
| **Remotion official Agent Skills** | Rules for video layout, animation, studio and rendering | **High** for any coding agent | `npx remotion skills add`; don't assume “agent said done” is render QA |
| **RemotionUI MCP** | Search catalog and retrieve exact component data/install commands | **High** for targeted agent discovery | `npx remotion-ui-mcp` is read-only about files; agent must run CLI to install |
| **Remotion Studio WebMCP** | Agent can inspect composition, elements, geometry, timeline, errors, rendering and assets | **Very high** when agent has a compatible browser | Introduced in 4.0.518: V6 package 4.0.543 qualifies. Official compatibility currently points to **Codex**, not all coding agents |
| **Remotion Studio Interactive** | Keyframe/geometry editing on canvas; `Interactive.Div` and `Interactive.create()` | **High** for editable layers and motion | Hard-coded editable `translate/scale/rotate/opacity` props, avoid opaque transform strings |
| **video-shotcraft** (original) | 124 refined shot recipe cards / 150 samples, captured UI, 2.5D camera, beat sync and sound QA | **Very high** as *cinematography recipes* | Read card + exact sample implementation; copy the motion principle, use ReviewRouter palette/fonts |
| **snapcn** | Source components for cursor track, screen capture crop/zoom, laptop frame, buttons; free and Pro mixed | **High** if RemotionUI cursor/layout lacks desired behavior | ``screen-recording` and ``cursor-track` local source; cursor and zoom need coordinated coordinates. Check per-component license |
| **agentic-product-demo** | Code-first product demo, scene tokens, preview contact sheet and frame-validation gate | **High** for QA architecture | Do not replace actual UI capture with generic fake screens |
| **Canvas Capture (experimental)** | High-res browser area recording with cursor metadata independent of footage; CLI import available in 4.0.543 | **High potential** for precise real interactions | Experimental / browser extension; needs manual start/stop. Safe fallback = Playwright deterministic screenshot + element layers |
| **RemotionUI Kine** | Proposed product-demo capture -> edited Remotion project | **Watch, do not depend on** | Early access: macOS installer not public as of research |
| **Remotion @remotion/three + shaders** | Deterministic frame-driven R3F/WebGL, 3D device or extruded title, GPU effects | **Medium, accent only** | In Remotion 4 force `--gl=angle` on desktop (or test `swangle` fallback); extra render cost and source assets |
| **Freesound / Remotion SFX / FFmpeg** | Sound assets or UI SFX; timing, peak measurement, mix, export verification | **High** for finishing | Record per-file license, tie cues to exact frames, avoid indiscriminate whooshes |
| **DaVinci Resolve / CapCut** | Optional final audio mix and editorial review; video-shotcraft supports editable JianYing export | **Optional** | Keep frame timing in Remotion as source of truth; don't require proprietary tool for an automated render |

## 2. RemotionUI components: shortlist by actual *function*

### Highest-return components

| Component | Real role | V7 use | Priority |
|---|---|---|---|
| `simulated-cursor` / `cursor-path` | Animated deliberate pointer, click/focus | Provider or GitHub repo selection | P0 |
| `connector-lines` / `path-draw` / `dashed-path-travel` | A routed visual connection between states | Selected provider flows into selected repo and then reviewer comment | P0 |
| `zoom-pan-frame` or `device-mockup-zoom` | 2.5D camera over readable real screen or browser/laptop frame | Real app details; should feel like camera movement, not DOM flying | P0 |
| `timeline-steps` | Ordered progress | Five setup steps, compress middle of process while leaving result readable | P0 |
| `metric-ticker` / `line-chart-draw` / `animated-bar-chart` | Metric rise and real SVG graph drawing | Statistics scene, adapted to actual UI geometry | P0/P1 |
| `comparison-bars` | Pairwise bars on a **common scale** | OpenCodeReview vs Claude Code time/tokens (separate distinct scales) | P1 |
| `code-reveal` / `file-tree-reveal` | Focus a file or code section | Finding scene background, if a fully captured genuine PR surface isn't available | P1 |
| `spatial-push` / `zoom-through` / `transition-whip-pan` | Directional motivated camera moves | Use at most 1–2 transition styles in whole film | P1 |
| `grain-gradient-bg` / `dither-field-bg` | Slow subtle material backdrop | Abstract brand/open/end only, avoid behind small code | P2 |
| `device-mockup-3d` | Real lit R3F laptop open and camera orbit | Optional 4–6s brand opening or outro, **not** main instructional UI | P2 |
| `text-extrude-3d` | Real 3D glyph geometry | Optional ultra-short “9×” visual at ending | P3; requires branded typeface as Three JSON |
| `card-stack-3d` | Real fanned volumetric cards | Optional provider-cards concept, weaker than actual selectable provider grid | P3 |

**Do not blindly use `comment-callout`:** its source template is a *social-media creator comment*, with handle, like and reply affordances. ReviewRouter must display a code-review **finding anchored to a specific line**, with review-bot avatar; build a faithful custom card or lift only its animation choreography after removing social UI.

**Do not blindly use `code-diff-wipe`:** it visually **applies code edits** and can imply ReviewRouter auto-fixes a patch. If the story is automated *code review*, prefer code context + one annotation, unless product actually applies a patch in this flow.

**Avoid `globe-points-3d` and `product-turntable-3d`**: visually impressive but misleading for a code-review product. A globe needs a separate Natural Earth GeoJSON; the turntable is intended for product GLTFs. `device-mockup-3d` requires a bright screenshot (a predominantly black UI reads as a black slab) and may need a separate shot rendered with `--gl=angle`. `text-extrude-3d` does not package its required Three.js font JSON: download or convert and track font license.

AE-style primitives (`ae-motion`, `shape-layer`, `text-animator`, `track-matte`, `effector-field`, `follow-through`) are usable for a custom title or graph choreography; do not add merely to increase dependency count. `ae-motion` is particularly useful for easing/parented transforms and deterministic seeded wiggle. Author-selected genuine UI + 2.5D movement should still dominate.

### Product-fidelity cautions

- Intro/brand graphics may be original, but in-app screens should come from the product or literal frontend components with seeded demo state.
- Preserve actual typography: Space Grotesk headings, JetBrains Mono code/metadata, actual color tokens; avoid the inherited Inter canvas.
- Keep **one** main visual focus per shot; inactive provider rows dim rather than scatter, and reviewer comment holds long enough to read.
- For six providers, do not portray unsupported/future models as presently integrated. “And more” must be editorially truthful and visually separate from the verified choices.
- Dataset values shown in usage/statistics are examples, not customer usage.

## 3. Real community recipes worth copying **as choreography**

[Original video-shotcraft gallery](https://vincentwei1021.github.io/video-shotcraft/) contains shot names, animated clips, timings and linked tuned implementations. Prefer the original maintained 2026-10 selection (124 cards / 150 previews); mirrors with 152 or 157 are earlier/differently curated distributions, not inherently better.

| Exact shot pattern | What to borrow | Where |
|---|---|---|
| `chip-grid-single-select-blackout` | Grid gathers -> one card selects -> other cards quietly recede | Providers |
| `line-carry-transition` | The same single line/object visually connects two shots | Providers -> repo |
| `circle-match-iris` | Match-cut between similarly sized circular marks | Provider logo -> repo icon / reviewer avatar |
| `scanline-annotate-focus` | Focus/highlight a code region, then annotation appears | Review finding |
| `crane-rise-reveal` | Detailed close-up opens into whole dashboard | Statistics |
| `bezier-source-converge-merge` | Multiple providers become one ReviewRouter hub | MCP/skills context scene |
| `speed-ramp-freeze` | Setup progresses quickly, then pauses sharply on meaningful result | Setup -> reviewer finding |

Read both the card and linked TSX demo. Reproduce its timing logic only; replace its colors, shadows, typography and layout. Do not run “one preset transition per screen” or full-frame camera slam on each beat.

Additional library: [Shotpack](https://getshotpack.com/animations) for a searchable preview moodboard (check individual source/license; some paid). Another [remotion-video agent skill community report](https://www.reddit.com/r/ClaudeAI/comments/1wz1621/agent_skill_for_motion_design_remotion_demo/) emphasizes storyboard review and sound-led short copy, not generic narration.

## 4. New workflow: AI proposes, Studio verifies, frame gates enforce

1. **Agent reads product state**: source components, design tokens, allowed features; freezes representative **fictional** workspace/repo/PR data. Distinguish actual implemented features from demo concepts and planned providers.
2. **Choose visual direction before code**: 3–4 1920×1080 styleframes: provider selection, selected repository, reviewer finding, analytics. Validate safe zones, product font loading and relative information size.
3. **Capture accurate UI**: Playwright at 2× device scale: full screenshot, element-level transparent cutouts, and layout JSON bounding boxes for animated flight/camera targets. Alternative proof: Canvas Capture (experimental, personal data must be masked) to get footage plus separately controllable cursor.
4. **AI selects from RemotionUI MCP**, reads exact component detail and source; installs the minimum; records compatibility and dependencies. Maintains clean root and V6.
5. **Camera and choreography**: code frame-driven paths and transform keyframes. Keep three semantic motion classes distinct: user click (precise), system progress (accelerating), camera tracking (unhurried). One vivid motion per scene.
6. **Agent uses Remotion Studio/WebMCP**: inspect source DOM, bounding boxes, selected layer, seek target frames, diagnose render errors; interactive props permit manual polish. On incompatible agent/browser, use normal Studio+Playwright screenshots.
7. **QA frames before long render**: render at least entrance, peak action, settled state, boundary for each shot; contact sheet; view small at 960×540 to expose unreadable text; then full MP4, audio on/off exports.
8. **Sound design**: subtle UI press, quiet stage ticks/riser, one finding alert, one end impact. SFX time is pinned to action *landing frames*. When beat-heavy track is supplied, analyze tempo + transient times; **do not** slam the whole frame on each kick. Check source licenses and audio sync.
9. **Independent final gate**: no black/tiled/duplicated frames, no overflow, no desynchronized pointer, no unreadable 1-second microcopy, no fiction presented as data or an unsupported integration, no unlicensed sound.

Remotion's native `Canvas Capture` import CLI is present starting at **4.0.543**, exactly the repo's version:
~~~bash
npx remotion canvas-capture import recording.webm --dry-run
~~~
The recording must contain original Canvas Capture metadata; ordinary screen recordings do not qualify. This is an option, not a dependency.

WebMCP availability starts in **4.0.518**, so the project's 4.0.543 is sufficient. Browser/agent availability is a separate requirement: official docs currently identify Codex. Studio `Interactive` exists in 4.0.475+.

## 5. V7Proof: **the first test must be 7.2s (216f @30fps)**

Keep the same synthetic provider/repo/finding throughout, so movements tell a continuous story.

| Frame | Visual state | Primary motion | Audio & hold |
|---|---|---|---|
| 0–15 | 6 provider choices on actual brand grid | Even grid settles, no aggressive card bounce | soft presence |
| 16–34 | Cursor moves to one *verified* provider and clicks | Selected item lifts 4–8px; others dim | quiet physical click |
| 35–48 | Selected provider holds | Teal connection line exits the selected mark | ~0.45s settle |
| 49–82 | Line morphs into repo selection underline / vertical guide | Motivated camera pushes along same route | short soft whoosh |
| 83–100 | Selected GitHub repo row fills the screen | Real repo row focus and identity lock | small click |
| 101–150 | Five actual conceptual setup stages | Step path progresses, speed ramp, final state clean | 2–3 faint steps, no machine-gun beeps |
| 151–173 | Review comment appears on one code line | Camera snap-to-line, reviewer avatar fades in, highlight | one restrained finding tone |
| 174–215 | Stable reviewer comment and context | Minimal breathing, **no constant movement** | ~1.4s uninterrupted readable hold |

Motion language:
- Typography and grid: match frontend Space Grotesk / JetBrains Mono, real token colors; use a single layout coordinate system across 1920×1080.
- Controls: z-axis motion very small; preserve crisp UI. Cursor hotspot must hit target exactly at activation frame; scale click ring relative to camera transforms.
- Transition: **same line** from provider selection into GitHub selection, not an unrelated flash.
- Review: anchored synthetic finding e.g. “Missing authorization check” with a visible code line + ReviewRouter bot avatar, NOT social reply UI or automatically applied patch.

Save a `ReviewRouterV7Proof` composition and isolated render output. Compare against V6 using the same 3 anchor states. Continue to whole V7 *only after* seeing full proof MP4 and the contact sheet; source-level tests alone are insufficient.

## 6. Full V7 story after proof passes

Desired edit 28–33s, 1920×1080 30fps, adjustable for readability: intro brand → sign-in / GitHub → provider selection with “and more” → repository selection / setup step run → one finding → MCP and review skills context → exact application-style usage/stats → independent OpenCodeReview benchmark → CTA. Never trim reading pauses just to hit a pre-picked duration. Use 3D for **one short chapter**, ideally opening or outro, not every transition.

Two finishing passes: visual (grid, typography, real UI integrity, brand) and audio (soft attack, intentional silence, music mix). Consider original synthetic BGM as placeholder and check licensing/recorded sources for any replacement. Offer a version with BGM and a clean SFX-only mix for future reuse.

### Benchmark accuracy (critical)

Source: https://arxiv.org/abs/2608.09290 and the upstream project https://open-codereview.ai/.
On the authors' AACR-Bench (Claude 4.6 Opus, OpenCodeReview vs Claude Code): **1m23s vs 13m06s** ≈ **9.47× faster**; **385K vs 5,664K** tokens ≈ **14.71× fewer tokens**. Their results depend on model, test conditions, and review harness. Frame copy should say “**~9× faster in upstream OpenCodeReview benchmark**” and display the compared systems/models if space permits. Do **not** say “ReviewRouter is 9× faster”, or generically “than any normal agent”. Time and token comparisons use different ratios.

## 7. Version-aware setup and commands (the agent runs locally, not done in this research)

Run in isolated video folder and inspect git diff after each install:
~~~bash
cd artifacts/reviewrouter-video
npm ci
npx remotion skills add
npx remotion-ui@latest init --existing
npx remotion-ui@latest doctor --json
npx remotion-ui@latest search -q "cursor" --json
npx remotion-ui@latest view cursor-path --json
npx remotion-ui@latest view metric-ticker --json
# Pick only needed pieces, inspect their packages; for proof:
npx remotion-ui@latest add cursor-path connector-lines timeline-steps
git diff --stat
npm run studio
~~~
RemotionUI's installer may auto-register new compositions, alter lockfiles and add `.claude/skills`; review changes to `src/root.tsx`. `update` overwrites installed source; call `diff` before adopting updates. Pin dependency versions after smoke test, and align all official Remotion packages to `4.0.543`.

Render checks after adding V7Proof: TypeScript `tsc --noEmit`; known frames via `npx remotion still src/index.ts ReviewRouterV7Proof out/qa/v7proof-frame.png --frame=<n>` (verify CLI options), then `npx remotion render src/index.ts ReviewRouterV7Proof out/reviewrouter-v7-proof.mp4 --codec h264 --concurrency 2`. Add `--gl=angle` **only if** the composition uses shader/Three; software fallback `--gl=swangle`. Check with `ffprobe` duration/streams and visual frame contact sheet, then watch full export.

## 8. Evidence and compatibility sources

Official:
- https://remotionui.com/docs/components/browse
- https://remotionui.com/docs/cli
- https://remotionui.com/docs/mcp
- https://remotionui.com/docs/components/code-diff-wipe
- https://remotionui.com/docs/components/comment-callout
- https://remotionui.com/docs/components/device-mockup-3d
- https://remotionui.com/docs/components/metric-ticker
- https://remotionui.com/docs/components/comparison-bars
- https://remotionui.com/docs/components/motion-graphics
- https://remotionui.com/kine (early access, not public)
- https://www.remotion.dev/docs/ai/skills
- https://www.remotion.dev/docs/ai/webmcp
- https://www.remotion.dev/docs/studio/interactivity
- https://www.remotion.dev/docs/three
- https://www.remotion.dev/docs/gl-options
- https://www.remotion.dev/docs/canvas-capture
- https://www.remotion.dev/docs/canvas-capture/how-to-use
- https://www.remotion.dev/docs/cli/canvas-capture/import
- https://www.remotion.dev/docs/sfx
- https://arxiv.org/abs/2608.09290

Community and comparative implementations:
- https://github.com/Vincentwei1021/video-shotcraft
- https://vincentwei1021.github.io/video-shotcraft/
- https://github.com/Alexwtlf/agentic-product-demo
- https://snapcn.dev/docs/screens/screen-recording
- https://snapcn.dev/docs/screens/cursor-track
- https://getshotpack.com/animations
- https://www.reddit.com/r/ClaudeAI/comments/1wz1621/agent_skill_for_motion_design_remotion_demo/

## 9. Non-goals, risk, completion rule

Do not modify unrelated workspace files; do not overwrite V6, existing exports or capture assets; do not add mocked product features to marketing; do not invoke real AI-code agents against user repos, generate live findings, or use confidential accounts; do not equate successful CLI exit with a visually finished clip. 3D/GPU effects may degrade CI reproducibility; if needed, render a small isolated alpha asset and composite rather than forcing every shot through WebGL.

**Research complete. Implementation and frame-by-frame verification of V7 are explicitly not claimed.** A subsequent agent must run real npm install and rendering in the accessible local checkout or supported CI environment, then visually inspect the file.
