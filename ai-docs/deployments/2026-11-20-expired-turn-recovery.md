# Expired investigation turn recovery: deployment

- Task ID: `2026-11-20-expired-turn-recovery`
- Goal: the worker's retention maintenance recovers every expired investigation
  turn it can, logs the real cause for the ones it cannot, and stops retrying
  those every cycle. Today one bad row aborts the whole pass, so 48 rows have
  sat in `turn_leased` since 2026-10-06 and every rollout logs
  `review_investigation_active_turn_recovery_failed` with `causeCode: null`.
- Affected targets: worker only (retention maintenance). API, Web, Gateway,
  native and the public Action are unchanged. No migration, no configuration.
- Implementation: ReviewRouter AI PR (this branch); the squash commit on `main`
  is the source reference, not proof that it is selected or installed.
- Dependencies: none. Rides in the next bundled worker rollout, not on its own.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                                                            |
| ---------- | --------- | ------------ | ------------------------------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary worker rollout and the checks below                        |
| Production | `pending` | Not verified | Not deployed. Rides in the next bundled worker rollout (no window). |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Merging the PR did not deploy anything.

## Root cause (production, read-only, 2026-11-19 22:03 UTC)

- 48 investigations are `turn_leased`, created 2026-10-06 to 2026-10-19, turn
  expired 2026-10-06 to 2026-10-20, `retainUntil` already passed. All 48 parent
  executions are finished (32 `superseded`, 11 `failed`, 4 `partial`,
  1 `completed`), every authorization is expired or revoked. Nothing is waiting on them.
- The recovery query returns the oldest expired turn first, and the old sweep
  rethrew the first non-race error, so the oldest bad row aborted the pass
  every hour and the six healthy rows behind it were never reached. Only one
  turn on production was ever recovered this way (2026-08-08).
- 42 of the 48 were written by producer `reviewrouter-action.89ae44621cab`,
  the unmerged hosted v4 relay build that ran on production in October. Their
  active turn carries a turn budget (`turnBudgetCanonicalJson`,
  `turnBudgetHash`) that is part of the stored dossier digest. Current `main`
  has neither column in its model, so it recomputes a different digest and
  fails closed with `investigation_dossier_digest_invalid`. Recomputing with
  the budget fields put back matches all 42 stored digests, so the data is
  intact; it is a canonical-form drift, not corruption.
- The same build left production-only schema that `main` does not know: lease
  purpose `relay_turn` (41 active relay leases on these turns; Prisma on
  `main` throws "Value 'relay_turn' not found in enum" when it reads them),
  the two budget columns with an immutability trigger, the trigger
  `review_investigation_v4_request_fence` that refuses any state change of a
  relay-bound turn whose upstream request is unresolved (18 of the 42 have
  relay rows: 9 `open`, 9 `terminal_unknown`), and eight migrations that are
  not in `main` (`000003_distributed_locks`,
  `000085_comment_token_gate_lock_result`,
  `000109_sdk_growth_verifier_assignment_lock`,
  `000116_hosted_v4_fenced_dispatch`, `000117_hosted_v4_one_shot_dispatch`,
  `000118_exclusive_test_publication`, `000128_account_admission_row_lock`,
  `000135_review_run_checkout_repository_lock`).
- Reproduced on Hetzner with a read-only copy of the 48 rows and their parents
  loaded into a scratch PostgreSQL 17 (with `relay_turn` added to match
  production): the old sweep throws `investigation_dossier_digest_invalid`;
  per row, 42 throw that and 6 recover to `superseded`.

## What changes at runtime

- `ReconcileExpiredActiveTurn.sweep` handles each row on its own. A failing row
  is counted, its cause is mapped to an allowlisted code
  (`dossier_digest_invalid`, `investigation_missing`, `idempotency_conflict`,
  otherwise `unknown`; raw messages are never logged), and the batch goes on.
- A row that fails is skipped for 1 h, then 2 h, 4 h and so on, capped at one
  retry a day. Rows on backoff are excluded in the candidate query, so they do
  not take slots from healthy rows. The schedule is in worker memory (at most
  1,000 rows); a worker restart retries each row once.
- The maintenance log now carries the cause: the existing warning
  `ReviewRouter review investigation retention maintenance failed` gets
  `failureCauseCode`, `failedInvestigationCount` and the new
  `deferredActiveTurnCount`; the "completed" info line also shows
  `deferredActiveTurnCount`, so parked rows stay visible.
- No row field records the cause: `ReviewInvestigation` has no such column and
  writing `abortReason` on a still-leased turn would misstate its state.
- Rows whose parent execution is gone or finished already reach `superseded`
  through the existing domain transition; that path is unchanged. Rows whose
  dossier cannot be verified are deliberately not moved: the digest check is a
  fail-closed integrity rule, and relaxing it for 42 legacy rows would weaken
  it for every future row.

## Ordered rollout

1. Ordinary worker rollout through the
   [release process](../operations/07-environments-and-release-management.md).
   Nothing to do before or after.
