# ReviewRouter PostgreSQL maintenance

This is an operator procedure for `prod-hel1-01` and the `postgresql@17-reviewrouter.service` cluster. It describes a future controlled restart; it does not authorize or perform one. The 2026-11-27 needrestart override defers an automatic service restart, not installation of security packages. It does not stop package maintainer scripts, administrators, failures or reboots from restarting PostgreSQL. A single PostgreSQL node cannot provide uninterrupted service during a restart.

## Detect and track a deferred restart

After unattended upgrades, an operator can inspect the current library scan without restarting services:

```bash
sudo needrestart -b -r l -l
```

Check the command's exit status and look for `NEEDRESTART-SVC: postgresql@17-reviewrouter.service`. Batch/list mode is read-only. A missing line is only the current scanner result, not proof that all patches are active. Also inspect the unattended-upgrade log and `/var/run/reboot-required`; the latter is host-wide, not proof that this particular PostgreSQL service needs a restart. Record the package/update, first detection time, owner and planned maintenance; resolve overdue security restarts rather than deferring them indefinitely. No dedicated alert or timer for this deferral was established by the 2026-11-27 audit: do not assume someone will be notified automatically.

## Prepare a maintenance window

1. Identify the installed fleet and Gateway versions, current admission state, outstanding production incidents, and a named operator. Verify an applicable, tested way to block **all** new review admissions while allowing existing requests and close/readback traffic to finish. A GitHub workflow cancellation, a repository-specific V2 drain, a database query, or stopping the API alone does not establish a global drain. If the applicable admission gate and its reopen/rollback path cannot be proven, stop here and prepare that mechanism before restarting.
2. Schedule the window, notify affected operators and close the proven admission gate. Verify readback that new admissions are blocked, then allow existing work to finish naturally. Preserve unknown effects: do not retry uncertain provider requests or manually mark allocations clean to make a count reach zero.
3. Inspect the current workflow jobs, Gateway/native in-flight transport and cleanup state as well as the application database. The following **read-only, aggregate** database snapshot is a starting point on the production host; it is not a complete drain proof and must not be treated as an instruction to edit data:

   ```bash
   sudo -u reviewrouter_pg /usr/lib/postgresql/17/bin/psql -X -v ON_ERROR_STOP=1 \
     -h /var/lib/review-router-postgres/socket -p 5434 \
     -U reviewrouter_pg -d review_router_dimy <<'SQL'
   BEGIN READ ONLY;
   SELECT state, count(*) FROM "ReviewExecutionV2" GROUP BY state ORDER BY state;
   SELECT state, count(*) FROM "ReviewInvocationLeaseV2" GROUP BY state ORDER BY state;
   SELECT state, count(*) FROM "ReviewRequestedIntent" GROUP BY state ORDER BY state;
   SELECT state, count(*) FROM "ReviewRunCompanionDispatchV1" GROUP BY state ORDER BY state;
   SELECT count(*) AS allocations_without_cleanup_receipt
     FROM "ReviewRunGatewayAllocationExecution" WHERE "cleanupCompletedAt" IS NULL;
   COMMIT;
   SQL
   ```

   Classify active, stale and unknown records using their actual ownership and terminal evidence. Historical uncleaned allocations are not automatically live, and an expired lease is not proof that its external effect ended. Wait or escalate on active/ambiguous work; do not infer safety from zero currently visible DB rows alone. After a quiet period recheck the gate, workflows, Gateway/native and DB immediately before the restart; if new work or unknown effect appears, stop and reconcile.
4. Take a fresh full ReviewRouter backup through the existing mechanism, then independently read back its final status and retain the receipt:

   ```bash
   sudo systemctl start review-router-pgbackrest-backup.service
   sudo -u reviewrouter_pg /usr/local/sbin/review-router-pgbackrest \
     --config=/etc/review-router-postgres/pgbackrest.conf \
     --stanza=reviewrouter --output=json info
   ```

   Confirm the newest backup belongs to this operation, completed successfully with `error=false`, and is usable under the current recovery policy. A successful `systemctl start` alone is not a backup receipt. Stop on failure, uncertainty, insufficient recovery capacity or expired/missing access.

## Restart and restore admission

Only after the gate, complete drain, fresh backup and an explicit maintenance decision are established, an operator may restart `postgresql@17-reviewrouter.service` through systemd. Do not restart other PostgreSQL clusters. Verify the service is active and accepts its normal database connection; run the applicable current release's fleet/privilege/readiness checks and verify Gateway/native availability and any retained close/readback obligations. Confirm the needrestart report after the restart and retain all evidence.

Reopen admission only after the current operator has verified the same gate's state and the checks succeed. If restart, recovery or verification fails, keep admission closed, retain logs and backup, and follow the PostgreSQL recovery procedure; do not claim review recovery from HTTP health alone. If the reboot-required marker persists, plan the separately coordinated host reboot instead of removing the marker manually.
