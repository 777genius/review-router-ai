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
- Last updated: `2026-11-25`.

## Environment status

| Environment / target | Status      | Actual deployed version         | Last verified | Evidence / next step                                                               |
| -------------------- | ----------- | ------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| staging              | `pending`   | Not verified                    | Not verified  | Qualify exact native, Gateway and consumer revisions before an authorized rollout. |
| production           | `installed` | `f20a75ed` / `sha256:2a601d6b…` | 2026-11-26    | Fleet and producers installed; 52-scenario and live account verification pending.  |

## Current acceptance scope

On `2026-11-25`, the owner explicitly excluded TypeSafe from mandatory provider
acceptance. The other 52 provider/method scenarios remain required. The exact
excluded row is
`typesafe-systemone-apikey-v1/api_key/provider_api_key`. Preserve the original
53-row inventory and historical results: TypeSafe's unsupported review observation
is an explicit exclusion, not a successful generative review. The Gateway
qualification applies the exact exclusion and still requires all 52 remaining
reviews, terminal state, erasure and reader checks.

The current integration combines provider source
`98228d9f58c476b6faba34324af9841e28e3f530` with main
`919a5add21a40d9adee064bf23b2e4217bd7e040`. It retains the native TypeScript toolchain,
Prisma `7.9.0`, the exact native SDK and reviewed dependency policies. Earlier
green checks on `1a2d85c3c93222263775784e3313ccc9c5f09f70` do not qualify this
combined source. Record the final immutable integration revision and its actual
consumer, browser and joined-producer checks before marking implementation
acceptance complete. Staging and production remain separate pending rollout
targets.

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
- The immutable RR reader at `38eb54a1706658fc005eba99d5c774c50005df90`
  uses its exact admitted SQL runtime closure. Qualification compares all 23
  selected lock snapshots, dependency edges and package integrities, then copies
  and checks complete package bytes and the previously qualified generated
  Prisma client. Unrelated application lockfile changes do not substitute a new
  reader dependency graph. The fresh reader process verifies the copies and
  their links before imports and rejects module resolution outside those copies
  and the exact old production bundle. The current Prisma schema formatter is
  recorded separately from the historical reader runtime; it is not described
  as an old generator. Source/schema checks, read-only PostgreSQL, three operation
  states and unchanged persisted rows remain required. This is test tooling and
  adds no production dependency, migration, configuration or activation step.
- A pinned receipt remains readable and continuable after catalog loss without
  rediscovering or substituting a method. An ambiguous effect stays readback-only.
- Personal native enrollment validates the same lowercase UUIDv4 nonce used by
  read and continuation before reserving an operation or contacting Gateway.
- Existing native providers remain editable without a direct-provider setup
  definition. Edits preserve the profile, account binding and model authority;
  credential storage alternatives appear only when that provider supports them.
- Browser qualification uses the real authenticated Next app, real PostgreSQL
  and Chromium against a controlled Gateway contract fixture. Joined native and
  live-provider evidence must be recorded separately.
- Runtime selection and usage retain native profile/policy identity and the
  existing live authorization/epoch fences. Private metadata never grants admission.
- Existing account identity uses the current lifecycle credential kind before a
  legacy catalog hint. Explicit unknown/native kinds never become API key or
  OAuth labels; native credential policy remains visible from its attestation.
- Browser model fixtures serve native v2 snapshots only for their enrolled
  owner/profile/authorization epoch. Unsupported v1 discovery remains explicit;
  browser selection uses current catalog labels and checks the distinct
  completed enrollment and reconnect receipts.
- Joined CLI qualification requires one completed controlled `pwd` reply before
  forwarding the continuation. It verifies the exact checkout and zero exit,
  rejects running sessions and execution failures, and records only fixed
  diagnostic booleans. The two-request bound and strict Action audit remain.

## Installed SDK source coherence

The current SDK provenance changed after the conversation source stamp was
generated. Regenerate the stamp and standalone conversation verifier together
with the owning `check-conversation-source-stamp.ts --write` and
`check-conversation-release-verifier.ts --write` commands. The verifier's only
code-byte change is the SDK provenance digest; parser behavior, declarations
and bundled dependency license remain unchanged.

On the earlier SDK-only source, Node `26.11.1` source-coherence checks passed
after regeneration. The existing memory bootstrap, setup and fleet-overlay tests
passed 57 cases; two
real Docker Compose cases remain skipped locally because Docker is unavailable.
Those historical local results do not replace the current integration's required
source-coherence checks or CI gates.

The stamp records installed source identity, not conversation qualification.
Existing operator declarations remain intact, and a declaration for the old SDK
does not authorize the new source. Before a future authorized rollout enables
full-thread Gateway conversations, requalify them against the exact installed
SDK and source profile as required by the existing native ownership rollout.

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

## Production installation — 2026-11-26

RR `f20a75edbc7eff11be4f2423fb2e723f6e484223` / `sha256:2a601d6bffaebea0c2cdd4e1cf82c95a10312136b173f56e837f15a09aa0d810`, Gateway `c6d73002ac28bb11c3d2e88d135a05c7f2f06bd6`, and native `9fc45a440eefcad815e16775200407b839419313` launcher `sha256:5a3e6b93e2d96f639188ee28cacfe92a985d079265de30db838173786a3c17b8` were installed. RR migration 000161, native 260–266 and Gateway 013 applied. Four RR roles and API readiness passed; native process identity and Gateway service readiness passed, admission reopened. New native-method enrollment was not enabled; the 52-scenario acceptance, live account/recovery/reconnect/model/usage qualification and backup restore remain pending. Do not treat service readiness as complete product acceptance.

Initial producer starts failed because the staged executable was the private engine rather than the foreground `cmd/account-gateway` launcher. Old service/admission were restored between attempts; a synthetic fullstack smoke with the corrected launcher passed before installation. Durable evidence: `/srv/platform/projects/review-router/account-gateway/rr959-prepared-20261126/v7-ready-fenced.json`, `/srv/platform/projects/review-router/releases/fleet-overlay-f20a75ed-oLiXCpng`, and `/srv/platform/projects/review-router/account-gateway/backup-rr959-20261126-v7`. Free production disk was approximately 2.4 GiB after rollout.

## Production native-method availability — 2026-11-26

At 21:58 UTC the existing eight native profiles were enabled through the
`native-account-capabilities/v2` Gateway configuration, preserving their
previous limits, token bounds and bearer grants. The current RR and producer
revisions did not change. Gateway configuration SHA256 is
`a49b517f855f20930f5adf83cedd368b73bd9ae9dab95f9ddb6927b365cafdd8`.
The fenced restart completed, the Gateway was active, admission reopened, and
both management and consumer-control V3 catalog reads returned HTTP 200 with
eight profiles. The catalog includes the newly exposed Codex and Grok native
methods; native discovery returned no additional provider profile IDs.

The stopped backup and activation evidence are retained under
`/srv/platform/projects/review-router/account-gateway/backup-native-methods-20261126-v1`,
`/srv/platform/projects/review-router/account-gateway/rr959-prepared-20261126/native-methods-ready-fenced-v1.json`,
and `/srv/platform/projects/review-router/releases/gate-native-methods-20261126`.
The owner requested activation without the extended live test suite. Actual
browser visibility, account enrollment and live provider/model/Usage behavior
remain unverified; this is availability, not completion of the 52-scenario
acceptance. Once native selections are recorded, an older reader may be below
the rollback floor; preserve the compatible reader and receipts.
