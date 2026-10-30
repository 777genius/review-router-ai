# Production rollout 533c040d (2026-10-30)

## Goal and scope

Move the Hetzner production fleet from `b8eac8ec` to main `533c040de09d2609c8ebb44474812e2b35f0e7ea`
together with the paired Action releases, in one pass and without staging
(there are no production users). This record is the shared evidence for the
task files linked below. It does not replace them: each task keeps its own
task-specific verification.

## Environment status

| Environment | Status     | Actual deployed version / image                                                        | Last verified (UTC) | Remaining work                                                     |
| ----------- | ---------- | -------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| staging     | `pending`  | Not used                                                                               | Not verified        | None for this rollout; production went straight from main.         |
| production  | `deployed` | `533c040d` / `sha256:e1578f75207de943031a6652ab94318433ef311c85fcaa5a1428fef26d08227a` | 2026-10-30 17:35    | Follow-ups below; per-task verification stays in the linked tasks. |

## What was done

1. Image built on the production host from main `533c040d`.
2. Full pgBackRest backup `20261030-143534F` before any schema change.
3. `prisma migrate deploy` from the new image under the database peer role.
   Applied `000152` (both), `000153` and `000154`. Migration ledger: 163 rows,
   0 unfinished. Canonical runtime grants were re-applied afterwards.
4. All four roles (web, api, worker, skill-scan-worker) replaced together; old
   containers kept stopped as `*-before-*` for rollback. The schema change is additive.
5. Action `v1.0.221`, `v1.0.222`, `v1.0.223` released; producers for all three
   registered. `workflow-v1` points to `v1.0.222`
   (`2588eeb839d282d7d4c8742244536a6d62a7d3a4`), which carries an explicit
   `modelDispatchProfile` with `ocr-managed-v5`. `v1.0.221` has no profile and is
   ambiguous between OCR profiles (`agent_profile_unavailable`); `v1.0.223` uses
   `ocr-managed-v3`, which fails against the current Gateway. Neither is used.
6. Managed OCR `ocr-v1.13.1-rr.6` built reproducibly with `tools/ocr/build.sh`
   (sha256 `9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`,
   matches the pin) and published.
7. Fleet env updated with the overlay tool (producer attestations, Action ref,
   allowed refs, installer tuple).

## Verification

- `https://api.reviewrouter.org/ready` is `ok`; the site returns 200; no restarts or
  errors in the four roles; no dead-lettered events.
- Self-hosted end-to-end run `40800168729` (attempt 6) in
  `777genius/rr-selfhost-direct-v2-e2e-20260730t120036z`: success on `workflow-v1`.

## Retry and rollback

Start the preserved `*-before-*` containers and stop the new ones; the migrations
are additive and do not need to be reverted. Do not re-run migrations. Registered
producers are immutable; revoke instead of deleting.

## Known follow-ups

- `review_run_authorize` answers 500 `ambiguous_outcome` for a stale pull request
  head; the real cause is `stale_precondition`, which is outside the operation
  contract and gets masked. Needs a server-side contract fix.
- Profile `ocr-managed-v4` needs `ocr-v1.13.1-rr.5`, which is not published; not a default.
- Gateway control origin in the web/api containers is still
  `https://api.reviewrouter.site:8443`. Caddy already serves `.org:8443` on the same
  bridge; switching also needs `extra_hosts` for the `.org` host.
- Hindsight memory is not configured (reviews log "memory unavailable" and continue).

## Related tasks

[Review History](2026-10-28-review-history.md),
[Account model catalog](2026-10-28-model-catalog.md),
[Skills catalog](2026-10-28-skills-catalog.md),
[Dispatch cleanup and Scanner CI](2026-10-28-dispatch-cleanup-ci.md),
[Conversational memory](2026-10-29-conversational-memory.md),
[Unified OCR](2026-10-29-unified-ocr.md),
[Several Gateway reviewers](2026-10-29-gateway-multi-reviewers.md),
[Review dispatch retry storm](2026-10-29-review-dispatch-retry-storm.md),
[Trusted Statistics and Usage reports](2026-10-29-statistics-history-followthrough.md).
