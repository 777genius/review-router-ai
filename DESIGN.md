# ReviewRouter design baseline (not selected landing direction)

The authenticated product already has a coherent dark/light design system in `apps/web/app/globals.css`, `@reviewrouter/ui`, and the local Space Grotesk and JetBrains Mono fonts. Preserve it outside an explicitly approved redesign. Existing visual guidance lives at `ai-docs/product/08-visual-direction.md`.

The **public landing is being redesigned**. Its current appearance must not restrict the replacement. Three separate visual concepts are awaiting user selection:

- **A — Signal Flow:** split hero, deep ink-green, sharp lime accent, visible inline review finding and compact CI pipeline.
- **B — Quiet Confidence:** warm editorial light canvas, cobalt action, wide side-by-side review artifact and calm composition.
- **C — Merge Signal:** high-impact aubergine/coral type, risk-first story, evidence-focused two-column cockpit.

Do not commit a chosen landing palette or change the live homepage until the user selects one. Once approved, document chosen tokens, hierarchy, type, motion and responsive rules here. Keep dashboard global tokens stable unless explicitly asked to unify them.

### Quality floor
Contrast ≥4.5:1 for regular text, visible focus, reduced-motion support, no overflow at 390px/768px/1440px, review examples explicitly illustrative, accessible CTA semantics and legal/security discoverability. Avoid large text walls, repeated icon-card grids, gradients as decoration and needless animations.
