# ReviewRouter product context for Impeccable

ReviewRouter is an open-source, free-to-start platform for AI review of GitHub pull requests. It uses OpenCodeReview and lets teams bring supported subscriptions or API keys, configure review rules, view reported tokens/known costs and review statistics, and use a hosted control plane or a guided self-hosted deployment.

- Main visitor task: understand the value and begin GitHub installation using the existing authorization-aware app-install dialog, or open the dashboard when already connected.
- In the default mode, code checkout and review tools run in customer GitHub Actions; the selected AI provider receives review context. The platform does not guarantee that all provider traffic stays inside the customer's network.
- "Free" refers to the hosted control plane under fair-use limits and the open-source code, not inference/CI infrastructure costs. No unsupported budget enforcement or invented customer counts.
- Alibaba OpenCodeReview AACR-Bench same-model Claude 4.6 Opus row reports 1m23s vs 13m06s and 385K vs 5,664K tokens: 9.5x faster and 14.7x fewer tokens in the upstream benchmark, *not* independent ReviewRouter performance or guaranteed provider invoice savings; recall was lower in that comparison.
- Plain short English, honest illustrative labels, no code in hero, no walls of text, real severity/finding selection, big spacious visual chapters.

Preserve global header/footer, website routes, theme, SEO, SSR auth and licensing. Source of truth: README.md, docs/capabilities.md, ai-docs/product/08-visual-direction.md and ai-docs/plans/2026-11-14-public-landing-product-led.md.
