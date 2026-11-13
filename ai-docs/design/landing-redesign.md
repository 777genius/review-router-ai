# ReviewRouter landing redesign — concept selection

**State: choose A/B/C before implementing or merging a new homepage.** Mockups are standalone HTML and PNG delivered for user review; they are not the Next.js production route and use illustrative PR content.

The primary proposition: actionable AI code review in your CI, with the user's chosen provider and review policy. Make a review result visible first, and explain the trust boundary simply and accurately. Retain all authenticated/install CTA logic in `apps/web/app/home-cta-cluster.tsx`, the current SEO/JSON-LD and accessible legal/security paths.

## Three directions
| A — Signal Flow | B — Quiet Confidence | C — Merge Signal |
| --- | --- | --- |
| Dark ink/lime, hero + code finding + compact flow | Warm light/cobalt, editorial hierarchy + evidence panel | Dark aubergine/coral, oversized claim + risk cockpit |

## Repeatable Impeccable setup
The repo currently contains selected vendored Impeccable *documentation only*. This PR adds an **opt-in, pinned local CLI installer**, without injecting any new frontend runtime dependency.

```bash
pnpm design:impeccable:install
```

It uses the published Impeccable `4.8.2`, project scope, providers `claude,codex,cursor,opencode`. Inspect the generated agent skill and hooks before trusting/committing them, restart the coding agent, and approve the Codex project hook using `/hooks` if desired. Root `PRODUCT.md` and `DESIGN.md` already seed project context; avoid overwriting them with generic output.

```bash
pnpm design:impeccable:detect  # source scan, exit 2 denotes findings
# With the web dev server running, also inspect rendered behavior:
npx --yes impeccable@4.8.2 detect http://localhost:3000
```

Use `critique`, `distill`, `adapt`, `harden`, and `polish` on the chosen page, plus real browser screenshots and interaction checks. Keep live/Apply **off** unless deliberately reviewed: upstream's unattended fallback can invoke local agents with relaxed sandbox/approval settings.

## Before publishing
Implement the selected concept in the existing Server Component layout with shared controls, retain actual GitHub CTA state and GitLab path, verify 1440/768/390 widths, both themes, keyboard/focus, reduced motion, screen reader headings, SEO and browser E2E. Record actual checks and only merge after user acceptance. No CI/deployment was claimed by this design-only PR.
