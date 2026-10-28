# Dispatch cleanup and Scanner CI: deployment

- Task ID: `2026-10-28-dispatch-cleanup-ci`.
- Goal: retain durable cancellation for unresolved pre-admission dispatches, keep the first discovered run immutable across retries, and isolate Scanner main/manual qualification without losing same-PR replacement.
- Targets: API, every review-v2 outbox worker, application PostgreSQL compatibility, and GitHub Scanner workflows.
- Implementation: [PR #732](https://github.com/777genius/review-router-ai/pull/732); related [#716](https://github.com/777genius/review-router-ai/pull/716) and [#719](https://github.com/777genius/review-router-ai/pull/719).
- Runtime integration checkpoint: `eb624bfca3bbc2a06d8e0e77e71e11c801b48292`, integrating protected main `b2f40048559a841f41b6756c8eac2ed90b04c2d4`. Final source, normal merge and shipping version must be recorded separately.
- Dependencies: [Review History](2026-10-28-review-history.md), the normal [release process](../operations/07-environments-and-release-management.md), and its current migration/cutover prerequisites.
- Last updated: 2026-10-28.

## Environment status

| Environment | Status    | Actual deployed version / image             | Last verified (UTC)        | Remaining work                                                                                                        |
| ----------- | --------- | ------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| staging     | `pending` | Not verified for this task                  | Not verified               | Select the authorized cohort and reconcile its prerequisites before executing.                                        |
| production  | `pending` | Final implementation not verified installed | Not verified for this task | Complete final source CI and main/release gates, reconcile schema/fleet, replace old consumers coherently and verify. |

Earlier source `418c0ff` and image `sha256:64b092d075237e3981ad8c77610664a71242a50a4ed2227c94729887f46e07ab` were observed in an earlier read-only rollout snapshot on 28 October. That baseline includes earlier supersession cleanup, not verification of this final task. Reconcile the live environment again; a local receipt or an old image does not establish completion here. This record grants no additional deployment authorization.

## Applicability and prerequisites

- Select an exact authorized source/image that contains this implementation. A green PR or a merged commit is not deployment evidence.
- Pass the normal exact-source PR and main/release gates, including the dedicated authority contract and the full private PG16-to-PG17 rehearsal required on main. The earlier human fast-deploy exception for `418c0ff` does not apply to this task.
- Read all applicable unfinished registry entries before the common rollout. The selected main integration includes migration `000151_review_history`; apply the normal pending migration chain before new binaries. The cleanup delta itself adds no migration, but that does not remove the schema requirements inherited from main.
- Coordinate History schema, fleet, capture and activation through its own task. Local tests activating a disposable History writer are not production activation. Do not enable production flags merely to reproduce a test or mark the History task deployed from cleanup evidence.
- Inventory actual API/worker replicas, image/source stamps, review-v2 and fenced-outbox configuration, in-flight work and existing cleanup obligations. Preserve admitted-provider drain behavior and existing release/catalog holds.

## Ordered rollout

1. Reconcile the installed-to-selected change range and all prerequisite tasks. Use the existing backup/fence/migration procedure; preserve source data and incomplete obligations. Record the exact target, source-qualified release evidence and rollback constraints.
2. Before any new sticky binding, stop/drain or coherently replace **all old cleanup consumers**, following the release guide. One new worker alongside old workers is unsafe: an old consumer can reject an original null-target event after the new worker binds its intent. Do not force-cancel admitted providers or unrelated workloads to expedite this phase.
3. Complete the applicable application migration chain and deploy the selected coherent API/worker fleet. Follow the History task for any selected History rollout. Keep its separate activation boundary and preserve a compatible history consumer for accepted events.
4. Verify fleet convergence before allowing normal processing. Retain the existing authorized review-v2/fenced-takeover configuration; no new cleanup activation command or historical cleanup backfill is introduced by this patch.
5. Let ordinary worker processing resume. Reconcile existing claims through the supported fenced lifecycle, not manual row edits or deletion. Check health, restart counts and cleanup retry/dead-letter signals.
6. Confirm the normal Scanner run at the actual merged source checks out that source and emits its native qualification receipt. Main/manual run identities remain independent and cancellation remains PR-only; do not manufacture production races or replay successful qualification.
7. Record the actual source/image, environment, operator, timestamps, normal workflow/release evidence, fleet/schema observations and any natural cleanup result below. Keep the task and index consistent after each attempt.

## Verification and completion

Implementation evidence and deployed behavior must remain distinct:

- Current-source disposable PG/GitHub qualification must include the activated real History writer/projector, atomic terminal/history/cleanup persistence and rollback, first-target binding before known-run HTTP, reopened retries using the same run, terminal readback and durable ACK. Earlier source `538cf73` qualification is historical after the History integration; it is not a claim about the changed runtime.
- The Scanner qualification must bind the actual source, pinned scanner build, container restrictions and cleanup assertions. PR qualification does not substitute for the ordinary main/release evidence required by the release guide.
- In the selected environment, verify exact compatible fleet/source and schema, successful ordinary worker cycles and absence of unsupported-event or new cleanup processing errors. If a natural cleanup obligation exists, retain its immutable target and terminal/ACK result. If no such event occurs, record that invocation was not observed; do not fabricate production requests or call that a production invocation test.
- Mark `deployed` only after the applicable rollout and verification steps are evidenced. Keep unobserved behavior and unrelated pending tasks explicit. No paid-provider or provider-admission canary is established by the isolated cleanup tests.

## Retry, partial completion and rollback

Before resuming, reconcile real versions, schema, flags, claims and prior effects. Reuse verified completed phases. Do not resubmit a dispatch or repeat an uncertain external cancellation just because observation expired.

During producer rollback, keep compatible cleanup consumers until **all newly bound unprocessed null-payload events and new terminal cleanup obligations** settle or are explicitly reconciled. This applies to existing Superseded events as well as the two new terminal reasons. Do not roll an old consumer onto these obligations. Preserve outbox/dead-letter evidence and do not backfill historical cleanup from this task.

Use the release guide rollback preflight and the History task for any remaining schema, capture flags, coverage markers and history events. Record partial failure as `blocked`, or an intentional reversal as `rolled_back`, independently for each environment.

## Related evidence

- [PR #732](https://github.com/777genius/review-router-ai/pull/732) owns final source qualification and the final current-head CI links.
- Earlier TEST [40702714962](https://github.com/777genius/TEST-ci-cancellation-20261026/actions/runs/40702714962) and [40733262696](https://github.com/777genius/TEST-ci-cancellation-20261026/actions/runs/40733262696) are retained historical source-bound evidence. Neither is a claim about the later integrated History runtime.
- Earlier Scanner PR [40739792466](https://github.com/777genius/review-router-ai/actions/runs/40739792466) qualified `76e4225`; it is not deployment evidence.
- Current History-enabled source proof, final main/release and actual rollout evidence: pending. Add durable secret-free records before marking this environment deployed; ignored `tmp/` receipts alone are insufficient.

## Execution log

| Time (UTC)   | Environment | Operator             | Actual source / image       | Observed result                     | Evidence                                  | Next action                                                    |
| ------------ | ----------- | -------------------- | --------------------------- | ----------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Not executed | staging     | Unassigned           | Not verified                | No rollout verified by this record. | None                                      | Select/reconcile the authorized cohort.                        |
| Not executed | production  | Common rollout owner | Not verified for final task | No final-task rollout verified.     | PR #732 source qualification is separate. | Complete final qualification and the common release procedure. |
