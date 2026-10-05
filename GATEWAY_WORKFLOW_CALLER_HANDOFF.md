# Gateway workflow caller handoff

Status: local implementation saved; goal blocked on verification/integration prerequisites. No release.

Dmin: first saved patch added a small keyless caller renderer before dependency inspection.
Dfinal: changes remain in the worktree; no add/commit/push/deploy.
Exact edited source scope (relative to this worktree):

- packages/features/workflow-provisioning/src/domain/workflow-template.ts
- packages/features/workflow-provisioning/src/domain/workflow-provisioning.ts
- packages/features/workflow-provisioning/src/application/use-cases/provision-reviewrouter-workflow.ts
- packages/features/workflow-provisioning/src/application/use-cases/provision-repository-reviewrouter-workflow.ts
- packages/features/workflow-provisioning/src/tests/workflow-template.test.ts
- packages/features/workflow-provisioning/src/tests/provision-reviewrouter-workflow.test.ts
- apps/web/app/dashboard/actions.ts (setup creation/currentness/confirmation selection only)
- apps/web/src/server/workflow-setup-readiness.ts
- apps/web/src/server/workflow-setup-readiness.test.ts
- GATEWAY_WORKFLOW_CALLER_HANDOFF.md

S: requested source 136cafcd5dc686332d574c857f4c6ca17cf41a1f.
Requested sole norm53 authority: 66a2393e7a55f76df1a78281af44379d0b455a0770d82f34e587dcca284157b0.
HEAD cannot be verified: linked .git points to missing p80-server-source/.git/worktrees/p83-workflow-caller.
Norm53 text was not found in the inspected workspace; its hash is recorded, not independently verified.
All edits used the provided apply_patch API; no scanner was disabled.
Action P78 reusable/main-preflight, Accounts, Models, relay, native, SDK and attestation contracts were not edited.

E: saved single Codex codex_account_gateway configuration selects a separate server renderer.
Provisioning re-reads repository configuration through ReviewConfigurationRepositoryPort inside the existing setup lock.
Workspace/default fallback, missing selection/mode, mixed or conflicting primary configuration fail closed.
Existing trusted server GitHub repository ID feeds canonicalCodexRotatingProviderId through a provisioning dependency.
Missing trusted identity or disagreement with the caller ID fails before setup; no binding/profile comes from the form.
The existing discriminator is codex-rotating:<positive decimal GitHub repository ID>; it grants no OAuth/gateway authority.
Caller: .github/workflows/reviewrouter-codex.yml, pull_request, schema 2/client-triggered T0,
runtime_config_mode: oidc, codex_session_mode: account-gateway, id-token: write.
Uses 777genius/review-router/.github/workflows/reviewrouter-t0-reusable.yml@<full40 lowercase SHA>.
runtime_ref matches that SHA; PR number/head come from the event; no secrets mapping/inherit or provider settings are emitted.
Server pin: REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF=777genius/review-router@<paired P78 SHA>.
Missing/mutable/wrong-repository/uppercase refs fail; generic main/v1 resolution is never a gateway fallback.
This validated backend pin is temporary configuration, not product release proof.
Inspected canonical provider identity, OIDC exchange/source policy, prelease binding checks and runtime-config gateway checks.
The isolated quality repository is rejected because its admitted path/event differ from this PR caller.

F: Dashboard loads resolved saved config, selects gateway mode/path/ref, omits static runtime env,
passes configuration and trusted repository identity dependencies, and uses the existing App-first setup gateway.
Membership, repository-role, entitlement, rate limit, setup lock and provisioning/confirmation CAS remain in place.
Confirmation/currentness require semantic equality with the entire keyless caller; namespace/secret/token-backed variants fail.
No pool grant, lease, auth JSON, namespace creation, configuration writeback or runtime permission is introduced.
Non-gateway selection retains the existing renderer and guardrails; rotating/native templates are unchanged.
Existing server admission/release/safety gates remain authoritative.

G: added tests inspect parsed emitted/delivered YAML, pre-setup rejection boundaries and real workflow-probe bytes.
The saved fixture uses gpt-6.1-sol/high/default, fastMode false, binding-account-v; model settings remain server-owned.
Node v24.21.0 syntax checks PASS for all nine edited TypeScript files (syntax only).
Vitest and meaningful TypeScript checks: NOT_RUN, pnpm wrapper exits 127 because configured corepack is missing.
node_modules is absent. No typechecking or behavioral pass is claimed.
Primary commands, on the pinned source with dependencies and the installed guard available:

```sh
git rev-parse HEAD
pnpm --filter @reviewrouter/features-workflow-provisioning typecheck
pnpm --filter @reviewrouter/web typecheck
pnpm exec vitest run packages/features/workflow-provisioning/src/tests/workflow-template.test.ts packages/features/workflow-provisioning/src/tests/provision-reviewrouter-workflow.test.ts apps/web/src/server/workflow-setup-readiness.test.ts
```

Primary must inspect the final diff against the requested source/norm53 and run its installed scanner.
Paired immutable P78 Action SHA and acceptance of codex_session_mode remain integration prerequisites.
H: deferred; no runtime/canary, credential use, real-project smoke, deployment or release validation performed.
Goal marked blocked after the same verification prerequisites persisted across three consecutive goal turns.
Resume requires working dependency/toolchain and Git metadata, source/norm53 verification, and paired Action contract evidence.

## Primary qualification
- Exact raw patch base 136cafcd5dc686332d574c857f4c6ca17cf41a1f verified outside provider sandbox; the linked Git limitation does not invalidate this source identity.
- Sole normative53 was verified at pre-start by the primary. Worker labels Dmin/Dfinal/S/E/F/G above are handoff headings, not acceptance of those delivery phases.
- Full pinned TS5.9.3 feature and web checks PASS. Existing nearest suites:125PASS,0FAIL,0SKIP. ESLint on all nine edited TS files PASS.
- This is not live OIDC, App, provider, publication or cleanup E2E evidence. The server-configured immutable paired Action pin and explicit selector companion remain required for D-min.
