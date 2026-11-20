# Private material prune past an unverifiable dossier: deployment

- Task ID: `2026-11-20-private-material-prune-isolation`
- Goal: the worker's retention maintenance deletes expired private
  investigation material for every investigation it can, instead of stopping
  the whole batch at the first investigation whose dossier cannot be verified.
- Affected targets: worker only (retention maintenance). No migration, no
  configuration.
- Implementation: [ReviewRouter AI PR #939](https://github.com/777genius/review-router-ai/pull/939);
  the squash commit on `main` is the source reference, not proof that it is
  selected or installed.
- Dependencies: [expired turn recovery](2026-11-20-expired-turn-recovery.md)
  (#935, live on production since 2026-11-20 00:08 UTC according to the
  operator; the record of that rollout belongs to the operator).
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                                                |
| ---------- | --------- | ------------ | ------------------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary worker rollout                                 |
| Production | `pending` | Not verified | Not deployed. Rides in the next bundled worker rollout. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Root cause

- The private-material step is not new and #935 did not change it: the
  maintenance adapter always ran its four steps independently, so
  `review_investigation_private_material_prune_failed` was already in
  `failureCodes`, behind the first code `active_turn_recovery_failed`.
- The prune works in groups, one investigation per group. A group failure is
  meant to fail only that group, but `investigation_dossier_digest_invalid`
  from the expiry use case was rethrown and aborted every group behind it.
- Four `awaiting_turn` investigations from 2026-08-06 (producer
  `review-action-v2-c4dc9d46`, executions finished) fail the dossier check
  on current `main`. Their material expired first (2026-08-07), so it sorts
  first and stopped the pass whenever the batch reached it.

## Production data (read-only, 2026-11-20 00:21 UTC)

Private material is AES-256-GCM ciphertext of the fixed-string code-search
queries an investigation ran, with a plaintext hash and an associated-data
hash; TTL is one day. All 2,065 rows (about 300 KB of ciphertext) are expired,
the oldest since 2026-08-07:

| Owner investigations                  | Rows  | After #935 and #939                    |
| ------------------------------------- | ----- | -------------------------------------- |
| 6 moved to `superseded` by #935       | 1,181 | pruned, about 100 rows per hourly pass |
| 1 `inconclusive`                      | 1     | pruned once #939 is deployed           |
| 4 unverifiable `awaiting_turn`        | 60    | stay; owner decision below             |
| 42 parked `turn_leased` (#935 record) | 823   | stay; skipped while a turn is active   |

Verified on a production-shaped copy with ciphertext replaced by zero
placeholders on the server: before the fix every pass stops at the 60 rows
once only old rows are left; after it, everything except those 60 is pruned
and each pass reports `failedInvestigationCount: 4`,
`failureCauseCode: "dossier_digest_invalid"`.

## Owner decision: the 883 expired rows the code cannot prune

The 60 rows (4 unverifiable investigations) and the 823 rows (42 parked
investigations) are past their one-day retention and no code path on `main`
deletes them, because deletion goes through the domain transition, and the
transition refuses unverifiable or still-leased aggregates. Proposal, not
implemented:

1. Recommended: a retention rule that expired private material is deleted
   even when its investigation cannot take the domain transition, as long as
   the investigation can no longer use it: its dossier fails verification
   (every use case already fails closed on it) or its parent execution is
   finished. The aggregate stays as it is. This is a small code change in the
   prune, with a test, and needs no data step.
2. Alternative: delete the 883 rows once with a reviewed SQL statement scoped
   by investigation id and `expiresAt`, with a count guard.
3. Leave them until the hosted v4 relay schema decision in the
   [#935 record](2026-11-20-expired-turn-recovery.md#the-48-stuck-rows).

## Ordered rollout

Ordinary worker rollout through the
[release process](../operations/07-environments-and-release-management.md).
Expect the private-material warning to carry `failureCauseCode:
"dossier_digest_invalid"` and `failedInvestigationCount: 4` when a pass
reaches the old rows, and the private material count to fall by up to 100 per
pass until only the 883 rows above remain.

## Retry, partial completion, and rollback

Ordinary worker rollback. The fix only lets the remaining groups of a batch
run; it deletes nothing the old code would not delete.

## Related links

- [Release process](../operations/07-environments-and-release-management.md).
- [Expired turn recovery record](2026-11-20-expired-turn-recovery.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed.            | None     | Next bundled worker rollout. |
