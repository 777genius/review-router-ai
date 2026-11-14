# ReviewRouter — product context for Impeccable

## Audience and purpose
Developers and engineering teams reviewing GitHub pull requests. Visitors should understand within seconds that this is an **open-source, free-to-start code-review platform**, not another mandatory hosted AI-review subscription. Its dashboard gives users ownership of review policy, their selected AI account/model and visibility into usage.

## Product positioning (in order)
1. **Open source + free to start.** ReviewRouter and its OpenCodeReview foundation are open source (Apache-2.0; upstream and third-party notices apply). Hosted GitHub App onboarding is available under fair-use terms. No seat-based price is implied. CI and model-provider subscriptions/API usage may cost money.
2. **Purpose-built review engine.** Uses Alibaba's OpenCodeReview, a deterministic-plus-agent engine designed for focused context, precise findings and lower token use. Its published upstream AACR-Bench report describes about **one ninth as many tokens** versus general-purpose Claude Code review under the benchmark conditions; it also reports faster reviews. That is **not** a measured ReviewRouter ninefold speedup, a guaranteed 9× billing reduction, or universal quality parity. The upstream experiment reports lower recall in its comparison.
3. **Your AI and spend.** Bring supported subscriptions or keys, select models and review settings; see provider/model/run usage, known token totals, known costs, incomplete telemetry and review statistics. Never present unknown cost coverage as $0 or promise costs cannot occur.
4. **Your infrastructure choice.** Hosted control plane with execution in GitHub Actions by default, or a guided self-hosted deployment. The chosen AI provider still receives the allowed review context; the control plane does not receive raw source by default.
5. **Useful findings and control.** Review results, inline evidence, configurable policies and safe revision-aware publication.

## Facts and restrictions
- GitHub App and review setup are available; GitLab capability depends on qualified deployment and is not universally available. Some advanced features and providers need explicit enablement.
- Do not invent customer counts, precision %, savings, ROI, runtime data, compliance certifications, testimonials, or production usage. Illustrative dashboard screens must be labeled as previews.
- Exact public claims must follow `docs/capabilities.md`, `README.md`, `docs/privacy-self-hosted.md`, current free/fair-use policy and real rollout state.
- Do not claim code *never* leaves the user's environment; selected AI providers receive review context.

## Primary landing action
Install GitHub App if eligible, or open dashboard when connected. Preserve `apps/web/app/home-cta-cluster.tsx` and the server-side CTA logic in `apps/web/app/page.tsx`. Keep self-hosted docs and GitHub source available. Copy: brief English, readable with no knowledge of internal infrastructure.

## Page priority
Hero: **Open-source. Fast, focused reviews. Your AI, your budget.**
Then an evidence-backed token-efficiency story, a genuine-looking illustrative PR finding, actual usage/statistics screenshot or clearly labeled concept preview, three-step setup/hosting choice, trust boundary, FAQs and source links. Detailed privacy/architecture belongs in expanded content or docs, not the first viewport.
