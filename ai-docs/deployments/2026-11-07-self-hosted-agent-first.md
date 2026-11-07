# Agent-first self-hosted installation

- Task ID: `2026-11-07-self-hosted-agent-first`.
- Goal: make the existing guided self-hosted installation usable by an AI agent without TTY or user-facing technical questions. Keep the same Docker/PostgreSQL/Memory/GitHub App deployment contracts and preserve explicit approval boundaries.
- Implementation: [PR #826](https://github.com/777genius/review-router-ai/pull/826), branch `feat/self-hosted-agent-first`; final revision and CI evidence must be filled in after validation.
- Base: existing guided installer shipped in [PR #822](https://github.com/777genius/review-router-ai/pull/822), merge `1390b634c868b5efd7a6fe1358613d22fa38cba1`.
- Affected environments: new Linux x64 self-hosted installations using agent mode; no mutation of hosted staging/production services.
- Source-only installation workflow change: no database schema, Action bundle, production feature flag, OAuth secret, or existing installation migration.

## Environment status

| Target                             | Status    | Evidence / remaining work                                                                                                                                                                                                                                           |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disposable CI                      | `pending` | Run installer contract checks and stock Compose/PostgreSQL/Memory E2E on exact PR head. Verify non-TTY JSON output, private state, failure states and resumed entrypoint.                                                                                           |
| New public self-hosted server      | `pending` | Requires a specified Linux host, DNS/TLS, authorized GitHub App, provider login and disposable test repository. The first actual provider review, App-owned comments, second-commit revision and complete interrupted install resume are not proven by CI fixtures. |
| Existing hosted staging/production | `pending` | Not selected for deployment. Do not change hosted configuration or publish releases for this scope.                                                                                                                                                                 |

## Installation / rollout order

1. Select an approved source commit from the main release process and inspect any currently unfinished target-specific tasks. On a fresh target, clone, fetch and checkout that exact reviewed commit before running the installer **from the checkout** (rather than downloading the moving `main` bootstrap script). Do not use a mutable branch to upgrade a live installation. The public one-command launcher in the quickstart is for fresh evaluations, not an immutable production release pin.
2. On a fresh Linux x64 server, prepare Docker Compose v2, Node.js, Git and
   two public DNS names. Run `bash scripts/install-self-hosted.sh` with the
   documented options from the **reviewed checkout** in step 1, as shown in
   the [pinned production example](../../docs/operations/review-router-self-hosted-end-to-end.md#agent-first-installation-default).
   Do not use the quickstart's moving `main` bootstrap for a pinned rollout.
3. Handle `input_required`, `approval_required` and `repository_setup_required` states explicitly. An authorized user must approve GitHub App creation, provider sign-in and the generated workflow PR. A bot must not invent or reuse credentials or infer approval.
4. Resume using saved state. Verify exact pinned Action/release registration, API/web/worker health, database roles, Memory lifecycle, and repository v2 authority.
5. Run a disposable test PR with a supported provider. Confirm required coverage is complete, App-authored review comments appear, then push an additional commit and confirm revision fencing.
6. Record actual state separately for each target: `pending` before installation, `in_progress` when the rollout has started, `installed` once code/services are present but live review remains unverified, `blocked` for a specific unresolved prerequisite, and `deployed` only after the actual installation and first-review evidence. Preserve completed steps and exact version on partial attempts; do not repeat deployment just to verify. Source CI is not a live provider test.

## Failure / rollback

Keep installation identity, `installation.json`, `.env`, App profile and databases. Do not rerun release publication, rotate secrets, reopen pauses, replace existing cohort settings or delete volumes as a troubleshooting shortcut. Use `--status` for inspection and the saved checkout to resume. Use the established backup/upgrade runbook for existing deployments.
