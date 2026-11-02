# Installed Gateway operator onboarding: deployment

- Task ID: `2026-11-02-installed-gateway-operator-onboarding`.
- Goal: finish an already installed compatible Gateway workflow without a browser login, using genuine operator authorization scoped to its owner, workspace and repository.
- Affected services: API and shared Web provisioning composition; ordinary application rollout.
- Implementation issue: [#790](https://github.com/777genius/review-router-ai/issues/790).
- Implementation reference: branch `fix/operator-installed-gateway-setup-20261102`, stacked on [#787](https://github.com/777genius/review-router-ai/pull/787); not released.
- Dependencies: [Analytics/review reliability](2026-11-02-analytics-review-reliability.md); the installed workflow, current owner entitlement and approved producer must pass normal provisioning guards.
- Last updated: `2026-11-02`.

## Environment status

| Environment / target          | Status        | Actual deployed version / image       | Evidence / next step                                                                                                                     |
| ----------------------------- | ------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated server qualification | `in_progress` | Frozen source snapshot; no deployment | API/feature/Web strict typechecks and all86 focused tests including compiled CLI passed; cold PostgreSQL API-role qualification pending. |
| staging                       | `pending`     | Not verified                          | Ordinary release qualification; no new migration required.                                                                               |
| production / Hetzner          | `pending`     | Baseline `57cc15137`                  | Coordinate with the single shared release owner; never start a competing deployment.                                                     |

## Applicability and authorization

The observed payments-sdk failures occur before a provider call: its compatible installed workflow has no mutation authority, core5 policy or confirmed provisioning row. Changing its model cannot repair that failure.

This implementation adds no session impersonation, browser cookie fabrication, direct authority-row writes, database grant, feature flag, migration or provider credential change. The existing configuration operator credential establishes identity; a separate strict server-owned permission manifest grants this operation. Missing permission defaults to deny. Current OWNER membership or personal ownership, coherent external identity, entitlement, repository installation, SCM binding version, policy, provider binding and exact workflow are rechecked before writes. Audit records identify the real operator and delegated owner.

## Ordered rollout

1. Qualify the final source with strict API/feature checks, security/contract review, the compiled CLI transport case, and the production factory against a fresh PostgreSQL17 database under canonical nonowner API grants. Keep the isolated fixture and receipts separate from production.
2. Follow the [release process](../operations/07-environments-and-release-management.md). Deploy the coherent application batch through the existing release owner. This slice needs no schema change or public Action release.
3. Configure `REVIEW_ROUTER_WORKFLOW_PROVISIONING_OPERATOR_GRANTS_JSON` for only operator `reviewrouter-operator`, permission `confirm_installed_gateway_workflow`, GitHub owner `13103045`, workspace `cmoss4xkf000228sbtcmpdjb5`, repository ID `cmvfmd8z800ks16nxls6z3lkp`. Do not add wildcard grants, rotate keys or expand repository access. Preserve other environment settings and compare the current configuration before applying.
4. Using the existing protected operator profile, run the reviewed `repositories confirm-installed` command once for `agent-teams-ai/payments-sdk`, with exact workspace/repository confirmation. Verify the audit, configured WorkflowProvisioning row, active mutation authority and repository core5 policy through normal readers. The legacy RepositoryConnection.setupStatus is not this readiness contract.
5. After the shared model-call window is released, submit one fresh normal review event and verify its real authorization, App-authored result, Usage accounting and eligible Statistics capture. Do not replay old failed history to claim success.

## Retry, partial completion and rollback

Before any retry, inspect the original operation audit and canonical authority/core5/setup state. Provisioning uses existing proof and compare-and-swap commands; an uncertain response does not justify blind repetition. A partial operation retains its real audit/state for reconciliation and never falsely reports configured. Preserve the shared stand, test repositories, data and all receipts. Permission removal disables this operator route; application rollback follows the release guide and must preserve existing authority and admitted runs.

## Execution log

- 2026-11-02: protected existing operator identity qualified without exposing its secret. First immutable 17-file snapshot passed strict API/feature checks and 74 focused cases; one compiled CLI case explicitly skipped pending build. Final 19-file snapshot plus the exact protocol-fixture metadata entry passed API/feature/Web strict checks, all86 focused tests with zero skipped (including the real compiled CLI), architecture boundaries and diff checks. The PostgreSQL runner stopped before invoking the fixture because of Docker metadata handling; its stopped owned container/data and original failure receipt are retained. Only the unexecuted PostgreSQL phase will resume after correcting that runner. No production mutation, deployment or model call performed by this slice.
