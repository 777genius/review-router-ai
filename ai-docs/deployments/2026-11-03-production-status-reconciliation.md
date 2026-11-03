# Production status reconciliation - 2026-11-03

## Current production baseline

Paired release227 is installed on Web/API/ordinary worker/scan worker:
private source `dbc161c9865f88e9cf60c8ad21b2814ecec8eec2`, image
`sha256:89a28e11e9c3191b1160abd1fbdd12b1cdadcd3f820e75e52a3ea617f5a3947a`.
Public Action and actual `workflow-v1` resolve to
`abff4814dccab046debd61f7f5e14f4524f54e5e`. The immutable capacity128 producer
is registered; all54 legacy registry entries were retained. All four roles were
running with restart count0 and API readiness200 at delivery.

[Durable release and live evidence](evidence/2026-11-03-capacity128-release227.json)
links the successful official release, exact-main CI, channel promotion and
Payments run41631048975/1. Its required coverage is17/17, two minor findings
were published by the App, and Statistics processed one review fact and two
unique issue lineages. Usage reports44 complete discovery calls and one optional
PR-description call with genuinely unknown outcome/tokens; that unknown is not
zero and was not retried. The exact45 Native requests are physically released:
occupied0,45 closure ACKs, terminal/fenced parent and scoped cleanupDONE.

## Owner decision and historical work

On2026-11-03 the owner explicitly accepted that old pre-user/test Statistics and
legacy executions do not require restoration or reconciliation for delivery.
Therefore historical Statistics dead-letter recovery, old-run backfills/replays
and blanket legacy physical-custody reconciliation are **waived / archived as
non-blocking historical work**, not queued production deployment steps.

This decision changes the work queue, not historical facts: partial results stay
partial, unknown effects stay unknown, and no missing tokens are invented. No
rows, namespaces, accounts, credentials, stands, test repositories, snapshots,
receipts or old containers are deleted by this documentation change. Do not
recover or replay unknown inference/publication operations merely to make an old
record green. Runtime authorization, cleanup and data-isolation safeguards remain
unchanged. Fresh observed incidents still require normal scoped handling.

## How to read statuses

- `deployed`: rollout and the stated required acceptance are established.
- `installed`: actual code/image delivery is established; some specific feature
  checks are not proven. Record a missing check as verification work, not another
  deploy, migration, feature activation or model invocation.
- Staging `pending` does not imply that production needs deployment.
- Old pending/not-executed/226 sections are retained historical observations.
  The current disposition and actual227 evidence supersede them for rollout.

No new server deployment, database migration, model request, replay or cleanup
is performed or requested by this reconciliation. Reuse accepted CI/qualification
and recorded deployment evidence. Do not reopen completed rollout gates without
new contradictory evidence.

## Separate scope retained

New Memory corrections/semantic qualification, genuine self-hosted distribution
and GitLab cohort acceptance retain their own records and statuses. This update
does not claim they are deployed or qualified. It also does not fabricate passing
production UI/security/multi-reviewer scenario checks that were not observed.

## Reconciled records

| Record                                                                                                  | Current production disposition |
| ------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [2026-10-31-analytics-extensibility](2026-10-31-analytics-extensibility.md)                             | `installed`                    |
| [2026-11-02-analytics-review-reliability](2026-11-02-analytics-review-reliability.md)                   | `deployed`                     |
| [2026-11-02-gateway-terminal-run-cleanup](2026-11-02-gateway-terminal-run-cleanup.md)                   | `installed`                    |
| [2026-10-30-architecture-reliability](2026-10-30-architecture-reliability.md)                           | `installed`                    |
| [2026-10-31-github-webhook-error-privacy](2026-10-31-github-webhook-error-privacy.md)                   | `installed`                    |
| [2026-10-31-outbox-error-privacy](2026-10-31-outbox-error-privacy.md)                                   | `installed`                    |
| [2026-10-31-review-publication-item-isolation](2026-10-31-review-publication-item-isolation.md)         | `installed`                    |
| [2026-10-28-model-catalog](2026-10-28-model-catalog.md)                                                 | `installed`                    |
| [2026-10-28-dispatch-cleanup-ci](2026-10-28-dispatch-cleanup-ci.md)                                     | `installed`                    |
| [2026-10-29-unified-ocr](2026-10-29-unified-ocr.md)                                                     | `installed`                    |
| [2026-10-29-gateway-multi-reviewers](2026-10-29-gateway-multi-reviewers.md)                             | `installed`                    |
| [2026-10-29-review-dispatch-retry-storm](2026-10-29-review-dispatch-retry-storm.md)                     | `installed`                    |
| [2026-10-29-statistics-history-followthrough](2026-10-29-statistics-history-followthrough.md)           | `installed`                    |
| [2026-11-02-public-agent-discovery](2026-11-02-public-agent-discovery.md)                               | `installed`                    |
| [2026-11-02-installed-gateway-operator-onboarding](2026-11-02-installed-gateway-operator-onboarding.md) | `deployed`                     |
| [2026-10-30-usage-sql-read-path](2026-10-30-usage-sql-read-path.md)                                     | `deployed`                     |
