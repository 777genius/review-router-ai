# Native account information and selected connection methods

- Task ID: `2026-11-19-native-account-info-imports`.
- Goal: display authorized native email, actual plan and correctly named dates;
  support Codex refresh-token/auth.json imports and qualified Anthropic/Gemini
  API-key profiles through Account Gateway.
- Affected services: Web; Account Gateway SDK dependency; native and Gateway
  producers must precede the consumer. Personal operation journal compatibility
  is part of the selected import work.
- Implementation: branch `feat/native-account-info-imports`; implementation and
  verification are in progress. A branch or PR does not establish deployment.
- Source baseline: `f1cde67a2baf7416ea1d2341f6c9a98e64750aa4`.
- Canonical contract and parallel plans: `agent-teams-ai/account-gateway`,
  `docs/reference/native-account-contracts.md` and
  `docs/reference/native-account-integration-plan.md`.
- Last updated: `2026-11-19`.

## Environment status

| Environment / target | Status    | Actual deployed version | Last verified | Evidence / next step                                                      |
| -------------------- | --------- | ----------------------- | ------------- | ------------------------------------------------------------------------- |
| staging              | `pending` | Not verified            | Not verified  | This task authorizes local/isolated qualification, not a staging rollout. |
| production           | `pending` | Not verified            | Not verified  | Production deployment is explicitly outside this implementation task.     |

## Scope and prerequisites

Sub2API owns provider requests, credentials and native facts. Gateway owns the
safe public contract and account operations. ReviewRouter owns product visibility,
bindings and UI. Metadata never grants review admission or changes readiness.

M1 adds one server-side metadata feature, one SDK adapter and one shared renderer.
It covers personal, workspace, overview and selected-account detail projections.
The final hydrated array is revalidated before private facts are returned.
There is no metadata database, browser polling endpoint or provider parser in RR.

M2 adds selected import/reconnect methods to the existing operations and forms.
The existing browser/device flows remain compatible. New key profiles require
actual runner/tool-flow qualification; successful key submission alone is not
review compatibility evidence. Additional subscription OAuth, AT-only/mobile/PAT
imports, a new operations engine and production activation are outside scope.

## Ordered rollout for a future authorized release

1. Confirm exact native and Gateway producers expose the accepted versioned
   contracts and pass cross-repository qualification.
2. Verify the exact packed SDK artifact consumed by this revision. Preserve
   existing runtime/profile registration and the producer-first release order.
3. Apply the normal complete migration chain through
   [000160_personal_credential_import_method](../../packages/platform/db/prisma/migrations/000160_personal_credential_import_method/migration.sql)
   before deploying readers or writers that select `credentialImportMethod`.
   The additive nullable column and its immutable-method constraint preserve
   legacy rows; they do not convert existing OAuth methods or intent digests.
4. Install the compatible reader through the
   [release process](../operations/07-environments-and-release-management.md)
   while new import submissions remain disabled. The reader compatibility floor
   is code containing `19ef44c0ef5cb5fcdae44af6c89f0ab666c143f1` or a descendant
   that retains both the new method discriminator and legacy digest handling.
   This identifies a code boundary, not an approved deployment revision.
   Enable the selected writer only after all readers satisfy that boundary and
   the authoritative release gates pass.
5. Verify the owner/borrower visibility matrix, selected-account hydration,
   existing connections and selected new connection methods. Record actual
   versions and evidence for each environment before marking it deployed.

No rollout, activation or live-provider call has been performed by this task.

## Verification and completion

- Scoped Get Modular composition invokes the returned feature API; construction
  performs no Gateway or database I/O. Foundation checks the declared boundaries.
- Metadata is shown only for the authorized owner/workspace. Revoke, detach,
  reconnect, deletion and stalled hydration suppress stale private facts.
- The existing real Next/PostgreSQL visual harness checks representative, long
  and missing information, both themes and responsive widths.
- Codex imports/reconnect preserve existing operation recovery and never replay
  an ambiguous provider exchange. Secret fields clear when the method or owner
  changes and never enter persistence or error text.
- Isolated fixtures, PostgreSQL checks, browser checks and live-provider evidence
  are reported separately. Unrun or skipped checks do not count as passing.

## Retry and rollback

Optional metadata failures preserve authorized inventory and existing review
behavior. Re-read current operation state after uncertain submission; do not
replay a credential exchange automatically. Keep legacy intent hashes readable.
Once a journal row contains `credentialImportMethod`, stop new import submissions
before rollback and keep a compatible reader containing the boundary above.
A pre-M2 reader is not a valid rollback target for those rows. Retain the additive
column, method constraint and trigger; do not drop or rewrite journal identity or
legacy digests as a rollback shortcut. The release record must name the exact
qualified rollback revision. Provider facts remain in Sub2API throughout;
rollback must not create a second facts store.

## Execution log

| Time       | Target       | Step and observed result                                                                                                             | Next action                                         |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 2026-11-19 | local source | Additional plan review identified the final post-hydration privacy fence; canonical contract updated. No runtime checks claimed yet. | Implement M1 and qualify the exact SDK integration. |
