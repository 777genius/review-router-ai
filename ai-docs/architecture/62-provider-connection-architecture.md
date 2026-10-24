# Provider connection architecture

Status: design for the next provider integrations; not a claim that these capabilities are implemented.

## Existing foundation

ReviewRouter already has provider-account domain/use cases and ports, a Gateway SDK adapter, and server composition. Gateway has a closed OAuth profile registry for Codex and Claude. Native sub2api owns qualified transports, credential custody and upstream interaction. Extend these boundaries; do not introduce another parallel account framework.

Current gaps are concrete: RR repeats trusted profile/auth-method configuration in server composition; completion input shape is partly selected in the browser; adding a provider still requires explicit native/Gateway qualification. The ordinary sub2api admin UI returns token material to its browser and cannot be reused as a customer-facing security boundary.

## Responsibility and dependency boundaries

| Boundary                 | Owns                                                                                                | Must not own                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| RR UI                    | Rendering supported connection methods, one-off handoff/input and safe account state                | Tokens, provider URLs, refresh logic, determining entitlement |
| RR account application   | Actor/owner/workspace authorization, operation identity, sharing and lifecycle policy               | Vendor-specific token formats or HTTP clients                 |
| Gateway                  | Capability negotiation, closed qualified profile selection, operation coordination and SDK contract | Browser-selected upstream URLs or ordinary admin credentials  |
| Native provider adapters | OAuth exchange/refresh, principal evidence, protocol conversion, quota observation                  | Product workspace authorization or account-list UI            |
| Native custody/lifecycle | Encrypted material, immutable account birth, revision fences and erasure                            | Provider presentation strings                                 |

Dependencies point toward application/domain ports; concrete clients are assembled in composition. Provider policies remain source-owned. A displayed catalog entry never grants execution authority.

## Qualified registry and public capabilities

Use the existing Gateway registry as the assembly point for qualified provider profiles. Each entry binds its fixed native implementation, allowed models/protocols and actual supported auth methods. Native independently validates the tuple; no generic arbitrary-origin escape hatch is introduced.

Publish a versioned, secret-free projection through the SDK: profile ID, provider label, allowed model/protocol IDs, auth methods and safe completion input kind. RR intersects this projection with its deployment allowlist. Provider-specific routes, OAuth clients, upstream origins and token policy remain server-side. Shared DTO/schema definitions live in the SDK contract; RR must not maintain a second authoritative copy of provider capabilities.

Separate concepts: provider identifies the upstream; profile identifies a qualified auth/protocol policy; model identifies an allowed model. One new provider must not imply every model or subscription tier is supported.

## Authentication capabilities

Keep capabilities separate rather than requiring every provider to implement a large Provider interface:

- API-key enrollment: accept a transient key and return safe operation/account state.
- Browser OAuth: begin with a one-off authorization URL; complete with the explicitly declared input kind.
- Device OAuth: begin and poll only when actually supported.
- Maintenance/erasure: existing lifecycle ports with source-owned provider adapters.

The saved server operation fixes owner, profile, auth method, state and PKCE custody. Completion is validated against that operation, not inferred authoritatively from pasted text or a UI label. Whitespace normalization belongs at the input boundary; provider grammar remains strict. Do not advertise unsupported methods or fake no-op refresh implementations.

Reuse the current form/dialog primitives. Render method choices from capabilities, including API-key-only providers and browser-only providers. Provider-specific extra fields, such as a Google project, use explicit bounded schemas instead of arbitrary metadata bags. Backend validates their allowed meaning independently.

## Common lifecycle and provider-specific policy

Reuse canonical operation state, idempotency, ownership checks, encryption, generation/revision fencing and erasure proofs. Keep provider-specific token exchange, stable principal extraction, entitlement checks and refresh semantics inside its adapter.

Do not merge custody tables or rewrite working Codex/Claude flows solely for symmetry. Extract shared mechanics only where an actual new adapter demonstrates the same invariant. An uncertain token exchange/refresh remains uncertain; adding another provider cannot introduce blind retries or weaken existing one-entry guarantees.

