# Deployment tasks

Keep one Markdown file per task whose implementation still needs deployment or
environment work. This includes ordinary code rollout, migrations, configuration,
data conversion, feature activation, and verification. Agents create or update
the record with the implementation and leave it ready for the next deployment.
Documentation-only changes with no environment work do not need a task record.

The [release process](../operations/07-environments-and-release-management.md)
remains authoritative for release gates, migration order, approvals, and tags.
Task files add feature-specific instructions and actual environment evidence.
They do not grant deployment permission or replace existing operational runbooks.

## Task index

Gateway saturation follow-up: [terminal-run cleanup](2026-11-02-gateway-terminal-run-cleanup.md) — staging `pending`, production `in_progress`;226 API installed, A/B full coverage; payments PARTIAL 0/17, versioned dispatch fix/fresh acceptance pending.

Current reliability batch: [Analytics and review completion](2026-11-02-analytics-review-reliability.md) — staging `pending`, production `in_progress`;226 coherent rollout complete, A/B full coverage and Usage/Statistics accepted; payments PARTIAL 0/17, future fresh run pending.

Bounded request capacity: [Named capacity128 rollout](2026-11-03-model-dispatch-capacity.md) — staging/production `pending`; source qualification passed. Preserve immutable V2; parser-first, owner-coordinated paired227 rollout must precede fresh full17-file Payments acceptance.
