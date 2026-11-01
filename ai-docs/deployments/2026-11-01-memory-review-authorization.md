# V4 run-wide memory authorization

Implementation: [PR #776](https://github.com/777genius/review-router-ai/pull/776).
The affected service is API memory capture/admission. Its deployment target is the
shared Web/API/worker/Skills-worker fleet on `prod-hel1-01` (`workers-fsn1-01-jump`),
preserving the diagnostics baseline. Follow the
[release runbook](../operations/07-environments-and-release-management.md).
The local guard, lifetime and diagnostic checkpoints are
[`e6a860526`](https://github.com/777genius/review-router-ai/commit/e6a86052651e26f15eb37eb276ba826f72d76a16),
[`3aa0cc338`](https://github.com/777genius/review-router-ai/commit/3aa0cc338), and
[`4cf5b5379`](https://github.com/777genius/review-router-ai/commit/4cf5b5379).
Check the current PR head's complete mandatory CI; historical checkpoint checks
alone do not qualify a later head.

| Environment | Status        | Actual version                             | Remaining work                                                                 |
| ----------- | ------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| production  | `in_progress` | `e7f2e600acc896448b91ea0a9985c6e766a3c95b` | Retrieval receipts passed; actual reviewer memory context remains unconfirmed. |
| self-hosted | `pending`     | Current main before this fix               | Include fixed API in the next application installation/update.                 |

The private native backend is active and manual memory save/edit/readback works.
The real installed-App review of disposable `777genius/rr-codex-rotating-e2e#134`
(run `41302865788`) nevertheless logged `memory unavailable`, persisted no bundle
receipt, and used `memoryBundleHash=none` for all invocations.

Production incorrectly reused the reviewer-scoped Context Tools authorizer for a
run-wide memory request. V4 requires a reviewer ID for tools. The dedicated memory
request checks every captured Gateway allocation, local repository/installation
authority and protected authorization confirmation. It makes no remote SCM read.
Canonical current-revision checks stay with execution and paid dispatch; Context
Tools retain their reviewer requirement and full SCM check. No schema, Action
wire or automatic-learning activation changes are included.

Before delivery, require the exact source's relevant local checks, technical
review and mandatory CI. Use the normal Hetzner application release, preserving
native memory settings and backend state. No migration is introduced here.
Verify application readiness and perform a fresh explicit test review on the
existing disposable PR only after its preceding run is settled. Require actual
bundle receipts, the expected rule revision in the admitted manifest, and the
configured App's resulting review. Then clean the task's disposable memory through
the authorized Forget lifecycle; do not delete authority rows directly.

Verify the frozen capture-time ceiling is the original maximum run deadline,
capped by entry validity. Token renewal must not extend that original ceiling;
an expired current token must still fail admission. Eligible and denied review
lease/preflight events must expose only allowlisted `phase`, `outcome` and
`elapsedMs` diagnostics, never tokens, memory bodies or raw provider/SQL errors.
Record the exact shipped source/image, verification time and controller receipt,
then require the expected memory hash in both reviewers' actual paid manifests.

After a partial rollout or an ambiguous result, inspect the existing controller
receipt and all four role states before continuing; do not repeat the entire
apply or buy a replacement model request. Roll back through the ordinary fleet
overlay to the recorded `e7f2e600` image below if availability regresses. Preserve
native volumes, generation, credentials and database schema. A rollback restores
the earlier memory limitation and therefore does not close this task.

The local real PostgreSQL17 contract covers review and PR-description bundles,
SQL receipts, unchanged450ms admission, reviewer-scoped tools, current-head
rejection and revocation of the secondary allocation. SCM reads do not increase
with the number of reviewers. Production review-memory E2E is still unverified.

Installed with the shared diagnostics release on 2026-11-01, source
`14bead9640d0b4e6c6741aa5645c2a6c160fdd2f`, image
`sha256:21dc5822d2bee10fd2bc6903d3243aadd7bf05712041292f4d575d089ee983a6`.
All four roles were independently read back running, exact-source and restart-free;
API readiness returned200. Protected receipt:
`/srv/platform/projects/review-router/releases/fleet-overlay-14bead96-7G4aXMdJ`.
See the [shared memory delivery record](2026-11-01-memory-production-startup.md)
and [diagnostics PR #772](https://github.com/777genius/review-router-ai/pull/772).
Native memory settings/state were preserved. No separate memory-only image was
activated. The current shared source and remaining acceptance boundary are recorded below.

The later shared application source
`e7f2e600acc896448b91ea0a9985c6e766a3c95b` (parent `14bead9640d0b4e6c6741aa5645c2a6c160fdd2f`)
is now installed, image
`sha256:7cee23648d3fb708fdf63f99fa0578e8d5726a512b06a5bbc992cdcf4cb6ec8a`.
It keeps receipt preflight local to run authorization. Custody:
`/srv/platform/projects/review-router/releases/fleet-overlay-e7f2e600-QWzrdEu2`.

[Shared acceptance 41318061244](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41318061244)
passed two-reviewer MCP/model acceptance. Two retrieval receipts contained the
approved task entry, but the first planned bundle hash `9b8708d84ae2` became
`none` in the later actual manifest; the second reviewer also used `none`.
Memory delivery is therefore unconfirmed. The silent later-admission refusal and
30-second snapshot lifetime required further investigation. The lifetime follow-up
at PR #776 source `3aa0cc338` / integration checkpoint `5149761f7` is source-only,
pending CI and real application delivery/acceptance. Do not close this task from
the successful MCP/model run or retrieval receipts alone. Self-hosted rollout and
automatic-learning qualification remain pending.

The [shared memory record](2026-11-01-memory-production-startup.md) contains the
separate ENOSPC/recovery evidence and restored acceptance-fixture baseline; the
[companion diagnostics record](2026-11-01-companion-gateway-refusal-diagnostics.md)
tracks the same deployed application without asserting memory acceptance.
