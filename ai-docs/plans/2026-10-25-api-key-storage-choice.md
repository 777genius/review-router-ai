# API key storage choice for OpenRouter, MiMo and Kimi Code

## Goal and current evidence

Give each of these providers the same concise choice after provider selection:

- **GitHub Secrets** — Add the key to each repository on GitHub.
- **ReviewRouter** — Store the key encrypted and reuse it across repositories.

The user requested research, a reviewed plan, implementation, controlled E2E and
visual verification, prompt commit/push checkpoints, PR review and merge. A
production deployment is not required. This plan changes the product in
`777genius/review-router-ai` and its public Action companion
`777genius/review-router`; it does not create a new credential service.

Research started at control-plane `8ba1db2e24a7f93d92a367a3e32e4f3be86aacf6`.
Implementation starts at `ded3fdfe8d948dd0f464c0744ffeb8121762bbc9`, which includes
the just-merged #706 exact-account model fixes. Public runtime inspected:
`3989b2849ac21d2d8d376233f4cc0c3436b44f59`. Gateway inspected:
`75f75c8397f7d3ceb2d5ff2b5c591de4a4b6bbe9`.

The relevant current distinctions are:

| Credential kind   | Actual behavior                                                 | Treatment                                                               |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `gateway_binding` | Encrypted connected account; execution through Gateway          | New ReviewRouter choice                                                 |
| `user_ci_secret`  | User installs a named repository secret                         | New GitHub Secrets choice                                               |
| `managed_api_key` | ReviewRouter stores ciphertext and installs the key into GitHub | Preserve compatibility; label as GitHub Secrets managed by ReviewRouter |

All normal provider add/default/repository/bulk entrypoints already use
`ProviderSetupDialog`. Account connection and key update already use shared
`AccountGatewayControls` forms. Provider credential identity is intentionally
immutable in application code and PostgreSQL. Account Gateway already supports
all three requested upstream providers; no new encryption is needed.

OpenRouter direct runtime support exists, but workspace profiles exclude its
`user_ci_secret` source. Kimi has no direct runtime mode. MiMo's older direct
workflow does not establish the current captured App-first review contract.
Therefore the complete change must qualify all three through the current
single-provider `provider_api` path, preserving the approved Codex engine.

## Scope and boundaries

1. Reuse existing provider profiles, account enrollment, workspace authorization,
   policy CAS, OIDC, exact runtime admission and GitHub App publication.
2. Add one shared product-level storage model/component and concise copy. Do not
   add a persisted storage column, another account cache or a second key vault.
3. Extend the existing direct provider-API route with a finite descriptor for
   OpenRouter, MiMo and Kimi Code. No arbitrary endpoint or model fallback.
4. Preserve existing managed-key identity, ciphertext, key installation, rotation
   and readable policy/profile bytes; new ReviewRouter custody always means Gateway.
   Stop offering legacy `managed_api_key` creation in the new unified choices;
   compatibility installation and rotation remain available for existing profiles.
5. Preserve unrelated Codex, Claude, hosted-pool, memory, Skills, publication and
   release behavior. No general dashboard rewrite or bulk credential migration.
6. Preserve current Gateway profile enablement, exact account model authority,
   owner/sharing decisions and capability checks. Kimi means the existing Kimi
   Code plan, not the separate Moonshot pay-as-you-go API.
7. No production deploy, credential extraction, producer activation, release-tag
   promotion or changes to shared Hetzner infrastructure are part of this work.

## Implementation design

### A. Shared UI and provider identity

Use `ApiKeyProviderId = "openrouter" | "mimo" | "kimi"` and
`ApiKeyStorage = "github_secrets" | "reviewrouter"` as presentation types.
Map them to existing canonical credential requests; derive the displayed storage
from the credential kind. Keep domain/runtime identity distinct from UI names.

Add one `ApiKeyStorageChoice` with the existing radio primitives in the provider
setup feature. Reuse its option copy and read-only summary in provider Add/Edit
and API-key account Connect/Update. Keep the control shallow and keyboard
accessible; no nested cards or dialogs.

In Provider Add, select the provider first, then storage. GitHub mode selects
`user_ci_secret` and reuses `CiSecretDelivery`; it never submits the raw key to
ReviewRouter. ReviewRouter mode selects a matching authorized ready Gateway
binding and the account-specific model catalog. If no matching account exists,
continue to the existing Accounts connection flow with the provider intent.
Do not expose unrelated Gateway accounts under the selected provider.

