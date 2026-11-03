# Installed Gateway operator onboarding: deployment

## Current disposition - 2026-11-03

Production code: **deployed** in verified release227 (`dbc161c986`, image `89a28e11`).
Required Payments17/17, App publication and new Statistics are verified;
the optional description retains its unknown outcome/usage.
See the [current decision](2026-11-03-production-status-reconciliation.md) and
[release227 evidence](evidence/2026-11-03-capacity128-release227.json). Older
pending/not-executed entries are historical; owner-waived legacy recovery is not
a redeployment prerequisite. Staging remains unverified.

- Task ID: `2026-11-02-installed-gateway-operator-onboarding`.
- Goal: finish an already installed compatible Gateway workflow without a browser login, using genuine operator authorization scoped to its owner, workspace and repository.
- Affected services: API and shared Web provisioning composition; ordinary application rollout.
- Implementation: [PR #792](https://github.com/777genius/review-router-ai/pull/792), [issue #790](https://github.com/777genius/review-router-ai/issues/790).
- Implementation reference: `74553d37f0a0c833c08affbee725a1f5a72d3802` (production code), with fixture qualification at `2688f96079314ad795b988bcb86d61a129187a8b`; stacked on [#787](https://github.com/777genius/review-router-ai/pull/787), not released.
- Dependencies: [Analytics/review reliability](2026-11-02-analytics-review-reliability.md); the installed workflow, current owner entitlement and approved producer must pass normal provisioning guards.
- Last updated: `2026-11-03`.

## Environment status

| Environment / target | Status     | Actual deployed version / image             | Last verified (UTC) | Evidence / next step                                       |
| -------------------- | ---------- | ------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| staging              | `pending`  | Not verified                                | Not verified        | Ordinary release qualification; no new migration required. |
| production / Hetzner | `deployed` | `dbc161c986` / `v1.0.227`, image `89a28e11` | 2026-11-03          | See current disposition; no repeat code rollout.           |

## Applicability and authorization

The observed payments-sdk failures occur before a provider call: its compatible installed workflow has no mutation authority, core5 policy or confirmed provisioning row. Changing its model cannot repair that failure.

This implementation adds no session impersonation, browser cookie fabrication, direct authority-row writes, database grant, feature flag, migration or provider credential change. The existing configuration operator credential establishes identity; a separate strict server-owned permission manifest grants this operation. Missing permission defaults to deny. Current OWNER membership or personal ownership, coherent external identity, entitlement, repository installation, SCM binding version, policy, provider binding and exact workflow are rechecked before writes. Audit records identify the real operator and delegated owner.

## Ordered rollout

1. Qualify the final source with strict API/feature checks, security/contract review, the compiled CLI transport case, and the production factory against a fresh PostgreSQL 17 database under canonical nonowner API grants. Keep the isolated fixture and receipts separate from production.
2. Follow the [release process](../operations/07-environments-and-release-management.md). Deploy the coherent application batch through the existing release owner. This slice needs no schema change or public Action release.
3. Before enabling the operator route, explicitly provide the API role with `REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF` matching the independently approved Web Gateway producer at each supported release phase (225 for initial target startup; verified 226 for final adoption). The old API Docker/initial environment lacked this previously Web-only setting; runtime dotenv changes were not proven. Validate the actual resolved target through the normal controller and preserve all other refs, credentials and registry rows. The existing registration wrapper requires the target API running, so retain initial startup/readback, then normal materialization and final 226 ref/readback before ABI and previous-SHA CAS channel promotion; do not collapse these phases or gate ordinary review promotion on semantic-memory qualification. Then configure `REVIEW_ROUTER_WORKFLOW_PROVISIONING_OPERATOR_GRANTS_JSON` for only operator `reviewrouter-operator`, permission `confirm_installed_gateway_workflow`, GitHub owner `13103045`, workspace `cmoss4xkf000228sbtcmpdjb5`, repository ID `cmvfmd8z800ks16nxls6z3lkp`. Do not add wildcard grants, rotate keys or expand repository access. Preserve other environment settings and compare the current configuration before applying.
4. Using the existing protected operator profile, run the reviewed `repositories confirm-installed` command once for `agent-teams-ai/payments-sdk`, with exact workspace/repository confirmation. Verify the audit, configured WorkflowProvisioning row, active mutation authority and repository core5 policy through normal readers. The legacy RepositoryConnection.setupStatus is not this readiness contract.
5. After the shared model-call window is released, submit one fresh normal review event and verify its real authorization, App-authored result, Usage accounting and eligible Statistics capture. Do not replay old failed history to claim success.

## Retry, partial completion and rollback

Before any retry, inspect the original operation audit and canonical authority/core5/setup state. Provisioning uses existing proof and compare-and-swap commands; an uncertain response does not justify blind repetition. A partial operation retains its real audit/state for reconciliation and never falsely reports configured. Preserve the shared stand, test repositories, data and all receipts. Permission removal disables this operator route; application rollback follows the release guide and must preserve existing authority and admitted runs.

## Execution log

- 2026-11-02: protected existing operator identity qualified without exposing its secret. First immutable 17-file snapshot passed strict API/feature checks and 74 focused cases; one compiled CLI case explicitly skipped pending build. Final 19-file snapshot plus the exact protocol-fixture metadata entry passed API/feature/Web strict checks, all 86 focused tests with zero skipped (including the real compiled CLI), architecture boundaries and diff checks. The PostgreSQL runner stopped before invoking the fixture because of Docker metadata handling; its owned container is stopped, and its data and original failure receipt are retained. Subsequent cold runs exposed two fixture errors: nested policy version creation and an ignored version-zero CAS conflict against the migration-seeded version-one global emergency stop. Only fixture preparation and finite failure diagnostics changed; production guards were preserved. Final corrected fixture SHA-256 `dfd416c85d4177c7b54d3172389a0a4d9a6cb5e9b477e589dc25690fda970cc0` passed the real PostgreSQL 17.11 API-role test: ordinary nonowner/nonsuperuser/non-bypass login created and restored authority/core5/setup through normal commands and retained audit. The final PG-only job `98c7dccc96221e80f274e8b03bb225b2` passed 1/1 with zero skipped. Evidence: [sanitized qualification summary](#qualification-evidence). All owned temporary clusters are stopped with data and prior failure evidence preserved. Successful unrelated checks were not rerun. No production mutation, deployment or model call performed by this slice.

## Qualification evidence

This checked-in summary records the isolated server results without exposing credentials, database contents or private logs. It establishes source qualification only; the environment table above remains unverified.

| Evidence                                                                                                               | Exact scope                                                                                                                           | Result                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server source qualification                                                                                            | Production implementation `74553d37f0a0c833c08affbee725a1f5a72d3802`; corrected PG fixture `2688f96079314ad795b988bcb86d61a129187a8b` | API/feature/Web strict checks and all 86 focused tests passed, zero skipped, including compiled CLI transport.                                                                    |
| Cold PostgreSQL 17.11                                                                                                  | Ordinary nonowner, nonsuperuser, non-bypass API login; normal authority/core5/setup commands                                          | 1/1 passed, zero skipped; created and idempotently restored authority/core5/setup with audit. Fixture SHA-256 `dfd416c85d4177c7b54d3172389a0a4d9a6cb5e9b477e589dc25690fda970cc0`. |
| [GitHub CI for integration source `ddfe9277d`](https://github.com/777genius/review-router-ai/actions/runs/41509830690) | Published source-check record                                                                                                         | Quality Gates passed; ordinary heavy jobs were skipped. This run is not the original server qualification or full final-batch CI.                                                 |

Supplemental private provenance for the PostgreSQL result: runner job `98c7dccc96221e80f274e8b03bb225b2`, receipt `/srv/workers/rr-operator790-20261102-165027/qualification-pg17-safety1/receipt.json`. The original private receipt is retained; no publicly downloadable receipt artifact is asserted.

Known availability limitation: runtime-channel guards currently read the public runtime commit without an authenticated repository credential. A public API quota refusal blocks confirmation safely as `installed_gateway_upstream_unavailable`. Do not substitute an installation credential without proving access to the runtime repository, or cache away the tag-drift checks. CLI transport and unknown API failures retain the fixed generic confirmation diagnostic; finite endpoint-code diagnostics are a separate improvement.

## Production R1 /226 — 2026-11-03

The [shared R1 release and environment evidence](evidence/2026-11-03-memory-production-r1-226.json) records official application source `6e6a0f078`, image
`0114caaa…`, all four running roles with zero restarts, and verified 226 producer/channel adoption.

Only the documented payments repository operator permission was installed. Normal protected CLI reports READY/CREATED authority1/epoch1 with approved fa3 producer. Review B 41583013357 completed full coverage (1/1), snapshot_committed, genuine App summary 6596139524 and successful check 125743333142; its processed Statistics fact adds zero new issues. One A lineage/source/caughtAt remains unchanged; the prior issue is NOT VERIFIED, not resolved. Payments 41581736184 is PARTIAL 0/17 despite 32 complete requests and 508,896 tokens; source/CLI readiness does not substitute for full review acceptance. No wildcard permission or browser/session impersonation was used.

Staging remains unchanged and unverified by this production batch.

Payments API returned HTTP 400 `model_dispatch_request_invalid` at 05:20:45 UTC.
The frozen Gateway allowance is 640 requests while installed dispatch allows 32.
Ordinal 33 is a source/count explanation, not an observed request body. A
versioned 128-request successor is source-only in the neighboring workstream;
immutable 226 producer `fa3e87a71…` is unchanged. A fresh normal payments run
after that successor is pending; the old run is not replayed or relabelled.
