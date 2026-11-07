# Guided self-hosted installation: delivery and qualification

- Task ID: `2026-11-07-self-hosted-guided-install`.
- Goal: start a fresh self-hosted installation with one guided command, retaining
  the existing GitHub App, provider-onboarding and review-authority contracts.
- Affected targets: the Linux x64 self-hosted installer, Compose services and
  optional Caddy proxy; the existing global emergency operator command gains an
  optional expected-version check. Public documentation is corrected separately
  from runtime activation.
- Implementation PR: [PR #822](https://github.com/777genius/review-router-ai/pull/822).
- First tested candidate: `0c5af53f13ea6be1ccd4f8041c8bdd532dbc74c4` on
  `feat/self-hosted-guided-install`. Its real self-hosted E2E failed as recorded
  below. The catalog correction is written; its combined commit and exact-source
  CI are pending. Neither source candidate is an installed version.
- Dependencies: the [release process](../operations/07-environments-and-release-management.md),
  a supported Node.js version, Git, Docker Compose v2, public DNS and GitHub App
  setup. Optional Memory uses the existing qualified backend bootstrap.
- Last updated: 2026-11-07.

## Environment status

| Environment / target           | Status    | Actual version / image                                                     | Last verified (UTC) | Evidence / next step                                                                                                                              |
| ------------------------------ | --------- | -------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh self-hosted installation | `blocked` | Candidate `0c5af53f13ea6be1ccd4f8041c8bdd532dbc74c4`; no completed install | 2026-11-07 10:44:29 | PostgreSQL 18 rejected the first role-preparation SQL; written catalog correction requires exact-source CI. HTTPS/App acceptance remains pending. |
| Managed self-hosted resume     | `pending` | Not installed by this task                                                 | Not verified        | Verify saved credentials, role identity, release material and data preservation on an interrupted install.                                        |
| Hosted staging / production    | `pending` | Existing baseline is not changed by this task                              | No new observation  | Not selected for rollout. No hosted deployment, migration, flag change or model request was performed.                                            |

`pending` records a missing verified completion for this change; the fresh-install
`blocked` status records the observed CI failure. Neither status changes the
separately recorded hosted baseline or implies that its reviewer is off.

## Scope and applicability

The shell entrypoint delegates to a TypeScript wizard. It retains a private
installation identity and secrets, guides GitHub App creation, verifies the pinned
reviewer artifacts, configures Compose/HTTPS, runs existing migrations and Memory
setup, checks readiness, and uses existing operator commands for release
registration and a selected repository's first activation. Provider onboarding
and the workflow setup PR remain explicit GitHub/browser steps. Server readiness
is not evidence that the first real review succeeded.

The initial Action pin is `v1.0.230`,
`8328c2e6c3a2a7767a0667a2669982bc6ef71f64`. Configuration must come from verified
committed artifacts through the existing release-manifest checker; the installer
must not substitute test attestations or manufacture successful release evidence.

The new database helper applies only to a fresh, installer-owned Compose database
or an exact resume. It creates the isolated
`reviewrouter_codex_effect_authority` login before migrations. Its saved binding,
attributes, memberships, object ownership, migration-owned privileges and actual
credential are verified. It does not create the SaaS release-role pair, change
canonical migration files, repair grants, reset an existing password or adopt an
unmanaged populated database. Migration 64 continues to own signer privileges;
migrations 79 and 110 retain their existing standalone behavior.

First repository activation may open only the original migration-created global
stop. The installer checks its provenance and uses the existing global emergency
command with `--expected-version 1`; a newer operator control or concurrent update
must fail without reopening it. Omission of this optional argument retains the
operator command's existing behavior. No new feature flag is introduced.

Public documentation removes hosted account-pool promotion/navigation while
retaining its implementation and operational history. It also separates the
earlier RR/Codex investigation/critic/replay controls from the default OCR path,
and approved Memory from separately unqualified conversational learning. These
documentation corrections do not activate either subsystem or alter production
flags. Memory semantic qualification remains in its
[existing record](2026-11-03-memory-one-turn-learning.md).

## Ordered delivery and acceptance

1. Record the actual candidate commit/PR and run its applicable exact-source CI,
   including installer strict types/contracts, the operator CLI suite and the
   existing disposable self-hosted E2E. Publish source/artifacts only through the
   [release process](../operations/07-environments-and-release-management.md).
2. On an authorized fresh test host, prepare the documented prerequisites and run
   the guided command. Record the exact checkout and Action pin. Verify private
   state-file permissions and completed GitHub App configuration without recording
   credentials or private keys.
3. Verify the real PostgreSQL role preparation, ordinary migration chain, retained
   role identity on resume, application/worker health and public HTTPS. The stock
   self-hosted E2E now uses this production role helper before migrations and
   checks it again after startup and migration rerun; its unrelated synthetic
   review fixtures do not establish live GitHub/provider acceptance.
4. Complete provider onboarding and merge the setup PR in a disposable
   repository. Verify exact release registration and repository activation using
   the existing operator path. Preserve any non-bootstrap emergency stop.
5. Observe the first real review, its required coverage and final publication by
   the configured GitHub App. Record actual run/review identifiers, versions and
   remaining limitations before marking that target `deployed`.

Hosted fleet deployment is outside this implementation task. No new application
schema migration, historical replay or hosted feature activation is required for
the documentation changes or installer distribution.

## Verification and completion

Local candidate checks observed on 2026-11-07:

- `node scripts/local-checks/compiler-cli.ts --native --noEmit -p deploy/self-hosted/tsconfig.install.json`: passed with the pinned TypeScript 7.0.2 compiler.
- `node scripts/local-checks/compiler-cli.ts --native --noEmit -p apps/api/tsconfig.json`: passed.
- `pnpm self-hosted:install:check`: passed all 28 installer tests, strict native types and shell syntax.
- `node --test deploy/self-hosted/install-database.test.ts scripts/self-hosted-e2e/runner-lifecycle.test.ts`: 10 passed, zero skipped.
- `node node_modules/vitest/vitest.mjs run apps/api/src/review-action-v2-operator-cli.test.ts`: 26 passed, including stale-version and concurrent-stop rejection.
- Focused formatting and `git diff --check` for those implementation files passed.

These initial checks concern the local source candidate, not a deployment. Docker
and psql were unavailable locally. The real self-hosted E2E on candidate
`0c5af53f13ea6be1ccd4f8041c8bdd532dbc74c4` subsequently failed at the first
pre-migration SQL on PostgreSQL 18: `record "authority" has no field "rolconfig"`
([run 42364819517, job 128380549445](https://github.com/777genius/review-router-ai/actions/runs/42364819517/job/128380549445),
2026-11-07 10:44:29 UTC). It did not verify a completed installation.

The written correction queries `pg_catalog.pg_db_role_setting` by the role OID,
without a database filter. PostgreSQL 18 documents role configuration there;
`pg_authid` has no `rolconfig` field. All existing role, credential, membership,
ownership and grant checks remain. The real E2E now also sets and resets role
configuration in global, current-database and other-database scopes. Each must
produce the specific authority-guard error, and preparation must succeed again
after reset. This regression executes the production SQL, rather than checking
its text. Local correction checks passed: the installer and
`scripts/self-hosted-e2e/tsconfig.memory.json` compile with pinned TypeScript
7.0.2, and the same database/lifecycle suite passes 10 tests with zero skips.
Corrected SQL/Compose CI, certificate issuance, GitHub App onboarding
and first-review acceptance remain pending. Attach the combined corrected commit,
final exact-head CI and durable target evidence before claiming completion.

The corrected candidate also writes the registration bundle through the API
runtime user, preserving private ownership and mode `0600`; the disposable E2E
checks its owner, bytes, permissions and cleanup in the real container. Imported
App credentials and installation state must remain outside the Docker build
context. The guided prompt releases terminal input before foreground child
commands, and the documented bootstrap executes only a successfully downloaded
script. Scoped ESLint passes without rule suppressions.

Catalog reference: PostgreSQL 18 [pg_authid](https://www.postgresql.org/docs/18/catalog-pg-authid.html)
and [pg_db_role_setting](https://www.postgresql.org/docs/18/catalog-pg-db-role-setting.html).

## Retry, partial completion, and rollback

Resume only with the saved installation directory, private environment,
credentials, source identity and Compose project. The database helper verifies
its existing role instead of rotating its secret or broadening permissions.
Configuration, role or release mismatches require inspection; do not recreate
the project, bypass the check or substitute fixture evidence to obtain success.

If installation stops after services or the GitHub App exist, retain their
identities and reconcile the completed step before retrying. Preserve database
volumes, Memory state, signing keys, App credentials and release receipts. Do not
use `docker compose down -v`, drop roles, delete data or replay unknown provider
effects as rollback. Stop only this installation's services when needed and use
the existing upgrade/recovery runbook for an installed deployment; this wizard is
not a general upgrade or database-restore tool.

## Related links

- [Guided installation and prerequisites](../../docs/operations/review-router-self-hosted-end-to-end.md#guided-installation)
- [Installer](../../deploy/self-hosted/install.ts), [configuration](../../deploy/self-hosted/install-config.ts), [database preparation](../../deploy/self-hosted/install-database.ts), [release verification](../../deploy/self-hosted/install-release.ts)
- [Self-hosted Compose reference](../../deploy/self-hosted/README.md)
- [Operator CLI](../../apps/api/src/review-action-v2-operator-cli.ts)
- [Disposable acceptance runner](../../scripts/run-self-hosted-e2e.mjs)
- [Capabilities and runtime scope](../../docs/capabilities.md)
- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)          | Target                      | Operator            | Actual version / image                                        | Step and observed result                                                                           | Evidence                                                                                                                      | Next action                                                |
| ------------------- | --------------------------- | ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 2026-11-07          | Local source candidate      | Implementation task | Uncommitted branch above                                      | Focused types, contracts, CLI concurrency tests and formatting passed                              | Commands above; no target receipt                                                                                             | Attach candidate commit/PR and run required CI.            |
| 2026-11-07 10:44:29 | Disposable self-hosted CI   | GitHub Actions      | `0c5af53f13ea6be1ccd4f8041c8bdd532dbc74c4`                    | First role-preparation SQL failed on nonexistent `pg_authid.rolconfig`; no successful installation | [Run 42364819517 / job 128380549445](https://github.com/777genius/review-router-ai/actions/runs/42364819517/job/128380549445) | Commit the catalog correction and run its exact-source CI. |
| 2026-11-07          | Local correction            | Implementation task | Working tree after `0c5af53f13ea6be1ccd4f8041c8bdd532dbc74c4` | Catalog query corrected; actual SQL regression added for three role-setting scopes                 | PR #822 source; no corrected CI receipt yet                                                                                   | Attach the combined corrected commit and observed result.  |
| Not executed        | Self-hosted test host       | Unassigned          | Not verified                                                  | No Docker/HTTPS/App/live-review result claimed                                                     | None                                                                                                                          | Perform authorized target acceptance.                      |
| Not executed        | Hosted staging / production | Unassigned          | Baseline retained                                             | No rollout or flag change performed                                                                | Existing registry remains authoritative                                                                                       | No hosted action is part of this task.                     |