In Accounts Connect, ReviewRouter keeps existing API-key ingress and operation
readback. GitHub mode offers one continuation to the existing Providers Add flow
with validated provider/storage intent. Close the account dialog before navigation.
Do not put keys, account identifiers or other authority in URL intent parameters.
Consume the intent once; retain workspace/repository context where available.
Pass the selected `workspaceId` through the personal-account control wrappers,
which currently omit it. Preserve the existing fixed repository/bulk target
when a continuation originates there; never fall back silently to another
workspace. Carry safe upstream provider/profile identity in provider read models
for replacement links; never infer it from redacted account names or labels.

The continuation is a small validated view-state contract: provider/storage hints,
the selected workspace and optional fixed repository/bounded bulk targets. Use
allowlisted internal Accounts/Providers destinations, not an arbitrary `returnTo`.
Reauthorize all targets on return. Enrollment does not assign a provider. A new
personal connection may still require the existing workspace Access operation;
show that requirement until a matching ready binding exists, then expose
**Back to provider setup** with the original target. Do not silently convert a
repository/bulk flow into changing the workspace default. If a target cannot be
preserved, explicitly return the user to selecting it; never guess ownership.
No durable draft table or general wizard engine is needed.

In Provider Edit and Account Update key, show the truthful current storage and
an explicit **Add with different storage** continuation. Credential identity is
not changed in place. Existing provider selection/default operations assign the
replacement explicitly. Do not retarget other repositories or archive the old
profile automatically. Rename remains a rename-only form.

Availability comes from existing management decisions and the server's allowed
Gateway profiles. A disabled or unavailable profile must not authorize creation.
Storage/provider transitions clear transient secret state and stale binding/model
selection. Preserve #706 loading, retry, saved-model anchoring and exact binding
validation, including organization use when personal sharing is disabled.

### B. Control plane and persistence

Extend `user_ci_secret` to OpenRouter and Kimi Code. Add the Kimi direct catalog
entry (`kimi`, `kimi_code_api_key`, `kimi-code-api`, `kimi/k3-256k`,
`KIMI_CODE_API_KEY`). Reuse MiMo/OpenRouter names and existing model constraints.
Add an incremental SQL CHECK migration; never alter applied migration bytes or
weaken the immutable-credential trigger. Maintain existing legacy managed-key
resolution without reclassifying its custody.
Keep the migration confined to the profile auth-mode CHECK; Kimi does not belong
in the legacy managed-key enum or ciphertext installer. Preserve historical
nullable projection fields and choose the next free migration number at commit.

Generalize current OpenRouter direct eligibility into a finite provider-API
selection. Keep its single-provider and agreement constraints. Propagate the
selected mode consistently through effective configuration, workflow requirement,
canonical caller, captured snapshot and runtime checkout. No browser hint is an
authorization source. Each runtime snapshot must retain the exact provider/model,
agent profile, runtime profile and producer identity.

OIDC reusable-workflow paths identify the generic `provider_api` transport only.
Read the selected provider from the verified canonical caller at
`claims.workflow_sha`, correlate it with the saved configuration, and carry the
result into checkout. The reusable path or an unverified request cannot choose
the upstream. Include the direct provider mode in workflow requirement/variant
comparison so changing OpenRouter to MiMo/Kimi correctly requires a caller update;
preserve documented unknown/null compatibility without treating it as proof.

Kimi's no-reasoning policy also applies to settings validation, materialization
and runtime plan creation. Do not inherit the generic non-Gateway `xhigh` default.
Reject fast mode and admit only the initial `k3-256k` model.

Apply direct single-provider restrictions at save/setup/admission boundaries;
old mixed policies remain readable and receive an actionable unsupported-state
result where execution is requested. Preserve existing managed-profile identity,
ciphertext, key installation and rotation, and readable policy/profile bytes.
Current App-first MiMo execution requires an explicit supported effort (`low`,
`medium` or `high`) and fast mode off. An unsupported legacy `xhigh`/fast selection
needs an explicit corrected selection and resave before preparing that route.
Do not silently coerce its saved settings or revive a legacy publication transport
to keep an unsupported selection running.
Replay (`matchesAdmission`) derives the direct mode from the original captured
canonical configuration plus the approved direct agent witness, not the current
policy or merely an absent Gateway. Capture, replay and checkout must agree.
Keep OpenRouter's existing PR-description capability; do not grant it to another
provider solely because it now shares a transport name.

The generated caller uses only the selected provider's fixed repository secret.
The additive companion extension is mandatory: define the finite OpenRouter,
MiMo and Kimi Code modes and their fixed transport descriptors in the canonical
companion source, generate the public mirror through the existing protocol
tooling, and require source/mirror parity. Keep the legacy OpenRouter default
property for compatible existing callers; publish the expanded mode list and
descriptors as separate exports so an object spread cannot add fields to the
strict checkout request.

