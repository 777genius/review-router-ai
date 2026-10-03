# Reusable Account Gateway and Personal Pool

Owner vision recorded on 2026-10-02. Architecture accepted; implementation and
E2E are pending. Decision: [ADR-030](../decisions/030-reusable-account-gateway-and-ownership.md).
Delivery steps: [Modular Integration Plan](./51-account-gateway-modular-implementation-plan.md).
Initial API/state/run defaults: [First-Slice Execution Contract](./52-account-gateway-first-slice-contract.md).

## 1. Owner vision, preserved explicitly

The owner wants:

1. Sub2API as an independent service reused by multiple products, rather than
   code entangled with Review Router or one agent.
2. Our own account-management frontend. Each product controls users,
   workspaces, organizations and repository/model settings.
3. A user enters an OpenRouter API key, MiMo Token Plan key or future supported
   provider credential once. The upstream credential stays in our server-side
   custody; CI makes authorized requests through the gateway.
4. Codex reviews working through Sub2API, with Claude and other agents possible
   after explicit compatibility checks. Agents/tools/checkout still execute in
   CI; the gateway serves model traffic and account lifecycle.
5. One personal account catalog/pool per stable user account. Selected accounts
   can be used in the user's personal workspace and multiple organizations.
6. An organization can select several of those personal accounts or connect
   separate accounts owned by the organization.
7. A personal account attached to an organization is a reference to that same
   account. Rename or reauthorization updates the source; the organization view
   and future authorized requests use that source. No copied accounts or copied
   credentials that require synchronization.
8. CI/CD review uses the accounts allowed by its workspace and repository/model
   policy. Connecting an account is distinct from choosing where to use it.
9. Prepare ownership/use boundaries now, then ship the full sharing feature as
   a follow-up. Keep the first integration small and reusable.
10. Build a separate reusable package immediately, using Get Modular for
    composition and Engineering Foundation for development checks. The owner
    confirms at least two intended products; the second product is not named.
11. A breaking replacement is acceptable: disable the old subscription pool,
    require account reconnection and spend no effort migrating its credentials
    or history. The owner states there are no users needing compatibility.

Owner acceptance of the boundary does not mean the full sharing implementation
exists. The rules below are engineering defaults for the initial version, not
additional requirements attributed to the owner.

## 2. One service, clear product responsibility

```text
Our UI -> Product backend
          users, memberships, workspaces, repo/model policy
          application ports -> HTTP adapter/client
                               |
                               v private server API
                      Account Gateway service unit
                      narrow control/execution adapter
                      consumer-scoped account mappings
                               |
                               v private engine API
                         pinned Sub2API fork
                         routing, provider auth/refresh
                               |
                               v
                       approved upstream providers

CI agent -> Product public relay -> Gateway execution API -> Sub2API -> upstream
checkout/tools/loop stay in CI
```

The service unit may contain a small facade process alongside the engine. A
deployment unit is not a requirement to merge their databases or expose an
engine admin panel. Keep that facade small and use existing native engine
transport; do not implement a second agent or protocol-conversion engine.

| Responsibility                                                         | Owner                           |
| ---------------------------------------------------------------------- | ------------------------------- |
| Product login, personal/organization roles, repo/model/batch policy    | Product backend                 |
| GitHub OIDC, workflow/run/repo authority, review permission/publishing | RR                              |
| Credential owner and allowed workspace use records                     | RR for RR accounts              |
| Opaque consumer/owner/account mappings, operation status and isolation | Gateway                         |
| Native provider routing, account auth/refresh, provider health         | Sub2API through gateway adapter |
| Bounded execution permission and per-request transport limits          | Gateway                         |
| Account-global provider request limits/health                          | Engine/gateway, one authority   |
| Workspace entitlements, usage attribution and review budgets           | Product                         |
| Agent loop, checkout, tools and findings parsing                       | Existing CI runtime             |

Another product supplies its own authorization/identity adapter and business
policy; it need not implement GitHub OIDC. The gateway sees a trusted consumer
and opaque owner/execution references. All consumer calls still require service
authentication. An opaque string supplied by a user is not proof of ownership.

`account-gateway` is distinct from the existing subscription-runtime library
and hosted worker orchestration. It serves model/account access; it does not
assign tasks, provision terminals or run checkout/tool loops. Product tenant
workspace references are also distinct from an agent's filesystem directory.

