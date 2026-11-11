# Claude Code dual authentication: deployment and qualification

- Task ID: `2026-11-11-claude-dual-auth`
- Goal: one Claude Code provider, with explicit user-owned subscription via official Claude Code CLI + GitHub Secrets, and API-key authentication via GitHub Secrets or the existing encrypted workspace-key store, whose existing GitHub Secrets delivery installs the key into selected repositories. Native Gateway inference is a separate future capability.
- Affected services/targets: ReviewRouter Web/API/worker, ReviewRouter Action runtime/immutable workflow channel, Prisma/PostgreSQL, Account Gateway/Sub2API (future API-key profile).
- Implementation PRs: [Action #385](https://github.com/777genius/review-router/pull/385), [SaaS #857](https://github.com/777genius/review-router-ai/pull/857), [plan #855](https://github.com/777genius/review-router-ai/pull/855).
- Implementation reference: moving Draft PR heads; these are source candidates, not installed/merged provenance.
- Dependencies: exact Action runtime bundle regeneration/pinning, release-profile attestation, a user-owned GitHub Actions Secret OR workspace-managed encrypted Anthropic API key delivered to GitHub Secrets, successful offline synthetic E2E.
- Last updated: 2026-11-11.

## Environment status

| Environment / target | Status    | Actual version/image                                    | Last verified UTC | Next step                                                                              |
| -------------------- | --------- | ------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Synthetic CI         | `pending` | Draft branches, exact HEAD qualification not yet proven | Not verified      | Offline two-auth and GitHub App test PR, tests/build/format/security                   |
| Staging              | `pending` | Not verified                                            | Not verified      | Inspect installed baseline, qualified Action and migration readiness before installing |
| Production           | `pending` | Not verified                                            | Not verified      | Explicit owner release approval required; no live credentials available for acceptance |

## Applicability and prerequisites

- **No production deploy or credential enrollment is authorized** by these Draft PRs.
- Read [release management](../operations/07-environments-and-release-management.md) and unfinished task index before any rollout. Verify exact current main, Action pin, approved immutable producer metadata and GitHub App identity.
- The additive SQL check migration `000156_claude_code_api_key_secret` must run before SaaS can write new `WorkspaceProviderProfile.authMode=claude_code_api_key` rows. Existing rows and secrets are not migrated.
- Protect existing workspace provider profiles, repository defaults and workflow pins. No implicit change to saved Claude subscription mode.
- **Credential-policy gate:** never collect/customer-enroll Claude subscription tokens in ReviewRouter or Gateway; the supported customer subscription path uses customer-owned GitHub Secrets with an unmodified Claude Code CLI. The existing prepared OAuth-over-HTTP runtime is not a substitute. Separate Anthropic authorization would be required for central subscription custody.
- **Current scoped API-key custody:** ReviewRouter already has an encrypted workspace-key store with per-repository GitHub Secrets delivery. Extend its exact `providerType=anthropic` allowlist, preserve owner/admin authorization and audit, and run the same official Claude Code CLI in CI. Do not repurpose the Claude OAuth Gateway profile. Native Gateway inference is a separate future capability and is not required for this CI-backed mode.

## Ordered rollout (only after owner approval)

1. Confirm and record the target runtime and SaaS image, compatibility/pin matrix, and branch CI evidence. Verify CodeRabbit/security feedback disposition.
2. Publish/qualify the Action built output from exact approved source; ensure committed bundles and release identity match. Confirm GitHub App publication and no token-in-logs in disposable repository.
3. Apply migration `000156` through the normal database migration mechanism before deploying SaaS writers. No data rewrite.
4. Install SaaS API/worker/Web through the standard release process, with source-pinned matching Action. No new feature flag.
5. Verify Claude subscription and API-key choices and secrets in disposable GitHub Actions, with both auth methods present but only the selected one passed to the CLI child, and fail-closed negative tests.
6. Qualify the existing ReviewRouter-managed key storage and GitHub Secrets delivery on a disposable repository (encryption, scope, audit, install, partial failure, rotation and revoke). Keep central Gateway-backed inference unavailable; it is not needed for this release.
7. Only then run an authorized live-account canary; synthetic fixtures cannot prove real Anthropic authentication or customer entitlement.

## Verification and completion

- Confirm selecting Claude produces a single provider row and independent credential modes. Save/reload workspace default and repository override without migration of old profiles.
- Verify SQL CHECK rejects incompatible credential/auth combinations.
- Validate CLI installation, isolation, token rotation diagnostics, cancellation, provider usage, both streams and malformed/unknown effect, fail-closed source selection.
- Disconnected/expired/revoked credentials never consume another account; no attempt replays after an unknown effect.
- Verify GitHub App-authored summary and inline comment, current-HEAD fence, duplicate suppression, and correct no-finding outcome on synthetic PR. Neither the subscription token nor managed API key can appear in SaaS logs/workflow outputs; only the selected credential is delivered to the Claude CLI process.
- Obtain exact CI source/pin, real tests and visual browser evidence. A simulated Anthropic-shaped upstream is **not** a live Anthropic approval or paid inference result.
- `deployed` requires matching installed versions and actual environment verification; a merged PR is not deployment.

## Retry, partial completion, and rollback

- Inspect PostgreSQL migration history, installed Action refs and already-created provider profiles before retrying. Never blindly reapply the migration or replay a review with unknown provider effect.
- If new mode fails, stop offering new API-key registration and revert the SaaS/Action change through approved source/channel rollback; preserve old `claude_code_oauth` rows, GitHub Secrets and user choices. An additive SQL CHECK need not be rolled back if rows rely on it; inspect first.
- Do not auto-switch accounts, credentials or providers during recovery.

## Related links

- [Dual-auth plan](https://github.com/777genius/review-router-ai/pull/855)
- [SaaS](https://github.com/777genius/review-router-ai/pull/857)
- [Action](https://github.com/777genius/review-router/pull/385)
- [Anthropic credential policy](https://code.claude.com/docs/en/legal-and-compliance)
- [Release management](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC) | Environment             | Operator         | Version/image | Observed result                                                   | Evidence             | Next action                                   |
| ---------- | ----------------------- | ---------------- | ------------- | ----------------------------------------------------------------- | -------------------- | --------------------------------------------- |
| 2026-11-11 | Synthetic source review | GitHub Draft PRs | Not released  | Two auth modes and tests submitted; final CI/E2E not yet complete | PRs #385, #857, #855 | Finish required checks before merge or deploy |
