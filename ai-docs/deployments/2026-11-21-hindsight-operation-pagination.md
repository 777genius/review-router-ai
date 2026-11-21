# Hindsight: complete operation pagination before cleanup

- Task ID: `2026-11-21-hindsight-operation-pagination`.
- Goal: enumerate every native operation before deleting its retained payload.
- Affected target: the private Hindsight derivative image and its qualification tooling.
- Implementation: [PR #914](https://github.com/777genius/review-router-ai/pull/914), prepared from `948dda628d096c9b078ccd63b4fad6779adcf961`.
- Dependencies: the existing [native image and cleanup profile](../../deploy/hindsight/README.md) and [patch record](../../deploy/hindsight/PATCH-RECORD.md).
- Last updated: `2026-11-21`.

## Environment status

| Environment | Status    | Actual deployed image | Evidence / next step                                                             |
| ----------- | --------- | --------------------- | -------------------------------------------------------------------------------- |
| staging     | `pending` | Not verified          | Qualify the exact derivative selected for the next authorized rollout.           |
| production  | `pending` | Not verified          | Reconcile the installed image and follow the existing private Hindsight rollout. |

## Change and qualification

Native `list_operations` now orders equal `created_at` values by the unique
`operation_id`. It preserves all filtering and operation lifecycle behavior.
The qualifier rejects duplicate pages, changing totals, mismatched readback IDs
and missing submitted operations; it compares one-row API pages with the complete
database inventory and retains strict payload absence checks before and after
worker restart. Synthetic timestamp ties are introduced only in the disposable
qualification bank after executor drain, never in a deployed database.

The local SQL regression failed against the pinned upstream query and passed
with the bounded patch. This is separate from the required real native API,
worker and PostgreSQL qualification and is not deployment evidence. The earlier
[948 qualification failure](https://github.com/777genius/review-router-ai/actions/runs/44848646316)
reported an unverified operation absence; its log does not identify the exact
failed readback, so this record does not assert a proven cause for that run.

## Ordered rollout and verification

1. Use the [release process](../operations/07-environments-and-release-management.md)
   and existing Hindsight runbook for the next authorized image rollout. No schema
   migration, user-data conversion, new credential or activation flag is required.
2. Build from the unchanged reviewed upstream revision and lock. Require exact
   patch preimages and the generated manifest, then qualify the actual immutable
   image with all native scenarios, including tied one-row pagination.
3. Record the deployed API and worker image identities and the environment's
   verification evidence. A green PR or merged source alone is not `deployed`.

## Retry and rollback

Reconcile the current image and cleanup state before resuming. Preserve the
existing drain, inventory and signed-receipt rules; never retry destructive
cleanup from an incomplete inventory. Image rollback follows the existing
runbook and restores the earlier pagination limitation. There is no data
migration to reverse. No staging or production rollout is claimed here.
