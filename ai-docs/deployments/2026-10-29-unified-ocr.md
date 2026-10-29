# Unified OCR discovery and finding verification

## Goal and scope

Deliver one review scenario for the currently supported connection routes:
prepared credentials/transport, OCR discovery, the shared previous-finding
verifier, durable shared request allowance, and existing GitHub App publication.
This record is not deployment authorization. The implementation remains in draft
and has unresolved integration/acceptance gates.

Affected surfaces: API, worker, web, database, approved public Action runtime,
managed OCR artifact, producer/profile registration, and installed callers.
Coordinate actual fleet changes and retirement evidence with the separate
`rr: deploy` task; do not combine them with an unverified container update.

## Environment status

| Environment | Status    | Verified deployed version | Remaining work                                                                                                  |
| ----------- | --------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Staging     | `pending` | Not recorded              | Finish implementation gates; reconcile actual fleet and schema; authorize and execute rollout; live acceptance. |
| Production  | `pending` | Not recorded              | All applicable implementation, release, migration, fleet, caller-upgrade, history and live verification gates.  |

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
- [New dispatch migration](../../packages/platform/db/prisma/migrations/000154_unified_model_dispatch/migration.sql)

Main's deployment registry is not yet integrated into this feature branch. Add
this task to `ai-docs/deployments/README.md` when that integration is committed;
preserve the existing Review History entry and its per-environment status.

## Prerequisites

The exact SaaS/Action pair must pass its complete CI, generated-contract and
reproducible-bundle checks, adapter tests, disposable PostgreSQL acceptance,
actual Next desktop/mobile checks, and managed OCR qualification. The temporary
merged tree described in the checkpoint is not a release artifact. Do not derive
production pins from an uncommitted candidate, a branch name, or a test fixture.

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
2. **Database before dependent code.** Apply the authorized compatible migration
   sequence, including `000154_unified_model_dispatch`. Its SQL SHA-256 is
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
   alone does not update immutable customer Action pins. No automatic account,
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

## Evidence log

2026-10-29: task created; staging and production remain pending. No deployment,
release promotion, live provider request, production history activation or
customer workflow update was performed. Implementation checkpoint records the
remaining Git integration and exact-pair acceptance work.
