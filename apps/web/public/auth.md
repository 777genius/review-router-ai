# ReviewRouter authentication for users and AI assistants

ReviewRouter is a hosted CI review **control plane**. Account sign-in is required to use private dashboard/workspace operations; the public landing and documentation are readable without sign-in.

## Supported sign-in

- Sign-in page: https://reviewrouter.org/auth/signin
- Source authorization: GitHub OAuth, and GitLab OAuth where enabled for this deployment. Authorization is performed by the user through the provider's browser consent flow.
- GitHub App installation grants repository permissions to the selected repositories. It is distinct from signing in to the dashboard.
- After signing in and installing, use the dashboard and the documented setup flow to create the repository's setup PR.

An AI agent **must not** pretend to possess a session, request passwords or OAuth tokens in chat, bypass provider consent, auto-install an App, or merge a setup PR without user authorization.

## Are there machine auth discovery endpoints?

ReviewRouter uses web sessions and provider authorization; **no public general-purpose agent OAuth authorization server or token-exchange API is advertised here**. Do not infer standardized `/.well-known/oauth-authorization-server` or `/.well-known/oauth-protected-resource` support from the existence of a web login. Do not invent a public client ID or agent API credential.

The public API domain exposes a [beta demo](https://api.reviewrouter.org/demo.md) and [demo OpenAPI schema](https://api.reviewrouter.org/openapi.json), not a grant to invoke internal write endpoints.

## Credential and review boundaries

The current free workflow runs reviews in customer-authorized CI. Configure provider access only through the supported dashboard/CLI setup, with credentials stored in GitHub Actions secrets or approved encrypted custody, as appropriate to the selected mode. Never paste secrets or auth files into prompts, URLs or issue comments.

- Setup: https://reviewrouter.org/getting-started
- Security: https://reviewrouter.org/security
- Privacy: https://reviewrouter.org/privacy
- AI assistant guide: https://reviewrouter.org/agents.md
