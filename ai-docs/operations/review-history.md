# Review history operations

This feature records new GitHub v2 review requests after an explicit activation
boundary. The dashboard groups logical requests by workspace, canonical repository
identity, and pull request number. Automatic dispatch recovery stays within one
logical review; an explicit rerun creates another history entry.

See the [implementation plan](../plans/2026-10-28-review-history-implementation.md)
for scope and the [composition decision](../decisions/032-review-history-scoped-composition.md)
for the feature's Get Modular contract. Follow the existing
[release process](07-environments-and-release-management.md) for deployment.

## Enable capture

1. Apply the normal database migrations through `000151_review_history` before
   starting the new API or worker binaries. The new Prisma schema includes three
   nullable lineage columns in operational tables; a disabled capture flag does
   not make these binaries compatible with an older schema.
2. Deploy the new worker handler and all API/worker source capture hooks. Keep
   `REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE=0` while rolling out the code. The history
   outbox handler is registered independently of this flag and publisher
   credentials, so accepted events can continue to drain.
3. Set `REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE=1` on every API and worker that can
   create or change v2 reviews. Complete that rollout and verify every writer is
   running the new version. Hooks remain dormant until the activation row exists.
4. Using the approved database connection for that environment, run once:

   ```bash
   pnpm history:activate --confirm-writers-ready
   ```

   The command accepts the existing `DATABASE_URL` or
   `REVIEW_ROUTER_DATABASE_URL_FILE` configuration. It prints only the coverage
   timestamp. Repeating the command retains the original timestamp; process
   startup never activates capture implicitly.

5. Trigger a new review in the existing disposable test repository. Confirm that
   one PR row appears, its state changes after a dashboard refresh, and a genuine
   rerun appears inside the same row's history. Confirm a different workspace
   cannot read the row or its history. Follow the release process before widening
   rollout; this feature does not change review execution or publication authority.

Managed PG17 qualification admits this migration through the existing
[exact checkout policy](../../scripts/lib/render-schema-handoff-policy.mjs).
Checkout admission preserves the historical restore subsets and managed92 target;
it does not apply History storage to those catalogs. The full application migration
in step 1 remains required before starting the new binaries.

Before activation, the Reviews view explains that history is not available yet.
After activation it shows the recording start date. Existing reviews and legacy,
GitLab, or other unsupported execution paths are not backfilled. “Completed”
means publication was confirmed; it does not mean the PR was approved or had no
findings.

## Failure and rollback behavior

Source changes and their history outbox fact commit in the same transaction. If
capture fails, the source transaction fails too; investigate the existing source
and outbox diagnostics rather than bypassing the transaction. Duplicate delivery
is safe. Projection handles reordered events without moving a PR back to an older
logical review or replacing the winner with a losing execution candidate.

The existing outbox worker retries transient projection failures. Malformed or
conflicting immutable facts fail with a safe error code and require the existing
outbox investigation/redrive procedure. Diagnose by event type
`review.history.changed` and the implementation's versioned handler definition;
do not fabricate events or infer success from a failed projection. Source-row
retention does not prevent replay of a retained, self-contained outbox fact.
Pruned outbox events cannot be reconstructed from a separate event journal.

For an incident, disabling `REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE` stops new capture
callbacks while the worker continues draining accepted facts. It creates a gap
in history, including possible missing final states for active reviews. The
coverage date is an initial boundary, not a promise of gap-free capture after
operator disablement. Restore all writers together and document any gap. Do not
delete the coverage marker to simulate a fresh complete history or drop the
additive schema during rollback. The previous application version can ignore the
new nullable columns and history tables.

## Data and scale

The feature uses the existing PostgreSQL database and outbox worker. API and
worker replicas keep no history state in memory. One short per-PR allocation lock
orders new logical requests, and projection updates a run and its PR summary in
one transaction. Different PRs and workspaces do not share that allocation lock.

