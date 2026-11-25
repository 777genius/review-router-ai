# Multi-tenant reliability: deployment

- Task ID: `2026-11-25-multi-tenant-reliability`.
- Goal: preserve tenant authorization and repository selection under concurrency,
  bound recovery/database/HTTP resources, and expose uncertain remote effects
  without reporting them as configured.
- Targets: Web, API, worker, PostgreSQL; the generated public Action proxy requires
  its ordinary separately authorized runtime release.
- Implementation: [PR #1007](https://github.com/777genius/review-router-ai/pull/1007).
- Implementation checkpoint: the complete source in PR #1007; its plan records
  the exact reviewed revisions and verification. This is not a shipping or
  installation claim.
- Dependencies: the selected release must include all changes and migrations
  from this PR; reconcile the existing fleet and earlier unfinished cutovers.
- Last updated: `2026-11-25`.

## Environment status

| Environment / target  | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                              |
| --------------------- | --------- | ------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| staging               | `pending` | Not verified                    | Not verified        | Select the coherent source and execute the ordered rollout.                       |
| production            | `pending` | Not verified                    | Not verified        | No deployment or credential rotation was requested in this task.                  |
| public Action runtime | `pending` | Not verified                    | Not verified        | Artifact regenerated and locally qualified; release through the existing channel. |

`pending` records no verified completion; it does not claim the change is absent.
Local fixtures, a merged PR and green CI are separate from deployed behavior.

## Applicability and prerequisites

Use the [release process](../operations/07-environments-and-release-management.md).
Record the exact image/source and migration ledger before proceeding. Back up the
ordinary database and retain current rollback artifacts. Identify every old Web,
API and inventory/ruleset worker writer: a mixed fleet cannot enforce the new
revision/watermark guarantees. Existing external-effect uncertainty and review
publication evidence must survive the rollout.

The new pool setting `REVIEW_ROUTER_DB_POOL_CONNECTION_TIMEOUT_MS` is optional;
it defaults to 5000 milliseconds. It bounds connection acquisition/establishment,
not query execution. Preserve existing maintenance transaction budgets. There
is no feature flag or new service to enable.

## Ordered rollout

1. Drain the old authorization/cache writers and inventory/ruleset workers before
   claiming the new concurrency guarantee. Preserve their outbox state; do not
   replay unknown external effects to make a cutover appear clean.
2. Apply ordinary migrations on supported PostgreSQL 17 through the existing
   migration credential and deployment command. `000161` adds OAuth authority
   revision/refresh ownership and cache authority columns and invalidates old
   unversioned permission-cache entries. `000162` adds the installation inventory
   watermark and ruleset desired revision. `000163` creates the global usage
   retention cutoff index concurrently. `000164` retains unresolved ruleset
   create/mutation identity and indexes the normalized organization lookup.
3. Deploy the coherent Web, API and worker versions. Confirm old writers are no
   longer serving before allowing the revised authorization/cache and inventory
   code to own the guarantee. Cache rebuild and a GitHub reconnect may be required;
   never clear an uncertain single-use refresh claim merely to retry its token.
4. GitLab setup now requires a separate project/group review credential. Verify
   the existing UI and backend deploy together. If an earlier installation copied
   the shared backend token into customer CI variables, the operator must identify
   those installations, replace their CI credential and rotate the exposed backend
   token through its owning secret process. This PR does not prove such exposure
   occurred and does not perform rotation or mutate customer repositories.
5. Release the Action streaming change only through the existing immutable runtime
   build/channel procedure. Backend deployment alone does not update an installed
   Action pin. Keep the supported provider entrypoints and publication authority.
6. Execute the verification below in the target environment and record version,
   time and evidence before widening rollout.

## Verification and completion

- Normal GitHub access remains usable; revoked authorization cannot republish
  cached repository permission, and concurrent refresh makes only one token call.
  An uncertain refresh offers reconnect rather than replaying a consumed token.
- A workspace beyond the ten recent entries opens through its authorized direct
  link; a forbidden workspace renders not found without another workspace's data.
- The GitLab review variable contains the explicitly scoped credential, while the
  backend and broad installation credentials are absent from CI values/response.
- At quota 250, existing admitted repositories remain selected; genuine removals
  revoke selection, and an old inventory cannot insert a previously unseen row.
- Ruleset state/outbox revision agrees. Duplicate/uncertain operations do not
  become configured; compare the actual GitHub ruleset before resolving unknowns.
- Pool saturation has finite wait; the ordinary API and usage adapter produce their
  qualified sanitized 503/Retry-After contract. Custom handlers retain their own
  error mapping. Watch overload rate and adjust pool capacity using existing
  deployment configuration, without removing the finite acquisition bound.
- Usage retention removes at most four batches of 1,000 rows per table per pass. A
  cleanup failure is visible and cannot prevent that pass's reconciliation work.
  Totals remain exact while detail/family hydration stays bounded; delivery-loss
  pagination preserves whole-interval counts and tenant/actor scope.
- Worker recovery proceeds after an observation deadline. Disconnected or slow
  Action clients cancel upstream work and respect stream backpressure.

The implementation plan records local PostgreSQL/HTTP/browser and CI evidence.
Those checks do not replace an authorized live canary or target-version inspection.

## Retry, partial completion, and rollback

Inspect the migration ledger and actual process versions before resuming. Keep
additive columns/indexes on an ordinary code rollback; do not reverse migrations
by deleting authority or unknown-effect evidence. An old binary loses the new
concurrency guarantees, so drain/fence relevant work before such a rollback.

A failed concurrent index creation may leave an invalid index. Inspect the
index and migration state and use the repository's ordinary migration repair
procedure before retrying; do not mark an incomplete index creation as applied.

An unresolved ruleset remote-attempt token is evidence that an old effect may
still complete. Never clear it merely because a timer elapsed or one read matches
current settings. Drain the owning workers and reconcile the actual remote effect
through the operator runbook before releasing that evidence. Finite outbox retry
exhaustion must remain visible. The [ruleset recovery runbook](../operations/org-ruleset-recovery.md) gives the
specific inspect/adopt/retry procedure; no background polling service is added.

## Related links

- [Implementation plan and verification record](../plans/2026-11-25-multi-tenant-reliability.md).
- [Quota policy](../operations/12-abuse-quotas-and-fair-use.md).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Observed result                                | Evidence          | Next action                                             |
| ------------ | -------------------- | ---------- | ---------------------- | ---------------------------------------------- | ----------------- | ------------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Implementation and fixture qualification only. | PR #1007 and plan | Select the coherent release when rollout is authorized. |
