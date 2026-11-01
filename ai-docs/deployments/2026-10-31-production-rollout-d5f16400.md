# Production rollout d5f16400 (2026-10-31)

## Goal and scope

Move the Hetzner production fleet from `533c040d` to main
`d5f16400e610e6fe9151c23da39868825d332711`, and repair three production problems
found after the 2026-10-30 rollout (empty Statistics, repository sync dead
letters, misleading Verify setup errors). No staging: there are no production
users.

## Environment status

| Environment | Status     | Actual deployed version / image                                                        | Last verified (UTC) | Remaining work                                  |
| ----------- | ---------- | -------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------- |
| staging     | `pending`  | Not used                                                                               | Not verified        | None.                                           |
| production  | `deployed` | `d5f16400` / `sha256:f1f9cc0ff9b808047f8e994512ba258ec4bfc18d5e746d23f78cec85b3c93edf` | 2026-10-31 17:30    | Follow-ups below; re-run the end-to-end review. |

## What was found

- Statistics showed zeros. The settled-event projector read `RepositoryConnection`
  with `FOR SHARE`, which needs UPDATE privilege; the worker role only has SELECT.
  Every `review.statistics.settled` event failed with `42501` and was dead-lettered
  (11 events, 2026-10-25 to 2026-10-30). Fixed in code (no row lock).
- Repository sync (`installation.sync_requested`) dead-lettered from 2026-10-22
  (97 events): the canonical runtime ACL that every release re-applies makes
  `RepositoryConnection` read-only for api, web and worker, but the worker upserts
  it. No repository created after 2026-10-19 reached the dashboard. See
  [issue #761](https://github.com/777genius/review-router-ai/issues/761).
- `review_run_authorize` answered 500 `ambiguous_outcome` for a stale pull request
  head ([issue #750](https://github.com/777genius/review-router-ai/issues/750)); the
  Action retried it. Fixed: a moved head now returns terminal 410 `resource_gone`.
- Verify setup said "wait a few seconds" for a setup PR merged long ago when a
  legacy workflow was still in the repository. Now `setup_legacy_workflows_present`.

## What was done

1. Before the rollout, by hand: column-level INSERT/UPDATE for `reviewrouter_worker`
   on `RepositoryConnection`, the 11 statistics events requeued (all processed, facts
   appeared), and a manual sync of two installations (repositories 42 to 43 and 419 to
   449).
2. Image built on the host from `d5f16400` (`reviewrouter-manual:d5f16400`).
3. Full pgBackRest backup `20261031-170619F`.
4. `prisma migrate deploy` from the new image: `000155` (index on `UsageCall`, created
   concurrently). Ledger 164 rows, none unfinished.
5. Canonical runtime ACL re-applied. It revoked the worker's repository write grant
   again, as expected, so `deploy/hetzner/db-grants/worker-repository-sync.sql` was
   applied right after it.
6. All four roles replaced together with `deploy/hetzner/fleet-overlay` using its new
   image mode; old containers kept stopped as `*-before-ovl-*`.

## Verification

- All four roles run `sha256:f1f9cc0f...` (revision label `d5f16400`), zero restarts,
  `/ready` and the site return 200.
- Worker privileges after the ACL step and the grant: column-level INSERT/UPDATE
  present, no table-level write, no UPDATE on `scmRepositoryIdentityId`.
- A manual sync after the rollout was processed; no new dead letters.
- Statistics: a new settled event was processed after the requeue (12 review facts).
- The compiled projector no longer takes a row lock; the compiled authorize handler
  contains the stale-head mapping; the web bundle contains the new Verify code.
- `node scripts/check-runtime-db-privileges.mjs` under the worker role passes its
  privilege checks. It still lists 31 dead-lettered sync events from 2026-10-28 and
  2026-10-29; they leave its 7 day window on their own.

## Retry and rollback

Start the preserved `*-before-ovl-*` containers and stop the new ones. The only schema
change is an index. Do not re-run migrations. If the canonical ACL is re-applied again,
apply the worker grant file right after it, then run the check script.

## Known follow-ups

- The end-to-end review run `40800168729` (attempt 8) failed with
  `required_admission_limited`: the Gateway limited model admission while many reviews
  ran. It reached the model, so authorization and the new fleet work; rerun it.
- [Issue #761](https://github.com/777genius/review-router-ai/issues/761): the canonical
  ACL and the worker disagree; the worker grant is applied outside the ACL on purpose.
  The referential guard trigger does not cover INSERT.
- About 80 percent of finished reviews end as `partial`; Statistics counts only fully
  completed ones, so its numbers stay small. Not investigated.
- Activation env files of the account gateway still point at `.site`.

## Continuation verification — 2026-11-01

- Both remaining delivery PRs merged: [Gateway #86](https://github.com/agent-teams-ai/sub2api/pull/86)
  and [Hetzner script #771](https://github.com/777genius/review-router-ai/pull/771).
  The script's exact-head CI included a successful fresh Self-hosted E2E run:
  [41246446995](https://github.com/777genius/review-router-ai/actions/runs/41246446995).
- At 10:43 UTC, all four application roles still run full revision
  `d5f16400e610e6fe9151c23da39868825d332711`, with zero restarts after fourteen
  hours. Gateway is active with zero systemd restarts. Its configured binary
  matches SHA256 `2339a4d30d2c319b3618fd0756fdd79bb841c091ad2dd17b1728c79cabed589e`.
- Gateway journal since 2026-10-31 21:00 UTC contains zero `admission_input`
  failures. Twelve other stream/provider failures remain; this is not evidence
  of an error-free upstream provider.
- Personal and agent-teams-ai statistics contain respectively 14 and 3 completed
  review facts. No new permission-denied dead letters were created after the fix.
- The 31 historical permission-denied sync events mentioned above were preserved,
  requeued, and all processed successfully on 2026-11-01. The earlier statement
  that they should age out is superseded by this recovery.
- [PR #772](https://github.com/777genius/review-router-ai/pull/772) fixes the release
  script's worker/scan-worker ambiguity and makes verification reject missing,
  duplicate, unhealthy, restarted, or wrong-revision containers. Verification now
  invokes the database probe through the real worker connection and rejects an
  unreadable outbox or unexpected database role. Its read-only production command
  passes all four roles, six worker privilege checks, and `/ready` 200 after recovery.
  Seven new failure cases fail against the original script and pass with the fix.
- A fresh test-repository review was requested as
  [run 40800168729, attempt 10](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/actions/runs/40800168729/attempts/10).
  At capture time it was queued for GitHub's `ubuntu-latest` runner; the earlier
  attempt 9 passed. Follow the linked run for the fresh result.

Issue #761 remains a separate canonical ACL/activation-routine and INSERT-guard
follow-up. The supported Hetzner release path automatically reapplies the narrow
worker grant after the canonical ACL. There is no standalone production helper
for reprovisioning those activation routines and pins; this continuation does not
claim that canonical policy or its trigger inventory was changed.