Version this extension through the existing generated-file hashes, committed
handoff manifest and exact producer/runtime SHA qualification. Retain workflow
schema 2 and the unchanged two-scalar checkout request shape. The frozen core
protocol schema and digest remain unchanged. Qualify the generated caller,
canonical source proof, captured mode, checkout and public runtime together on
their exact commits; unknown or mismatched modes fail closed.

An older OpenRouter-only direct producer cannot execute or complete a new MiMo
or Kimi mode: its immutable workflow/runtime rejects the unknown mode, and an
OpenRouter checkout selector cannot match a captured different provider. The
producer registry does not independently filter allowed modes by release SHA;
do not describe exact SHA matching alone as that additional authorization gate.

### C. Public runtime

Use the existing Codex `provider_api` route for all three direct modes. Keep
Gateway's existing OCR route unchanged. One narrow descriptor selects:

| Mode                  | Secret                    | Fixed Responses endpoint                             | Initial model policy      |
| --------------------- | ------------------------- | ---------------------------------------------------- | ------------------------- |
| `openrouter-api`      | `OPENROUTER_API_KEY`      | `https://openrouter.ai/api/v1/responses`             | Existing OpenRouter rules |
| `mimo-token-plan-api` | `MIMO_TOKEN_PLAN_API_KEY` | `https://token-plan-sgp.xiaomimimo.com/v1/responses` | Existing MiMo catalog     |
| `kimi-code-api`       | `KIMI_CODE_API_KEY`       | `https://api.kimi.ai/coding/v1/responses`            | `k3-256k`                 |

Reuse the loopback transport, bounded request handling and existing disposal.
Credentials stay in the trusted proxy, never Codex environment/files. Reject
wrong/mixed secret inputs, wrong caller mode, model/prefix mismatch and redirected
destinations. Remove unselected provider credentials before child process launch.

Kimi keeps the qualified capability subset: function tools, including functions
inside Codex's native namespace containers; omit reasoning controls and
fast/service-tier settings. Tool declarations may be a top-level function or a
named namespace containing only direct function leaves. Reject nested namespaces,
custom/freeform tools, web search and other tool kinds in this qualification.
The approved Codex 0.147.0 serializes
an empty `reasoning: {}` envelope even when no controls are set. Qualification
permits an omitted envelope or exactly that empty object, and rejects any
effort, summary, context, or other reasoning field. Set the finite Kimi model
metadata to `use_responses_lite: false` so native requests retain standard
function tools. A namespace groups function declarations and is not evidence of
an unsupported custom tool. Do not flatten namespaces or rewrite native request
bodies to satisfy a fixture assumption. Represent omission through the Codex
protocol/configuration path, rather than patching outbound JSON after selection.
Preserve existing OpenRouter behavior and MiMo's applicable model/effort rules.
Use honest client identity; do not impersonate another tool.

Before completing direct Kimi implementation, run a bounded Kimi wire spike with the approved
Codex `0.147.0` executable and its verified profile digest. The old checked-in
`action-dist/codex/linux-x64` archive contains `0.135.0` and cannot qualify this
behavior. Use existing exact-version preparation. Prove actual outgoing fields,
including native defaults, with finite model metadata where needed. A fake
Codex executable or omitted app-server field alone is insufficient evidence.
For both `codex exec` and app-server, the fixture must return a function call
with the exact declared namespace and bare function name, observe exactly one
real MCP invocation, receive its output marker in the next native HTTP request,
and complete with the expected strict final JSON. This proves that native
serialization, call dispatch and continuation work together; accepting a
namespace declaration without executing its function does not pass the gate.

