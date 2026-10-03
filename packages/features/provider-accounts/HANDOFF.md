# contract52 C1 handoff

C1 owner/binding foundation is implemented in the workspace. Main qualification
is pending; this is not UI/gateway/CI completion or a production release.

## Identity and owned patch

Requested base: `f0c18bf7759c030f311cf21050d6a61718e9dcd4`.
Actual HEAD is **UNVERIFIED**: `git rev-parse HEAD` exits 128 because `.git`
points to unavailable `/srv/workers/jobs/review-router/account-gateway-v1/repos/saas/.git/worktrees/owner-binding-c1`.
No supplied50/51/52 files were available in this worktree; explicit task C1
requirements are the implementation contract. Primary must compare with the
approved documents and confirm the exact base before integrating.

Available pre-edit SHA256 fingerprints:
- schema.prisma: `87d0beaeadf6dc66abd81afcc3b79a73243865c5c55eec2d23d7b520ef977b14`
- pnpm-lock.yaml: `3d81c57a3ea0bdd9223592fb5021dfb049f02a50fd3ce5f68337ff812c5141cd`
- exported auth assertion source: `69a423d022a285257d0d930ec6be46409297a511d95453188149b81f67304c64`

Changed: this feature package, additive schema declarations, and new
`000116_provider_accounts/migration.sql`. Removing only C1 schema additions
reconstructs the pre-edit schema SHA256 exactly. Old migration/pool/native/
private gateway files were not written. Lockfile remains byte-identical.
No commits, index changes, pushes, deployment, credential/key/runtime-auth-file reads,
network/database/socket/provisioning or real-project smoke execution occurred.
Final file fingerprints and command outcomes are in `EVIDENCE.json`.

## Policy and storage

Pure domain -> product ports/use-cases -> Prisma adapter; public auth feature
export `assertWorkspaceAdminAllowed` is reused, with live injected
`WorkspaceAccessRepositoryPort`. Stable userId wins; a present ID never falls
back to GitHub/login roles. Absent IDs use immutable GitHub ID. The existing
local override comes from trusted composition configuration. Members can select
in their current workspace, but cannot mutate. No paid/shared-pool grants.

Connections have exactly one stable User/Workspace FK owner, enforced by SQL
XOR and immutable owner/identity/gateway-ref trigger. Safe account/operation/
profile refs, label, status and mirror CAS revision only; no credential, native
DTO, prompt, fingerprint or refresh journal. Separate bindings retain revoked
rows, enforce a unique workspace/connection pair, positive increasing revision
and `(id, workspaceId)` uniqueness for a future same-workspace config FK.
Ownership FKs use RESTRICT. Reserved `Workspace.personalOwnerUserId` has an
explicit named User relation, nonempty check and RESTRICT FK. Nothing infers,
provisions or enables personal ownership. User-owned sharing remains denied,
including when the reserved personal owner is explicitly set.

Bind/revoke preflight live admin access and owner; bind requires active gateway
status. The adapter locks the owned connection, rechecks owner/status, then
atomically creates at expected revision 0 or CAS-updates a retained binding.
Missing/stale/racing writes return safe product errors. Revocation also works
for inactive connections so they can be cleaned up. Current-workspace selection
requires an active binding, matching owner and exactly known active account.
It returns only a safe binding tuple. Reads expose no global owner list.

`./synchronization` is a separate privileged backend seam with an explicit field
allowlist and metadata CAS; it mirrors an already-qualified gateway projection.
Its revision is a local mirror version, not an account authorization epoch.
No browser route can set active in C1 because there are no routes here.

## Tests and observed results

Test regression intent was recorded before implementation, and appears beside
individual tests: member mutation/live membership removal; stable-ID fallback;
local override without foreign/personal sharing; stale CAS undoing revocation;
inactive/future gateway states; workspace-scoped selection; unsafe/nonempty PG
fixtures; real SQL XOR/transfer/FK/duplicate/revision failures and CAS races.

From repository root on Node v24.21.0:
- `node --import ./packages/features/provider-accounts/tests/register-source-loader.mjs --test packages/features/provider-accounts/tests/use-cases.test.mts packages/features/provider-accounts/tests/database-target.test.mts`: **PASS, 7 tests**.
- TypeScript syntax parsing using Node `stripTypeScriptTypes` (12 TS/MTS files), JSON manifest parsing and focused whitespace inspection: **PASS**. Syntax parsing is not a typecheck.
- `node --experimental-transform-types --import ./packages/features/provider-accounts/tests/register-source-loader.mjs --test packages/features/provider-accounts/tests/postgres.test.mts`: **SKIPPED**, opt-in absent; actual PG/full migration **NOT_RUN**.
- `pnpm --filter @reviewrouter/features-provider-accounts typecheck`: **NOT_RUN**, wrapper exits 127: pinned corepack is unavailable; node_modules absent.
- `node scripts/check-architecture-boundaries.mjs`: **NOT_RUN**, missing TypeScript dependency, exits 1 before checking.
- `git diff --check`: **NOT_RUN**, unavailable linked gitdir, exits 128. Focused whitespace check passed independently.

The lightweight source loader resolves extensionless TS and directly loads the
existing exported auth assertion source, isolating unrelated SCM/crypto adapters.
It does not replace the auth algorithm. Unit fixtures implement product ports;
actual persistence/race evidence must come from the opt-in PostgreSQL suite.
Standalone Node tests are not discovered by the root Vitest include pattern;
main CI must run the package test and PG commands explicitly.

