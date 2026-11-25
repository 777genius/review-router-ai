# Review V2 publication: item isolation and module boundary

Date: 2026-10-31
Status: implementation planned; stacked on PR #747 while its exact-head CI
completes.

## Concrete failure

`ReviewV2PublicationMaintenance.runMaintenance` in
`apps/worker/src/review-v2-production-runtime.ts` executes due publication items
serially. An unexpected exception from one item's executor or retry defer
escapes the loop, discards that pass's successful settlement evidence, and
prevents later items from being attempted. The outer worker treats the whole
publication phase as failed and suppresses progress. This is particularly costly
when publication has already caused an external effect.

## Scope and ownership

- Extract the existing publication maintenance class, work-provider mapping and
  publication outcome helpers into a worker-private
  `review-v2-publication-maintenance.ts`. The composition entrypoint retains
  dependency wiring and can continue re-exporting existing public helpers. No
  application/persistence port or schema change.
- Preserve scan order, maximum scan size, execution status policy,
  required/optional operation rules, retry delay and defer CAS. A global feed
  scan failure still fails the publication phase and blocks dependent progress.
- Capture and sanitize each individual executor or defer exception and continue
  with remaining items once. An unexpected executor throw has no proven terminal
  outcome: only advance its next eligibility using the existing retry-count
  compare-and-set, with a fixed safe error code. This prevents a permanently
  poisoned ordered prefix from starving later batches. Neither this defer nor a
  catch replays an external effect; the persisted claim and reconciliation own
  recovery. Preserve defer-CAS failures as degraded results.
- Count only executor calls that successfully returned; count
  manual/terminal-unknown statuses exactly as today. Return verified settlements
  from successful items even if another item failed. Preserve strongest terminal
  outcome and deterministic sorting.
- Propagate item failures into existing `ReviewV2MaintenanceResult.failures` so
  degraded one-shot runs fail. Return a null `advanced` total when an item can
  have unknown completion, while preserving the known `publicationProcessed`
  count. Successful settlements may wake and promote; **an item error must never
  manufacture a terminal settlement**. A global scan error still blocks
  progress.
- Keep production composition narrow, with no task scheduler, retries, new
  flags, or generic error framework.

## Qualification before merge

1. Focused unit tests: executor throws between two valid items, defer throws,
   mixed returned statuses, settlement order/precedence and scrubbed errors.
   Prove final item still executes and no failed item appears in settlements.
2. Worker integration: completed publication with item failures emits degraded
   failures while still promoting only its verified settlement subset; a feed
   scan failure blocks publication-dependent progress.
3. Run type, lint, formatting, architecture and applicable CI/E2E on the exact
   head. Review diff for scope, secret leakage, idempotency and regressions. Fix
   confirmed findings.
4. Merge upstream PR #747 first; realign this stacked branch to `main` without
   inheriting stale PR diffs. Merge only after required checks, without
   bypassing branch protection.

## Known boundaries

No claim of exactly-once effects. No live provider mutation testing or
production rollout is implied by fixture tests. Do not change SQL eligibility,
claim fencing, or installation inventory behavior.
