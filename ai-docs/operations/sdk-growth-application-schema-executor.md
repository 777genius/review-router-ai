# SDK growth application-schema executor

This operation is the bounded schema-owner path for
`000105_sdk_growth_publication_effect`. It does not activate SDK growth and it
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

For `apply-000105`, use confirmation `APPLY_PINNED_SDK_GROWTH_000105` and supply
the retained database identity, immutable release image digest, release config
revision, and observed API and worker service revisions. All three revisions
must equal the exact workflow commit. These are non-secret evidence bindings;
the schema operation does not claim it independently observed hosted fleet
state.

The executor takes a fixed transaction-scoped advisory lock, validates PG17,
the exact database generation/name/OID, caller and schema-owner topology, the
single exact `000104` predecessor, absence of later migrations, and an empty
legacy effect table. In the same transaction it:

1. creates the target ledger row only when absent;
2. runs the repository-pinned migration bytes as the NOLOGIN schema owner;
3. marks that one ledger row finished;
4. converges API/worker privileges and the observer's table, column, schema and
   membership boundary;
5. checks target structure, ownership, routine properties, effective observer
   table/column permissions, grants and restored schema-owner topology before
   commit.

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
exact inputs; never insert a replacement ledger row.