2. On the first maintenance pass (within one hour of start) expect:
   `recoveredActiveTurnCount: 6`, `failedInvestigationCount: 42`,
   `failureCauseCode: "dossier_digest_invalid"`, then `deferredActiveTurnCount:
42` on later passes and one warning per backoff step instead of one per hour.

## The 48 stuck rows

**Sanctioned path, no manual data change: deploy the new worker.** It
recovers the 6 healthy rows by itself on the first pass through the normal
domain transition (`turn_leased` to `superseded`, turn `expired`). Verified on
the production-shaped copy: pass 1 `reconciledCount 6, failedCount 42`, pass 2
`deferredCount 42`, final `superseded=6 turn_leased=42`.

Count check (read-only, the existing `default_transaction_read_only` psql
pattern on the production host):

```sql
SELECT state, count(*) FROM "ReviewInvestigation"
WHERE state IN ('turn_leased', 'superseded') GROUP BY 1;
```

Before: `turn_leased 48`. After the first pass: `turn_leased 42` and
`superseded` up by 6. Rollback: none needed. The 6 rows end in the state the
domain gives an expired turn of a finished execution; going back to the old
worker leaves them there.

**The other 42: recommended, no data change in this rollout.** No code on
`main` can close them: it cannot verify their dossier, cannot read their
`relay_turn` leases, and the production trigger blocks closing 18 of the
turns. They are inert (finished executions, dead authorizations) and with this
change they only cost one warning per backoff step. Their cleanup belongs with
the owner's decision on the production-only hosted v4 relay schema listed
above (merge the relay work, or remove its schema and data together). Doing
it here in isolation would bypass both the dossier rule and the relay fence.

Optional, only with explicit owner approval and outside this rollout: mark
the 42 as `superseded` and let the existing retention prune delete them on
its next pass (their `retainUntil` and their children's have already passed).
This does not touch turn rows, so neither production trigger fires. It is a
direct data change around the domain rules: their stored digest stays stale
and the relay ledger rows of the 18 stay as they are.

```sql
-- 1. Backup (read-only session). \copy writes to the psql working directory;
--    run it from a root-only directory on the host and keep the file.
\copy (SELECT row_to_json(i) FROM "ReviewInvestigation" i JOIN "ReviewInvestigationTurn" t ON t."turnId" = i."activeTurnId" WHERE i.state = 'turn_leased' AND i."producerReleaseId" = 'reviewrouter-action.89ae44621cab' AND t.state = 'leased' AND t."turnBudgetHash" IS NOT NULL AND t."expiresAt" < '2026-10-21') TO 'stuck-42-investigations.jsonl'

-- 2. Apply (writable session, operator only).
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE changed integer;
BEGIN
  UPDATE "ReviewInvestigation" i
  SET state = 'superseded', "activeTurnId" = NULL, "nextEligibleAt" = NULL,
      version = i.version + 1, "updatedAt" = now() AT TIME ZONE 'UTC'
  FROM "ReviewInvestigationTurn" t
  WHERE t."turnId" = i."activeTurnId"
    AND i.state = 'turn_leased'
    AND i."producerReleaseId" = 'reviewrouter-action.89ae44621cab'
    AND t.state = 'leased' AND t."turnBudgetHash" IS NOT NULL
    AND t."expiresAt" < '2026-10-21'
    AND NOT EXISTS (SELECT 1 FROM "ReviewExecutionV2" e
                    WHERE e."executionId" = i."executionId" AND e.state = 'running');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 42 THEN
    RAISE EXCEPTION 'expected 42 rows, changed %', changed;
  END IF;
END $$;
COMMIT;
```

Check: `turn_leased 0` right after, and on the next maintenance pass
`prunedInvestigationCount` includes the 42 and none of their ids remain.
Rollback is only possible before that pass: restore `state`,
`activeTurnId`, `nextEligibleAt`, `version` and `updatedAt` from the backup
file. After the prune the rows are gone; the backup is the only record.

## Verification and completion

- Worker log after the first pass as in the rollout step 2, and no later pass
  with `failedInvestigationCount` above 0 more often than the backoff allows.
- The count check above.
- Local evidence (not deployment evidence): on Hetzner, typecheck of
  review-investigations, worker and API, eslint and prettier on the changed
  files, vitest `packages/features/review-investigations/src/tests`
  (213 tests, real PostgreSQL 17 included), the two worker maintenance test
  files, and `pnpm review-investigation:e2e` all pass.

## Retry, partial completion, and rollback

Ordinary worker rollback to the previous image. Nothing is persisted by the new
code except the domain transitions the old code would also make; the backoff
schedule lives only in memory.

## Related links

- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).
- Earlier sightings of the same log line:
  [rollout 974295ea](2026-11-17-coordinated-rollout-974295ea.md),
  [rollout 7c176ef7](2026-11-19-rollout-7c176ef7.md),
  [rollout 061f04bc](2026-11-19-rollout-061f04bc.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed.            | None     | Next bundled worker rollout. |
