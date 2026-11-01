# V4 run-wide memory authorization

| Environment | Status    | Actual version                             | Remaining work                                                                                      |
| ----------- | --------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| production  | `pending` | `d5f16400e610e6fe9151c23da39868825d332711` | Deliver verified authorization fix and repeat installed-App review with an admitted memory receipt. |
| self-hosted | `pending` | Current main before this fix               | Include fixed API in the next application installation/update.                                      |

The private native backend is active and manual memory save/edit/readback works.
The real installed-App review of disposable `777genius/rr-codex-rotating-e2e#134`
(run `41302865788`) nevertheless logged `memory unavailable`, persisted no bundle
receipt, and used `memoryBundleHash=none` for all invocations.

Production incorrectly reused the reviewer-scoped Context Tools authorizer for a
run-wide memory request. V4 requires a reviewer ID for tools. The dedicated memory
request now checks every captured Gateway allocation and shares the existing
SCM/current-revision and protected authorization confirmation. The Context Tools
reviewer requirement remains intact. No schema, Action wire or automatic-learning
activation changes are included.

A later production privilege probe identified a separate admission failure:
`reviewrouter_api` intentionally has SELECT-only repository access, whereas raw
`FOR SHARE` requires UPDATE privilege. Memory admission now uses the existing
workspace-scoped `rr_review_run_checkout_repository_lock` SECURITY DEFINER helper
from migration135 for both the reviewed repository and linked source repositories.
No grants or migrations change. Thirteen PostgreSQL17 regressions include the
restricted caller succeeding through that actual helper while direct row locks
and repository writes remain denied, and concurrent archive writes remaining
blocked until the memory admission transaction ends. This follow-up is not yet
installed; the production delivery boundary below remains open.

Before delivery, require the exact source's relevant local checks, technical
review and mandatory CI. Use the normal Hetzner application release, preserving
native memory settings and backend state. No migration is introduced here.
Verify application readiness and perform a fresh explicit test review on the
existing disposable PR only after its preceding run is settled. Require actual
bundle receipts, the expected rule revision in the admitted manifest, and the
configured App's resulting review. Then clean the task's disposable memory through
the authorized Forget lifecycle; do not delete authority rows directly.

The local real PostgreSQL17 contract covers review and PR-description bundles,
SQL receipts, unchanged450ms admission, reviewer-scoped tools, current-head
rejection and revocation of the secondary allocation. SCM reads do not increase
with the number of reviewers. Production review-memory E2E is still unverified.
