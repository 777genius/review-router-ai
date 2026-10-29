# Unified OCR discovery and finding verification

## Goal and scope

Deliver one review scenario for the currently supported connection routes:
prepared credentials/transport, OCR discovery, the shared previous-finding
verifier, durable shared request allowance, and existing GitHub App publication.
This record is not deployment authorization. Main integration, canonical source
handoff and local controlled qualification are complete in draft PRs; final-pair
GitHub CI on **M/A** remains pending. Source implementation reviews and the final
documentation recheck returned GO; both P2 wording findings are closed. This task has not deployed
an environment.

Affected surfaces: API, worker, web, database, approved public Action runtime,
managed OCR artifact, producer/profile registration, and installed callers.
Coordinate actual fleet changes and retirement evidence with the separate
`rr: deploy` task; do not combine them with an unverified container update.

## Environment status

| Environment | Status    | Verified deployed version | Remaining work                                                                                         |
| ----------- | --------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Staging     | `pending` | Not recorded              | Final M/A CI; reconcile actual environment; authorized release/rollout and designated live acceptance. |
| Production  | `pending` | Not recorded              | Final M/A CI; qualified immutable release/defaults; actual environment/history and live verification.  |

No rollout was executed by this task. `pending` does not prove that an environment
lacks a particular step: reconcile its actual state before acting. Do not copy a
staging status to production or treat CI as deployment evidence.

## Sources of truth

- [Control-plane PR #718](https://github.com/777genius/review-router-ai/pull/718)
- [Public Action PR #346](https://github.com/777genius/review-router/pull/346)
- [Reviewed plan](../plans/2026-10-26-unified-ocr-review.md)
- [Plan review record](../plans/2026-10-26-unified-ocr-review-reviews.md)
- [Earlier acceptance evidence](../operations/2026-10-27-unified-ocr-acceptance.md)
- [Current integration checkpoint](../operations/2026-10-29-unified-ocr-integration-status.md)
- [Authoritative release process](../operations/07-environments-and-release-management.md)
- [Review History activation](../operations/review-history.md)
- [Review History deployment task](2026-10-28-review-history.md)
- [Existing dispatch migration](../../packages/platform/db/prisma/migrations/000154_unified_model_dispatch/migration.sql)

Main integration and this registry entry are already committed. Canonical
source **S** is `dccf5b628680bd7f3f8c9501e3108e432053495b`. The published
Action **A** is `cfe2b78fba925e3e7741d8c7f479324aa785d12b`; SaaS pin **P** is
`ff033fd0056e84f522c2b62799a48c56e5613cbd`. Published merge **M** is
`841f44f0900409692559286cdbb00ac319a40664`. Their validation state is recorded in the
[current checkpoint](../operations/2026-10-29-unified-ocr-integration-status.md);
final-pair CI on the current-main test/docs merge descendant is still pending.
The join preserves **S/A**, all protected inputs and the Action pin; its bounded
three-case source/comparison checks do not replace full CI. Local 25-case qualification, the isolated cleanup
rerun, actual Next/visual review and executable proofs retain their separate
scopes in the [acceptance record](../operations/2026-10-27-unified-ocr-acceptance.md).

The owner confirms there are no users. Completion added no schema migration,
backfill, customer upgrade framework or rollout coordinator. The existing
156-entry migration inventory includes `000154_unified_model_dispatch`; reconcile
actual environment state through the release process rather than inventing or
reapplying a migration from a candidate count.

## Prerequisites

The exact SaaS/Action pair must pass its complete CI, generated-contract and
reproducible-bundle checks, adapter tests, disposable PostgreSQL acceptance,
actual Next desktop/mobile checks, and managed OCR qualification. The current
candidate is committed; old temporary-tree and old-pair receipts
remain historical. Final **P/A** CI is not replaced by those or by local counts.
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
   `000154_unified_model_dispatch` where applicable. Its SQL SHA-256 is
   `0ecebe5d1437544b0be81e946731a8bde39d1d3eb51a3516b465014323c70884`.
   Verify the environment's complete actual migration inventory. The integration
   candidate has 156 entries; historical managed92/historical96 catalogs must
   remain byte-identical. A candidate count is not proof of installed schema.
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

Final M/A GitHub CI remains pending. Source implementation reviews and the final
documentation recheck returned GO; both P2 wording findings are closed. Both staging
and production remain pending. No deployment, release/tag promotion, live
provider request, production history activation or external workflow update
was performed by this task.