## 3. Namespaces and security boundary

- Bind `consumerId` to the server credential used for HTTP calls. Never trust a
  client body/header alone to select another consumer.
- Each account reference belongs to one consumer namespace and has one owner.
  Reads and mutations check that mapping and expected revision.
- RR owner IDs are stable `User.id` or organization workspace IDs. Generic
  gateway `ownerRef` is opaque; the service does not query RR's User table.
- Sharing inside RR creates explicit workspace-use relations. It does not make
  accounts public to other products, all organizations or all repositories.
- Native Sub2API account/group IDs are internal. Product clients get safe
  references and metadata, not engine admin responses or credentials.
- The selected account set is the intersection of active owner/use mappings,
  repo/model policy and the permitted profile. No default/shared-group fallback
  may add an account outside that set.
- Preparation chooses and persists a sticky account for the invocation. The
  permitted set is not permission to round-robin accounts on later agent turns.
  One backup is permitted only for classified auth/quota failure before the
  first successful upstream response and under the adopted effect policy;
  timeout, transport ambiguity or partial output cannot trigger switching.
  Backup activation is an atomic bounded transition, with fresh account,
  binding/repo/entitlement admission. The native engine must enforce the pin
  rather than applying its own independent round-robin/failover policy.
- Gateway origin and native upstream endpoints are server-controlled, with
  approved protocol/model profiles. User input cannot choose a URL, redirect,
  native group ID or private admin route. Wire-client validation and egress
  policy preserve this restriction.
- One physical account/credential has one refresh authority. Duplicate enrollments
  of a known OAuth upstream identity must not create competing writers,
  including across legacy/new backends. Unknown provider identity is not
  evidence that duplicate refresh is safe; qualification must define identity
  handling per profile. Automatic cross-product account sharing is separate.

## 4. HTTP contract and TypeScript connection

Sub2API is a Go service; TS connects over HTTP, not by importing its Go code or
accessing its database. A versioned schema is the wire contract. A separate TS
package is required from the first slice because the owner has confirmed two
consumers. Publication to public npm is not required to prove the first slice;
an exact packed artifact can be installed in isolated consumers. Do not share
source files by path aliases or import Sub2API's native admin DTOs.

Working package name: `@agent-teams/account-gateway` (not yet created or
published). Curated entries separate safe contract types, the server-only HTTP
client and an optional `/get-modular` composition adapter. The package lives
outside Get Modular's neutral Core. Product domain/application code does not
import Get Modular, Sub2API, HTTP clients or Engineering Foundation.

Initial placement in RR:

```text
features/<account feature>/domain
  CredentialOwner, WorkspaceAccountBinding, domain invariants

features/<account feature>/application/ports
  AccountManagementPort
  AccountExecutionPort

features/<account feature>/infrastructure/http
  AccountGatewayAdapter
  consumes separate account-gateway HTTP client + boundary validation

product composition root
  construct real client and inject adapters into use cases
```

This is proposed placement, not an existing implemented package. Reuse the
relevant account feature instead of creating parallel CRUD modules solely to
match the diagram. Product ports belong to the consuming application. Wire DTOs
belong to the HTTP contract; they do not dictate the product's domain models.

Get Modular owns inert declarations and deterministic composition; optional
Assembly constructs the explicitly selected client/adapters. The product Host
owns admitted configuration, service credentials, resource lifetime and cleanup.
Use closed typed dependency records and public package exports. No global
service locator, dynamic plugin manager or lifecycle kernel is needed. Module
profiles/plan digests contain no secrets and confer no workspace/run authority.
Wire/profile compatibility and execution permission remain explicit runtime
checks, independent of composition success.

Illustrative domain shapes for the first slice:

```ts
type CredentialOwner =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "workspace"; readonly workspaceId: string };

type WorkspaceAccountBinding = {
  readonly id: string;
  readonly workspaceId: string;
  readonly accountRef: string;
  readonly revision: number;
  readonly state: "active" | "revoked";
};

type ExecutionScope = {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly runId: string;
  readonly attempt: number;
};
```

`CredentialOwner` is not derived from `ExecutionScope`. In the initial org-owned
flow, the owner workspace and consuming workspace match; they remain distinct
fields and checks. A personal account is user-owned from creation and receives
a binding only in that user's verified personal scope until sharing is enabled.
Do not first label personal accounts workspace-owned and defer a hidden ownership
migration. Future organization bindings then point to the same canonical account.

