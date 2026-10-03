# Account Gateway: Modular Implementation Plan

Date: 2026-10-02. Status: accepted owner direction; checkpoint A merged on
2026-10-03, B–D in progress. Full program acceptance is incomplete.
No package was installed, new service deployed or old pool disabled by this plan.

Authorities: [ADR-030](../decisions/030-reusable-account-gateway-and-ownership.md)
and [owner vision / account lifecycle](./50-reusable-account-gateway-and-personal-pool.md).
This document owns delivery order; document 50 owns the account/sharing rules.

## Worker execution preference

Newest owner instruction, reaffirmed on 2026-10-03: subsequent hosted workers use ordinary
mode, `serviceTier: default`; do not request fast/priority service. Keep explicit
`gpt-6.1-sol` and role-appropriate effort. Historical fast-mode review receipts
below remain historical and are not the template for new jobs.

## Implementation readiness

This is a detailed architecture/delivery plan, not a frozen implementation
specification for every checkpoint. A can begin with public artifact and module
qualification. [First-slice execution contract](./52-account-gateway-first-slice-contract.md)
now supplies the proposed wire/storage, account-operation, bounded run/deadline
and restart-cleanup defaults for A–D. Freeze its schemas in A and prove the
native mapping/reconciliation in B before exposing execution in C/D.
OAuth protected custody and numeric capacity acceptance remain explicit later
decisions. These require actual evidence before their checkpoints can pass.

Independent 2026-10-03 readiness audit found two concrete omissions, now specified
in contract52: preparation/readback must return the selected safe account/epoch,
and initial MiMo tokens is a native per-request output/reasoning cap with
conservative request-slot accounting. The SDK result-schema correction and
actual native cap qualification remain required implementation gates.

Readiness review provenance: the 2026-10-02 hosted attempt used
`gpt-6.1-sol/high/default` and ended `partial / task_timeout` without report
artifacts. Its generic continuation was rejected with
`project_control_broker_required`; the job is no longer running. It is not a
completed independent review. Contract 52 is coordinator-authored; post-change
independent SDK review has now passed at exact head `226a0907`; PR 1 merged as
`07234f60`. Native review requested six fixes. Facade/RR and live product E2E
remain NOT RUN. Current evidence belongs to contract 52 and the execution ledger.

## Locked scope

- Independent Sub2API-backed service, reusable from several products.
- A separate TS package from the first slice. The owner confirms at least two
  intended products. The second product's name is not supplied; do not invent it
  or run agents against another real project to test portability.
- Get Modular for composition, Engineering Foundation for development checks,
  Docs Protocol for repository-owned documentation. No framework types in
  product policy. No Sub2API-specific additions to Get Modular Core.
- Own Review Router Accounts UI, server-side workspace authorization,
  Models/repository/batch settings and actual CI review/publishing.
- Own BYOK connections do not need a manual shared-pool grant. Operator-managed
  pool access remains granted to selected workspaces. Keep role/entitlement and
  owner/use checks separate from that shared-pool availability decision.
- MiMo Token Plan and OpenRouter BYOK, and Codex subscription through Sub2API,
  with distinct protocol/auth qualification. Claude is an additional explicitly
  qualified agent; new Claude subscription OAuth is a separate profile.
- Owner/use distinction immediately. Full personal-to-org sharing follows the
  first working integration; the detailed user vision remains in document 50.
- Breaking replacement: no old-pool credential/history migration, compatibility
  adapter or persistent dual backend. Users reconnect accounts. The owner states
  there are no users requiring old-pool compatibility.

## Smallest reusable boundary

```text
Review Router domain/application          Another product's policy
          | own ports                              | own ports
          v                                        v
Product adapter + composition            Product adapter + composition
          \________________________________________/
                       |
          separate TS account-gateway package
             contracts | http | get-modular
                       | versioned private HTTP
          Account Gateway facade + pinned Sub2API
                       | approved native protocol
                    providers
```

Package: `@agent-teams/account-gateway`, in the private
`agent-teams-ai/account-gateway` repository. SDK checkpoint A is merged; service
facade and native integration are still being implemented. Keep service facade,
wire authority and TS SDK together in a dedicated account-gateway repository;
the Sub2API fork remains a pinned engine dependency. Do not move the feature into
Get Modular's framework repository. Repository/namespace availability is checked
when creating the implementation workspace.

The SDK has real feature-owned management and execution capabilities; module
composition and curated exports index those features. Private transport helpers
stay with their owner. An integration SDK needs no invented business aggregate
or empty domain/application directory tree. The organization standard governs
that role-appropriate topology only after scoped local adoption.

