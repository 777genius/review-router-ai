# ReviewRouter

AI code review for GitHub pull requests, powered by [OpenCodeReview](https://github.com/alibaba/open-code-review).
Run reviews in GitHub Actions with your own AI providers; manage findings, models
and review rules in one dashboard.

[Set up your reviewer now](https://reviewrouter.org) with a guided setup.

[Self-host](./docs/operations/review-router-self-hosted-end-to-end.md) · [Documentation](./docs/README.md)

## Dashboard preview

<img width="1136" height="681" alt="ReviewRouter dashboard" src="https://github.com/user-attachments/assets/18b8e7bd-88a3-4235-bfb2-2110ae284ce7" />
<img width="721" height="630" alt="ReviewRouter review comment" src="https://github.com/user-attachments/assets/3def12b4-ad47-4b85-95b7-5cc585e4ff72" />
<img width="1145" height="737" alt="ReviewRouter Accounts" src="https://github.com/user-attachments/assets/5b7b1383-683b-4266-9da5-74c48f1d94c9" />
<img width="1135" height="737" alt="ReviewRouter usage" src="https://github.com/user-attachments/assets/447a4f0c-5527-41bd-a08e-6bb540eb3943" />
<img width="1135" height="737" alt="ReviewRouter statistics" src="https://github.com/user-attachments/assets/9a6d86ae-1884-45f4-9c89-3c5851bd2ccf" />


## Features

### Memory, Skills and MCP

- **Memory (Hindsight).** Reuse approved workspace-, repository- and user-scoped
  rules, observations and exceptions when a memory backend is configured.
- **PR conversations.** On qualified interaction workflows, respond to inline
  review threads using the verified discussion. Authorized maintainer replies can
  also propose memory changes.
- **Memory controls.** Browse and add knowledge, retire outdated entries or
  request permanent forgetting. Workspace admins can require confirmation
  before AI memory changes.
- **Skills.** Create versioned Markdown review instructions, import/export
  `SKILL.md`, share across workspaces with permission and assign them to repositories.
  Each review captures its selected instructions.
- **Skills catalog.** Preview [Universal Agent Plugins](https://universal-agent-plugins.com/)
  skills, check static security results (optionally AI-assisted) and import
  reviewed text without installing third-party scripts.
- **MCP tools.** Connect remote HTTPS MCP servers, discover and approve tools,
  and select them for compatible reviews. Test Dashboard credentials in the UI;
  verify GitHub Secrets in the repository workflow. Built-in tools cover
  GitHub issues and docs.

### AI reviews

- **Inline code review.** Severity-rated, line-specific findings and summaries
  attached to the exact PR commit.
- **Multiple reviewers.** Choose models and accounts, run reviewers in parallel
  and require agreement before publishing inline findings.
- **AI providers and accounts.** Connect Codex, Claude Code, OpenRouter,
  MiMo Token Plan or Kimi Code via supported subscriptions, OAuth or API keys.
  Manage accounts and choose models from the available provider catalogs.
- **Review settings.** Workspace defaults and per-repository overrides for models,
  reasoning effort, language, severity, comment limits and parallelism. Workspace
  admins also control automatic reviews of draft PRs.
- **PR descriptions.** Optionally generate or update descriptions with the
  configured primary reviewer.
- **Safe publication.** Stale runs cannot publish findings for newer code.
  Failed or incomplete review coverage is reported, not counted as success.

### Dashboard and insights

- **Review history.** Search pull requests by title, number or repository;
  filter by status and date, inspect previous runs and reruns, and open the GitHub PR.
- **Statistics.** Published reviews, distinct PRs and first-recorded issues by
  severity, with trends, top repositories and 7/30/90-day comparisons. Drill into
  individual findings and open their PRs.
- **Usage.** Provider attempts, known tokens and costs by provider, model
  and run, with filters and explicit coverage when data is missing.
- **Operations.** Repository health, queue failures, audit events,
  metadata-only diagnostics and workspace/repository access management.

### Setup and hosting

- **GitHub App setup.** Select repositories, create an inspectable setup PR
  for workflow changes and verify readiness in the dashboard.
- **Organization-wide checks.** In eligible GitHub organizations, configure a
  shared required workflow through GitHub Rulesets for selected or all repos.
  Requires a supported GitHub plan and organization permissions.
- **Code and credentials.** By default, checkout and tools run in GitHub Actions,
  repository credentials stay in CI, and the chosen AI provider receives review
  context. ReviewRouter stores results and operational metadata, not raw source files.
- **Hosting options.** Use the hosted service or
  [self-host with the guided Docker Compose installer](./docs/operations/review-router-self-hosted-end-to-end.md).

Availability varies by provider, installed workflows and deployment. See
[capabilities and limits](./docs/capabilities.md).

## Start with GitHub

1. [Install the GitHub App](https://reviewrouter.org) and select repositories.
2. Create and merge the review setup PR from the dashboard.
3. Connect a supported AI provider and open a pull request.

You approve the workflow changes before reviews begin. Provider usage counts
against your own subscription or API billing.

## Self-host

**Agent-first is the default.** On a Linux x64 server, prepare Docker
Compose v2, Git, curl, and Node.js 24.21+ or 26.10+. Point two DNS names
(e.g., `review.example.com` and `api.review.example.com`) to the server
and allow inbound ports 80/443. Default Memory also requires Python 3 and tar.

Give your coding agent shell access to that server and run:

```bash
bash -c 'installer=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/777genius/review-router-ai/main/scripts/install-self-hosted.sh -o "$installer" && bash "$installer" "$@"; result=$?; rm -f "$installer"; exit "$result"' -- \
  --web-url https://review.example.com \
  --repo OWNER/REPOSITORY
```

Replace the example domain and repository. The API domain defaults to
`https://api.review.example.com`; configure its DNS record too.
The installer generates private credentials, starts services and HTTPS,
and returns **one JSON status** with the next action. It resumes without
rebuilding a healthy installation. Agent mode needs no interactive terminal;
to follow prompts yourself, add `--interactive` to the same command.

You still approve the GitHub App, connect the provider through **GitHub Secrets**,
and approve the workflow setup PR. In `--review-only` mode, install the canonical
workflow manually instead. Subscription-account Gateway is a separate service.
A running server is **not** proof of a completed AI review.

This moving-branch command is for evaluation. For production,
[pin an approved source commit](./docs/operations/review-router-self-hosted-end-to-end.md#agent-first-installation-default).
See [installation, resume and first-review steps](./docs/operations/review-router-self-hosted-end-to-end.md#guided-installation).

## Review engine

ReviewRouter uses [OpenCodeReview](https://github.com/alibaba/open-code-review).
Its [published benchmarks](https://github.com/alibaba/open-code-review#benchmark)
are upstream results, not independent ReviewRouter measurements.

## Current status

| Integration | What to expect                                                     |
| ----------- | ------------------------------------------------------------------ |
| GitHub      | App installation, setup PRs, inline review and a shared dashboard. |
| GitLab      | In development.                                                    |
| Self-hosted | Guided Docker Compose installation on your infrastructure.         |

Live PR progress comments require deployment-specific rollout. See
[capabilities and limits](./docs/capabilities.md) for availability, the review
runtime boundaries and privacy details.

## Learn more

- [Self-hosting guide](./docs/operations/review-router-self-hosted-end-to-end.md)
- [Review settings](./docs/review-settings.md)
- [Development and checks](./docs/development.md)
- [All documentation](./docs/README.md)

This repository contains the dashboard, API, worker and review orchestration.
The public GitHub Action entrypoint lives in
[777genius/review-router](https://github.com/777genius/review-router).
