# Retry retained completed Gateway closes before expiry

- Task ID: `2026-11-22-relay-completed-close-recovery`.
- Goal: a lost or unknown acknowledgement while completing a v4 review does not leave its relay slot waiting for a failed source workflow before retrying the same close, including allocations restored from a durable binding by another API process.
- Affected target: API process memory and Gateway close calls.
- Implementation PR: [#970](https://github.com/777genius/review-router-ai/pull/970).
- Implementation reference: `ddec400c9b98b1b042b524e83f56b9cc90588fe0`; this identifies the initial source and is not proof of deployment. The restored-session followup must accompany it before claiming this recovery path is complete.
- Dependencies: existing Gateway idempotent close-operation contract; no Gateway deployment required.
- Last updated: `2026-11-23`.

## Environment status

| Environment | Status    | Actual version / image | Last verified (UTC) | Evidence / next step                                                          |
| ----------- | --------- | ---------------------- | ------------------- | ----------------------------------------------------------------------------- |
| staging     | `pending` | Not verified           | Not verified        | Include this implementation in an authorized API rollout and verify recovery. |
| production  | `pending` | Not verified           | Not verified        | No production slots or provider requests were used for development.           |

## Applicability and prerequisites

Select a release containing this implementation using the [release process](../operations/07-environments-and-release-management.md). Ordinary API code rollout is sufficient. There are no migrations, configuration, feature flags, native, public Action, Web or worker changes.

Completed v4 cleanup preserves parent publication authority. An already closed local session retries its original close under capacity pressure without requiring the source workflow to fail. A bounded background retry also runs without incoming traffic: up to eight attempts per retained authorization, starting at one second and doubling to a 30-second cap, shortened near the original deadline. All attempts reuse the exact close operation ID and never replay inference. Existing cleanup concurrency, owner identity, immutable snapshot, deadline and joined cancellation fences remain required. Original deadline timers remain until slot release; shutdown clears deadline and retry timers.

Restoring a cleanup-only allocation from its durable binding must retain the effective first close reason before attempting native cleanup and install the original immutable deadline timer. The initial implementation did neither for newly restored sessions: an unknown completed close could retain a full slot while pressure and background recovery skipped it. A synthetic loopback regression on exact initial PR head `b5812be63806b88bc2558a45aa3acac0b5159384` reproduced that admission failure. The followup preserves a previously captured parent cancellation when choosing a restored allocation's first native close reason; it does not replace an existing operation or its first intent. It also pins the restored session's immutable authority before awaiting cleanup, so a deadline or cancellation joining that first close cannot terminate a replacement identity or snapshot.

## Ordered rollout

1. Reconcile the target environment and applicable pending deployment tasks for the selected version.
2. Complete the ordinary authorized API rollout; record actual source/image and time here.
3. Verify on a disposable synthetic fixture that a completed active-parent v4 execution whose first committed close acknowledgement is lost receives an exact-ID close retry and releases its slot. Verify both capacity-pressure and background recovery, including a fresh API process restoring an existing durable binding. Do not induce ACK loss or run inference in a real user project.
4. Inspect normal admission, close failures and retained-session diagnostics. Preserve unknown custody and record unresolved debt; do not evict slots, replay inference or restart to manufacture successful cleanup.

## Verification and completion

Local regressions must demonstrate the prior failure and the corrected behavior, stable close IDs, unchanged inference count, preserved completed publication authority, eight-attempt bound, original expiry, changed-owner rejection, concurrent cleanup/cancellation and shutdown. Real Gateway/SDK/SQL evidence must remain distinct from synthetic native transport and physical teardown.

The restored-session followup passed 150 loopback fixture tests, including eleven focused regressions for pressure, idle recovery, bounded retries and the restored deadline timer, changed identity/snapshot and failed owner reads, joined cancellation across two restored allocations, deadline joins during the first held restore (including an already expired restore), and shutdown. Native TypeScript 7.0.2 checked the actual relay, preparation, fixture and local verification configuration with the owning strict API settings. Native lint, formatting and whitespace checks passed. These are local implementation checks; exact-head required CI and independent custody review are delivery gates, not deployment evidence.

A Gateway execution bearer expires at the original hard deadline. This implementation does not claim automatic reconciliation after expiry or after its retry budget is exhausted; those slots remain fail-closed unless a close can be authoritatively confirmed. It is not proof of the historical production incident's cause or the composition of production's retained slots.

## Retry, partial completion, and rollback

Before a rollout retry, reconcile the actual installed image and task evidence. Retry only ordinary deployment steps that remain incomplete. Follow the release runbook rollback procedure to restore the prior API image. Preserve durable authorizations, bindings, usage and native cleanup state. Process memory and local retry timers do not constitute durable Gateway cleanup proof.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Result                                                                    | Next action                                         |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Implementation and disposable verification only; no deployment performed. | Complete normal delivery and an authorized rollout. |
