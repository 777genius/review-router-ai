# V8 revision — brand positioning, product proof and honest efficiency story

**Source**: feedback on V7.1. New independent `ReviewRouterV8`; preserve V6/V7/V7Lite for side-by-side comparison. All modifications restricted to video project and isolated video CI. Visual language: far fewer simultaneous details, one meaningful motion/change per moment, product logo and actual provider SVG marks. Target ~33s at 1920×1080/30.

## Claims audited against evidence

- **Open source, free control plane, self-hosted**: supported by https://reviewrouter.org/, https://reviewrouter.org/pricing, and this repository's self-hosted docs. Distinguish ReviewRouter platform fee from optional provider subscriptions/API and CI/runner charges. Avoid 'everything costs zero'.
- **Subscriptions or API keys**: supported at https://reviewrouter.org/ and `/getting-started`; show 6 identified provider marks from product's `ProviderMark`, with NVIDIA clearly **via OpenRouter**, not a misleading direct provider. Select Codex/Claude under subscription; remaining modes shown as API/plan via editorial grouping.
- **Speed and token use**: upstream OpenCodeReview AACR-Bench (Claude 4.6 Opus). 1:23 vs 13:06 = 9.47× faster; 385K vs 5,664K tokens = 14.71× fewer. Sources https://open-codereview.ai/ and https://arxiv.org/abs/2608.09290. **Not a separate ReviewRouter benchmark.** Position hero as "9× faster. 9× leaner.*" with in-frame source, then data-rich benchmark later. DO NOT present real provider invoices or guaranteed flat 9× cheaper; with same model pricing token savings can reduce variable token cost, but caching, input/output split, plan type, other overhead vary. No fabricated cost figure.
- **Incremental newer-commit review**: `ai-docs/architecture/46-incremental-review-snapshots.md` explicitly documents completed snapshots and live E2E for rotating Codex Action; compatible new heads review only changed/add/renamed/removed file paths and carry findings from unchanged paths. Other runtime paths may not guarantee reuse. Caption: "Compatible snapshots → changed files only", and visual shows a new commit causing two changed files to re-review, unchanged issues preserved. Do not claim universal token percentage or always-on behavior. Fail-safe full review for incompatible/missing snapshot.
- **Findings/context**: source `ai-docs/product/04-review-product-behavior.md` describes precise line comment, severity, impact/context, optional fix. Show one small code excerpt with one focused animated annotation. No fake automatic patch.
- **Live Demo**: all repository names, PRs, counts and findings synthetic. Single disclaimer in scene, not bloated microcopy on every frame.

## Scene and second-order changes

| Time @30fps | Scene | Primary content and change | Held readable |
|---|---|---|---|
| 0–118 | Hero | First-frame brand. `OPEN SOURCE` immediately; huge `9× FASTER` then `9× LEANER` vs Claude Code; small credible source label | ≥1s |
| 118–159 | GitHub | One button, brief pointer click, **no success badge** | direct transition |
| 159–280 | Providers | All six correct logos simultaneously. `Subscription OR API key`. One selection illuminates after all are seen | ~1.4s |
| 280–398 | Repo | One GitHub repository, stages progress in place (Create/Merge/Enable/Ready) | ~1s |
| 398–565 | Finding | One code line highlighted, bot avatar, context then suggested remedy revealed | ≥1s |
| 565–692 | New commit | Previous reviewed head → new commit, changed files subset, previous findings retained; no 9× claim for this incremental mode | ~1s |
| 692–790 | Insights | Two sparse sample KPIs, one bar chart | ≥1s |
| 790–900 | Benchmark | 9.5× time & 14.7× tokens with exact numbers, and conditional lower-cost implication (no billing promise) | ≥1s |
| 900–1014 | CTA | **Start free on web** vs **Self-host for full control** — same free open-source platform, external model/CI costs distinct | ≥1s |

## Critique cycles and corrections

1. **Marketing/story**: initial proposal said 'ReviewRouter 9× cheaper than Claude Code'. Rejected: extrapolates upstream engine benchmark to a distinct full product and mixes token quantity with actual bills. New first-frame headline remains punchy, but source and scope are readable.
2. **Art direction/attention**: six cards sequentially was too slow; six cards with labels and footnotes is too dense. All logos appear at once, one short heading, two auth modalities. Only one provider gets selected animation. Elsewhere a state replacement animates rather than adding a new unrelated layer.
3. **Workflow accuracy**: success after sign-in and giant all-steps row read as redundant. Remove success, shorten entry; change stage label within one frame; mark newly committed files but reuse previous findings only for compatible completed snapshots.
4. **Quality/risk**: previous native render passed rendering but CI failed on absent system `ffprobe`. New workflow installs/uses ffmpeg explicitly, typechecks before render, uploads outputs even on failure, and verifies frame/duration/audio. Do not claim E2E complete until generated MP4 is visually inspected.

## Validation / release gate

- Source-only branch commit after each coherent stage.
- Run npm ci / `tsc --noEmit` / 4–6 `remotion still` frames.
- Render full native 1920×1080/30fps. Compare actual frame readability 960×540, check pointer hotspot and cut boundaries, confirm logo and 6 provider marks, separate chapter stills.
- Decode ffmpeg to null; validate H264 and AAC, 1014 frames, 33.8s; upload MP4 and keyframes.
- Keep new version alongside originals; retain Draft PR until validated.
