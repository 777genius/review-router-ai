# Outbox failure summaries: durable error privacy

Date: 2026-10-31
Baseline: `e0fb3391f69cb69941b8a72233a120dcd4fcbf29`
Status: draft.

## Confirmed defect

`packages/features/outbox/src/domain/outbox-event.ts` names its function `safeOutboxErrorSummary` but persists the raw `OutboxHandlerError.message.slice(0, 500)` or unexpected `Error.message.slice(0, 500)`. Handler exceptions can contain SDK access tokens, DB credentials, URLs, tenant data and private provider responses. The Prisma outbox adapter writes the resulting string to `safeLastErrorSummary`. Truncation does not prevent leaks.

## Bounded contract

- Replace durable arbitrary text with one of two fixed, non-sensitive summaries: known application error vs unexpected handler failure. Keep application error's explicit `code` / `retryable` semantics and the generic `handler_error` code; allow only reviewed, developer-defined diagnostic codes (otherwise use `handler_error`) so lowercase secret-shaped values cannot leak through the code field.
- Do not alter outbox claim, heartbeat, fencing, handler dispatch, retry exhaustion, manual dead-letter controls, retry scheduling or database schema.
- Add unit and persisted-retry regressions that inject representative credentials and private payload/error messages and assert no leakage in persisted summary. Ensure the existing deterministic error codes and retryable distinctions stay intact.
- Avoid a new generic secret-redaction framework; fixed summaries are robust and simpler.

## Qualification / release

Risk-targeted unit/Prisma tests, full architecture/type/format and CI/E2E gates, independent security/reliability review and issue fixes before merge. Coherent ordinary worker + applicable Skills consumer rollout, no activation or migration. Deployment registry remains `pending` until actual environment evidence exists.