Illustrative consumer-facing port, not a published API:

```ts
interface AccountExecutionPort {
  prepare(input: {
    readonly operationId: string;
    readonly scope: ExecutionScope;
    readonly bindings: readonly {
      readonly bindingId: string;
      readonly accountRef: string;
      readonly expectedRevision: number;
    }[];
    readonly profile: string;
    readonly deadline: string;
  }): Promise<PreparedExecution>;
  revoke(executionRef: string, operationId: string): Promise<RevocationOutcome>;
}
```

`PreparedExecution` is a validated server-only result: opaque execution
reference, expiry, supported protocol, selected canonical account, its owner
authorization epoch and private capability. Any permitted backup is explicit,
not an arbitrary member of the account set. It is never sent wholesale to the
browser or CI. Actual ports include the required typed budget limits and
effect/error semantics; this short sketch is not executable code.
`RevocationOutcome` distinguishes applied fencing from pending/unknown operation
status; an HTTP acceptance is not proof that remote permissions are revoked.

Pin account identity and authority, not an immutable access token for the entire
run. Each dispatch validates the live authority and credential generation;
ordinary fenced OAuth refresh may advance that generation on the same account.
Owner reconnect/global revoke changes authority and denies old execution
permissions. A safe refresh is not permission to replay an ambiguous inference.

The management port separately submits/reconnects a credential through a
write-only operation, reads safe status/metadata and disables an account. It
never exports a credential. A client contract test must cover private response
classification, not just successful TypeScript compilation.

Proposed wire capabilities (candidate routes in [contract 52](./52-account-gateway-first-slice-contract.md), schemas frozen in checkpoint A):

| Capability                        | Important contract                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| Submit/reconnect/disable account  | Consumer scope, stable operation ID, expected revision; write-only secret ingress  |
| Read account and operation status | Positive safe DTO, no raw admin response/credential document                       |
| Prepare/revoke execution          | Authorized account subset/profile, deadline, request/byte/token/concurrency limits |
| Execute native model request      | Valid server permission, bounded stream, abort, safe status/effect classification  |

These are requirements for our facade, not claims that stock Sub2API exposes
this product-neutral API today. Operation status can be `pending`, `applied`,
`rejected` or `unknown`; a timeout cannot be silently treated as safe to replay.

## 5. Two authorizations in a CI review

1. RR verifies GitHub OIDC/repo/workflow/run and product policy, then issues a
   bounded RR run grant to CI. OIDC's mint lifetime and the approved job deadline
   are distinct; live revoke and budget checks remain required.
2. Before dispatch, RR checks active workspace binding, owner authority,
   credential/profile revision and execution policy. CI's grant is not the
   generic service's admin credential.
3. RR's server authenticates to the private gateway and uses a server-only
   execution permission for the permitted account/profile. The gateway validates
   consumer mapping and current permission before forwarding a native request.
4. Codex/Claude in CI use the configured product relay endpoint and temporary
   auth. Their real CLI spawn/env and tool/final semantics require canaries.
5. Returned model events go back through the stream; RR's existing runtime
   parses and publishes the review. Sensitive request/response bodies are not
   durable gateway/audit data.

Temporary CI credentials are usable within their permitted scope until expiry
or revocation. The promise is that provider master credentials stay server-side,
not that CI has no authorization at all.

The trusted per-dispatch admission envelope binds the authenticated consumer,
invocation/attempt, account, owner authorization epoch, workspace binding/policy
revision, profile, limits and expiry. RR supplies it only after product policy
admission; it is not a user-editable body that grants itself authority. Gateway
atomically validates its live execution permission and claims the dispatch
attempt. That claim is the dispatch-admission linearization point.

A RR detach/role loss/revoke first closes new local admissions and increments
the affected authority revision. It persistently requests a matching gateway
fence with a stable operation ID. Report `applied` only after the gateway has
acknowledged that previously issued envelopes can no longer claim dispatch;
pending/unknown status requires safe readback and keeps RR admission closed.
No cross-database transaction or gateway import of RR membership tables is
required. An attempt admitted before that fence retains its effect record and
may finish; revocation cannot erase its accepted/uncertain upstream effect.

