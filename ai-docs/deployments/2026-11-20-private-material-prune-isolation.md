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
  (#935). The orchestrator reports it live on production since 2026-11-20
  00:08 UTC; that record is still `pending` until the operator fills it in.
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
  `failureCodes`, behind the first code
  `review_investigation_active_turn_recovery_failed`.
- The prune works in groups, one investigation per group. A group failure is
  meant to fail only that group, but `investigation_dossier_digest_invalid`
  from the expiry use case was rethrown and aborted the groups behind it in
  that batch. Batches whose page did not reach the bad groups ran normally.
- Four `awaiting_turn` investigations from 2026-08-06 (producer
  `review-action-v2-c4dc9d46`, executions finished) fail the dossier check
  on current `main`. Their material expired first (2026-08-07), so it sorts
  first, and every batch whose page reaches it stopped there.

## Production data (read-only, 2026-11-20 00:21 UTC)

Private material is AES-256-GCM ciphertext of the fixed-string code-search
queries an investigation ran, with a keyed HMAC of the plaintext and an
associated-data hash; TTL is one day. All 2,065 rows (about 300 KB of
ciphertext) are expired, the oldest since 2026-08-07:

| Owner investigations                  | Rows  | After #935 and #939                      |
| ------------------------------------- | ----- | ---------------------------------------- |
| 6 moved to `superseded` by #935       | 1,181 | pruned, up to 100 rows per hourly pass   |
| 1 `inconclusive`                      | 1     | pruned once #939 is deployed             |
| 4 unverifiable `awaiting_turn`        | 60    | stay; owner decision below               |
| 42 parked `turn_leased` (#935 record) | 823   | stay; skipped while their turn is active |

Verified on a production-shaped copy of the 11 investigations above that are
not parked (ciphertext replaced by zero placeholders on the server; the 823
parked rows were not in the copy): before the fix, once only the old rows were
left every pass stopped at the 60 rows and the `inconclusive` row was never
deleted; after it, everything except those 60 was pruned. On production the
823 parked rows also take page slots (the candidate query does not filter on
the active turn, only the per-group lock does), so a pass reaches the 60 rows
roughly once every nine passes rather than every pass.

## Owner decision: 883 expired rows that no code path prunes

- 823 rows of the 42 parked investigations need no separate decision: if the
  owner approves the optional cleanup in the
  [#935 record](2026-11-20-expired-turn-recovery.md#not-a-rollout-step-optional-cleanup-of-the-42),
  those investigations become terminal and the existing prune deletes their
  material (the retention prune of the investigation graph removes it too).
- 60 rows of the 4 unverifiable `awaiting_turn` investigations need a
  decision. Options, not implemented:
  1. Recommended: a one-off reviewed SQL delete of exactly these 60 rows,
     scoped by the 4 investigation ids and `expiresAt <= '2026-08-08'`, with a
     count guard of 60. The executions are finished and no use case can load
     these dossiers. Residual: the 4 aggregates keep `open` obligations whose
     material is gone; if their dossier ever became verifiable again they
     would be treated as missing material, not marked `RegenerationUnavailable`.
  2. A code rule that deletes expired material even when the domain
     transition refuses the aggregate. This departs from rule 4 of the
     [foundation hardening plan](../plans/2026-11-05-reviewrouter-foundation-hardening.md)
     (non-terminal material goes only through the transition, which is also
     what marks obligations `RegenerationUnavailable`), and gating it on a
     finished parent execution needs execution context the prune does not
     read today. Not a small change.
  3. Leave them. Cost: about 60 ciphertext rows past retention, and one
     `dossier_digest_invalid` group failure in the warning whenever a pass
     reaches them, indefinitely (the private-material step has no backoff).

## Ordered rollout

Ordinary worker rollout through the
[release process](../operations/07-environments-and-release-management.md).
There is one maintenance warning line per pass, not one per step:
`failureCodes` lists every step that failed, `failureCauseCode` belongs to
the first failed step (after a restart usually the active-turn step, which
uses the same `dossier_digest_invalid` value), and `failedInvestigationCount`
sums all steps. Expect `failureCodes` to include
`review_investigation_private_material_prune_failed` on passes that reach the
60 rows, with 1 to 4 of the 4 investigations counted depending on the page,
and the private material count to fall by up to 100 per pass until only the
883 rows above remain.

## Verification and completion

- Read-only count by owner state, as in the production data section; the
  `superseded` and `inconclusive` rows go to zero.
- Local evidence (not deployment evidence): on Hetzner, prettier, eslint,
  typecheck of review-investigations and worker, and vitest
  `packages/features/review-investigations/src/tests` plus the two worker
  maintenance test files pass (real PostgreSQL 17 included); the new test
  proves one batch prunes the healthy group behind an unverifiable one and
  leaves the unverifiable aggregate unchanged.
- Residual: other per-aggregate errors in the expiry path (for example a bad
  `updatedAt`) still abort the batch by design; the next new kind of broken
  row would repeat this class of incident until it is mapped.

## Retry, partial completion, and rollback

Ordinary worker rollback. The fix only lets the remaining groups of a batch
run; it deletes nothing the old code would not delete.

## Related links

- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).
- [Expired turn recovery record](2026-11-20-expired-turn-recovery.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed.            | None     | Next bundled worker rollout. |
