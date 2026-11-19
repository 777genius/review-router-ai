# Expired investigation turn recovery: deployment

- Task ID: `2026-11-20-expired-turn-recovery`
- Goal: the worker's retention maintenance recovers every expired investigation
  turn it can, logs the real cause for the ones it cannot, and stops retrying
  those every cycle. Today one bad row aborts the whole pass, so 48 rows have
  sat in `turn_leased` since 2026-10-06 and every rollout logs
  `review_investigation_active_turn_recovery_failed` with
  `failureCauseCode: null`.
- Affected targets: worker only (retention maintenance). API, Web, Gateway,
  native and the public Action are unchanged. No migration, no configuration.
- Implementation: [ReviewRouter AI PR #935](https://github.com/777genius/review-router-ai/pull/935);
  the squash commit on `main` is the source reference, not proof that it is
  selected or installed.
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
  relay rows in `HostedCodexV4RelayTurn`: 9 `open`, 9 `terminal_unknown`),
  and three applied migrations whose names `main` does not have
  (`000116_hosted_v4_fenced_dispatch`, `000117_hosted_v4_one_shot_dispatch`,
  `000118_exclusive_test_publication`; `main` uses those numbers for other
  migrations).
- Reproduced on Hetzner with a read-only copy of the 48 rows and their parents
  loaded into a scratch PostgreSQL 17 (with `relay_turn` added to match
  production): the old sweep throws `investigation_dossier_digest_invalid`;
  per row, 42 throw that and 6 recover to `superseded`.

## What changes at runtime

- `ReconcileExpiredActiveTurn.sweep` handles each row on its own. A failing row
  is counted, its cause is mapped to an allowlisted code
  (`dossier_digest_invalid`, `aggregate_incompatible`, `investigation_missing`,
  `idempotency_conflict`, otherwise `unknown`; raw messages are never logged),
  and the batch goes on.
- A row that fails is skipped for 1 h, then 2 h, 4 h and so on, capped at one
  retry a day. Rows on backoff are excluded in the candidate query, so they do
  not take slots from healthy rows. The schedule is in worker memory (at most
  1,000 rows) and per worker process; a worker restart retries each row once,
  and with several worker processes each keeps its own schedule, so a parked
  row can be retried up to once per process per step (the maintenance lock
  still lets only one pass run at a time).
- The existing warning `ReviewRouter review investigation retention
maintenance failed` already had `failureCauseCode` and
  `failedInvestigationCount`; they are now filled for active turns too, and the
  new `deferredActiveTurnCount` is on both the warning and the "completed"
  line, so parked rows stay visible.
- Unchanged: a row whose commit loses a race (`investigation_concurrency_conflict`
  or `investigation_lease_fencing_stale`) is skipped silently and tried again
  next pass, as before. If such a race were ever permanent it would not show in
  the log; none of the 48 rows is in that case.
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
2. On the first maintenance pass (within one hour of start) expect
   `recoveredActiveTurnCount: 6`, `failedInvestigationCount: 42` and
   `failureCauseCode: "dossier_digest_invalid"`. Later passes show
   `deferredActiveTurnCount: 42` and one warning per backoff step instead of
   one per hour (per worker process, see above).

## The 48 stuck rows

**Sanctioned path, no manual data change: deploy the new worker.** It
recovers the 6 healthy rows by itself on the first pass through the normal
domain transition (`turn_leased` to `superseded`, turn `expired`). Verified on
the production-shaped copy: pass 1 `reconciledCount 6, failedCount 42`, pass 2
`deferredCount 42`, final `superseded=6 turn_leased=42`.

Count check (read-only, the existing `default_transaction_read_only` psql
pattern on the production host):

```sql
SELECT "producerReleaseId" = 'reviewrouter-action.89ae44621cab' AS relay_build,
       state, count(*)
FROM "ReviewInvestigation"
WHERE "createdAt" >= '2026-10-06' AND "createdAt" < '2026-10-20'
  AND state IN ('turn_leased', 'superseded')
GROUP BY 1, 2 ORDER BY 1, 2;
```

Before: `relay_build f turn_leased 6` and `relay_build t turn_leased 42`.
After the first pass: `f superseded 6` and `t turn_leased 42` (the 6 get a
new 30-day `retainUntil`, so the prune leaves them alone for now). Rollback: none needed. The 6 rows end in the state the
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

### Not a rollout step: optional cleanup of the 42