Acceptance pauses a real request after RR admission but before gateway claim,
applies and acknowledges a policy fence, then resumes: no upstream dispatch.
Also test an already claimed attempt, delayed/unknown revoke acknowledgement
and a replay with a new request ID. No instantaneous remote revoke is promised
before its acknowledgement.

The gateway adapter is the sole owner of provider-transport replay/account
fallback decisions, within the agreed product policy. RR's client, SDK and CLI
must not independently resubmit the same dispatched request on a transient
error. After possible dispatch or partial output, abort/timeout yields an
unknown-effect fence, not automatic retry/failover. HTTP retries on read-only
metadata are distinct; account mutation retries reuse the original operation
ID and read back its status. Account-operation intents and RR review-effect evidence concern
different state and must not become two independently edited copies of one
billing ledger.

The execution contract includes a stable request/attempt reference and safe
effect metadata: `not_dispatched`, `dispatch_started`, `response_started`,
`completed` or `effect_unknown`. Gateway persists bounded effect metadata before
dispatch and exposes safe readback after client timeout; it never stores bodies
for replay. Loss of the HTTP connection cannot be interpreted as proof of no
provider effect. An unresolved effect fences new inference in the affected
invocation, including retries that arrive with a new client request ID.

Engine/HTTP SDK inference retries must be disabled or constrained by that one
decision authority and state. Native CLI retry configuration and terminal error
behavior are part of each supported profile's real canary; a CLI that bypasses
the contract is not qualified by merely changing its base URL. Credential
refresh and safe pre-dispatch connection recovery remain separate operations.

## 6. Personal pool follow-up

### Canonical identity and data

```text
Stable User.id
  -> canonical personal ProviderAccount A, B, C
       -> explicit binding in personal workspace
       -> selected binding in organization X
       -> selected binding in organization Y

Organization X
  -> its own ProviderAccount D
```

- One canonical account name, credential reference/generation, provider profile
  and health. No organization-specific copied credential or copied account.
- Workspace binding owns local priority, active/revoked state and revision.
- Unique workspace/account relation; new personal accounts are not
  automatically exposed to existing organization bindings.
- Account-global provider quota/request concurrency/cooldown; usage and review
  budgets attributed to the consuming workspace. Do not multiply capacity per
  binding. No full-agent-run mutex or `executionSlotsPerAccount` setting.
- A personal pool is the user's catalog; an organization's runtime pool is a
  policy-filtered selected set, not ownership of the user's credentials.
- Current provider-derived personal workspace slugs are not the stable user
  account ID. Establish the user/personal-scope relation deliberately; don't
  infer ownership from a slug or mutable GitHub login.

### Initial engineering policy

- An owner/admin of the organization may attach their own personal account.
  Attach requires both personal ownership and organization authority.
- Personal master name/auth/global disable is controlled by its owner. Org
  admins may detach or change local use priority but not reauthorize it.
- Org-owned accounts are administered by org owner/admin and initially stay
  within that organization. No ownership transfer or org-to-org sharing.
- Canonical rename is reflected on the next authorized read/refetch. Reconnect
  updates credential revision and invalidates old execution authority; active
  sharing relations persist if their permissions remain valid.
- Routine engine OAuth refresh is distinct from owner reconnect; it has one
  writer and must not revoke all organization bindings on each token refresh.
- Initially the donor keeps required owner/admin authority. Losing that role or
  membership revokes their personal share in that organization. Rejoin does not
  automatically restore it. Offer/approve sharing by ordinary members is a
  later policy/UX extension, not an implicit commitment from the owner.
- Follow the existing explicit RR workspace-membership policy in architecture 29. Live RR membership/role and binding revisions authorize admission; removal
  or downgrade invalidates its authority. GitHub App installation or GitHub org
  membership alone does not grant access. External GitHub membership sync is a
  separate optional policy, not a prerequisite or a new baseline scope request.
- Detach X preserves personal/Y. Global disable/tombstone denies new dispatch
  everywhere and preserves audit history. Already accepted upstream effects
  cannot be undone by revocation.
- UI shows origin, canonical name, safe connection status and editable actions.
  It does not reveal another organization's prompts, repositories or usage.

### UI ownership

**Accounts:** personal and org-owned connections, connect/reconnect/disable,
attach/detach selected personal accounts, safe status and ownership indicators.

Own MiMo/OpenRouter BYOK connections do not require a discretionary grant to the
operator's shared pool. Workspace role and normal product entitlement checks
still apply. Access to an operator-managed shared pool remains explicitly granted
to selected workspaces; personal BYOK does not make that pool public.

