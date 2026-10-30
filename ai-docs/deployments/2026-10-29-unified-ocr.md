# Unified OCR discovery and finding verification

## Goal and scope

Deliver one review scenario for the currently supported connection routes:
prepared credentials/transport, OCR discovery, the shared previous-finding
verifier, durable shared request allowance, and existing GitHub App publication.
This record is not deployment authorization. The earlier source PRs are merged;
their qualified SaaS candidate N and paired Action A4 remain historical evidence.
The canonical handoff remains S2. Every subsequently selected integrated SaaS
head requires its own exact-pair checks; earlier source results and local
controlled qualification retain their original scope. This task has not deployed
an environment. The 2026-10-30 delivery follow-up is committed locally; its
observed qualification and remaining publication blockers are recorded below.

Affected surfaces: API, worker, web, database, approved public Action runtime,
managed OCR artifact, producer/profile registration, and installed callers.
Coordinate actual fleet changes and retirement evidence with the separate
`rr: deploy` task; do not combine them with an unverified container update.

## Environment status

| Environment | Status    | Verified deployed version | Remaining work                                                                                                                  |
| ----------- | --------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Staging     | `pending` | Not recorded              | Qualify the selected integrated source; reconcile actual environment; authorized rollout and designated live acceptance.        |
| Production  | `pending` | Not recorded              | Qualify the selected integrated source; qualified immutable release/defaults; actual environment/history and live verification. |

No rollout was executed by this task. `pending` does not prove that an environment
lacks a particular step: reconcile its actual state before acting. Do not copy a
staging status to production or treat CI as deployment evidence.

## Sources of truth

