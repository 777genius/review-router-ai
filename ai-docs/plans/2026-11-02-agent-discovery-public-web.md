# ReviewRouter — public AI-agent discovery (2026-11-02)

## Goal
Allow browsing agents to accurately discover public product setup, pricing, security and API **demo** documentation without widening authorization or inventing agent-action APIs.

## Inspected implementation
- Next.js `apps/web` with per-page public canonical/OG metadata, sitemap/robots and public home graph (Organization/WebSite/WebPage).
- Real GitHub/GitLab sign-in via Auth.js; GitHub App installation + user review/approval of setup PR and own CI-based execution.
- API host already provides `/docs`, `/demo.md`, `/openapi.json` for **public demo**. This is not a documented general agent mutation API.
- Free CI control plane now. Hosted API tiers/pricing remain **proposed**, not purchasable.

## Scope
- Publish static `/llms.txt`, `/auth.md`, `/agents.md` on the Next.js web origin, with the real API demo/OpenAPI URLs and security/permission boundaries.
- Add truthful free-current-product SoftwareApplication/WebApplication JSON-LD to homepage, without converting unlaunched pricing into an offer.
- E2E check the exact generated production server assets (content types, HTTP statuses, source link consistency, no bogus OAuth or MCP metadata) using existing web smoke; focused source test to cover static contracts.
- No new server API, authorization changes, OAuth metadata, MCP endpoint, WebMCP or machine-driven installation of GitHub App.

## Acceptance
1. `/llms.txt`, `/auth.md`, `/agents.md` return real plain text/Markdown rather than the HTML shell, without authenticating.
2. Instructions point to `/getting-started`, `/security`, `/pricing` and external API **demo** links. They require explicit user GitHub/GitLab authorization, confirm setup PR and repo secrets through supported UI.
3. Homepage structured data represents the free current control plane only.
4. Focused tests plus existing PR CI pass on final SHA; independent review and safe squash merge. Production deployment is a separate verification step.

## Risks
- Claiming all API methods are open to agents because a demo OpenAPI exists.
- Publishing OAuth protected-resource metadata where no compliant authorization server exists.
- Advertising proposed subscriptions as purchasable plans.
- Accidentally turning a public documentation link into a privileged action.
