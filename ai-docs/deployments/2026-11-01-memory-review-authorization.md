# V4 run-wide memory authorization

| Environment | Status        | Actual version                             | Remaining work                                                           |
| ----------- | ------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| production  | `in_progress` | `14bead9640d0b4e6c6741aa5645c2a6c160fdd2f` | Installed; verify one shared App review with an admitted memory receipt. |
| self-hosted | `pending`     | Current main before this fix               | Include fixed API in the next application installation/update.           |

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

Installed with the shared diagnostics release on 2026-11-01, source
`14bead9640d0b4e6c6741aa5645c2a6c160fdd2f`, image
`sha256:21dc5822d2bee10fd2bc6903d3243aadd7bf05712041292f4d575d089ee983a6`.
All four roles were independently read back running, exact-source and restart-free;
API readiness returned200. Protected receipt:
`/srv/platform/projects/review-router/releases/fleet-overlay-14bead96-7G4aXMdJ`.
See the [shared memory delivery record](2026-11-01-memory-production-startup.md)
and [diagnostics PR #772](https://github.com/777genius/review-router-ai/pull/772).
Native memory settings/state were preserved. No separate memory-only image was
activated. Installed-App memory acceptance remains pending the one shared canary.
