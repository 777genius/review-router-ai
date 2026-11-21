# Native account information and selected connection methods

- Task ID: `2026-11-19-native-account-info-imports`.
- Goal: display authorized native email, actual plan and correctly named dates;
  support Codex refresh-token/auth.json imports and qualified Anthropic/Gemini
  API-key profiles through Account Gateway.
- Affected services: Web; Account Gateway SDK dependency; native and Gateway
  producers must precede the consumer. Personal operation journal compatibility
  is part of the selected import work.
- Implementation: implemented in [PR #914](https://github.com/777genius/review-router-ai/pull/914);
  qualification evidence is tracked in [Gateway PR #116](https://github.com/agent-teams-ai/account-gateway/pull/116).
  A branch, PR or merge does not establish deployment.
- Source baseline: `f1cde67a2baf7416ea1d2341f6c9a98e64750aa4`.
- Canonical contract and parallel plans: `agent-teams-ai/account-gateway`,
  `docs/reference/native-account-contracts.md` and
  `docs/reference/native-account-integration-plan.md`.
- Production rollout plan: [bundle 6 plan](2026-11-21-bundle6-plan.md)
  (native `14f500eb`, Gateway 116, Caddy SDK routes, migration 000160, image).
- Last updated: `2026-11-21`.

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

### How the bundle 6 plan maps these steps (proposed, owner decision D2)

The [bundle 6 plan](2026-11-21-bundle6-plan.md) runs steps 1-4 as: Caddy
SDK routes, native `14f500eb`, Gateway 116, migration `000160`, then one image
for all four roles. There is no switch that keeps import submissions off:
native advertises the Codex import methods whenever Codex OAuth connect and
dispatch are configured. If the owner selects recommendation D2, the plan
drops the separate "reader installed, imports disabled" phase of step 4: the writer becomes
available in the same cutover as the reader, before the canary. What step 4
protects against still cannot happen, because `fleet-overlay` stops every old
container before any new one starts and only Web writes import rows, so no
pre-M2 reader ever runs next to the new writer. The exact rollback revision is
`a02b1607` only while the RR, Gateway kernel and native import counts are all
zero, counted with writers stopped; after the first import the rollback target
is `9c52c250` or a descendant of the reader boundary above, that is fix-forward.

## Qualification tooling maintenance

The consumer now pins the merged runtime compiler maintenance revision
`c7543bc716411a5f899a790a735d09ed2530f779` from
[runtime PR #85](https://github.com/777genius/ar/pull/85). It preserves the frozen
runtime implementation and every existing consumer dependency resolution while
building the owner source with TypeScript 7.0.2. Both installed peer contexts
receive the same exact-source build through the existing preparation script.

The Action bundle normalizer uses Acorn to inspect the generated JavaScript.
Its maintained implementation is now TypeScript and receives a strict native
TypeScript 7.0.2 check in the existing Action artifact gate. The unchanged legacy
build/check entrypoints retain their `.mjs` format for this localized import
correction; they are not claimed to be part of the new strict project. The wider
repository's legacy compiler migration is outside this bounded maintenance.

The generated Action remains byte-identical except for the runtime source SHA
in the third-party notice. Its SHA-256 is
`2bb673a9739690edb734929a2a49483df3e1c316707f973dde4843425e4af02b`.
Public Action publication and production rollout remain separate, unperformed
operations.

The subscription browser readiness listener records early inventory responses
before navigation and starts the existing bounded readiness assertion after the
new page is rendered. Original navigation, assertion and test deadlines, seven
selected scenarios and zero retries/skips remain unchanged. The three-head paired
test now checks the accepted App-owned sticky summary contract: one stable
comment ID, a current revision marker and idempotent replay.

Current-source CI, the complete browser receipt and the joined six-profile
RR → Gateway → Sub2API review flow still precede final qualification. Local
tooling checks do not establish those runtime outcomes.

### Hindsight operation-pagination qualification correction

The fresh [Hindsight qualification run on head 948](https://github.com/777genius/review-router-ai/actions/runs/44848646316)
passed its 56 contract tests and then failed the additional operation-absence
readback. Its partial artifact does not identify the exact failed operation or
phase. Investigation independently demonstrated a pagination defect: native
retain parents and children share a transaction timestamp, and ordering offset
pages only by that timestamp can repeat one ID and omit another.

The existing source-pinned derivative now adds operation UUID as the secondary
descending ordering key. The qualification harness retains one-record pages and
uses the production strict page guard, an independent bounded database census,
matching full-read identities, and every original/discovered/late ID before and
after restart. No deletion, authorization or deadline check is relaxed. Upstream
revision, base-image selection and dependency pins remain fixed; derivative
bytes and the resulting image identity change.

Local verification passed 65 contract tests with zero skips, six native control
fixtures, native TypeScript 7.0.2 for the expanded bootstrap project, lint and
generated-patch application checks. The permanent SQL regression executes the
exact pinned list method against tied fixtures and two legal SQLite plans. It
demonstrates the original 16-page/15-identity defect and complete 16-identity
results after correction; it is not PostgreSQL or native-runtime qualification.
The subsequent [native qualification on cf900602](https://github.com/777genius/review-router-ai/actions/runs/44853638542)
passed all 65 contracts and 32 native checkpoints on actual synthetic
`693c1886909350795cc17400af0058287738f2d2`, tree
`256b7083765e26d0158b3781ab65abfbda2090b2`. Its new image
`sha256:02b21f537bdd4c57daa8b0db74bfe25812d37e82f13dfda0eeee114de35a9f22`
matches build metadata and the final cleanup/restart receipt. Artifact
`14687307689`, ZIP SHA256
`8253ee99e97d97f4195a440b12cff1e5c4246d455a43d0ad5746984366db05e8`,
matched the API, upload log and downloaded bytes. This is native/API/PG17
deterministic-fixture evidence; real-model and production-release flags remain
false. Any later authorized Hindsight rollout must bind its exact qualified
image and receipt; old derivative receipts cannot be reused. No environment
rollout or production migration has been performed.

### Skills fixture scan-grace correction

The [Skills run on cf900602](https://github.com/777genius/review-router-ai/actions/runs/44853638473)
passed 23 of 24 browser cases; the stale Paths editor case timed out before its
save request. The retained trace proves that the original page reloaded before
the second page removed the binding. Both database assertions later confirmed
version one with a different generation, but no `updateBindingScope` request
was sent, so this is not evidence of a failed generation fence.

The populated Skills fixture installations inherited a fresh `createdAt` and
had no scan outbox request. The real model therefore classified them as scanning
inside its 120-second new-installation grace, then unknown outside it. Recorded
reads at ages 106.597 and 138.626 seconds crossed that boundary and triggered a
dashboard refresh. An independent probe of the actual model reproduced this
transition; ageing the same fixtures by one day removed the transition and its
refresh key. This probe is not a replacement for the browser gate.

Only the two existing Skills fixture installations are now seeded as one day
old. The production scan model is unchanged. The stale-editor case additionally
checks its original `performance.timeOrigin` before removal, before save,
after the conflict and after reconciliation. All 24 cases, generation/version
and database assertions, draft checks, 30-second action deadlines and zero
retries remain intact. Native TypeScript 7.0.2, targeted lint and formatting
passed locally; a fresh complete browser run remains required.

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

| Time       | Target                 | Step and observed result                                                                                                                                                                                                                                  | Next action                                                                                                                                                  |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-19 | local source           | Additional plan review identified the final post-hydration privacy fence; canonical contract updated. No runtime checks claimed yet.                                                                                                                      | Implement M1 and qualify the exact SDK integration.                                                                                                          |
| 2026-11-19 | local / isolated       | Source `43e475d455e2931b39adef2652c5b8fe921c693e`: strict scoped metadata typecheck, layout/profile and AST boundary checks passed; 92 focused runtime tests and 12 metadata PostgreSQL cases passed.                                                     | Final CI and exact paired native/CLI qualification are tracked in PR #914 and Gateway PR #116; no complete joined pass or deployment is claimed by this row. |
| 2026-11-21 | production (read-only) | Merged as `9c52c250`; main CI 44877576086 green. Read-only baseline at 13:25-13:50 UTC: the Caddy management site answered 404 to `/v1/account-info/read` and `/v2/provider-connection-capabilities`; ledger 168, 33 personal operations, no import rows. | Recheck the baseline and follow the [bundle 6 plan](2026-11-21-bundle6-plan.md) only after its go/no-go items are resolved; production stays `pending`.      |
