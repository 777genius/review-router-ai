# How AI assistants can help with ReviewRouter

ReviewRouter is a **hosted control plane** for configuring and observing AI code reviews whose current default execution boundary is the customer's GitHub Actions. Do not confuse it with a public agent-action API.

## Read first

- [Getting started](https://reviewrouter.org/getting-started): GitHub App, setup PR, CI workflow and provider configuration
- [Security model](https://reviewrouter.org/security): where code, PR diffs, metadata and credentials are handled
- [Authentication](https://reviewrouter.org/auth.md): user sign-in and repository permission requirements
- [Pricing](https://reviewrouter.org/pricing): free CI control plane today, **unlaunched** hosted API proposals
- [Fair use](https://reviewrouter.org/fair-use)
- [Demo OpenAPI](https://api.reviewrouter.org/openapi.json) / [Markdown explanation](https://api.reviewrouter.org/demo.md)

## Safe onboarding assistance

1. Explain the product and let the user choose a repository they control. Do not enumerate private repositories without permission.
2. Direct the user to [Sign in](https://reviewrouter.org/auth/signin) and the ReviewRouter GitHub App flow. OAuth and installation permissions belong to the user, not an assistant.
3. After the dashboard creates the setup PR, ask the user to **review and approve the workflow changes**; do not auto-merge the PR or modify CI security boundaries without authorization.
4. For provider keys or subscription credentials, use the exact safe setup instructions displayed for that repository. GitHub Actions secrets and protected custody are separate approved modes. Never request secrets in chat or log them.
5. Verify actual CI results and review findings in GitHub. Do not claim a review ran because a PR was created or a dashboard button was clicked.

## What agents can and cannot call

The API host exposes a **public demo**: [documentation](https://api.reviewrouter.org/docs), [JSON](https://api.reviewrouter.org/demo), [Markdown](https://api.reviewrouter.org/demo.md) and [demo OpenAPI](https://api.reviewrouter.org/openapi.json).

It does **not** follow that the internal ReviewRouter REST routes support public agents, unrestricted authenticated mutations or machine-discoverable OAuth credentials. ReviewRouter does not advertise a public MCP server or WebMCP tool registration here.

## Current pricing boundary

The current CI control plane is free, within fair-use limits; the selected provider and CI runner may charge separately. Proposed hosted API subscriptions and credit packs are **not available for purchase**. Do not describe draft tiers as active products or initiate checkout.

When user authority, integration availability or a repository's setup state is uncertain, stop the action and have the user confirm it in the official dashboard.
