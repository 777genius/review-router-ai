# ReviewRouter

AI code review in your CI, powered by **[open-code-review](https://github.com/alibaba/open-code-review)**.
Supports multiple coding providers using your own subscriptions or API keys.
Get inline feedback on pull requests and manage models, review rules and
repository health from one dashboard.

[Set up your reviewer now](https://reviewrouter.org) with a guided setup.

[Self-host](./docs/operations/review-router-self-hosted-end-to-end.md) · [Documentation](./docs/README.md)

<img width="1145" height="737" alt="image" src="https://github.com/user-attachments/assets/c32ea23f-3d34-4e5c-917f-d72d981b88c5" />
<img width="916" height="622" alt="ReviewRouter dashboard" src="https://github.com/user-attachments/assets/fc11accd-dbd4-457b-ad6a-a43cccd075d1" />

## Features

### Memory, Skills and context

- **Thread-aware memory.** Use the full verified inline review thread
  to answer in context and learn useful observations. Reuse scoped knowledge
  in later reviews; recheck facts when source comments change or disappear.
- **Memory controls.** Browse rules, observations and exceptions; add rules,
  retire outdated entries or request permanent forgetting. Learning can be
  automatic or require maintainer confirmation, set by workspace admins.
- **Reusable Skills.** Create and edit versioned Markdown review instructions,
  import/export `SKILL.md`, assign them to repositories and share them between
  workspaces with permission. Selected instructions are captured for each run.
- **Skills catalog and checks.** Browse [Universal Agent Plugins](https://universal-agent-plugins.com/),
  preview the actual skill text, run static security checks (optionally AI-assisted),
  review warnings and import checked instructions. No third-party scripts or
  dependencies are installed.
- **MCP context tools.** Connect remote HTTPS MCP servers, use reviewed catalog
  presets, discover and approve individual tools. Use encrypted dashboard
  credentials or GitHub Secrets; select tools per compatible agentic OCR review.
  Built-in context tools can read GitHub issues and repository docs.

### Reviews and insights

- **Statistics.** See published reviews, distinct pull requests reviewed and
  first-recorded issues by severity. Explore daily trends, top repositories,
  7/30/90-day filters and coverage-aware period comparisons.
- **Review history.** Find pull requests by title, number or repository; filter
  by status and date, see the latest review state and expand earlier runs and
  reruns. Jump to the original PR on GitHub.
- **Usage.** Track provider attempts, known input/output tokens and costs by
  provider, model and run. Filter by date, provider, model or route; inspect
  charts and missing-data coverage instead of treating unknown costs as zero.

### Review execution

- **AI code review.** Run [OpenCodeReview](https://github.com/alibaba/open-code-review)
  in CI, with inline findings, severity and review summaries tied to the
  exact commit being reviewed.
- **Multiple reviewers.** Combine different models and connected accounts,
  configure parallelism and require a minimum agreement before publishing an
  inline finding.
- **Bring your own AI.** Connect Codex, Claude Code, OpenRouter, MiMo Token Plan
  or Kimi Code with supported subscriptions, OAuth or API keys. Choose models
  from the available provider catalogs.
- **Review policies.** Set workspace defaults and repository overrides for
  models, reasoning effort, language, severity, comment limits and review
  behavior. Control automatic reviews of draft PRs.
- **PR descriptions.** Optionally generate or update an AI-assisted pull
  request description using the configured first reviewer.
- **Revision-aware publication.** Prevent stale runs from publishing as if they
  reviewed newer code, and track incomplete or unconfirmed outcomes rather
  than silently calling them successful.

### Setup and operations

- **GitHub App setup.** Select repositories, use an inspectable setup PR for
  workflow changes and check repository readiness in the dashboard.
- **Accounts and access.** Manage provider connections, workspace access and
  repository-specific selections with owner/admin permissions.
- **Health and diagnostics.** Inspect repository health, queue failures,
  audit events and support diagnostics without exposing raw review context.
- **Privacy and hosting.** By default, checkout and review tools stay in
  GitHub Actions; repository provider secrets stay in CI. Choose the hosted
  service, an opt-in encrypted hosted account pool or
  [self-hosted Docker Compose](./docs/operations/review-router-self-hosted-end-to-end.md).

Features requiring specific providers, workflows or rollout configuration may
not be active in every deployment. See [capabilities and limits](./docs/capabilities.md).

## Start with GitHub

1. Open [ReviewRouter](https://reviewrouter.org) and install the GitHub App
   for the repositories you want reviewed.
2. Use the dashboard to create and merge the review setup PR.
3. Connect your provider using the generated setup instructions, then open a pull request.

The setup PR makes the CI changes visible before you accept them. In the default
mode, provider secrets stay in GitHub Actions; ReviewRouter stores review results
and operational metadata, not raw source files by default. Provider and CI usage
still count against your own plan or billing.

## Benchmark

ReviewRouter uses the OpenCodeReview engine. [Upstream benchmarks](https://github.com/alibaba/open-code-review#benchmark)

<img width="2560" height="1836" alt="image" src="https://github.com/user-attachments/assets/327c8f80-29e2-4cf0-9ccf-e773be5c8205" />

## Current status

| Integration | What to expect                                                     |
| ----------- | ------------------------------------------------------------------ |
| GitHub      | App installation, setup PRs, inline review and a shared dashboard. |
| GitLab      | In development.                                                    |
| Self-hosted | Docker Compose deployment on your infrastructure.                  |

The hosted pool holds encrypted credentials and relays model traffic through
ReviewRouter, unlike the default repository-secret setup. Advanced investigations
and cross-revision replay are also gated. See [capabilities and limits](./docs/capabilities.md)
for availability, privacy boundaries and unfinished work.

## Learn more

- [Self-hosting guide](./docs/operations/review-router-self-hosted-end-to-end.md)
- [Review settings](./docs/review-settings.md)
- [Development and checks](./docs/development.md)
- [All documentation](./docs/README.md)

This repository contains the dashboard, API, worker and review orchestration.
The public GitHub Action entrypoint lives in
[777genius/review-router](https://github.com/777genius/review-router).
