# SDK growth application-schema executor

This operation is the bounded schema-owner path for
`000105_sdk_growth_publication_effect` and its bounded follow-up
`000106_sdk_growth_finalized_report_logical_identity`. It does not activate SDK growth and it
does not replace the release process in
`07-environments-and-release-management.md`.

Use `.github/workflows/sdk-growth-application-schema-checkpoint.yml` from the
exact protected `main` commit. Run `preflight` first with confirmation
`CHECK_SDK_GROWTH_SCHEMA`. Retain its non-secret database identity. The
checkpoint requires the authority flag to remain `0` and fenced outbox takeover
to remain `1`. A standalone `postflight` dispatch must supply that retained
identity so every catalog and permission probe is bound to the executor target.

The protected environment must contain three separate credentials:

- `REVIEW_ROUTER_SCHEMA_OWNER_COORDINATOR_DATABASE_URL` authenticates as the
  database owner `reviewrouter`. The transaction admits only the reviewed
  provider-granted ADMIN/NOSET recovery edge to the NOLOGIN schema owner, adds
  its own temporary SET edge, and removes that edge before commit.
- `REVIEW_ROUTER_RELEASE_MIGRATION_DATABASE_URL` authenticates as the restricted
  release observer `reviewrouter_release_migration`.
- `REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL` authenticates as the
  NOINHERIT read-only checkpoint observer.

For `apply-000105`, use confirmation `APPLY_PINNED_SDK_GROWTH_000105`. After its
postflight passes, run `preflight-000106`, then use confirmation
`APPLY_PINNED_SDK_GROWTH_000106`; finish with `postflight-000106`. Both apply
phases require the retained database identity, immutable release image digest, release config
revision, and observed API and worker service revisions. All three revisions
must equal the exact workflow commit. These are non-secret evidence bindings;
the schema operation does not claim it independently observed hosted fleet
state.

Both executors take the same fixed transaction-scoped advisory lock, validate PG17,
the exact database generation/name/OID, caller and schema-owner topology, the
single exact predecessor, absence of later migrations, and the phase-specific
empty legacy table. `000106` requires an empty finalized-report table;
historical reports need a separately reviewed rekey procedure. Before checking
that prerequisite, `000106` takes a bounded `ACCESS EXCLUSIVE` lock on the
finalized-report table and retains it through commit, so an in-flight legacy
insert either completes before the check and is rejected or cannot begin until
after the operation. In the same transaction it:

1. creates the target ledger row only when absent;
2. runs the repository-pinned migration bytes as the NOLOGIN schema owner;
3. marks that one ledger row finished;
4. converges API/worker privileges and the observer's table, column, schema and
   membership boundary;
5. checks target structure, ownership, routine properties, effective observer
   table/column permissions, grants and restored schema-owner topology before
   commit.

The `000106` checks atomically pin the completed `000105` ledger and catalog.
Postflight proves the digest-derived unique constraint/index is gone while the
logical-report primary key, evidence foreign key, exact column types, bounds,
nullability and defaults remain. The statement-level immutability trigger must
have no condition or column restriction and must invoke the exact independently
verified public trigger function. The observer can read the report table but
cannot write it or reach a writer through inheritance or `SET ROLE`.

An exact already-committed ledger and catalog returns `already-committed`.
Unfinished, duplicate, wrong-checksum or catalog-drift states fail closed. SQL
errors roll back the migration, ledger and grant changes together. After commit,
the executor runs the existing postflight through the restricted release and
observer connections and requires the same database identity.

The resulting JSON binds the phase, repository SHA, migration digest, database
identity, image digest, config revision and service revisions. It deliberately
reports `activationStatus: HOLD`. Trusted authority ingestion, provider merge
enforcement, observed fleet convergence, and disposable App-first live
qualification remain separate activation gates.

Do not delete or repair legacy rows, edit `_prisma_migrations`, change the
migration bytes, use a broad migration workflow, or enable the production flag
to make this operation pass. An ambiguous result requires readback with the same
exact inputs; never insert a replacement ledger row. Service revisions are
operator-supplied bindings, not proof of fleet convergence. The protected SHA
must contain the logical `(evidenceId, grantId)` writer, so an old
digest-derived writer is not an eligible release; independently observe the
deployed services before activation.