| Surface         | Owns                                                                         | Must not own                                                           |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/contracts`    | Versioned safe wire DTOs, diagnostics/effect classifications                 | RR User/Workspace/Repository models, native admin responses            |
| `/http`         | Server-only management/execution clients, validation, stream/cancel/readback | Product policy, provider protocol conversion, independent paid retries |
| `/get-modular`  | Inert declaration + typed construction factory for the client                | Credentials in profiles, auth decisions, global service locator        |
| Product adapter | Translation to its application-owned ports                                   | A duplicate HTTP/schema implementation                                 |
| Service facade  | Consumer mapping, private engine calls, execution authority                  | Product login, GitHub OIDC, PR publishing                              |

A service wire schema is the single authority; derive TS types/validators and
check drift. Do not independently edit equivalent DTOs in each product. Small
product-specific mappings remain legitimate when they protect different policy.
Separate management from execution permissions and credentials. A CI/execution
handle cannot invoke account administration. Credential submission is write-only;
status/readback never returns a key, refresh token or vendor account document.

Module compilation is passive. Use public Core/Assembly APIs, exact declared
dependencies and an explicit static profile. Assembly is used only for factory
construction; no lifecycle kernel or dynamic plugin subsystem is needed. The
Host supplies admitted origin/auth configuration privately and owns resource
cleanup. Neither module metadata nor a plan digest authorizes a run or tenant.

## Current tooling facts and adoption

Checked through `gh` against RR main
`99f5e97c16b7bce47b4cfe196c1d8e462c92f6d3`:

- `@agent-teams/engineering-foundation@1.6.0` is already a dev dependency of
  `packages/features/sdk-growth-authority`; this is limited feature adoption,
  not proof of a repository-wide Foundation profile.
- No Docs Protocol dependency, profile or workflow invocation was found in the
  inspected dependency/config/CI sources. Existing `protocol:*` commands concern
  Review Action wire protocols, not Docs Protocol. Get Modular is not adopted.
- Get Modular itself already uses Engineering Foundation and Docs Protocol as
  development dependencies. Installing them does not activate consumer rules.

Public npm metadata checked on 2026-10-02: Core/Assembly `0.2.0`, Foundation
`1.7.1`, Docs Protocol `0.6.2`. Core/Assembly are pre-1.0 and have candidate
dist-tags; some source guides still show older pins. These are available
candidate coordinates, not evidence that our consumer has qualified them.
Before installing, recheck exact published artifacts, supported public APIs,
release qualification and integrity. Commit exact approved versions and one
native lockfile; do not install from a floating Git branch or `latest`.

Current Core/Assembly engines require Node `>=24.18 <25` or `>=26.10 <27`;
current Foundation/Docs Protocol require Node `^24.18 || ^26` and pnpm
`>=11.17 <12`. RR declares pnpm `10.33.0`. Run the new repository on a qualified
toolchain; qualify any RR tooling upgrade as a bounded change before adding these
current dev tools there. Do not silently rewrite RR's package manager to copy a
template. Check Node capability against deployed RR/CI and the packaged client.

Foundation belongs only in dev dependencies: declare actual source boundaries,
curated public API and dev-only prohibition, then run its checks. No Foundation
runtime/types may leak into shipped clients or the product. Get Modular types
are allowed only in the optional composition surface.

Docs Protocol adoption starts in the new library repository with a portable
profile. RR adoption is a bounded tooling change preserving `ai-docs` and its
existing authorities: inspect the exact installed CLI, preview create-absent and
reviewed exact-preimage operations (including any marker-bounded AGENTS edit),
review paths/preimages and apply only the matching plan. Never force bootstrap
over this dirty checkout or generate a competing documentation tree. Commit the
profile, ownership/reachability rules, scripts and CI check together. Adoption
in the new gateway repository is qualified for docs and package READMEs; its root
README remains outside the supported catalog. RR adoption remains pending;
writing these Markdown documents does not constitute adoption.

### Scoped composition and artifact acceptance

Checkpoint A records the selected combinations in one small capability matrix:

| Component     | Initial candidate / explicit scope                                                       | Required installed evidence                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Get Modular   | Core/Assembly 0.2.0; static package-client construction and RR outer adapter composition | Exact archives/SRI, exported APIs, ESM mode and supported TS with `skipLibCheck: false`; actual positive/rejecting consumer wiring |
| Foundation    | 1.7.1; source-dependencies v2, curated public-API and dev-only checks                    | Installed supported schemas/CLI on actual local profiles; real prohibited imports including type-only imports must fail            |
| Docs Protocol | 0.6.2; portable profile v4, Document Authoring profile v3                                | Installed init/check/new preview and stale-preimage rejection; explicit data-only blocker vocabulary and reachability              |
| Toolchain     | Node 24 >=24.18 within its supported major, pnpm 11.20 candidate lane                    | Actual installed version/build outcomes; RR upgrades qualify separately                                                            |

Foundation source-dependencies v3 is not required for this slice; its source
README still marks qualification pending. Avoid that extra axis. If a selected
artifact does not support the stated minimal capability, resolve that exact
mismatch before activation; do not replace it with a source-only check or claim
that older 0.1.0/0.4.0 guide receipts qualify new archives. Portable v4 does not
silently migrate an existing v3 profile; authoring v3 is a separate identity.

Maintain two bounded consumer profiles: package composition and the newly
adopted RR seam. Record accepted local decision, organization authority pin,
central contract commit/full-document digest, exact package/archive identity,
roots/owner, materialized entrypoint, declarations/profile/factories and actual
blocking fast/full commands. Their existing boundaries inventory explicitly
marks untouched scopes not-adopted with an owner/review trigger, without blanket
exceptions or a claim of repository-wide conformance. Discover and reject new
unknown boundaries; enforce policy through the existing source-policy mechanism,
not another import parser. No second direct production assembly is retained in
the adopted seam; the independent wiring oracle is test-only.

Central contract candidate: Get Modular `common-assembly.md` at source pin below,
full-byte SHA-256 `33b41d5babf0a431c97e8e596a56e6ec1557ba1a0b26d39bf23e13d9a19e1fbd`.
It references organization Feature Module Standard v1, Git blob
`d0bfff2033faf544fe65268c1dcdfd524d093015`; retain and verify that authority before
activating the local profiles. These source pins are not installed evidence.
Its authority source is `agent-teams-ai/.github` commit
`eef92e7fd40f538b4e9ba03e01bbd4e2d23f12f2`, path
`docs/architecture/feature-module-standard/v1.md`, SHA-256
`851653f96643cf0466b67ab22963661976b00de44840fa3144a48a8c054f95fa`;
the full bytes were retained and verified in this planning turn. Reuse the
retained authority as evidence, without presenting a copy as a new standard.

Test owners are distinct: archive/export closure; typed and behavioral wiring
parity with zero construction on invalid preparation; actual source-policy
rejection; portable docs stale-preimage/corpus checks; and two consumer fixtures
reusing the base facade harness for transport/isolation. Do not implement an
extra source classifier or repeat all service security tests in each fixture.

RR Docs Protocol mapping must inventory existing `ai-docs` Markdown collections,
sidecar metadata for documents without frontmatter, owners/templates, indexes,
relations/reachability and blocker vocabulary before activation. Preserve
accepted document content/IDs. Verify the mapping on a disposable copy: valid
existing documents remain reachable, a broken relation/invalid metadata is
rejected and a changed apply preimage causes zero mutation. New-repository
bootstrap does not qualify RR's historical corpus or rewrite it automatically.

## Implementation checkpoints

Each worker owns a bounded lane and returns patch/bundle and evidence. Main
integrates and commits with owner identity. Use dependency-safe PRs near 2,000
changed LOC; keep indivisible security contracts together. Do not create a large
framework scaffold before a functioning client/service slice.

| Checkpoint                  | Ownership and outcome                                                                                                                     | Dependencies / acceptance                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Reusable contract/client | Dedicated repository: wire schema, minimal HTTP clients, Get Modular entry, dev profiles, packed consumer fixtures                        | Exact artifact/toolchain checks; static construction; correct namespace/role/errors; installed public exports work without RR source imports            |
| B. Native service path      | Gateway facade and pinned fork: private routing, write-only MiMo account connection, scoped mappings, status/revoke                       | A; real native request and response; foreign consumer/account denied; no shared-group fallback; no master in readback                                   |
| C. RR account/UI policy     | Existing RR account feature and composition: owner/use model, own Accounts UI, safe connect/reconnect/disable, Models/repo/batch bindings | A+B; explicit workspace membership and roles; personal stable user ownership; org-owned scope; partial batch failures; no key copying into repo secrets |
| D. MiMo real CI slice       | Existing Action/control-plane/relay/publishing adapters                                                                                   | B+C; OIDC admission, bounded run grant, native Codex tools/final answer, actual findings publication, secret isolation and lifecycle/failure gates      |
| E. OpenRouter               | Profile adapter/config and relevant CLI compatibility                                                                                     | D; actual OpenRouter tools/final/publication, usage/error mapping; repeat only profile-specific unproven gates                                          |
| F. Codex subscription       | Protected credential custody + engine setup/refresh + CLI profile                                                                         | B+D; live test-account connect, refresh, tools/final/publication, fenced single writer, encrypted custody/cache/history/restore qualification           |
| G. Breaking replacement     | RR old-pool selectors/routes/UI/jobs and provisioning cleanup                                                                             | D+E+F and exact-candidate release checks; retirement contract below; old grants cannot dispatch; no dual runtime authority                              |
| H. Sharing follow-up        | RR canonical accounts, workspace-use relations and Accounts UI                                                                            | Stable base; personal + two org uses, foreign third denied; rename/reconnect/detach/global disable/role loss/shared quota as document 50                |

Claude/BYOK compatibility can run alongside E/F once its native endpoint path is
ready. It does not qualify Claude subscription OAuth. A and B may be reviewed in
bounded sub-PRs, but C/D form the first useful product vertical checkpoint.
Memory and cleanup defects may require a separate bounded engine patch; they
are acceptance work, not silently deferred because the client is modular.

Before assigning another real product, name its repository, authorization policy
and service namespace. Two disposable TS fixtures establish package portability
and isolation, not second-product production adoption.

## Runtime contracts that make the tests meaningful

- Bind consumer identity to a server credential, not caller-supplied IDs. RR
  authorizes live workspace membership, binding revision, repo/model and budget
  before preparation and dispatch; engine groups never substitute for this.
- Use the existing explicit RR membership policy from architecture 29. Do not
  add broad GitHub membership permissions or an external-sync system for v1.
- The RR-to-gateway admission envelope and acknowledged policy-fencing contract
  are authoritative in document 50 section 5. Apply it in C/D: close local
  admission before revoke; expose pending/unknown until remote fencing is
  acknowledged; atomically check permission and claim each gateway attempt.
  Pause/resume a real admitted request across revoke to prove stale envelopes
  cannot dispatch after that fence. Classify already admitted effects separately.
- Agent checkout, tools and loop stay in CI. CI receives a narrow revocable run
  capability and relay origin; only servers hold upstream master credentials.
  Test CI logs/env/artifacts and public read APIs for master-secret absence.
- Specify start and maximum run deadline separately from initial OIDC expiry.
  Initially issue one capability bounded to the server-approved run deadline;
  the caller cannot extend it. Do not add renewal unless an actual supported
  runner demonstrates that need and its contract is separately qualified. Expiry/revoke
  denies new dispatch; accepted upstream effects are classified rather than
  claimed undone. Automatic expiry/abandonment cleanup must be demonstrated.
- Pin canonical account and owner authorization epoch across tool requests.
  Ordinary fenced refresh can advance credential generation on the same account.
  At most one classified backup before first success, freshly and atomically
  admitted. No independent native round-robin or SDK/CLI failover.
- Gateway owns paid inference retry/failover. Once dispatch may have occurred,
  timeout/partial SSE is never a reason to resubmit. Stable attempt references
  and effect-state readback distinguish not-dispatched from unknown outcome;
  unknown effect fences the invocation even if a caller changes request ID.
- Qualify bounded streaming/backpressure/cancellation and native CLI retry
  behavior. Observe process/memory bounds under concurrent invocations and
  cleanup after deadline, worker loss and abandoned supervisor. Historical
  functional load success does not close the failed strict RSS gate.
- Endpoint/profile configuration is server-owned; deny arbitrary upstream URLs,
  redirects, admin routes and unsupported agent/protocol/profile combinations.
  New engine restore does not revive obsolete grants or credential authority.

Keep actual failure-path evidence beside the exact candidate. Add tests for
observable contract regressions at the nearest strong boundary. Explain what
would make each new test fail; no source-string assertions, mock-only tests,
copied implementation expectations or duplicated scenarios at every layer.

## Retirement contract, without migration

1. Qualify the new stack on disposable accounts/repositories. Reuse existing
   disposable repos; no launch/provisioning tests on real user projects.
2. In the coherent replacement batch, close old admission and refresh scheduling,
   invalidate old grants and classify in-flight effects. Check that no legacy
   writer survives before enrolling that same provider identity into Sub2API.
3. Require new connection/setup and new server-side repo bindings. Update the
   supported Action/control plane together. Old workflow versions/config fail
   with a clear reconnect/update state; no transparent fallback to old secrets.
4. Remove old pool UI/routes/runtime selectors and obsolete secret provisioning.
   Remove dead code without weakening unrelated account/tenant invariants. A
   source grep alone is not proof: stale API/grant/workflow behavior must deny.
5. No history import or credential conversion. Existing read-only evidence can
   stay under retention; retire legacy secrets under that policy. Do not delete
   unrelated review/user/workspace data.
6. If the new candidate fails, suspend dispatch and repair/revert safely; do not
   automatically restart old refresh writers or revive old grants. Preserve
   ambiguous-effect evidence. Breaking compatibility is not permission to replay
   a paid request or corrupt existing tenant crypto constraints.

This is the target delivery behavior. The current production pool is not shut
down during this planning turn. Follow the existing release/deployment runbook
for an actual coherent verified batch.

## Budget interpretation and open risks

The earlier 4–9k production /3.3–7k tests estimate covers MiMo/OpenRouter BYOK,
private facade, own UI and CI integration. It already includes HTTP client,
schemas, ports and isolation: moving them into a package is not another full
implementation. A hosted bounded review estimated the packaging/modular increment:

| Increment                                          |  Production |         Tests |      Config |
| -------------------------------------------------- | ----------: | ------------: | ----------: |
| Pack/export/build existing client/contracts        |      90–180 |       180–320 |      70–120 |
| Static module and consumer composition glue        |     170–330 |       260–460 |       50–90 |
| Minimal Foundation profile/gates                   |           0 |       100–180 |     110–190 |
| New repository Docs Protocol profile/workflow      |           0 |        60–120 |      70–130 |
| Two disposable installed consumers, shared harness |           0 |       180–320 |       40–70 |
| **Increment only**                                 | **260–510** | **780–1,400** | **340–600** |

Confidence 6/10. Handwritten additions beyond the base; relocated unchanged
source, generated outputs/lockfile churn and prose are excluded. RR-wide
toolchain adoption and historical corpus mapping remain unpriced unknowns; no
new total ceiling is asserted. Each invariant has one primary test owner.

Prior new Codex/Claude subscription estimate +2–4k production /+2–4k tests remains
conditional. Protected OAuth storage and provider repairs are not a proven
ceiling. Do not drop those gates to fit the earlier number. Old-pool migration
and coexistence are removed from scope, not assigned an invented savings figure.
Owner/use preparation (+200–400 production) is a subset of the sharing follow-up,
not an additional fee on top of full sharing. No external GitHub membership sync
is included in default sharing scope.

Open: exact consumer qualification for Get Modular, RR toolchain compatibility,
Sub2API strict memory bounds, long-run authority/cleanup and live OAuth custody.
All implementation checkpoint receipts remain NOT RUN. Existing sandbox E2E
receipts establish only their tested engine/agent/profile candidates.

Hosted plan review `rr-gateway-spike-20260930-modular-plan-review-w1` completed
with gpt-6.1-sol/medium/fast, verdict ACCEPT_WITH_FIXES. Main incorporated its
four design findings: authorization handoff/fencing, scoped modular adoption,
artifact/capability matrix and existing-docs mapping. This is a source review,
not a subsequent independent review of the revised plan or implementation.

## Source pins

- [Get Modular public boundary](https://github.com/agent-teams-ai/get-modular/blob/4b56072ec6ca269fb16e3fdf131d31423af804bd/README.md)
  and [consumer construction](https://github.com/agent-teams-ai/get-modular/blob/4b56072ec6ca269fb16e3fdf131d31423af804bd/docs/guides/consumer-quickstart.md).
- [Foundation development-only boundary](https://github.com/agent-teams-ai/engineering-foundation/blob/9843822e6c10c4b805cf2bb95fc0f43e5211edeb/README.md)
  and [portable Docs Protocol](https://github.com/agent-teams-ai/engineering-foundation/blob/9843822e6c10c4b805cf2bb95fc0f43e5211edeb/docs/reference/open-source-docs-protocol.md).
- [RR Foundation feature dependency](https://github.com/777genius/review-router-ai/blob/99f5e97c16b7bce47b4cfe196c1d8e462c92f6d3/packages/features/sdk-growth-authority/package.json)
  and [explicit workspace membership](https://github.com/777genius/review-router-ai/blob/99f5e97c16b7bce47b4cfe196c1d8e462c92f6d3/ai-docs/architecture/29-workspace-membership-lifecycle.md).

Source files were fetched through `gh` and checked against Git blob IDs. Registry
metadata is a separate observation, not a release/capability acceptance receipt.