Independent `gpt-6.1-sol/xhigh` code review completed against the final recorded
source hashes. No remaining actionable product/schema/migration defects were
identified. It found two fixture hazards, now repaired: pg can treat an empty
password string as omitted and consult ambient credentials/pgpass; omitted
options or port zero can consult ambient session/port settings. The helper now
uses a truthy empty-password callback, explicit safe session options/name/UTF8
and SSL configuration, and rejects port zero. Revised offline tests passed 7/7
in both the worker and independent review.

A new actual-adapter PG regression changes status to quarantined between live
preflight and atomic CAS, requiring denial and zero binding rows. This regression
was inspected and syntax-checked; its actual database execution is NOT_RUN.
The reviewer confirmed the CI gap: `vitest.config.ts` excludes `.test.mts`, while
`.github/workflows/ci.yml:776` runs root `pnpm test`. Main must wire the standalone
commands explicitly; CI changes remain outside this worker's ownership.
Exact-base and actual CI-run qualification remain unverified.

## Main-owned qualification and deferred work

Main qualified the guarded worker patch `3a5aed10` on canonical `f0c18bf7`
in a NEW hosted sandbox: Prisma generation/validation, feature typecheck/build,
all seven lightweight tests and actual architecture checks passed. A NEW
PostgreSQL 17.10 cluster passed all historical migrations and all six database
cases, with zero skips. The original multi-statement `pg` harness failed on
historical `CREATE INDEX CONCURRENTLY`; main corrected only the fixture to use
actual `psql` with checked loopback parameters, no ambient credentials and
individual-statement execution. Migration SQL and product policy were unchanged.
The failed first cluster and successful second cluster have separate receipts
under `qualification-c1-3a5aed10-v1` and `qualification-c1-pg-harness-v2`.

Pinned pnpm 10.33.0 generated the real package importer. Main retained only that
16-line importer after proving parsed existing lock authority unchanged; the
unrelated full re-resolution is retained as evidence. Frozen install and feature
typecheck passed again on the minimal lock. Stale worker-only `EVIDENCE.json`
was retained outside product source. The dedicated C1 workflow explicitly runs
the standalone Node tests and full-schema PostgreSQL fixture; root Vitest alone
does not cover them. Exact-head CI and independent xhigh review remain pending.

No new libraries: package dependencies reuse pinned Prisma/adapter 7.8.0 and pg
8.23.0, verified in current package manifests/lock. The original worker's pending
qualification instructions below describe the reproducible commands. Main ran
pinned pnpm 10.33.0 lockfile registration (lock-only, ignore scripts), generate
Prisma from the full schema, validate/typecheck/build and architecture checks.
Do not hand-edit a guessed importer. Worker installed nothing.

Main supplies a **new empty** passwordless loopback database named
`rr_gateway_test_*` in a disposable cluster, with a synthetic migration-capable
role. The test refuses any preexisting non-system objects before writing, then
applies every checked-in SQL migration in sorted order and uses the actual
Prisma/auth adapters. Historic migrations create cluster-wide release roles;
this is why a disposable cluster acknowledgment is additionally required.
It never creates a database or reads ambient database credentials. Example after
main's install/generation, replacing the synthetic target with its fresh fixture:

```sh
RR_PROVIDER_ACCOUNTS_PG_TEST=1 RR_PROVIDER_ACCOUNTS_DISPOSABLE_CLUSTER=1 \
RR_PROVIDER_ACCOUNTS_PG_TEST_URL=postgresql://fixture_owner@127.0.0.1:5544/rr_gateway_test_c1 \
node --experimental-transform-types --import ./packages/features/provider-accounts/tests/register-source-loader.mjs --test packages/features/provider-accounts/tests/postgres.test.mts
```

The fixture remains inspectable; main destroys its new database/cluster after
review. Full migration/typecheck/real PG checks, exact-base qualification and
independent gpt-6.1-sol/xhigh review of exact code plus CI are required before
primary's mechanical integration commit/merge. No FAST qualification claim.

C2/C3 must compose trusted authenticated principals, existing live auth port,
Prisma repository and privileged status synchronization with the qualified
private facade/static SDK seam. Gateway owns native ID/generation, credentials
and inference. No second native manager/facade/framework was built. Routes/UI,
repo config, personal sharing/provisioning and remote gateway fence ACK are
explicitly deferred. Local-revoked selection denial is not completed remote
disable. In-flight operations still need gateway authority/fencing in C2.

## Migration risk and rollback

Additive nullable Workspace column and new tables/enums/indexes/triggers; existing
rows need no backfill. New authority references intentionally prevent deleting
referenced User/Workspace/connection rows. Binding tombstones prevent application
ABA. Apply SQL migration, not schema push, to retain XOR/immutability/revision
constraints. Full historical migrations passed in the new hosted fixture above;
production migration and rollback have not been executed.

Prefer a forward fix. For rollback, first disable future C1 composition/writers
and preserve safe product rows for recovery, then main can remove bindings,
connections, guard functions, enums and the reserved Workspace FK/index/column
in dependency order. Dropping these loses product mapping/revocation history;
gateway accounts/credentials remain outside RR. Never rewrite older migration
hashes or alter pool tables. Rollback and actual PG deployment are NOT_RUN.
