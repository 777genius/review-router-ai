# Organization ruleset recovery

This runbook owns recovery for `org_ruleset.provision_requested`. Its scope is the
existing organization ruleset and dedicated required workflow. It does not deploy
workers, create another ruleset, or authorize changes to a different organization.
See the [reliability deployment task](../deployments/2026-11-25-multi-tenant-reliability.md)
for rollout order and the ordinary [incident runbook](08-incident-response.md).

## Guarantees and limits

A request commits its desired revision and outbox event in one transaction.
Workers serialize the normalized organization/ruleset identity with a finite
lease, check current authority before writes, and read back the workflow and
ruleset before `configured`. Discovery rejects duplicate names and an incomplete
1,000-row listing instead of interpreting either as permission to create.

Each PUT/POST also records `pendingRemoteAttemptId` before sending HTTP. A known
successful response, an explicit rejecting response, or a local refusal before
sending closes only that attempt token. Closing a superseded or timed-out attempt
atomically queues repair of the latest desired revision. A failure to persist
that settlement leaves the token intact. No retry can report `configured` while
an unresolved token exists in any workspace addressing the same normalized
organization. Admission and configured settlement check that identity under
short database row locks as well as the remote-operation lease.

A timeout, disconnect, server error or process crash can leave the remote outcome
unknown. A lease expiry or one matching GET does not prove the old write cannot
arrive later. Such an attempt stays visibly failed/unresolved, including across
new requests and worker restart. Existing outbox retries remain finite; exhausted
work is visible in Diagnostics as `dead_letter`. The marker is never cleared by a
timer, retry exhaustion or a new desired revision.

`pendingRulesetCreateOrganization` separately records the normalized organization
before a create POST. It survives new requests and prevents a blind duplicate
create if discovery finds no ruleset. An unresolved marker also prevents changing
the operation to another organization. A known existing ruleset ID is retained
across requests; a missing or renamed known ruleset requires operator inspection.

Normal recovery remains automatic after a known HTTP completion: if the process
fails before `configured`, a later worker can read back the existing workflow and
ruleset. Recovery does not claim exactly-once remote execution or that arbitrary
unobservable writes inside GitHub can be permanently fenced.

## Inspect before changing state

1. Inspect the workspace's **Diagnostics** outbox failures and provisioning error.
   Record the provisioning ID, desired revision, organization, ruleset ID, pending
   token, `lastAttemptAt`, and the affected outbox event IDs. Inspect all provisioning
   rows for the same organization: another workspace can own the unresolved token.
   A retry alone will not erase an unknown marker.
2. Drain all ruleset workers for the affected environment and preserve their logs.
   Do not allow a second operator or process to provision the same organization
   during recovery. Establish that the original request has finished using its
   actual response or correlated GitHub audit/operation evidence. Merely waiting
   for the 45-second lease or killing the local process is not that evidence.
3. Read the current organization rulesets with the installed App's ordinary
   authorized administration access. Follow every pagination page. Require exactly
   one matching name (`ReviewRouter required workflow`) before adoption. Inspect
   its full GET response: target, enforcement, bypass actors, repository conditions,
   workflow repository/path/ref and exclusions. Inspect the source file at the
   desired ref as well. Do not delete a duplicate automatically.
4. Compare that evidence with the saved desired state. If the request's outcome
   is still uncertain, keep the marker and failed event; escalate through the
   existing incident process. An absent ruleset by itself does not authorize a
   repeat POST. A different desired organization is not a recovery mechanism.

A read-only database inspection, through the environment's existing authorized
operator connection, can use psql variables (values come from the incident):

```sql
SELECT "id", "workspaceId", "organizationLogin", "revision", "status",
       "enforcement", "scope", "targetRepositoryIds", "rulesetId",
       "sourceRepositoryFullName", "sourceWorkflowPath", "sourceWorkflowRef",
       "pendingRemoteAttemptId", "pendingRulesetCreateOrganization",
       "safeErrorCode", "lastAttemptAt"
FROM "OrgRulesetProvisioning"
WHERE lower("organizationLogin") = (
  SELECT lower("organizationLogin") FROM "OrgRulesetProvisioning"
  WHERE "id" = :'provisioning_id'
)
ORDER BY "id";
```

## Resolve a confirmed outcome, then retry

Only proceed after the preceding inspection proves that the old mutation is
finished. Record the evidence and the operator's decision in the incident. Keep
workers drained while making the single targeted state change.

For a unique existing ruleset that belongs to this operation, adopt its verified
GitHub ID and clear the exact captured attempt token. The current worker will
still read back and apply the desired revision before `configured`:

```sql
BEGIN;
UPDATE "OrgRulesetProvisioning"
SET "pendingRemoteAttemptId" = NULL,
    "pendingRulesetCreateOrganization" = NULL,
    "rulesetId" = :'verified_ruleset_id'::bigint,
    "status" = 'failed',
    "safeErrorCode" = 'org_ruleset_reconciliation_required',
    "safeErrorSummary" = 'Operator confirmed the previous remote outcome; retry must verify the current desired revision.'
WHERE "id" = :'provisioning_id'
  AND "revision" = :'captured_revision'::integer
  AND "pendingRemoteAttemptId" = :'captured_attempt_id'
RETURNING "id", "revision", "rulesetId";
COMMIT;
```

Require exactly one returned row. Zero rows means authority changed; re-inspect
instead of widening the WHERE clause. For a confirmed no-effect create with no
existing ruleset, use the same fenced update without assigning `rulesetId`.
Clear the create marker only when there is positive evidence the original POST
cannot still create a ruleset. Retain an already known ruleset ID when resolving
an update; do not clear it to force a replacement POST.

If only `pendingRulesetCreateOrganization` remains (the remote attempt token is
already null), inspect the known successful/create evidence first. Use the same
revision fence plus `pendingRemoteAttemptId IS NULL` and the captured normalized
create organization instead of a token comparison. Adopt the unique existing ID;
absence still requires confirmed no-effect evidence before clearing the marker.

Then use the workspace's existing **Diagnostics → Retry** action for the affected
`dead_letter` event. This preserves the normal authorization, rate limit, audit
and outbox claim rules. A `pending`/`retry_wait` event already owns its retry; do
not insert a second event manually. If no unprocessed event remains, submit the
same desired organization setup through its normal dashboard action, which
atomically creates a new revision/event. Resume workers and verify all of:

- The provisioning's latest revision is `configured` with both markers null.
- The actual workflow and unique ruleset match that revision, including target
  repositories and enforcement; no additional ruleset was created.
- The affected outbox work is processed, or any remaining failure is explicit and
  has an identified owner. A queued retry is not completed recovery.

A code rollback must preserve both markers and the outbox evidence. Old binaries
cannot enforce these guards, so keep this work drained until a compatible worker
is restored or the existing incident owner completes reconciliation.
