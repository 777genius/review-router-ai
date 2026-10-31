# GitHub webhook failure summaries: privacy boundary

Date: 2026-10-31
Baseline: `e0fb3391f69cb69941b8a72233a120dcd4fcbf29`
Status: implemented; pending final exact-head CI/review and merge.

## Confirmed defect

Both `handleGitHubInstallationWebhook` and the GitHub signed webhook HTTP route write `error.message.slice(0, 500)` into the durable `GitHubWebhookDelivery.errorSummary` column after an installation, pull-request, repository or push handler fails. Backend and GitHub SDK error messages may contain credentials, Authorization headers, URLs with access tokens, private repository paths or webhook payloads. Truncation is not sanitization. The worker and other production paths already avoid unrestricted error strings.

## Bounded refactor

- One feature-owned pure helper for safe webhook failure codes reused by the HTTP adapter and installation use case, no duplication or generic logging framework.
- Retain only compact, explicitly shaped machine-safe codes. Arbitrary text, exception causes and payload objects become a fixed opaque failure reason. Never embed credentials, emails, access URLs or private payload text.
- Existing durable delivery status, exact identity, retry/reclaim behavior and signed webhook validation do not change. Signed webhook handler exceptions now return a fixed HTTP 500 body and report an opaque failure via the configured API logger instead of propagating to Fastify's default error handler/onError hook; validation responses remain unchanged.
- Direct regression tests and integration tests inject known credential forms and unstructured payloads, asserting no leakage, correct persisted code and unchanged retry.

## Qualification

Focused E2E handler and route tests, architecture/type/format gates, exact-head CI and security/code review, fix confirmed findings. No new migration, configuration or flag. Register ordinary API rollout as pending; do not claim staging/production deployed.
