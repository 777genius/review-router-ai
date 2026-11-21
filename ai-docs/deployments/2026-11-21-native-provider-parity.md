# Native provider parity: deployment

- Task ID: `2026-11-21-native-provider-parity`.
- Goal: use native connection descriptors in the existing account interface,
  retain exact connection methods during recovery, and carry native identity
  through lifecycle, model selection, runtime admission and usage.
- Affected targets: Web, API, worker and PostgreSQL; coordinated native and
  Gateway producers and the exact vendored SDK.
- Implementation PR: [ReviewRouter #959](https://github.com/777genius/review-router-ai/pull/959).
- Implementation reference: the final reviewed head of that PR; record the
  immutable release revision before any rollout. A PR head is not deployment evidence.
- Dependencies: [native account information and imports](2026-11-19-native-account-info-imports.md),
  [native ownership](../architecture/64-gateway-native-ownership-and-model-catalog.md),
  and the producer/SDK revisions in
  [SDK provenance](../../vendor/account-gateway/native-provider-parity-sdk-provenance.json).
- Last updated: `2026-11-21`.

## Environment status

| Environment / target | Status    | Actual deployed version | Last verified | Evidence / next step                                                               |
| -------------------- | --------- | ----------------------- | ------------- | ---------------------------------------------------------------------------------- |
| staging              | `pending` | Not verified            | Not verified  | Qualify exact native, Gateway and consumer revisions before an authorized rollout. |
| production           | `pending` | Not verified            | Not verified  | This implementation task does not authorize production deployment.                 |

## Applicability and prerequisites

The producer owns provider HTTP, credential grammar and provider facts. Gateway
owns custody, versioned descriptors, effect fences and operation receipts. RR
renders the fixed browser/device/credential-form interactions, authorizes the
current user and workspace, and applies existing mirror and binding rules.
Native credential kinds remain explicit; old API/OAuth discriminators are not
reused for cloud or delegated identity.

Verify the exact packed artifact and lockfile integrity. The SDK source commit,
source hashes and tarball hash must agree with the producer qualification record.
Successful isolated fixtures and a green PR are separate from live-provider and
production evidence. New providers require the native execution/tool contract,
not just a successful credential submission.

## Ordered rollout for a future authorized release

1. Follow the [release process](../operations/07-environments-and-release-management.md)
   and reconcile the current fleet, schema and earlier account cutovers. Qualify
   native connections, v3 Gateway lifecycle and the exact installed consumer.
2. Apply the complete normal migration chain through
   [000161_native_connection_intent](../../packages/platform/db/prisma/migrations/000161_native_connection_intent/migration.sql)
   before any RR reader or writer selects `nativeConnection`. The additive
   nullable column and immutable-selection checks preserve legacy rows and
   their original intent hashes. Do not edit old migrations or frozen historical
   manifests; the current checkout admits the checksum-bound extension.
3. Install compatible native and Gateway producers, then the RR reader fleet
   containing this PR and its exact SDK. Keep new native-method enrollment
   unavailable until all readers support the safe connection snapshot and
   lifecycle v3. Bind the release and rollback floor to immutable commits in
   the actual rollout record before enabling descriptors.
4. Confirm existing accounts remain listed, even when a new native profile is
   absent from old configured profile IDs. Verify an owner-scoped connection,
   recovery after discovery loss, reconnect, suspend/resume, current model
   admission and usage attribution with the qualified native profiles.
5. Record environment, source/image/SDK identities, operator, UTC timestamps and
   actual receipts before widening rollout or marking the environment deployed.

## Verification and completion

- Native browser/device/structured fields use the same account operations;
  unsupported required primitives disable their own method, leaving supported
  siblings usable. Credentials and challenges stay transient.
- PostgreSQL preserves the selected profile, method revision and configuration
  generation across a fresh reader; changed selections and raw SQL retargeting
  are rejected. The complete migration chain preserves legacy configuration.
- A pinned receipt remains readable and continuable after catalog loss without
  rediscovering or substituting a method. An ambiguous effect stays readback-only.
- Browser qualification uses the real authenticated Next app, real PostgreSQL
  and Chromium against a controlled Gateway contract fixture. Joined native and
  live-provider evidence must be recorded separately.
- Runtime selection and usage retain native profile/policy identity and the
  existing live authorization/epoch fences. Private metadata never grants admission.

## Retry, partial completion and rollback

Inspect the existing operation before retrying; never automatically replay an
unknown credential exchange. Keep journal IDs, method/revision/generation and
credential-policy attestations intact. Once any journal contains a native
selection, a reader predating this PR is below the rollback compatibility floor.
Stop new enrollment before rollback and retain a compatible reader for all
existing receipts. Keep the additive column, trigger and checks; do not rewrite
receipts or drop schema as a rollback shortcut. Provider credentials and facts
remain native-owned throughout.

No environment rollout, production migration or live-provider call is claimed
by this deployment task.