- [Control-plane PR #718](https://github.com/777genius/review-router-ai/pull/718)
- [Public Action PR #346](https://github.com/777genius/review-router/pull/346)
- [Reviewed plan](../plans/2026-10-26-unified-ocr-review.md)
- [Plan review record](../plans/2026-10-26-unified-ocr-review-reviews.md)
- [Delivery completion plan](../plans/2026-10-30-unified-ocr-delivery-completion.md),
  committed as `cc3b46290ab9b04f831cfcc402b0d24b546305be`
- [Earlier acceptance evidence](../operations/2026-10-27-unified-ocr-acceptance.md)
- [Earlier S2/A3 integration checkpoint](../operations/2026-10-29-unified-ocr-integration-status.md)
- [Authoritative release process](../operations/07-environments-and-release-management.md)
- [Review History activation](../operations/review-history.md)
- [Review History deployment task](2026-10-28-review-history.md)
- [Existing dispatch migration](../../packages/platform/db/prisma/migrations/000154_unified_model_dispatch/migration.sql)

Canonical source **S2** is `8080881802d87f3bf700b15faa7cebb02f54ee9b`. Its original
public Action **A3** was `fb132c4ed337141339d487e7c388518178c24b10`; that checkpoint
is preserved in the [earlier integration record](../operations/2026-10-29-unified-ocr-integration-status.md).
The historical paired Action **A4** is
`925df40c6c5806fe2b6673c5f807fdc6abf2fe40`. A4 retains S2's
canonical 64-file handoff without a second canonical export.

Qualified SaaS candidate **N** is `22bbc6cee22c47e4a7f57eac5d176e8c1a035f0d`.
Its main merge `2c9310337a0f4820f6f5b2d74911e19bc06ff83d` has the same source tree;
Action merge `b5f12764d62d0e70e48beff416027e7001c5068b` likewise has A4's tree.
[N CI](https://github.com/777genius/review-router-ai/actions/runs/40962088489),
[N actual-Next/lifecycle acceptance](https://github.com/777genius/review-router-ai/actions/runs/40962088270)
and [A4 CI](https://github.com/777genius/review-router/actions/runs/40961791101)
passed for those exact inputs. Later integrations, including
[PR #740](https://github.com/777genius/review-router-ai/pull/740), require fresh
combined-source qualification. These baseline results do not prove
production adoption. Earlier D/A2 and S2/A3 receipts remain historical.

The current local delivery pair is SaaS
`5b9da7f6fd94198bd7216ce8f18ef112da35d283` and Action
`4db644c798326cb52d86e4762cabdd24bca2b8c6`.
[The maintained CI](../../.github/workflows/ci.yml) now pins this exact new Action
commit; A4 is no longer its selected pin. These commits preserve the frozen S2
canonical handoff. They have not been pushed or merged remotely.

The owner confirms there are no users. This join authors no new migration,
backfill, customer upgrade framework or rollout coordinator. The actual merged
source inventory has **157 entries**, preserving inherited migration
`000152_review_run_gateway_allocations` and existing
`000154_unified_model_dispatch` unchanged. Reconcile real environment state
through the release process; source counts do not establish installed schema.
The inherited [Gateway-reviewer deployment task](2026-10-29-gateway-multi-reviewers.md)
continues to own its applicable environment prerequisites.

## Prerequisites

The exact SaaS/Action pair must pass its complete CI, generated-contract and
reproducible-bundle checks, adapter tests, disposable PostgreSQL acceptance,
actual Next desktop/mobile checks, and managed OCR qualification. The earlier
qualified candidates and the 2026-10-30 local delivery pair are committed.
Old temporary-tree and old-pair receipts remain historical.
The selected integration's CI cannot be replaced by earlier
N/A4 results or by local counts.
Do not derive production pins from a branch name or a test fixture.

Authenticated GitHub access is currently unavailable: `gh auth status` reports
no accounts, the identity endpoint returns HTTP 401, and the immediate push of
the committed delivery plan failed with `could not read Username`. No remote
write or authenticated workflow dispatch was completed. Restore authorized gh
access before publishing the implementation, opening its draft PRs, running
the final exact-pair hosted gates and completing the authorized merge. Merge
authorization does not authorize automatic deployment.

The owner will supply designated test credentials for final live acceptance.
Real subscription OAuth refresh/writeback, provider behavior and billing, GitHub
OIDC, App-bot publication and resolution require that stage. Synthetic tokens and
wire fixtures never satisfy it. Qualify each offered provider/auth/transport
combination explicitly; do not infer support from a catalogue label.

Inspect existing installed Action pins, runtime/profile approvals, schema state,
active authorizations, outstanding model effects and pending resolve operations.
Record the target environment, database generation, full writer inventory and
release/image identities. Use the existing backup, migration and rollout tools;
do not invent environment-specific commands from this task file.

## Ordered rollout

1. **Release artifacts.** Through the existing release process, publish the exact
   compatible public Action and managed OCR artifact with immutable identity.
   Keep previous releases unchanged. Register the new qualified producer,
   transport capabilities, explicit default profiles and exact contract hashes.
   Use the checked exact-commit release manifest to carry dispatch policy and
   existing reviewer-plan approval through the normal operator registration.
   Native publication must qualify the exact source, create the unused fixed
   tag once, upload to a draft, compare remote tag/assets with qualified bytes,
   and only then publish the prerelease without changing the latest release.
   An existing identity or uncertain partial publication requires inspection;
   never overwrite assets or move an old immutable pin to new bytes.
2. **Database before dependent code.** Reconcile the existing authorized
   migration sequence and apply only actually missing entries, including
   `000152_review_run_gateway_allocations` and `000154_unified_model_dispatch`
   where applicable. Their unchanged SQL SHA-256 values are respectively
   `013e9b1917940ed3a796f8df6fa85a0c9c0cc5a4e76a7b19841911f3ea24bd6d`
   and `0ecebe5d1437544b0be81e946731a8bde39d1d3eb51a3516b465014323c70884`.
   Verify the environment's complete actual inventory against the 157-entry
   source union and the current fresh-replay receipt; historical managed92 and
   historical96 catalogs remain unchanged. A source count is not installed-schema
   proof.
3. **Fleet overlap.** Roll out the approved API/worker/web pair with old/new
   contract compatibility. Preserve already admitted authorizations, original
   deadlines, credential custody, paid-effect fences and exact publication
   reconciliation. Confirm all required writers use the compatible behavior.
4. **History authority.** Follow the Review History task and the existing guarded
   activation protocol. Obtain real, applicable retirement/managed-writer
   evidence from `rr: deploy`. Missing or revoked evidence must keep fresh
   auto-resolution unavailable, even for restored runs; exact reconciliation of
   already issued operations remains available. Never fabricate a history cut.
5. **Installed callers.** Promote Gateway's `workflow-v1` only through its existing
   ABI and expected-current-SHA gates. Use the normal setup/update PR and exact
   merged-source verification for Secrets and Hosted callers. Preserve the
   credential namespace/generation and original Hosted binding. Backend rollout
   alone does not change an immutable installed Action pin. No automatic account,
   model, engine or transport fallback is allowed.
6. **New admissions.** Activate only the qualified route/profile combinations.
   Verify readiness from the confirmed installed runtime, not an unmerged setup
   candidate or a stale healthy flag. Ordinary eligible reviews should use the
   complete behavior without a new user toggle. Preserve explicit supported
   alternatives such as supplied-diff mode without enabling repository tools.
7. **Live acceptance.** Use the designated disposable repository and test
   accounts for the checks below, then record actual environment receipts before
   marking that environment `deployed`.

## Acceptance and monitoring

For every qualified route, commit A must produce new findings; commit B must fix
one, leave one valid, and leave an unprovable one explicitly unverified. OCR and
verifier must use the same original account/model/route. Only eligible positively
verified fixes may be closed; publication must come from the configured GitHub
App bot. Pre-activation comments remain open for manual review; absence of old
history is not repaired by transport unification.

Verify shared allowance exhaustion, cancellation, expiry, stale head, lost model
response, lost settlement acknowledgment, process restart, and resolve response
loss. No uncertain paid request is repeated automatically; no reservation is
refunded to create a second budget. Read back uncertain GitHub effects before
any permitted continuation. A failed verifier must not turn unknown targets
into fixed ones.

Exercise real OAuth refresh and encrypted writeback, including insufficient
access-token lifetime: preserve a confirmed same-account rotation, then deny
inference when the original deadline cannot be met. Confirm cleanup of private
temporary material and that credentials remain in their intended custody.

Record new/existing/next-push activation, concurrent activation, expired/revoked
fleet qualification, installed-client upgrade overlap and mixed result UX.
Capture date, exact code/image/Action/OCR identities, relevant workflow/run URLs,
secret-free receipts and per-route outcome. Do not store tokens, private payloads
or production connection strings in this repository.

## Retry and rollback

Stop new admissions for an unqualified route rather than silently selecting a
fallback. Preserve existing durable reservations and accepted evidence. Restore
only compatible code through the authoritative release procedure; never
reintroduce unqualified legacy writers while guarded history is in use. Do not
reset the history cut, delete unknown-effect records, replay an old refresh token,
or repeat a resolve solely because an acknowledgment was lost.

A failed setup/writeback or caller migration resumes from its original durable
operation and verified readback, not a new identity. Reconcile recorded effects
before retrying. Keep schema changes and interrupted-task evidence visible after
rollback and update both this record and the deployment index.

## Optional memory/conversation dependency

The final export preserves Action main's canonical type-only conversation
companion. Contextual memory and managed conversation require the separately
reviewed server implementation and rollout from SaaS
[#734](https://github.com/777genius/review-router-ai/pull/734). No such runtime,
UI or migration is imported by this completion. Ordinary OCR can continue with
memory unavailable; do not weaken strict parsing or claim a complete live
memory/conversation pair from the type export or OCR qualification.

## Evidence log

2026-10-29: committed main integrations and source **S** replace the earlier
pending integration checkpoint. Local controlled qualification passed 25/25;
subsequent isolated setup-cleanup verification passed 1/1 overlapping comparison.
Actual Next passed 2/2 with Sol visual GO; actual bundle tests passed 3/3 and the
separate official auth-only helper passed 1/1. These scopes are documented in
the acceptance record and are not summed into a unique-test count.

2026-10-29 current-main completion: S2 `8080881802d87f3bf700b15faa7cebb02f54ee9b` and A3
`fb132c4ed337141339d487e7c388518178c24b10` publish the reviewed join, deterministic 64-file
contract union and normal wrappers. Scoped source checks qualified 202 distinct
tests after the one stale inventory-assertion correction; full current-pair
results remain on the linked PR checks. The wrapper's curated Codex **0.135.0**
archive is unchanged; the separate **0.147.0** auth-only helper has a different
qualification scope. Prior D/A2 hosted gates passed and remain historical green
proof. Both staging and production remain pending. No deployment, release/tag
promotion, live provider request, producer registration, production history
activation or installed customer workflow update was performed by this task.

2026-10-30 delivery follow-up: the plan is committed as
`cc3b46290ab9b04f831cfcc402b0d24b546305be`; implementation is committed locally
in the SaaS/Action pair recorded above.
Three plan-review rounds with three independent critics completed, and the
second implementation review returned GO after the concrete findings were
corrected. These source reviews do not qualify a final immutable release pair.
The review fixes include exact nonrecursive detection of an empty committed
policy tree, a disposable named clone for detached Action checkouts, full Git
history for canonical provenance, and rejection of a dirty original Action
source before importing its executable modules.

The local implementation adds an explicit Action dispatch policy file and
carries its exact committed contents through release generation, exact
checking, operator parsing and producer registration, retaining the existing
reviewer-plan approval. The native publisher uses one-time exact tag creation,
draft asset upload, remote-byte verification and final publication. Ordinary
Action release restores committed bundles before identity checks. Browser
acceptance rejects an explicit source mismatch before fixture creation, with
historical Git objects available to the exact-release bridge. The bridge has
passed from the clean detached Action commit `4db644c798326cb52d86e4762cabdd24bca2b8c6`
through the real generator/checker, operator codec, `ManageProducerReleases`,
Prisma registration/readback and admission. It selected exact
`ocr-managed-v5` / `1.13.1-rr.6`, with binary SHA-256
`9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`.
The first head published four findings. The next head made four discovery
requests and one verifier request under the original nine-request shared
allowance, resolved two threads and retained three unresolved threads.
Completed replay added zero model or GitHub effects. These are controlled
external boundaries, not live-provider or remote App/OIDC acceptance.
No new schema migration, backfill, flag or rollout framework was
added; the owner continues to confirm that there are no users.

Passed local groups are recorded separately: 61 release/operator/domain tests,
13 source-identity tests, two dirty-source tests, 24 native-publisher tests and
four native CLI cases. The application build completed **48 build tasks**;
these are not test cases. API/worker builds and typechecks also passed.
These groups are not summed into a unique-test count.

The full Action Jest run passed 266 suites and 4,244 tests, failed one wrapper
test because Docker was missing (`ENOENT`), and skipped six suites / 23 tests.
That wrapper could not run its three fresh PostgreSQL-container revisions; the
full Action test gate is therefore not green. The Docker CLI, daemon and socket
are absent, capabilities are zero, and rootless `uid_map` is read-only. The
existing CI Docker gate is unchanged and remains required. Full Action lint
reported zero errors and 398 baseline warnings; typecheck, build and committed
dist parity passed.

The maintained **six-file paired suite passed 44/44**, with zero failures or
skips, in **348.17 seconds** on exact SaaS `5b9da7f6fd94198bd7216ce8f18ef112da35d283`
and detached Action `4db644c798326cb52d86e4762cabdd24bca2b8c6`, using the real pinned
OCR binary and PostgreSQL **17.11**. The breakdown is 24 lifecycle cases, four
Gateway multi-reviewer cases, seven review-investigation cases, six direct
OpenRouter cases, one banner case and two PR-description cases. The JSON
report's seven suite entries include a nested describe; they are not seven
files. All seven production routes record four first-head findings, two
next-head native resolves, three unresolved threads and completed replay with
zero provider/publication/resolve effects. The separate focused registration
bridge overlaps the lifecycle group and is not an additional unique case.

Actual Next **16.2.11** / Playwright **1.64.1** passed desktop/mobile acceptance
**2/2**, with zero failures or skips, in **30.6 seconds** on exact SaaS HEAD
`5b9da7f6fd94198bd7216ce8f18ef112da35d283`. All six actual captures covering
desktop/mobile, light/dark and empty states were visually reviewed, with GO;
a second reviewer also inspected desktop light and mobile dark. The run used official Chrome
**156.0.8078.79** through the existing `--browser-executable` option after the
pinned Playwright browser download failed. Isolated stock PostgreSQL **17.11**
applied **157/157** existing migrations with exact source checksums, and boot
checks passed.

The UI source-delta receipt is
`61b8cac967c71e52ac9d15fd44a7b34625914d3747f310506039b9ba924d6258`: Next generated
only the `apps/web/next-env.d.ts` import-path change from `.next/types` to
`.next/dev/types`, with no executable UI change. Its diff is preserved and that
file was restored. Earlier shared-PostgreSQL-role and long-`TMPDIR` Chrome
attempts remain failed environment receipts; the successful run used isolated
PostgreSQL and the corrected local socket path, with no migration source change.

Local receipts are `tmp/delivery-paired-e2e.{json,log}`,
`tmp/delivery-registration-bridge.{json,log}`, `tmp/delivery-progress.json` and
`tmp/accounts-reference-e2e/runs/unified-ocr-delivery-5b9da7f6-stock-pg-shorttmp/`
(`result.json`, `playwright-result.json`, `migration-readback.json` and
`browser-artifacts/`). These local artifacts do not replace the outstanding
authenticated hosted CI and Docker gate.

The production bootstrap URL
`https://github.com/777genius/review-router/releases/download/ocr-v1.13.1-rr.6/opencodereview-linux-amd64`
returned HTTP 404 on 2026-10-30. The new publisher has not published that native
release. No remote implementation publication, environment producer
registration, channel promotion or environment rollout occurred during this
follow-up. Authenticated GitHub access and designated live provider credentials
remain unavailable. No current-pair remote CI, live-provider acceptance, merge
or deployment is claimed.
Staging and production remain `pending`; reconcile their actual schema/fleet
state and coordinate applicable rollout/history authority with `rr: deploy`
only through the separately authorized release/deployment process.
