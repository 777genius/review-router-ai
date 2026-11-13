# ReviewRouter landing redesign — approved positioning / unselected composition

## User direction
Preserve the **current cyberpunk colors and dashboard visual language**. The problem is information hierarchy, not branding: current homepage is too text-heavy and leads with setup mechanics. Build a highly visual explanation of an **open-source, free-to-start platform** giving the developer **choice of AI subscription/model, visible tokens/costs and hosting control**, powered by **OpenCodeReview**.

These are non-negotiable positions:
- Public, open-source ReviewRouter project and Apache-2.0 OpenCodeReview foundation.
- Hosted GitHub App ready to use within fair-use terms; guided self-hosted installation as second route.
- Choose a supported subscription or API key and configure review policy.
- See known token consumption, known model/provider costs and review statistics from the dashboard. Honest unknown-data handling.
- Focused PR reviews, useful inline findings, transparent CI boundary.

## Performance claim policy
**Do not claim "9× faster" as an independently proven number.** Upstream Alibaba's [OpenCodeReview benchmark](https://github.com/alibaba/open-code-review#benchmark) says reviews consume **~1/9 of tokens vs Claude Code** under its tested configuration, and are *faster* (not specifically 9× faster). It notes **lower recall** than the general-purpose agent. ReviewRouter [README](../../README.md#review-engine) expressly labels the measurements *upstream, not ReviewRouter benchmarks*. A publishable visual:
- large **~9× fewer tokens** (small label: **upstream benchmark, same model vs Claude Code**);
- separate **Faster, focused reviews** statement; no numeric speed ratio;
- short source link and caveat (conditions/model/provider affect cost, latency and recall);
- don't equate ninefold token reduction with guaranteed ninefold subscription/API bill reduction.

## Information hierarchy
1. **Immediate value:** headline like `Open-source AI reviews. Your models. Your spend.` plus **Start free** and **View source**.
2. **Proof in product, not a paragraph:** show a real-looking illustrative inline review finding alongside token usage and model control; use actual product screenshots when implementation allows.
3. **Performance proof:** Alibaba/OCR token comparison with provenance, distinct from ReviewRouter-specific results.
4. **Control chain:** Your GitHub PR → customer CI + OpenCodeReview + chosen model → review comments → dashboard insights. Clearly show the model-provider data transfer.
5. **Options and trust:** Hosted (free under fair use) vs Self-hosted; open source; no vendor lock-in; model subscription/account options.
6. Comparison, FAQ and full security information as discoverable secondary material, not dense above-the-fold sections.

## Three compositions in one visual world
| A: Engine First | B: Control Room | C: Open Platform |
| --- | --- | --- |
| Split hero, prominent benchmark and inline finding | Large authentic analytics/review cockpit | Large product statement, CI network diagram and open-source emphasis |
| First impression: efficiency | First impression: full ownership | First impression: transparency and flexibility |

All use the existing graphite/cyan/lime/magenta design system, typography and UI conventions, not three new color themes.

## Repeatable Impeccable setup
The prior repository integration is documentation-only. This Draft PR adds opt-in scripts for published `impeccable@4.8.2`:

```bash
pnpm design:impeccable:install
pnpm design:impeccable:detect
# and, against the running dev server:
npx --yes impeccable@4.8.2 detect http://localhost:3000
```

The project-scoped installer targets Claude Code, Codex, Cursor and OpenCode; review generated skills and hook permissions locally before enabling. Never silently allow `impeccable live` to invoke a fallback agent with disabled sandboxing.

## Build acceptance after selection
Preserve `HomeCtaCluster`, current authentication-aware setup and GitLab path, server-side metadata/JSON-LD, legal links and dashboard. No runtime dependencies added to change the landing. Use actual Impeccable critique/distill/adapt/harden/polish passes, browser screenshot review across widths/themes, source-backed claims, typechecking, navigation/CTA E2E, and proper performance tests. Until user chooses a composition, this branch stays Draft without a homepage replacement or deployment.
