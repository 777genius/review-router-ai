# Landing implementation plan, 2026-11-14

Status: separate Draft PR. Research remains in #863; promo-video story remains in #864. No production deployment authorized.

## Composition and reuse
Keep the real ReviewRouter dark/light cyberpunk style, branded logo, server auth flow and shared UI. Borrow composition ideas from Launch UI and stateful PR review behavior from Forge, but do not copy external template components or add a second UI framework, font, animation runtime or pricing model.

1. Hero: split layout, short open-source/free positioning and the existing authenticated GitHub CTA. Right: interactive severity selector (no code or long comments, illustrative badge).
2. Proof: two large upstream OpenCodeReview metrics (9.5x time, 14.7x tokens) based on Claude 4.6 Opus AACR-Bench pairing; link source, mention lower recall and independent ReviewRouter results are not established.
3. Control: one large dashboard-inspired UI preview with model/usage/cost visibility and explicitly illustrative data. Never fake dollar totals or enforce-budget claims.
4. Review flow: choose repos, approve setup PR, enable CI, review findings, see insights. State AI provider receives selected review context.
5. Hosted/self-hosted: distinct alternatives with functional links, then short footer links to compare, privacy/security, fair use and support.

## Architecture
Server HomeExperience, single small client HomeFindingsPreview for state, scoped CSS module, existing HomeCtaCluster with optional GitLab beta hiding. Preserve page metadata/JSON-LD and authorization-aware CTA selection. Link /compare directly instead of removed /#compare anchor. Keep real dashboard unchanged.

## Critical review cycles
1. UX: strip setup-first hero, six similar feature rows, eight-competitor matrix and homepage FAQ. Five visually different chapters, with generous spacing.
2. Product: free control plane is not free model/CI; provider context does leave CI; unknown costs are not zero, benchmark is upstream and has recall tradeoff.
3. Engineering: server first, no new runtime dependencies, minimal client state, existing primitives and no change to dashboard/auth.
4. Accessibility: semantic headings/buttons, aria-pressed and live status, visible focus, mobile stacking and reduced-motion support.
5. Release: leave Draft, run focused test and typecheck, inspect real 390/768/1440 screenshots in both themes, check keyboard and CTAs. Do not claim success from queued/skipped CI, and do not deploy until visual approval.

Expected delta: 500-900 UI/CSS lines plus focused tests. Complexity 5/10; reliability target 8/10; confidence 7/10 before native E2E verification.
