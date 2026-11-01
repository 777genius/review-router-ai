# Memory bootstrap cleanup inventory

Implementation: [PR #780](https://github.com/777genius/review-router-ai/pull/780).
Affected component: standalone native Memory cleanup operator. No application
fleet rollout, migrations, database grants, native image change, restart-policy
change or conversation-learning activation is introduced by this patch.

| Environment | Status    | Remaining work                                                                                                         |
| ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| production  | `pending` | Deliver reviewed operator source and verify both task-owned Forget commands through signed physical cleanup.           |
| self-hosted | `pending` | Include updated operator and its new helper in the next installation/update; verify a bootstrap-produced cleanup plan. |

The bundled bootstrap gives PostgreSQL the same deployment label as API/worker.
The previous operator treated every matching label as a native executor and
refused that legitimate PostgreSQL before effects. It also capped the complete
Docker census at512, while a read-only production count found615 distinct
containers. No foreign containers were removed to fit that bound.

The optional explicit `postgresInfrastructure` plan binding attests the saved
PostgreSQL ID, resolved immutable image ID and loopback port. Its bootstrap
command/entrypoint, PostgreSQL17 environment, standalone network/restart policy
and continuously unchanged process lifetime are checked at every phase. Only
that exact infrastructure container is excluded from executor lifecycle actions.
Unknown same-label containers, every matching native image and every writer of
the inspected API database remain in the complete census. One shared1024-record
limit preserves a finite bound;1025 refuses. Existing plans without the binding
retain their strict behavior. Receipt/profile/authority checks are unchanged.

Local strict TypeScript7, erasable-syntax checks, lint and formatting pass. Nine
runtime-profile and20 supported host/profile tests cover exact PostgreSQL,
identity/role/image/port drift, restart drift, unknown writers and1024/1025
boundaries. The existing Linux flock test is not skipped in source or CI; local
macOS execution cannot replace its Linux qualification. A read-only production
collector passed under the real Linux flock:616 containers were inspected in
8.565s, exactly two running native executors were identified, and the exact saved
PostgreSQL container was attested separately. Helper SHA256
`fca466957b6a15a5dd82a976e3d9311b225a632475e5e2926a7bedd85ad87704`;
protected source/result are retained in
`/srv/workers/TEST-reviewrouter-memory-cleanup-inventory-20261101`. This does not
establish deletion, restart or signed-receipt acceptance.

Before use, require current-head technical review and mandatory CI. Stage the
exact source with all imported helpers in an owned private operator checkout;
verify hashes before execution. Derive the PostgreSQL plan binding from existing
verified bootstrap state/configuration, never arbitrary caller exclusion data.
Preserve the current native image, models, data/cache volumes, credentials,
provenance, namespace and generation. No new native executors may coexist on this
host during the production physical Forget test.

After the main memory-delivery canary settles, issue normal Forget commands for
only the two task-owned test entries. Obtain the real current maintenance epoch,
pause through the supported drain barrier, fetch each stored command binding,
and run cleanup sequentially under the same deployment lock. Immediately submit
each fresh signed receipt to its own command; require both commands completed
before unpausing with the current epoch. Preserve signed inventories and receipts.
Do not infer success from read-only inventory or ordinary native health checks.

After a partial/ambiguous cleanup, retain the pause, original command identities
and signed source inventory. Reconcile the exact existing state before any
supported continuation. Do not create replacement commands, restore forgotten
text, delete a volume, fabricate receipts or fall back to the incompatible old
operator after effects. Before effects, the old operator remains a conservative
refusal path and cannot close this task.

Completed stopped-deployment recovery after a host reboot remains a separate
unimplemented limitation. This patch adds no unattended reconciler and does not
claim that an unpaused maintenance flag proves absence of cleanup debt.