Only with explicit owner approval, outside the bundled rollout, and not
something a rollout agent should run from this registry. It marks the 42 as
`superseded` and lets the existing retention prune delete their graphs on its
next pass (their `retainUntil` and their children's have already passed). It
is a direct data change around the domain rules: the stored digest stays
stale, the 18 `HostedCodexV4RelayTurn` rows stay and point at deleted turns
(that table has no foreign key to them), and after the prune the turn budgets
and relay leases are gone, so "merge the relay work" could no longer verify
these dossiers. The SQL was dry-run on the production-shaped copy with the
budget columns restored: 42 rows changed, then the prune removed exactly 42.

1. Read-only pre-check that nothing on production blocks the prune's deletes.
   On 2026-11-19 the only triggers on `ReviewInvestigation*` tables were the
   two `BEFORE UPDATE` triggers on turns, and no table outside
   `ReviewInvestigation*` had a foreign key to them. Repeat before applying;
   any new row here stops the procedure:

   ```sql
   SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND c.relname LIKE 'ReviewInvestigation%'
     AND pg_get_triggerdef(t.oid) NOT LIKE '%BEFORE UPDATE%';
   SELECT con.conname, c.relname FROM pg_constraint con
   JOIN pg_class c ON c.oid = con.conrelid
   WHERE con.contype = 'f' AND c.relname NOT LIKE 'ReviewInvestigation%'
     AND con.confrelid::regclass::text LIKE '"ReviewInvestigation%';
   ```

2. Backup (read-only session, CSV so text and JSON columns round-trip). It
   holds review findings, so write it to a root-only directory on the host and
   delete it once the owner closes the relay schema decision:

   ```sql
   \copy (SELECT i.* FROM "ReviewInvestigation" i JOIN "ReviewInvestigationTurn" t ON t."turnId" = i."activeTurnId" WHERE i.state = 'turn_leased' AND i."producerReleaseId" = 'reviewrouter-action.89ae44621cab' AND t.state = 'leased' AND t."turnBudgetHash" IS NOT NULL AND t."expiresAt" < '2026-10-21') TO 'stuck42-investigation.csv' WITH (FORMAT csv, HEADER)
   \copy (SELECT x.* FROM "ReviewInvestigationTurn" x WHERE x."investigationId" IN (SELECT i."investigationId" FROM "ReviewInvestigation" i JOIN "ReviewInvestigationTurn" t ON t."turnId" = i."activeTurnId" WHERE i.state = 'turn_leased' AND i."producerReleaseId" = 'reviewrouter-action.89ae44621cab' AND t.state = 'leased' AND t."turnBudgetHash" IS NOT NULL AND t."expiresAt" < '2026-10-21')) TO 'stuck42-turn.csv' WITH (FORMAT csv, HEADER)
   \copy (SELECT x.* FROM "ReviewInvestigationLease" x WHERE x."investigationId" IN (SELECT i."investigationId" FROM "ReviewInvestigation" i JOIN "ReviewInvestigationTurn" t ON t."turnId" = i."activeTurnId" WHERE i.state = 'turn_leased' AND i."producerReleaseId" = 'reviewrouter-action.89ae44621cab' AND t.state = 'leased' AND t."turnBudgetHash" IS NOT NULL AND t."expiresAt" < '2026-10-21')) TO 'stuck42-lease.csv' WITH (FORMAT csv, HEADER)
   \copy (SELECT x.* FROM "ReviewInvestigationObligation" x WHERE x."investigationId" IN (SELECT i."investigationId" FROM "ReviewInvestigation" i JOIN "ReviewInvestigationTurn" t ON t."turnId" = i."activeTurnId" WHERE i.state = 'turn_leased' AND i."producerReleaseId" = 'reviewrouter-action.89ae44621cab' AND t.state = 'leased' AND t."turnBudgetHash" IS NOT NULL AND t."expiresAt" < '2026-10-21')) TO 'stuck42-obligation.csv' WITH (FORMAT csv, HEADER)
   \copy (SELECT x.* FROM "ReviewInvestigationCommandReceipt" x WHERE x."investigationId" IN (SELECT i."investigationId" FROM "ReviewInvestigation" i JOIN "ReviewInvestigationTurn" t ON t."turnId" = i."activeTurnId" WHERE i.state = 'turn_leased' AND i."producerReleaseId" = 'reviewrouter-action.89ae44621cab' AND t.state = 'leased' AND t."turnBudgetHash" IS NOT NULL AND t."expiresAt" < '2026-10-21')) TO 'stuck42-command-receipt.csv' WITH (FORMAT csv, HEADER)
   ```

   Expected rows: 42 investigations, at least 42 turns, at least 41 leases;
   obligations and command receipts as found.

3. Apply (writable session, operator only):

   ```sql
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

4. Check: the count check above shows `t superseded 42` right after, and after
   the next maintenance pass no row with that `producerReleaseId` remains and
   `prunedInvestigationCount` is at least 42. If that pass logs
   `review_investigation_dossier_prune_failed` instead, restore the five
   columns listed under rollback at once, because a stuck prune batch blocks retention for
   every investigation behind it.

Rollback before the prune pass: set `state`, `activeTurnId`, `nextEligibleAt`,
`version` and `updatedAt` back from `stuck42-investigation.csv`. After the
prune, only the CSV backups remain; reloading them is a manual restore.

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
