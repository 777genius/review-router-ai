# Durable GitHub webhook delivery: deployment

- Task ID: `2026-11-27-webhook-effect-fence`.
- Goal: supported signed webhooks retain durable ownership, commit their local
  effects safely, and permit bounded recovery without duplicate redelivery requests.
- Affected targets: API and database; existing outbox workers retain ownership of
  external commands. Their compatibility must be checked during the fleet drain.
- Implementation: [PR #1027](https://github.com/777genius/review-router-ai/pull/1027).
- Source checkpoint: `7f4ceded6c0d7703c94fb94a5fd43e921a4519ab` wired the default
  routes. The subsequent PR continuation adds replay eligibility, known-delivery
  CLI and full-schema HTTP qualification. Record the exact passing final SHA before
  selecting a release; the earlier checkpoint is not that qualification.
- Dependencies: existing release/migration authority and configuration; no new
  service, queue, dependency or activation flag.
- Last updated: `2026-11-27`.

## Environment status

| Environment / target | Status | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker |
| --- | --- | --- | --- | --- |
| staging | `pending` | Not verified | Not verified | Final-source checks, migration/grant review and controlled fleet cutover remain. |
| production | `pending` | Not verified | Not verified | No production migration, replay, deployment or activation was performed by this workstream. |

`pending` means no verified completion is recorded; it is not evidence that code
is absent. A merge or passing CI does not change deployment status.

## Implementation and qualification

All six supported event families use the default fenced production processor.
Initial enabled PR ingress commits with generation-one receipt/fence acquisition;
generic PR effects and terminal status follow in a separate guarded transaction.
Later generations never recreate that ingress. Other local effects/outbox and
terminal receipt commit together. Unrelated account/auth/config epoch changes have
been removed; existing authority owners and scope/row locks remain.

| Evidence | Current status |
| --- | --- |
| Default route wiring, claim/failure protocol and explicit operator command | Implemented; final runtime proof pending |
| Full migration catalog | 172 directories, including `000165_webhook_effect_fence` and `000167_webhook_recovery_intent`; no experimental `000166` epoch migration |
| Prior 170 → 172 migration rehearsal and isolated fence tests | Partial earlier-source results; not evidence for the final replay guard/HTTP suite |
| Full signed HTTP/Prisma/PostgreSQL/outbox and recovery matrix | Checked in and mandatory in the existing CI; final execution pending |
| TypeScript 7.0.2, lint/format, architecture and ordinary CI | Pending; local executor unavailable after resource-killed pinned dependency build |
| Production replay or fleet qualification | Not executed; separately authorized operational work |

Historical prototype/shim-based checks at `783409f2a21edc182df216d63c1f3cb4b84785bf`
do not qualify this implementation. Do not treat queued/skipped CI as passing.

## Applicability and prerequisites

- Select an exact release containing the final independently reviewed and tested PR
  source, using the [existing release process](../operations/07-environments-and-release-management.md).
- Reconcile the actual fleet, migration ledger, application/maintenance roles and
  unfinished deployment tasks. Use the approved migration authority; preserve the
  existing historical-migration checksum/cutover policy.
- Apply the two additive migrations through that approved path. Verify checks,
  primary/foreign keys, receipt trigger and exact checksums. Verify the real API
  and recovery roles have the required privileges on the new tables; a synthetic
  limited-role test is not proof of production grants.
- Confirm trusted `GITHUB_APP_ID`, matching webhook secret/API origin and
  `GITHUB_APP_SLUG`. Existing review-ingress/conflict settings still apply.
  Recovery additionally requires the configured App private key and database URL;
  its client supports only `https://api.github.com`.
- Keep old unfenced deliveries. Do not backfill fences or claim unknown legacy
  effects. Fenced processed duplicates succeed only for the exact App/body/event
  identity; unfenced legacy rows are not automatically adopted.

## Ordered rollout

1. Verify the exact final SHA's full migration/HTTP race/recovery tests and ordinary
   required CI. Quiesce ingress and inventory/drain every old API/webhook writer,
   maintenance writer and open transaction before takeover-capable code starts.
   A lease timeout or receipt trigger does not prove an old effect stopped.
2. Perform the approved schema expansion and privilege verification before the
   new API serves requests. Record actual migration checksums and role evidence.
3. Install the qualified API version and verify all relevant processes use it.
   Fenced processing is the default composition; there is no new activation flag.
4. Reopen ingress only after the writer drain/version checks. Use an authorized
   disposable repository for signed event and outbox verification, then record
   actual version/image, timestamps and durable evidence before widening.
5. Perform any real recovery only as a separately authorized, known-delivery
   operation. Retain unresolved and superseded receipts for reconciliation.

## Known-delivery recovery

After building the API with the pinned toolchain, use the existing operator
environment. Supply one exact GUID and numeric GitHub delivery ID:

```sh
pnpm webhook:recover inspect --delivery-guid GUID --github-delivery-id ID
pnpm webhook:recover request --delivery-guid GUID --github-delivery-id ID
pnpm webhook:recover reconcile --delivery-guid GUID --github-delivery-id ID
```

These examples are procedures, not a record of execution. `inspect` is read-only.
`request` validates the authenticated local receipt and trusted GitHub delivery
metadata/signature digest, then durably reserves at most one POST. `reconcile`
never sends POST; it can update local custody to confirmed after exact receiver
readback. A missing/redacted/rotated signature or unknown original fails closed.
An unavailable detail preflight also reports `not_authorized`; only bounded poll
observations distinguish rate limits/incompleteness.

HTTP 202, GitHub list status 200 and a lost response are not completion. Repeated
invocations retain `issued_unknown`/accepted custody and cannot request a second
POST. Never reset an issued intent to prepared. Only exact processed receiver
identity confirms recovery. A local `processed` result with
`githubDeliveryIdBound: false` does not prove the supplied numeric ID's association.

A later/equal locally received lifecycle/same-repository event blocks an older
installation/repository retry. Missing identity is conservative. This compares local
receipt order, not GitHub chronology. Authorization revocation has no retained
original grant revision, so its retry requires separate reconciliation to avoid
revoking a reconnect. Never-ingressed and unfenced legacy deliveries are unsupported.

## Verification and completion

Require successful final-source execution of every mandatory PostgreSQL suite,
zero skipped tests in that qualification, exact migration checksums and real
application-role checks. Exercise all six signed HTTP families, duplicate/mismatch,
active and expired owner, rollback, concurrent takeover, stale completion/failure/
renewal, old-writer rejection, PR ingress persistence and policy changes. Recovery
must prove one POST, unknown response retention and exact receiver completion.

Deployment completion additionally requires the actual fleet drain/version proof,
configured App identity, grants, live disposable-repository verification and durable
per-environment evidence. No local test proves a production fleet was drained.

## Retry, partial completion, and rollback

Before resuming, inspect migration history, receipts/fences/custody and actual
process versions. Unknown reservation/POST outcomes remain unknown; use reconcile.
Do not issue a replacement GUID or delete state to bypass the retained decision.

On application rollback, close admission and drain fenced work before any legacy
binary returns. Keep the receipt trigger, fences, custody and terminal records;
do not roll back by dropping additive data or restoring an unsafe old writer.
The trigger rejects old terminal overwrites, but does not undo their earlier
unguarded effects. If the drain cannot be proved, keep admission closed.

## Related links

- [Completion plan and exact local-effect inventory](../architecture/2026-11-27-webhook-delivery-fencing.md).
- [Quality gates](../operations/03-quality-gates.md).
- [PR #1026](https://github.com/777genius/review-router-ai/pull/1026): duplicate
  acknowledgement contract; production here requires an exact fenced terminal.
- [PR #1021](https://github.com/777genius/review-router-ai/pull/1021): separate worker,
  transport and broader reliability work; not imported or qualified by this PR.

## Execution log

| Time (UTC) | Environment | Operator | Actual version / image | Step and observed result | Evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| Not executed | staging / production | Unassigned | Not verified | Source/test implementation only; no operational rollout or recovery | PR #1027 source and pending qualification | Finish final-source gates, then a separately authorized controlled rollout |
