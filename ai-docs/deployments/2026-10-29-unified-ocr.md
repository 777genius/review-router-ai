# Unified OCR discovery and finding verification

## Goal and scope

Deliver one review scenario for the currently supported connection routes:
prepared credentials/transport, OCR discovery, the shared previous-finding
verifier, durable shared request allowance, and existing GitHub App publication.
This record is not deployment authorization. The source PRs are merged with
qualified SaaS candidate N and paired Action A4 as the latest baseline below.
The canonical handoff remains S2. Every subsequently selected integrated SaaS
head requires its own exact-pair checks; earlier source results and local
controlled qualification retain their original scope. This task has not deployed
an environment.

Affected surfaces: API, worker, web, database, approved public Action runtime,
managed OCR artifact, producer/profile registration, and installed callers.
Coordinate actual fleet changes and retirement evidence with the separate
`rr: deploy` task; do not combine them with an unverified container update.

## Environment status

| Environment | Status        | Verified deployed version     | Remaining work                                                                                                                                                                                  |
| ----------- | ------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging     | `pending`     | Not recorded                  | Qualify the selected integrated source; reconcile actual environment; authorized rollout and designated live acceptance.                                                                        |
| Production  | `in_progress` | `533c040d` / image `e1578f75` | Code and migrations deployed, see [Production rollout 2026-10-30](2026-10-30-production-rollout-533c040d.md). Task-specific live verification is not recorded yet: verify below and then close. |

No rollout was executed by this task. `pending` does not prove that an environment
lacks a particular step: reconcile its actual state before acting. Do not copy a
staging status to production or treat CI as deployment evidence.

## Sources of truth

- [Control-plane PR #718](https://github.com/777genius/review-router-ai/pull/718)
- [Public Action PR #346](https://github.com/777genius/review-router/pull/346)
- [Reviewed plan](../plans/2026-10-26-unified-ocr-review.md)
- [Plan review record](../plans/2026-10-26-unified-ocr-review-reviews.md)
- [Earlier acceptance evidence](../operations/2026-10-27-unified-ocr-acceptance.md)
- [Earlier S2/A3 integration checkpoint](../operations/2026-10-29-unified-ocr-integration-status.md)
- [Authoritative release process](../operations/07-environments-and-release-management.md)
- [Review History activation](../operations/review-history.md)
- [Review History deployment task](2026-10-28-review-history.md)
- [Existing dispatch migration](../../packages/platform/db/prisma/migrations/000154_unified_model_dispatch/migration.sql)

Canonical source **S2** is `8080881802d87f3bf700b15faa7cebb02f54ee9b`. Its original
public Action **A3** was `fb132c4ed337141339d487e7c388518178c24b10`; that checkpoint
is preserved in the [earlier integration record](../operations/2026-10-29-unified-ocr-integration-status.md).
The final paired Action **A4** is `925df40c6c5806fe2b6673c5f807fdc6abf2fe40`, as
pinned by [the maintained CI](../../.github/workflows/ci.yml). A4 retains S2's
canonical 64-file handoff without a second canonical export.

Qualified SaaS candidate **N** is `22bbc6cee22c47e4a7f57eac5d176e8c1a035f0d`.
Its main merge `2c9310337a0f4820f6f5b2d74911e19bc06ff83d` has the same source tree;
Action merge `b5f12764d62d0e70e48beff416027e7001c5068b` likewise has A4's tree.
[N CI](https://github.com/777genius/review-router-ai/actions/runs/40962088489),
[N actual-Next/lifecycle acceptance](https://github.com/777genius/review-router-ai/actions/runs/40962088270)
and [A4 CI](https://github.com/777genius/review-router/actions/runs/40961791101)
passed for those exact inputs. Later integrations, including
[PR #740](https://github.com/777genius/review-router-ai/pull/740), retain A4 and
require fresh combined-source qualification. These baseline results do not prove
production adoption. Earlier D/A2 and S2/A3 receipts remain historical.

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
actual Next desktop/mobile checks, and managed OCR qualification. The current
candidate is committed; old temporary-tree and old-pair receipts
remain historical. The selected integration's CI cannot be replaced by earlier
N/A4 results or by local counts.
Do not derive production pins from a branch name or a test fixture.

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
   Never move an old immutable pin to new bytes.
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

2026-10-30: production moved to main `533c040de09d2609c8ebb44474812e2b35f0e7ea` (image `sha256:e1578f75207de943031a6652ab94318433ef311c85fcaa5a1428fef26d08227a`). Migrations through `000154` are applied (including `000152` and `000153`); full evidence is in the [Production rollout 2026-10-30](2026-10-30-production-rollout-533c040d.md). Task-specific checks were not run separately.
