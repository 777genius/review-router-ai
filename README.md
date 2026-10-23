# ReviewRouter

AI code review in your CI, powered by **open-code-review**.
Supports multiple coding providers using your own subscriptions or API keys.
Get inline feedback on pull requests and manage models, review rules and
repository health from one dashboard.

[Set up your reviewer now](https://reviewrouter.org) with a guided setup.

[Self-host](./docs/operations/review-router-self-hosted-end-to-end.md) · [Documentation](./docs/README.md)

<img width="1186" height="735" alt="image" src="https://github.com/user-attachments/assets/6fce13d0-b83d-4ff0-bbd5-66eb588a897f" />
<img width="916" height="622" alt="ReviewRouter dashboard" src="https://github.com/user-attachments/assets/fc11accd-dbd4-457b-ad6a-a43cccd075d1" />

## Why ReviewRouter

- **Bring your own AI.** Use supported coding providers with your own
  subscriptions or API keys.
- **Run reviews in your CI.** Checkout, code reading and review tools run
  in your GitHub Actions runner. You choose the AI provider that receives context.
- **Get a second opinion.** Run multiple reviewers and require agreement
  before posting an inline finding.
- **Tune reviews for your team.** Set models, reasoning effort, review language,
  comment limits and severity thresholds, with workspace defaults and repository overrides.
- **Avoid outdated feedback.** Reviews are tied to the commit being checked,
  so an older run cannot publish findings as if it reviewed newer code.
- **Choose where to host.** Use the hosted service or run the dashboard, API,
  worker and database on your own infrastructure.

## Start with GitHub

1. Open [ReviewRouter](https://reviewrouter.org) and install the GitHub App
   for the repositories you want reviewed.
2. Use the dashboard to create and merge the review setup PR.
3. Connect your provider using the generated setup instructions, then open a pull request.

The setup PR makes the CI changes visible before you accept them. In the default
mode, provider secrets stay in GitHub Actions; ReviewRouter stores review results
and operational metadata, not raw source files by default. Provider and CI usage
still count against your own plan or billing.

## Current status

| Integration       | What to expect                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub            | App installation, setup PRs, inline review and a shared dashboard.                                                                                              |
| GitLab            | Setup wizard and CI-based merge request review. Setup uses a request-scoped access token.                                                                       |
| Self-hosted       | Docker Compose deployment on your infrastructure; operator setup required.                                                                                      |
| Hosted account pool | Gated, opt-in account management for a workspace. Entitled workspace admins enroll an eligible provider account from the dashboard (device sign-in or `auth.json` upload). |

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
