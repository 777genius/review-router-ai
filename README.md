# ReviewRouter

AI code review for GitHub pull requests, powered by [OpenCodeReview](https://github.com/alibaba/open-code-review).
Run reviews in GitHub Actions with your own AI providers; manage findings, models
and review rules in one dashboard.

[Set up your reviewer now](https://reviewrouter.org) with a guided setup.

[Self-host](./docs/operations/review-router-self-hosted-end-to-end.md) · [Documentation](./docs/README.md)

## Dashboard preview

<img width="1145" height="737" alt="ReviewRouter overview" src="https://github.com/user-attachments/assets/c32ea23f-3d34-4e5c-917f-d72d981b88c5" />
<img width="916" height="622" alt="ReviewRouter dashboard" src="https://github.com/user-attachments/assets/fc11accd-dbd4-457b-ad6a-a43cccd075d1" />

## Features

### Memory, Skills and MCP

- **Memory (Hindsight).** Reuse approved workspace and repository rules,
  observations and exceptions in later reviews when a memory backend is configured.
- **PR conversations.** On qualified interaction workflows, respond to inline
  review threads using the verified discussion. Authorized maintainer replies can
  also propose memory changes.
- **Memory controls.** Browse and add knowledge, retire outdated entries or
  request permanent forgetting. Workspace admins can require confirmation
  before AI memory changes.
- **Skills.** Create versioned Markdown review instructions, import/export
  `SKILL.md`, share with permissions and assign them to repositories.
- **Skills catalog.** Preview [Universal Agent Plugins](https://universal-agent-plugins.com/)
  skills, check static security results (optionally AI-assisted) and import
  reviewed text without installing third-party scripts.
- **MCP tools.** Connect and test remote HTTPS MCP servers, approve individual
  tools and select them for compatible reviews. Credentials can use encrypted
  dashboard storage or GitHub Secrets; built-in tools cover GitHub issues and docs.

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
- **Statistics.** Published reviews, distinct PRs, first-recorded issues by
  severity, daily trends, top repositories and 7/30/90-day comparisons.
- **Usage.** Provider attempts, known tokens and costs by provider, model
  and run, with filters and explicit coverage when data is missing.
- **Operations.** Repository health, queue failures, audit events,
  metadata-only diagnostics and workspace/repository access management.

### Setup and hosting

- **GitHub App setup.** Select repositories, create an inspectable setup PR
  for workflow changes and verify readiness in the dashboard.
- **Code and credentials.** By default, checkout and tools run in GitHub Actions,
  repository credentials stay in CI, and the chosen AI provider receives review
  context. ReviewRouter stores results and operational metadata, not raw source files.
- **Hosting options.** Use the hosted service or
  [self-host with Docker Compose](./docs/operations/review-router-self-hosted-end-to-end.md).
  The opt-in encrypted hosted account pool uses a separate model-relay privacy boundary.

Availability varies by provider, installed workflows and deployment. See
[capabilities and limits](./docs/capabilities.md).

## Start with GitHub

1. [Install the GitHub App](https://reviewrouter.org) and select repositories.
2. Create and merge the review setup PR from the dashboard.
3. Connect a supported AI provider and open a pull request.

You approve the workflow changes before reviews begin. Provider usage counts
against your own subscription or API billing.

## Review engine

ReviewRouter uses [OpenCodeReview](https://github.com/alibaba/open-code-review).
Its [published benchmarks](https://github.com/alibaba/open-code-review#benchmark)
are upstream results, not independent ReviewRouter measurements.

## Current status

| Integration | What to expect                                                     |
| ----------- | ------------------------------------------------------------------ |
| GitHub      | App installation, setup PRs, inline review and a shared dashboard. |
| GitLab      | In development.                                                    |
| Self-hosted | Docker Compose deployment on your infrastructure.                  |

Advanced investigations and cross-revision replay remain gated.
See [capabilities and limits](./docs/capabilities.md) for rollout and privacy details.

## Learn more

- [Self-hosting guide](./docs/operations/review-router-self-hosted-end-to-end.md)
- [Review settings](./docs/review-settings.md)
- [Development and checks](./docs/development.md)
- [All documentation](./docs/README.md)

This repository contains the dashboard, API, worker and review orchestration.
The public GitHub Action entrypoint lives in
[777genius/review-router](https://github.com/777genius/review-router).
