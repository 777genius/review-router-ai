# Outbox failure summaries: durable error privacy

Date: 2026-10-31
Baseline: `e0fb3391f69cb69941b8a72233a120dcd4fcbf29`
Status: draft.

## Confirmed defect

`packages/features/outbox/src/domain/outbox-event.ts` names its function `safeOutboxErrorSummary` but persists the raw `OutboxHandlerError.message.slice(0, 500)` or unexpected `Error.message.slice(0, 500)`. Handler exceptions can contain SDK access tokens, DB credentials, URLs, tenant data and private provider responses. The Prisma outbox adapter writes the resulting string to `safeLastErrorSummary`. Truncation does not prevent leaks.

## Bounded contract

- Replace durable arbitrary text with fixed, non-sensitive summaries and reviewed diagnostic codes. Preserve `db_permission_denied` for SQLSTATE 42501 or a precise database privilege failure, so post-deploy grant checks still detect recent dead letters without persisting SQL or provider text. Preserve retryability, otherwise fall back to `handler_error` for untrusted codes.
- Do not alter outbox claim, heartbeat, fencing, handler dispatch, retry exhaustion, manual dead-letter controls, retry scheduling or database schema.
- Add unit and persisted-retry regressions that inject representative credentials, untrusted error codes and PostgreSQL grant failures; assert that the post-deploy SQL predicate contains the stable code, legacy text clauses, and a seven-day cutoff (without claiming an executable temporal-boundary test), plus unchanged retryability.
- Avoid a new generic secret-redaction framework; fixed summaries are robust and simpler.

## Qualification / release

Risk-targeted unit/Prisma tests, full architecture/type/format and CI/E2E gates, independent security/reliability review and issue fixes before merge. Coherent ordinary worker + applicable Skills consumer rollout, no activation or migration. Deployment registry remains `pending` until actual environment evidence exists.
