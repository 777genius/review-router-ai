# Capabilities and limits

[Back to README](../README.md)

This describes the code on `main` reviewed on 2026-09-14. Merged implementation
is not proof that a capability is enabled in every hosted deployment.

## Review and configuration

- GitHub App installation, repository sync, setup PRs, review publication,
  repository health and audit views are implemented.
- The provider catalog offers Codex subscription auth, Claude Code OAuth and
  OpenRouter API keys. OpenAI API-key contracts remain in the code, but are not
  offered as a current Codex onboarding mode.
- Reviews support multiple providers, configurable parallelism and an agreement
  threshold for inline comments. Model, effort, language, comment and severity
  settings can inherit workspace defaults or be overridden per repository.
- Exact-revision authorization and publication checks guard against stale runs.

Sources: [provider catalog](../packages/features/review-providers/src/domain/provider-catalog.ts),
[configuration schema](../packages/features/review-config/src/domain/review-configuration.ts),
[Review v2 contract](./operations/review-action-v2-cutover.md).

## Hosting and data

**Default GitHub mode:** checkout, tools and review execution stay in GitHub
Actions. The configured AI provider receives review context. The control plane
handles identities, revisions, findings, summaries, publication and operational
metadata; it does not receive raw source files or provider credentials by default.
See the [privacy boundary](./privacy-self-hosted.md).

**Self-hosted:** Compose includes web, API, worker, PostgreSQL and migrations.
Operators still configure the GitHub App, HTTPS, signing/release material and
repository activation. It is not a one-click installer.
See the [complete deployment guide](./operations/review-router-self-hosted-end-to-end.md).

**Hosted Codex pool:** an opt-in, operator-managed mode centralizes accounts,
encrypted credential generations and repository bindings. Checkout and tools stay
in Actions, but model requests, tool outputs and responses pass through the SaaS
relay. Relay bodies must not be retained. This is a different trust boundary,
not the default mode where provider secrets stay in CI. The checked-in operator guide retains
Production HOLD pending release and disposable provider-canary evidence.
See the [pool decision](../ai-docs/decisions/029-opt-in-hosted-workspace-account-pool.md)
and [operator guide](../ai-docs/operations/hosted-pool-operator.md).

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

## Gated and unfinished work

Advanced investigations, independent critics and selective cross-revision replay
are implemented behind rollout controls that default to off. Reuse requires
compatible dependencies, configuration and fresh revision authority; it is not
an unconditional skip for unchanged files. See the
[investigation status](./architecture/review-investigation-implementation-status.md)
and [reuse contract](./architecture/dependency-attested-review-reuse.md).
Historical deployment observations in those documents are dated evidence.

One-click self-hosting, payments, enterprise SSO and broader support/admin tooling
remain product work. This repository documents a local development environment
and an operator CLI, not a general local-code-review command.
