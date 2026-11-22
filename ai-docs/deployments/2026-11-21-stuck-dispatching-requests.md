# Dispatch preparation recovery

- Task ID: `2026-11-21-stuck-dispatching-requests`
- Goal: stop obsolete and abandoned pre-submission requests without touching a newer request or replaying an uncertain workflow dispatch.
- Affected target: ReviewRouter worker. Plan: [89](../architecture/89-stuck-dispatching-requests.md).
- Implementation reference: [PR #960](https://github.com/777genius/review-router-ai/pull/960), pending merge.
- Dependencies: none. No migration, configuration, public Action, Gateway or native change.
- Last updated: 2026-11-22.

## Environment status

| Target     | Status    | Actual image | Evidence     |
| ---------- | --------- | ------------ | ------------ |
| Staging    | `pending` | Not verified | Not deployed |
| Production | `pending` | Not verified | Not deployed |

## Applicability and verification

Include in the next authorized worker image bundle. Before rollout use read-only queries to confirm that dispatching requests with no submission, run, authorization or execution have null `resolutionDeadlineAt`; pause and investigate non-null legacy values. Do not use an old fixed row count as a write guard: rows and claims change continuously.

On first claim a request receives 24 hours for pre-submission work. Only the same unsubmitted request may be superseded after definitive stale-revision evidence. After 24 hours a new worker can terminate the request only after its prior claim expires. Unavailable or malformed GitHub responses do not prove the revision stale. Preparations in a batch run concurrently and each wait is capped at five seconds. This is not a deadline for the complete worker pass: database operations and recovery retain their existing behavior. GitHub reads receive an AbortSignal, but other I/O may ignore it. A late result cannot submit a workflow. At most 32 unresolved preparations are kept; their slots are not released until the underlying I/O finishes. When full, the worker signals saturation and skips new preparation while continuing other phases. Neither pool frees a slot merely on timeout; saturation can persist after network recovery if I/O never settles. The fleet overlay requires restart policy no; automatic self-restart is not safe or proven for other in-flight work. Investigate the saturation warning and use the authorized operator procedure if a restart is needed. POSTs have their own maximum of 32 unresolved operations and a five-second observation timeout. A slot is reserved before `beginSubmission`; saturation never begins a new durable submission. The five-second limit is a soft observation deadline and does not abort the network request. Each confirmed run ID is recorded immediately without waiting for other POSTs; a late accepted result uses the same fenced `recordDispatch` and cannot replace a terminal or different recovered result. A late no-effect response is ignored; the existing recovery resolves unknown outcomes without another POST.

After rollout use a fresh read-only state census and compare request identities and states against the earlier evidence. Confirm every old request is either stopped or has a legitimate bounded preparation window; check history projection for stopped requests and normal new reviews. Allow up to 24 hours for legacy rows whose cause is still unavailable. Do not claim all 23 resolved without read-back. A successful test review should use an existing disposable E2E repository, not a real project.

## Qualification before deployment

The isolated worker run passed 177 focused unit/adapter tests, including early independent POST recording, a seven-second success, late responses after terminalization or competing recovery at ten minutes, and ignored late no-effect results, both review-executions and worker typechecks, and scoped ESLint. Four targeted tests passed against disposable PostgreSQL 17 with schema through 000079; 41 other tests in that file were deliberately filtered. A separate three-case history policy check maps superseded to Stopped, dispatch_failed_no_effect to Failed, and an unknown POST outcome to Unconfirmed. An additional targeted test in the existing history PostgreSQL suite passed on a separate fresh disposable PG17 with the full migration chain: source transaction → outbox event → projector → persisted Stopped/Failed status. It selected 1 test and intentionally filtered the other 7 because only this changed transition was under review. It does not prove production delivery or a specific reason in the UI. A synthetic EXPLAIN on disposable PG17 used 100,000 narrow temporary rows, 20,000 due and 16 excluded IDs: bitmap scan plus top-N sort processed 20,000 rows in 8.551 ms. This single synthetic run is not representative of production row width or distribution; large due sets still require performance assessment. An independent technical review found no confirmed blockers in the worker changes at `7095f4cdd`; subsequent commits changed tests and documentation, not worker behavior. Exact-head CI has failures and remains incomplete. The existing `home-landing.test.tsx` typecheck error is outside this PR and is also being addressed in [PR #961](https://github.com/777genius/review-router-ai/pull/961); do not count that proposed fix or its pending CI as complete.

## Known user-visible gaps

A pre-submission timeout ends in the generic Failed history status without an explanation or a PR notice. A stale base SHA stops the old request, but a base branch advancing is not proven to create another PR webhook or replacement request; a fresh review may need a new event or manual retry. The change does not claim to close either gap.

The dispatcher paces local database transition starts for at most 20 ms each; this does not cancel a slow database operation, coordinate separate worker processes, or guarantee a bind before runner admission. Known rolled-back serialization failures receive at most three transaction attempts; exhausted retries and unknown transaction outcomes still rely on reconciliation. Under contention a run can reach admission before binding, and a known no-effect recovery can remain unresolved if its retries are exhausted. On disposable PG17, a synthetic 12-PR burst passed with 11 accepted runs and one confirmed no-effect successor; separate tests showed admission proceeding while another POST, begin, or record was deliberately held. A prior unpaced run produced serialization failures, and this sample is not a production frequency estimate. Injected rollback tests used the historical fixture without the real history capture hook, so they do not prove absence of duplicate history/outbox events.

Durable begins are observed concurrently for up to five seconds. A timed-out begin is not cancelled: its slot remains occupied until the actual operation settles, and a late success never starts a POST. While it is unresolved, its request is excluded from local due selection even after the preparation deadline; after a late committed begin the normal reconciliation path handles the durable state. This limit does not bound every SQL operation or the entire worker pass. A permanently stuck begin can consume one of the bounded submission slots until the worker is restarted.

## Rollback

Restore the previous worker image according to the release runbook. It ignores a preparation deadline while `dispatching` and replaces it on `beginSubmission`, so it can retry pre-submission preparation indefinitely again. Already terminal or superseded requests are not resurrected by rollback. During mixed-version operation, old workers do not enforce the new preparation deadline; verify all worker instances use the new image before judging completion.

## Execution log

| Time         | Environment          | Actual version | Result       | Next action                                            |
| ------------ | -------------------- | -------------- | ------------ | ------------------------------------------------------ |
| Not executed | Staging / production | Not verified   | Not deployed | Qualify, merge, include in the next authorized bundle. |
