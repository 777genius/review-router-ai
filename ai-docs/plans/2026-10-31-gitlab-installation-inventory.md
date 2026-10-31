# GitLab inventory transactional ownership

Date: 2026-10-31
Baseline: `e0fb3391f69cb69941b8a72233a120dcd4fcbf29`
Status: draft implementation.

## Proven failure
`apps/web/src/server/gitlab-connect.ts` upserts a GitLabInstallation, deselects previous repositories, then loops separate RepositoryConnection upserts. Any exception leaves a partially installed/deselected inventory. Its unique `provider_externalRepositoryId_sourceBaseUrl` update writes `workspaceId`, letting a second workspace silently take over a previously assigned repository.

## Bounded contract
- Network discovery/provisioning remains outside DB transactions; it is not reversible.
- Move only persistence into a Web-owned Prisma inventory adapter. Apply installation summary, deselections and successful project updates inside one short ReadCommitted transaction with a per-installation advisory transaction lock.
- Never write `workspaceId` in a repository update. Check an existing global project owner and fail closed on another workspace; preserve current owner for same-workspace refresh.
- Ensure selected-project list is a valid discoverable subset and bound to successful provisioning. Unknown IDs must not silently descope installed projects.
- Prevent a concurrently completed older install from overwriting a newer completed install where supported by installation timing; use existing `lastInstalledAt` and explain clock/ordering limitations; no schema change.
- Preserve existing external GitLab provisioning semantics, statuses and CAS; do not invent recovery, reconciliation, or a generic ORM abstraction.

## Qualification
Inject failure after installation upsert, after deselection and in middle of upserts; verify rollback. Check same-workspace reinstallation, different-workspace collision, concurrent same-install commits, supersession, server-only token discipline and route sanitization. Run real PostgreSQL fixture when available plus focused unit, native typecheck, architecture, CI and independent security/reliability review; fix all concrete findings before merge.

## Rollout
Ordinary coherent Web code rollout. No new migration/flag. Register environment task. Do not claim staging/production deployed from CI.