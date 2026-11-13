# ReviewRouter design direction — preserve established cyberpunk identity

## Locked product identity
**Do not redesign the color palette or establish a new brand.** The current landing and authenticated dashboard already have the user's preferred high-contrast, futuristic command-center look. Study `apps/web/app/dashboard/`, `apps/web/src/features/review-statistics/interface/statistics.module.css`, `apps/web/app/globals.css`, `@reviewrouter/ui`, and `ai-docs/product/08-visual-direction.md` before working on the landing.

Existing visual DNA:
- Dark graphite/near-black void surfaces, bright cyan (#00e5ff), lime (#a6ff00), restrained magenta (#ff2bd6), severity amber/red and lucid pale text.
- Space Grotesk for headings/UI and JetBrains Mono for code and measurements (both already self-hosted), light/dark theme behavior and subtle grid/routing traces.
- Thin borders, code surfaces, restrained status chips, practical diagrams and analytics from the actual dashboard; sharp technical but human-readable; no unrelated color themes.
- No generic white SaaS rebrand, template purple gradients, glow on every tile, dense icon cards or walls of copy.

## Only the public landing's hierarchy/composition changes
Three **layout variants using the exact same brand language** are being prepared; they are not competing palettes:

- **A — Engine First:** concise left hero; impactful OpenCodeReview performance proof and real-review example on the right; ownership/usage strip underneath.
- **B — Control Room:** UI preview as the dominant hero; headline plus clear free/open source CTA; spend/model control and review stats demonstrated inside the product.
- **C — Open Platform:** powerful typographic headline, open-source/source + hosting badges, center CI control flow and targeted review artifact, with performance as a proof element.

User will pick composition A/B/C. Do not replace production homepage until selection. Preserve same navigation/footer and dashboard design tokens unless explicit change is approved.

## Verification
1440px, 768px and 390px, both existing themes, keyboard/focus, reduced motion, WCAG contrast, accurate source-backed performance disclaimer, source/license links, no mobile scroll overflow. No fake production metrics. A marketing mockup can show example UI values only with visible "Illustrative preview" disclosure.