List queries read 25 projected PR summaries at a time; expanding a row reads five
reviews at a time. Repository options are paged too. All endpoints authorize the
actor against the active workspace in the same repeatable-read transaction as
their workspace-scoped query. Historical metadata comes from the original
workspace's ledger, not a repository's current connection after a transfer.

The schema includes indexes for workspace, repository, status, numeric PR lookup,
and run pagination, plus a matching full-text search index. Text search matches
word prefixes, not arbitrary substrings. There are no exact-total queries,
per-row GitHub calls, polling, extra broker, or shared cache. Database throughput
and workload still determine capacity; the included volume check is evidence for
the tested dataset, not a user-count guarantee.

Page sizes bound the returned rows, not the work needed by every filtered query.
Canonical repository options choose one captured label per repository before
filtering and paging, so that read can inspect all PR summaries in the workspace.
The planner can also select a wider table scan and sort. A text search with no
matches can select the workspace/time index and inspect the workspace's PRs rather
than using GIN. These reads retain a cost proportional to tenant history; the
chosen options plan may also examine other tenants' table pages before applying
the workspace predicate. Authorization and returned data remain workspace-scoped.

The PostgreSQL 17 qualification used 100,000 PR summaries in each of two tenants
and 100,000 logical runs on one PR. Twelve captured production reader statements
were explained with `ANALYZE, BUFFERS`. On the final local run, list/continuation,
exact numeric lookup, repository-filtered list, and run continuation used their
B-tree indexes; a selective text prefix used GIN. The no-match text plan inspected
100,000 tenant rows (about 197 ms), and repository option enumeration scanned
200,065 table rows and sorted 100,000 tenant rows (about 301 ms). The selected
repository label used the repository index (about 0.07 ms). These timings describe
that disposable fixture and host load, not production latency guarantees. The
canonical repository ordering permits backward index traversal but does not force
the planner to choose it. No materialized search-candidate stage, extension,
shared cache, or new projection table is introduced to change this tradeoff.

The exact local qualification receipt and query plans are retained under ignored
`tmp/review-history/read-postgres.log` and `tmp/review-history/reader-volume.json`.
Use actual plans and workload evidence before making claims beyond this tested
dataset; full-history repository enumeration is not constant-time pagination.

The compact ledger intentionally outlives operational review/outbox retention.
Workspace deletion cascades its history. Any future independent history-retention
policy needs its own product and privacy decision; this change adds no scheduled
history deletion or old-data import.

## Focused qualification

Run the risky PostgreSQL cases against an isolated loopback database server:

```bash
HISTORY_REQUIRE_POSTGRES=1 \
HISTORY_TEST_POSTGRES_ADMIN_URL=postgresql://test_role@127.0.0.1:5432/postgres \
pnpm history:test:postgres
```

Each suite creates and drops a uniquely named disposable database and applies the
real migration chain. `HISTORY_TEST_POSTGRES_TEMPLATE_DATABASE` can name a local,
fully migrated, idle template to avoid repeating migration work. It must never
identify a production database. `HISTORY_REQUIRE_POSTGRES=1` prevents a missing
connection from silently skipping the qualification. Set `HISTORY_TEST_VOLUME=1`
for the bounded 100,000-row read/query-plan fixture.

Run `pnpm history:architecture` for the scoped Get Modular pins, module layout,
and Foundation rejection checks. Its deliberate temporary forbidden-import
fixtures must not run concurrently with other architecture/typecheck processes.
The real composition-root smoke is part of `pnpm modular:qualify`.

For the actual SSR/API/browser workflow, use the `history` scenario in the
[existing browser qualification harness](../../scripts/statistics-e2e/README.md).
It uses a named disposable database, synthetic NextAuth session, SELECT-only web
role, and real Chromium. Source capture, projection races, and rollback are
qualified separately by the PostgreSQL cases; browser fixtures do not claim to
execute a real GitHub review.