**Models/repositories:** account/profile/default/override selection and applying
settings to selected repositories with partial-failure status. The new mode
changes server-side bindings/config; it does not batch-copy upstream keys into
GitHub secrets.

Reuse shared controls and the existing repository-selection/batch components.
Use server-side authorization/first paint and React Query only for interactive
cached reads/mutations. Secrets and permission checks stay server-side.

## 7. Codex through Sub2API and breaking replacement

The owner's priority is actual Codex-through-Sub2API, not importing the old
database/history for its own sake. New Codex accounts therefore belong in the
target compatibility matrix and acceptance plan.

The owner explicitly authorizes replacing the old pool without compatibility
or migration because there are no users requiring it. All new connections use
Sub2API. Users reconnect accounts; do not import credential envelopes, grants,
restore permits, pool configuration or history into the new model. Do not build
a dual-backend adapter, per-account migration UI or automatic legacy fallback.

1. Qualify the new backend using disposable test identities first.
2. For the verified replacement batch, stop old admission and refresh jobs;
   invalidate old grants and classify any in-flight effects. Do not replay
   uncertain old reviews or create a second publisher. A reused upstream
   identity cannot have both old and new refresh authority.
3. Connect accounts afresh through the new setup and select server-side bindings
   for repositories. Existing repo secrets are not silently treated as gateway
   credentials; remove obsolete references from newly provisioned workflows.
4. Disable old pool UI/routes/config and runtime selection, then remove dead
   implementation in bounded cleanup. Existing read-only audit evidence may
   remain outside the new runtime; no historical import is required.
5. On replacement failure, suspend new admission/dispatch and repair or revert
   the new candidate safely. Do not automatically reactivate old grants,
   credentials, snapshots or refresh workers. Retire legacy secret material
   under the existing retention policy, without logging or exporting it.

Do not remove current Codex composite tenant FKs, generation checks or AAD to
make the new model fit. The opt-in hosted mode's encrypted custody/restore
requirements also survive extraction. Stock engine JSONB/Redis credential
storage is an open compatibility/security gap for that requirement, not a
qualified solution just because the engine runs privately. Protected Codex
OAuth cache/history/refresh storage must be scoped and costed when qualified.

## 8. What to prepare in the first implementation slice

1. Accepted owner/use vocabulary and separate consumer-facing management and
   execution ports; adapter wiring at composition root.
2. Minimal canonical account references and explicit workspace bindings, even
   when only one workspace can currently use an account. Database constraints
   keep owner and use domains distinct; enforce exactly one owner. Personal
   accounts use stable user ownership from creation, with a verified personal
   scope relation; org-owned accounts use organization workspace ownership.
3. Versioned wire schema, safe operation/status DTOs and consumer-scoped private
   mappings. Generic service knows opaque references, not RR tables.
4. One refresh/credential mutation authority, execution metadata for account and
   workspace attribution, bounded operation IDs/revisions and revoke semantics.
5. Account and profile metadata needed to add personal sharing later; no
   invitations, transfer workflow, real-time push or general ACL engine.

Preparation estimate from the prior bounded audit: approximately +200–400
production changes, +150–300 tests, +20–50 config compared with a single-scope
base. It is part of the full sharing delta, not an extra charge on top of it.
This document prepares the design; those code changes have not been implemented
by writing the ADR.

## 9. Delivery checkpoints and acceptance

| Checkpoint                                | Evidence required                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Service + owner/use foundation + MiMo key | One real RR CI review/publish in existing disposable repo; no master in CI; foreign consumer/workspace/repo denied                     |
| OpenRouter profile                        | Real selected engine path, tool/final/parser/usage correctness, no paid replay after ambiguous dispatch                                |
| Codex subscription through Sub2API        | Actual test-account setup/auth/refresh and real CLI review; required custody/cache/history/restore gates; one refresh writer           |
| Personal/org sharing                      | One master in personal + two org scopes; third denied; rename/reconnect/global disable/local detach/role loss and shared quota proven  |
| Claude agent / new subscription profile   | Native tested profile, real CLI endpoint/auth propagation, tools and final review; live OAuth if claimed                               |
| Release batch                             | Exact-candidate focused CI, streaming bounds/capacity acceptance, failure/cleanup/restore/revoke tests and fenced breaking replacement |

