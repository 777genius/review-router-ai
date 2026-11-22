# Relay close diagnostics: deployment

- Task ID: `2026-11-22-relay-close-diagnostics`
- Goal: give operators bounded, secret-free reasons for unresolved Gateway close operations while preserving session custody.
- Affected target: ReviewRouter API.
- Implementation PR/issue: [#962](https://github.com/777genius/review-router-ai/pull/962). Incident context: [review error report](https://github.com/777genius/agent-teams-ai/pull/1266#issuecomment-7078993822).
- Implementation reference: based on `18b89ac56bcc78653389138d1ce2c9402bd6eb43`; record the implementation PR and exact shipping commit before release.
- Dependencies: existing ReviewRouter/Gateway contracts; no schema or configuration change.
- Last updated: `2026-11-22`.

## Environment status

| Environment | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                   |
| ----------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| staging     | `pending` | Not verified                    | Not verified        | Review, merge, and select an authorized release before rollout.        |
| production  | `pending` | Not verified                    | Not verified        | Reconcile current release and follow the authorized release procedure. |

## Applicability and prerequisites

Confirm that the exact target release includes the reviewed implementation, verify the current fleet and applicable deployment tasks, and follow the [release process](../operations/07-environments-and-release-management.md). Existing Gateway capability and close contracts remain unchanged. No new migration, configuration, feature flag, or activation is required.

## Ordered rollout

Ordinary API code rollout is sufficient, subject to the release process and its existing fleet/custody safety gates. Do not restart services or evict uncertain sessions solely to generate a diagnostic. Record the exact version and environment evidence after each rollout attempt.

## Verification and completion

Local loopback tests passed 146/146. The repository's native compiler wrapper resolved `typescript-native@7.0.2`; `node scripts/local-checks/compiler-cli.ts --native --noEmit --listFiles -p apps/api/tsconfig.json` passed and included both changed API files. On 2026-11-22, the owner explicitly authorized a task-scoped exception for the existing TypeScript 6-based toolchain while a separate upgrade is investigated. Under that exception, scoped ESLint passed for the changed preparation and test files. This scoped run does not replace the full repository lint or required CI; the earlier pre-authorization compiler run is not counted.

Run the focused local and CI tests before rollout. After an authorized deployment, verify the API version and inspect only naturally occurring `review_run_gateway_close_diagnostic` entries for the fixed `phase`, `category`, allowlisted Gateway error `code` and `effect`, and bounded HTTP status. No execution, authorization, request, trace, bearer, provider payload, or raw error fields may appear. The absence of an event is not proof of successful cleanup. A bare non-JSON 503 may appear as `invalid_response` with unknown status; a cancellation category does not prove a timeout. Events are bounded and deduplicated per preparation, phase, and category, so later changed details can be suppressed; there is no global rate limit, and errors outside preparation are not covered. Observability does not itself fix saturation or establish the production incident's root cause.

## Retry, partial completion, and rollback

Reconcile the actually installed image and prior attempt before retrying. Use the [release process](../operations/07-environments-and-release-management.md) for rollback; this change does not require a data rollback. Preserve unknown execution custody and existing recovery evidence; never increase capacity, replay an inference, or release an unknown session as a diagnostic shortcut.

## Related links

- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).
- [Gateway terminal cleanup](2026-11-02-gateway-terminal-run-cleanup.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and result       | Evidence | Next action                                       |
| ------------ | -------------------- | ---------- | ---------------------- | --------------------- | -------- | ------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | No rollout attempted. | None     | Complete review and select an authorized release. |