## Transport and quota are independent capabilities

Reuse existing sub2api protocol adapters behind the qualified native entry. An ordinary admin proxy path is not a substitute for the customer-facing custody/admission boundary. Each advertised protocol/model needs streaming, tool, usage, cancellation and request-limit coverage; unsupported input is rejected before provider entry.

Keep the existing canonical saved-limits reader. Provider adapters normalize upstream observations into supported dimensions, percentages and actual observation/reset times. No source-generated guess may become a browser quota value.

Some providers emit quota in inference response headers; Coding Plans may require a separate read-only usage endpoint. Their bounded collector belongs in the source layer, independently of the Accounts page. Page/list/saved-snapshot reload must remain inert. Do not silently turn the existing cached-read endpoint into a credential refresh or provider probe. Any user-triggered live refresh requires its own negotiated capability and operation semantics.

Absent dimensions stay absent; an absent observation is not unlimited capacity. Account/subscription quota is distinct from API balance and local ReviewRouter usage.

## Visibility is separate from ownership

A workspace binding permits use according to workspace policy; it does not transfer ownership of account-global quota. The actual personal owner may read their own quota from any already-authorized visible context, including a workspace. Other recipients remain restricted. Workspace-owned accounts require the existing workspace owner/admin authority. Revalidate membership, binding, owner and source/authorization revision after awaited reads and before batch release.

UI copy must distinguish explicit ownership restrictions from unavailable data or failed authorization. A generic failure must not assert that the viewer is not the owner.

## Workspace providers and their selection

Implemented by the [provider registry plan](../plans/2026-10-23-provider-registry-and-unified-setup.md).
A connected account is not yet a reviewer: a workspace provider profile
(`review-config`, `WorkspaceProviderProfile`) pairs one immutable credential
source (Gateway binding, managed key, CI secret, hosted pool or a repository's
rotating Codex) with a model. Policy documents (stored schema 4) select
profiles: the workspace document may name a default, a repository document may
name its own provider; a repository without one follows the default. The
runtime configuration is materialized from those selections and keeps its
contract with the action.

`ProviderManagementPolicy` decides every create, edit, archive, attach and
default change from verified facts; Dashboard -> Other -> Access rights limits
provider management to owners and admins. Writes decide again under their
locks, and the profile-independent part of an edit or archive runs before any
rate limit or network check.

UI: one `ProviderSetupDialog` with a fixed target (one repository, several, or
the workspace) is opened from the provider line above a repository's setup
steps, the row line, step 3 (on the credential the provider needs), the table's
bulk action, the Model section and the Providers list. Dashboard -> Providers
lists the profiles with usage, creator and the actions the viewer may take. A
hosted Codex pool is never chosen there; its session source flow selects it per
repository. Screens and end-to-end flows are qualified with
`pnpm provider-setup:visual` ([operations guide](../operations/provider-setup-visual-qualification.md)).

## Delivery sequence

1. Deliver the visibility/copy correction with owner-versus-recipient regression coverage.
2. Before adding the next provider, extend the SDK capability projection and migrate existing Codex/Claude forms to it without changing their behavior. Preserve compatibility during capability negotiation; unknown auth/input kinds are not advertised.
3. Add one Coding Plan key adapter as the concrete proof of reuse. Configure its exact endpoints, models, credential lifecycle and quota collector; do not add a universal plugin platform.
4. Add Grok or Antigravity through the OAuth capability ports, following a real-account authentication/proxy compatibility spike first.

Acceptance per provider: authenticated enrollment, correct owner/principal, fresh and repeated refresh where applicable, reconnect, erasure and late-write rejection; actual protected native transport; installed SDK consumer; safe cached quota projection; owner/non-owner tests; real browser sign-in handoff/error recovery and a controlled end-to-end provider fixture. A real disposable account canary is required before production activation. Existing Codex and Claude contract regressions remain required.
