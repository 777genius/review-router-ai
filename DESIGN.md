# ReviewRouter design system — landing direction

The design **inherits the existing dashboard's cyberpunk style**, not a fresh template identity: near-black graphite (#0a0a0f), cyan (#00f0ff), lime (#39ff14) and restrained magenta, with semantic severity red/amber, locally hosted Space Grotesk and JetBrains Mono. The light theme is an existing supported alternative.

Homepage is an editorial product story: five visually separated chapters, one dominant visual each. Hero is two columns (short huge headline, working GitHub CTA and selectable severity-only review list); efficiency is two large sourced benchmark measurements, control is one wide real-product-inspired console, workflow is a short three-stage map, closing is two hosting choices and a tiny FAQ.

Avoid code samples in hero, prose inside findings, nested card grids, glow everywhere, marquee/carousel decoration, additional icon-only "features" and false customer metrics. Actual ReviewRouter logo uses /review-router-logo.png through shared LogoMark/global header.

Animation should communicate states, never be required to understand them: focused finding highlight, introductory card transition and subtle bar progression; no continuously moving background. prefers-reduced-motion disables effects. 390/768/1024/1440 widths and both themes are mandatory checks. Preserve semantic buttons, focus, 44px touch targets and quick skimmability.

The reference implementation is apps/web/app/home-landing.tsx, home-review-demo.tsx, home-landing.module.css and existing auth-aware HomeCtaCluster. Inspiration (not copied code) includes Launch UI's spacing and Forge's PR-focused motion. Impeccable 4.9.1 is a pinned **opt-in developer CLI**, not a runtime dependency or automatically trusted live agent. Never enable live Apply fallback with bypassed permission mode.