The [official Kimi Codex guide](https://www.kimi.com/code/docs/en/third-party-tools/codex.html)
(checked 2026-10-25) documents native Responses/function calling with Codex and
preserves desktop MCP configuration. It does not separately specify acceptance
of every namespace wire shape. This supports testing the unmodified native
protocol; it is not a live receipt for our pinned client/model. The existing
Gateway controlled receipt used Codex 0.133.0 and counted function tools without
establishing this 0.147.0 namespace shape. Neither that receipt nor the new
controlled upstream fixture proves live Kimi acceptance or paid-account access.
The credential-free fixture is published in runtime PR #340. Its clean runner
is needed because this interactive host's newer global hooks cannot be parsed by
the pinned client. Independent UI and control-plane work can proceed while the
CI job is queued; no direct Kimi completion or merge claim precedes the native
receipt. This sequencing avoids coupling unrelated work to runner availability.

Rebuild the checked-in runtime bundle. A new executable needs its real producer
identity; never relabel old bytes or bypass admission. Pin the actual companion
commit for paired qualification after the companion is reviewed and pushed.
Production activation remains a separate deployment step.

## Work allocation and checkpoints

- Frontend agent: shared selector/copy/model, provider forms, account forms,
  intent routing and focused UI tests.
- Backend agent: catalog/domain, migration, API admission/snapshot, canonical
  caller/companion sources, generated exports and focused backend tests.
- Runtime agent: public Action implementation, transport/protocol tests, bundle
  and public companion PR.
- Coordinator: independent plan critiques, integration, paired/browser E2E,
  screenshots, commit/push checkpoints, external review and final merge gates.

All delegated agents use GPT-6.1 Sol xhigh as requested. File ownership is
explicit; only the coordinator stages/publishes commits in the shared checkout.
Changes are pushed at coherent checkpoints, beginning with the reviewed plan.
The two release-coupled repositories use separate PRs. No unrelated PR is merged
as a substitute for this task; #706 is already on the implementation base.

## Verification and acceptance

1. Domain/persistence: parameterized 3-provider source mapping, save/refetch,
   accepted SQL combinations, legacy compatibility and immutable identity.
2. Workflow/admission: each selected secret and mode generates the expected
   canonical caller and captured snapshot; wrong/mixed mode, foreign workspace,
   disabled account/profile and unsupported multi-provider configuration fail.
   Include the three matching and six mismatching caller/policy pairs, changed
   policy between capture and admission, wrong exact producer/workflow SHA and
   stale workflow health after changing direct provider.
3. Runtime wire: the actual approved, digest-verified Codex executable for each
   direct mode uses the expected fixed origin/path/model and
   only its selected key; rejection/abort releases transport; Kimi omits
   unsupported options and retains function leaves in the permitted native
   containers. Its `exec` and app-server cases both prove namespace-aware MCP
   dispatch, the next-request function output and strict final JSON completion.
4. Paired E2E: generated caller to captured configuration, actual compiled
   runtime and controlled upstream to App publication fixture/output. Extend
   existing paired fixtures instead of adding a parallel test framework.
5. Browser E2E: real Next.js, PostgreSQL 17, session and existing Gateway/GitHub
   HTTP fixtures. Exercise all three provider/storage selections, representative
   full create/attach and account enrollment paths, save/refetch, Accounts to
   Providers continuation, source replacement, and permission/capability refusal.
   Verify same-workspace continuation through personal/org wrappers, a renamed or
   redacted Gateway source, enrollment/access/return to the original target,
   one-time intent consumption, tampered context refusal and legacy key rotation.
6. Visual QA: inspect desktop and 390 px mobile screenshots in light/dark,
   verify keyboard radio/focus behavior, short copy and no horizontal overflow.
7. Run affected native TypeScript 7 checks, lint/format, protocol generation
   parity, runtime build and repository required CI. Expand testing only when a
   concrete remaining risk or required gate warrants it.
8. Independent critics review the plan before implementation and the integrated
   diff after implementation. Fix substantive findings and external PR review
   threads before merging, with checks on the final published head.

Controlled external fixtures prove application integration, not live paid-provider
availability or production activation. Record exact tested commits and any unrun
gate honestly. Hetzner operator instructions were located, but this session has
no configured SSH credential or worker handle; do not claim Hetzner execution
without an actual worker receipt. GitHub source/CI and the isolated local test
environment remain available.

## Size estimate and review record

The earlier 1,200–2,250 total-line estimate omitted profile restrictions, current
captured MiMo execution, immutable edit semantics and some shared form entrypoints.
Before implementation, a practical combined range is 1,800–3,000 product lines
and 1,400–2,400 test/fixture lines changed across both repositories. Generated
bundles, protocol output, documentation and lockfiles are counted separately.
These are planning estimates, not targets; prefer deletion/reuse over filling a
line budget. Final reporting will use the actual merged diff.

Plan critiques: independent frontend, backend and runtime reviewers identified
workspace-context propagation, safe upstream identity for edit continuations,
OIDC caller/vendor correlation, provider-specific workflow requirement comparison,
Kimi settings defaults and actual pinned-Codex wire qualification. Those bounded
corrections are incorporated above. Runtime review accepted the design with the
native Kimi spike as an implementation qualification gate; final frontend/backend readback
is recorded with the implementation checkpoint.
Frontend follow-up also required an explicit enrollment/access return boundary
and removal of legacy managed-key creation from the two-choice UI; both are now
included. Its verdict is GO after these corrections.
Backend follow-up accepted the design after the three P1 corrections. Its narrow
SQL/legacy-read/replay clarifications are included; native Kimi wire remains the
only native-client uncertainty and remains a required merge gate.
