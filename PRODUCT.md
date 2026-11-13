# ReviewRouter — product context for Impeccable

## Audience and objective
Developers and teams using GitHub pull requests. Show visitors the **actual shape of AI feedback**, the **execution boundary**, and one clear way to begin without requiring a wall of text.

## Product truths
- ReviewRouter provides AI-assisted pull-request review and policy/status control through a hosted or self-hosted control plane.
- In the default GitHub Actions flow, review execution runs in the customer's CI. The selected AI provider receives the context sent to it; **never** claim prompts or code can never leave the customer's environment.
- The GitHub App and dashboard manage setup, workflow PRs, run metadata and review results. In the default mode, do not imply the App reads repository files.
- Codex/Claude subscriptions and provider API keys have different onboarding, availability and billing. The optional hosted encrypted account pool and advanced workflows are separately gated.
- GitLab support is beta. Self-hosting requires setup. Free access has fair-use limits; AI subscription/API and CI usage can incur costs.
- Do not invent production metrics, testimonials, accuracy rates, compliance certifications, performance numbers or customer logos.

## Existing integration contracts
Keep the `apps/web/app/page.tsx` server-side state and `home-cta-cluster.tsx` for GitHub installation/dashboard and GitLab. Preserve `seo.ts`, JSON-LD, metadata, documentation, legal and security paths, plus responsive/theme/keyboard behavior.

## Landing outcome
Primary action: install GitHub App (or open dashboard for existing installation).
First viewport: one sentence of value, one real-product-style **illustrative** inline finding (severity, location, explanation, next action), and one primary CTA. Visually explain GitHub → customer's CI + chosen model → pull-request review below the hero. Make the detailed FAQ/comparison available farther down.
