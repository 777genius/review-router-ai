# Capabilities and limits

[Back to README](../README.md)

This page distinguishes **implemented features** from **verified rollout**.
Availability depends on the installed version, provider, configuration and
recorded data coverage. See the [deployment registry](../ai-docs/deployments/README.md)
for current environment-specific status.

## Review and configuration

- GitHub App installation, repository sync, setup PRs, review publication,
  repository health and audit views are implemented.
- The provider catalog offers Codex subscription auth, Claude Code OAuth,
  OpenRouter, Kimi Code and MiMo Token Plan. Supported authentication and model
  options depend on the selected provider; OpenAI API-key contracts are not a
  current Codex onboarding mode.
- Reviews support multiple providers, configurable parallelism and an agreement
  threshold for inline comments. Model, effort, language, comment and severity
  settings can inherit workspace defaults or be overridden per repository.
- Exact-revision authorization and publication checks guard against stale runs.
- Organization-wide GitHub required workflows are supported for selected or all
  repositories when organization rulesets, account plan and admin permissions
  are available. GitHub Free organizations are not eligible.
  See the [ruleset implementation](../packages/features/org-ruleset-provisioning/src/application/use-cases/request-org-ruleset-provisioning.ts).

Sources: [provider catalog](../packages/features/review-providers/src/domain/provider-catalog.ts),
[configuration schema](../packages/features/review-config/src/domain/review-configuration.ts),
[Review v2 contract](./operations/review-action-v2-cutover.md).

## Feature availability

| Feature           | Availability and limits                                                                                                    | Rollout                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Memory            | Approved scoped knowledge; enabled with a configured, qualified Hindsight backend unless explicitly disabled.              | [setup][memory]         |
| PR conversations  | Full-thread replies and automatic learning require a separately qualified interaction runtime, Gateway, account and model. | [status][conversations] |
| Skills            | Versioned text instructions, sharing, assignments and checked imports; production text-only E2E verified.                  | [status][skills]        |
| MCP context tools | Approved remote HTTPS tools for compatible OCR/Gateway; two-reviewer canary verified.                                      | [status][mcp]           |
| Statistics        | PRs, reviews, issues and trends; completeness requires verified capture and reconciliation.                                | [status][statistics]    |
| Review history    | GitHub v2 review runs, filters and reruns; production capture since activation, no historical backfill.                    | [status][history]       |
| Usage             | Provider/model/run attempts, known tokens and costs; coverage-aware, rollout verification ongoing.                         | [status][usage]         |

[memory]: ../packages/features/memory/README.md#default-enablement
[conversations]: ../ai-docs/deployments/2026-10-29-conversational-memory.md
[skills]: ../ai-docs/deployments/2026-10-28-skills-catalog.md
[mcp]: ../ai-docs/deployments/2026-11-01-reviewer-v4-mcp.md
[statistics]: ../ai-docs/deployments/2026-10-29-statistics-history-followthrough.md
[history]: ../ai-docs/deployments/2026-10-28-review-history.md
[usage]: ../ai-docs/deployments/2026-10-29-statistics-history-followthrough.md

Features in source are not necessarily active in every hosted workspace.

## Hosting and data

**Default GitHub mode:** checkout, tools and review execution stay in GitHub
Actions. The configured AI provider receives review context. The control plane
handles identities, revisions, findings, summaries, publication and operational
metadata; it does not receive raw source files or provider credentials by default.
See the [privacy boundary](./privacy-self-hosted.md).

**Self-hosted:** The guided installer configures web, API, worker, PostgreSQL,
migrations, HTTPS and release registration. Operators prepare DNS, complete
GitHub App and provider onboarding, and merge the repository's workflow setup PR.
The installer checks readiness and repository activation; verify the first live
review with a test pull request.
See the [installation guide](./operations/review-router-self-hosted-end-to-end.md#guided-installation).

## GitLab

The setup wizard accepts a group or project URL, discovers repositories and
installs CI wiring. It uses a request-scoped access token that the UI says is
not stored. Depending on permissions and existing CI configuration, setup may
produce a merge request instead of directly updating project settings.
The runtime publishes MR discussions and keeps provider secrets in GitLab CI/CD
variables. GitHub-specific OIDC, App publication and workflow instructions do
not apply unchanged to GitLab.

See the [setup implementation](../apps/web/app/setup/gitlab/gitlab-connect-wizard.tsx)
and [GitLab runtime reference](../deploy/gitlab/README.md).

## Deployment-specific and legacy capabilities

Optional GitHub live-progress comments require explicit capture, publisher
and repository-cohort configuration. The defaults are off; failed progress
publication must not block a final review. See the
[progress rollout guide](./operations/live-review-progress-rollout.md).

The default OpenCodeReview path runs separately from the earlier
ReviewRouter/Codex investigation runtime. ReviewRouter's independent critics
and dependency-attested cross-revision replay belong to that earlier runtime
and retain its activation requirements. See the
[runtime selection](https://github.com/777genius/review-router/blob/main/src/review-orchestration/infrastructure/production-t0-review-runner.ts),
[earlier investigation status](./architecture/review-investigation-implementation-status.md)
and [reuse contract](./architecture/dependency-attested-review-reuse.md).
Those historical rollout controls do not govern ordinary OpenCodeReview reviews
or approved-memory retrieval. Dated deployment observations describe the
environment recorded at that time.

Payments, enterprise SSO and broader support/admin tooling remain product work.
This repository documents a local development environment and an operator CLI,
not a general local-code-review command.
