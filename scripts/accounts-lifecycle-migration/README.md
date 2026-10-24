# Account lifecycle migration qualification

Migration 000134 extends the existing operation ledger and source reservation. It retains all historical IDs, owner constraints, legacy operation guards and binding ACK rules. `originalOperationId` is the immutable Gateway command ID (equal to ledger ID); `gatewayOperationRef` on a source still identifies its previous applied command while a new command is pending.

New writes are gated only by the remote Gateway lifecycle capability (`writeGate: enabled`); there is no local feature flag. Legacy `disabled` rows are not changed to `suspended` and stay terminal for lifecycle writes.

Run the standard feature `test:postgres` against a fresh, explicitly disposable cluster to exercise the full migration chain and existing tests. `tests/lifecycle-migrated.test.mts` is an additional guarded runner for the dedicated already migrated TEST database on loopback port 55644; it runs actual adapter races, no-effect recovery, more than 100 grants, revocation preservation, owner-scope NULL/adversarial SQL and permanent delete denial.

`rehearse-preserved.mts` applies only migration 000134 to the exact retained TEST fixture `rr_gateway_test_c2c_accounts` in `rr-accounts-reference-pg-20261019`. It requires explicit TEST mode and the SHA256 of migration bytes already qualified on the fresh cluster. It refuses an existing receipt, records all old rows before the effect, and compares every old field after the effect. It requires the retained baseline counts of 3 users, 3 sources and 10 operations. It never resets a database or changes cluster roles. Typecheck it with `pnpm exec tsc --noEmit -p scripts/accounts-lifecycle-migration/tsconfig.json`.

The database validates immutable owner scope on every operation and the original actor's live org-admin authority at reservation. The advancing caller can be a different current admin: the Prisma adapter checks and locks that caller's live membership before the source. No per-request actor identity is assumed to exist on the shared SQL connection.

The winning claim additionally owns an in-process random UUID capability. It is consumed synchronously before Gateway ingress and is never exposed in operation receipts. Only that unconsumed capability can release its exact submitted row back to fencing after authorization loss; cleanup preserves source denial, revisions and ACKs. Restart or another store instance cannot manufacture this positive non-entry evidence. Ordinary reads, claims and entry still require live ownership authority.