Every execution profile must additionally prove:

- multiple tool-loop requests remain on the same account across ordinary
  refresh; no native engine rotation over the authorized set;
- an authorized classified backup is activated at most once, atomically and
  only before first success, with fresh scope checks;
- ambiguous dispatch/partial SSE/CLI retry cannot cause another paid request at
  any layer; timeout readback and unknown-effect fences preserve this evidence;
- account-wide request limits allow parallel authorized invocations without a
  full-agent-run lock, with workspace-local usage attribution.

Codex is not postponed behind an automated legacy migration. Claude's native
MiMo/BYOK compatibility can be qualified earlier in the same implementation;
new Claude subscription OAuth is a separately proven auth profile.

Build the reusable package from the first slice, then deliver a coherent product
vertical slice. Target bounded PRs around 2,000 changed LOC, retaining indivisible
security invariants. Two isolated consumer fixtures prove packaging and private
namespace isolation; they do not claim actual second-product adoption. The
second intended product must be named before assigning its integration work.
Shared-service upgrades are
pinned and requalified by supported profile; a Go engine upgrade need not force
unrelated TS product domain changes.

Existing sandbox evidence is useful but not blanket production acceptance:
historical functional load passed while strict RSS acceptance failed; new live
OAuth and some lifecycle gates remain open. A completed architecture audit is
not a completed implementation or E2E.

## 10. Effort and scope boundaries

The earlier 4–9k production /3.3–7k tests budget already included the private
service, narrow control adapter, own Accounts/Models/repository/batch UI and RR
CI integration for MiMo/OpenRouter BYOK. HTTP isolation/client/ports are part of
that service/adapter work, not a second platform added on top.

- Sharing follow-up: the prior worker estimated +1.5–2.8k production and
  +1.6–3k tests at the bounded initial policy. The subsequently suggested
  external GitHub membership adapter is not part of the default scope: current
  RR membership is explicit. Preparation is a subset, not an extra sharing fee.
- New Codex/Claude subscription profiles: prior estimate +2–4k production and
  +2–4k tests is conditional on qualification. Protected engine OAuth custody
  work and unresolved provider repairs are not an already-proven ceiling.
- Migration of existing Codex state/history and a coexistence layer are excluded
  by the owner. New connections, retirement of old authority and genuine
  Codex-through-Sub2API still need proof.
- Packaging/Get Modular adoption and dev-tool profile wiring add bounded work;
  do not count the existing HTTP client/schema/ports twice. The concrete plan
  separates this increment from the prior service/UI/CI estimate. A fresh npm
  version does not prove a consumer has qualified its artifact or toolchain.

Do not build a universal scheduler, protocol translator, multi-language SDK
family, per-org engine instance/admin, plugin platform, generic governance or
cross-product credential sharing before a real use case requires it.

## Sources and provenance

Current main was verified as `99f5e97c16b7bce47b4cfe196c1d8e462c92f6d3`.
Existing local checkout is older and has unrelated changes; this document does
not assert that main's hosted account module is present in that checkout.

- ADR-029 and account plan 49 at that main establish hosted custody and legacy
  boundaries; ADR-005 establishes application-owned ports.
- Main `schema.prisma:1657–1687`, `account-pool.ts:148–167` and
  `credential-envelope-vault.ts:428–445` show existing Codex tenant/crypto fences.
- Prior Sub2API candidate: v0.2.11 commit
  `96f4c115c9749078f90cbf210a01d39baf3f53b6`; profile support and stock private
  storage behavior were inspected against that candidate. This is a pin for
  evidence, not a promise to deploy an outdated release without requalification.
- The bounded personal-pool audit completed in hosted runtime with
  gpt-6.1-sol/high/fast. Its estimates are engineering ranges, not measured future
  diffs. This specification extends it with the owner's accepted service target
  and explicit custody/cutover requirements.
- Main architecture 29 establishes explicit RR workspace membership after
  initial owner setup; external GitHub membership synchronization is future work.
- Get Modular main `4b56072ec6ca269fb16e3fdf131d31423af804bd` separates Core,
  optional Assembly and Host responsibilities. Engineering Foundation main
  `9843822e6c10c4b805cf2bb95fc0f43e5211edeb` separates dev tooling from product
  runtime. Exact package versions and docs-protocol status are recorded in the
  implementation plan; no dependencies are installed by this document.
