# Remotion research and production choices

Research date: 2026-11-13. This is a short decision record for the ReviewRouter concept, not a product capability specification.

## Tools

- [Remotion API](https://www.remotion.dev/docs/api): React compositions render deterministic frames; `Sequence` offsets local time, `useCurrentFrame` supplies the clock, `interpolate` maps progress, and `spring` adds a controlled entrance. All animation in the current composition follows the frame clock. [CSS transitions and timers are unsuitable for rendering](https://www.remotion.dev/docs/troubleshooting/css-animations).
- [Transitions](https://www.remotion.dev/docs/transitions): `TransitionSeries` supports timed transitions including fades and slides. This cut overlaps scene fades over a persistent background so the UI stays readable. Overlaps shorten the total timeline and must be reflected in the composition duration.
- [Media](https://www.remotion.dev/docs/media/audio): frame-synchronized audio with editable volume. Current music is locally generated; there are no external runtime media requests.
- [Fonts](https://www.remotion.dev/docs/fonts): bundle and explicitly load brand fonts for pixel-consistent final delivery. This concept currently uses local fallbacks, so glyph metrics can vary between systems.
- [Player](https://www.remotion.dev/docs/player): useful if interactive in-page playback or parameterized video is required. A single MP4 is simpler for the current deliverable.
- [Still rendering](https://www.remotion.dev/docs/cli/still) and [rendering](https://www.remotion.dev/docs/cli/render): inspect keyframes first, then encode the composition. Check the final video itself as well as stills.
- [Motion blur](https://www.remotion.dev/docs/motion-blur) and [effects](https://www.remotion.dev/docs/effects): optional; use sparingly after measuring render time and checking readability. The current version prioritizes simple frame-driven movement.

## Templates

[Hello World](https://www.remotion.dev/templates/hello-world) is a useful minimal TypeScript and Tailwind reference. [Code Hike](https://www.remotion.dev/templates/code-hike) is useful for more involved code transitions. [The template catalogue](https://www.remotion.dev/templates) also contains Next.js SaaS, Three.js and paid editor starters, but an editor, video-generation server, and 3D runtime are unnecessary for this short fixed composition. This is a standalone composition built directly from the same primitives, not a copy of a template.

## Project and truth boundaries

- The checked-out landing page describes GitHub App installation, setup PR, and provider configuration. Its flow is condensed for the concept; the repository scene mentions the setup PR.
- The checked-out provider catalog lists Codex subscription, Claude Code subscription and OpenRouter API key; API access must not be depicted as a subscription.
- `ai-docs/architecture/56-open-code-review-integration-plan.md` describes OpenCodeReview as planned, not shipped; this video is marked as a product concept and the benchmark scene says planned integration.
- The findings/token-usage dashboard shown here uses invented values and is marked illustrative; it must not be presented as a screenshot of existing product functionality.
- The benchmark is attributed to OpenCodeReview's authors and a particular model/baseline. The upstream paper reports lower recall for OCR than Claude Code in several comparisons; it does not establish a universal 9× improvement in review quality. ReviewRouter itself has not been benchmarked by this video.
- [Remotion license/pricing](https://www.remotion.dev/docs/license/pricing): free terms cover individuals and eligible companies up to three people; other commercial use may require a license. Confirm eligibility at publication. Match all Remotion package versions exactly.
