# V4 run-wide memory authorization

Implementation: [PR #776](https://github.com/777genius/review-router-ai/pull/776).
Production authorization, retrieval and delivery to both actual reviewers were
verified on 2026-11-02. This covers approved Memory; automatic learning and its
real qualification remain pending in [draft PR #774](https://github.com/777genius/review-router-ai/pull/774).
The [release runbook](../operations/07-environments-and-release-management.md) remains authoritative.

| Environment | Status     | Actual version                             | Remaining work                                                        |
| ----------- | ---------- | ------------------------------------------ | --------------------------------------------------------------------- |
| production  | `deployed` | `57cc15137e62068ccf12b98eb4206b2dbbf43fef` | Authorization/retrieval E2E and both signed physical Forget verified. |
| self-hosted | `pending`  | Fixed API/client update not verified       | Deliver and verify through normal installation/update.                |

## Current deployment

All four Web/API/worker/Skills-worker roles on `prod-hel1-01` run source
`57cc15137e62068ccf12b98eb4206b2dbbf43fef`, preserving the deployed Gateway
diagnostics. Protected-main merge `8c6be7331b68942dbbd21bd6b205947df75f0c44`
has the same source tree.
Image: `sha256:3550f3c7ea126acdef99b25305afecc9a0462defdb380107743f9e6943637171`.
Exact-source mandatory CI passed. Protected application receipt:
`/srv/platform/projects/review-router/releases/fleet-overlay-57cc1513-ZHJrnskW`.

Public Action [v1.0.225](https://github.com/777genius/review-router/releases/tag/v1.0.225),
merged source `034d367f5a3a0358fe5a850f496362d504f3028a`, completed official
release and workflow-channel promotion. Its client-only Memory admission deadline
is 2,000 ms; the server's 450 ms guard, wire schema, hashes and lease authority are unchanged.
Safe closed diagnostics replace silent admission failures; historical timeout was
not proved. Producer adoption completed through release controllers
`fleet-overlay-action225-overlap-034d367f-20261102-v2` and
`fleet-overlay-action225-primary-034d367f-20261102-v2`. All four roles use the new
primary reference; 53 approved inventory rows retain the prior 52. Application
source/image and native state were preserved. Final readback: all roles running,
zero restarts, seven worker privilege checks passing and API readiness 200.

## Actual reviewer delivery and cleanup

[Run 41374304955](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41374304955)
completed on disposable PR #134 at source head
`3e49b31278c1a70eae36cad05ad35a020095c757`, repository configuration 86 and
unchanged workspace configuration 21. Both configured reviewers produced actual
`gpt-6.1-sol` observations. Each accepted manifest used bundle
`c9a80006b3f6c7d882add04f0aaf392d72fbfb9bc9d6b11f3c56645495640f6c`;
the matching receipt contained the task's approved entry, and both observations
matched their accepted manifests and dispatch fences. Both review leases were
released. Auxiliary description delivery was excluded from this proof. The App
published finding `4438282421` citing the Memory rule. Both Gateway requests
completed and their closes were applied.

Private evidence: `tmp/memory-production/actual-memory-e2e-225.json` and
`paid-memory-delivery-proof-41374304955.txt` (SQL export SHA-256
`b44b019efbdee203c883222ac8fc3ff21df58b108eb871ad78b25227473ae499`).
Private workflow-log SHA-256:
`e176bf0864e4b7edca3bb0ee222a9a67449ddde8e14af848e92103fc744ef7b3`.
Prompts, credentials and memory bodies remain private.

The normal configuration writer restored the original singleton policy as
repository version 87, preserving workspace version 21 and disabled MCP settings. PR #134
was closed and its temporary branch deleted. Both task-owned entries completed
normal physical Forget using operator source SHA-256
`7dd099afcfa597f19f79d0edfa0b8313490f1e2a7f4cbbd520a5f135a1942906`.
Signed receipt SHA-256 values:
`cd8ad5647b75cb849f360608960721d4c2f4838353b318dd2e37d01ea25d7ff3`
and `75db1ca7e0bde42cf5a3ddffd4a4bc56300cd0a9e94ca73823028fd398c835a4`.
Both commands completed with physical absence verified before and after native
writer restart. Maintenance paused at epoch 1 and resumed at epoch 2 with
`paused=false`. Native API/worker IDs stayed the same; PostgreSQL container
`6fd5ab3e07ed` retained start time `2026-11-01T11:19:16.819031036Z`.
Provider/SCM authority, volumes, generation and credentials were preserved.

## Repair and recovery boundary

The API uses dedicated run-wide Memory authorization across all captured Gateway
allocations; Context Tools retain reviewer-scoped authorization and SCM checks.
Restricted-role admission uses migration135's existing
`rr_review_run_checkout_repository_lock` helper, including linked repositories;
no grants or migration were added. The original run-deadline ceiling survives
token renewal. Expiry, current-token rejection, revocation and current-head
checks remain enforced, with real PostgreSQL17 restricted-role/concurrency tests.

Historical releases `14bead964` and `e7f2e600` retain protected recovery receipts
`fleet-overlay-14bead96-7G4aXMdJ` and `fleet-overlay-e7f2e600-QWzrdEu2`.
The later shared baseline `06934abf` was preserved during integration; candidate
`d6fa6700` was withheld to avoid losing its diagnostics. Earlier runs `41302865788`,
`41318061244` and `41364231175` did not prove both reviewer deliveries: unavailable
Memory or later accepted manifests with no Memory hash kept that boundary open.
The evidence above supersedes those limits without relabeling historical runs.
The [shared startup record](2026-11-01-memory-production-startup.md) retains
ENOSPC/recovery evidence; the [companion diagnostics record](2026-11-01-companion-gateway-refusal-diagnostics.md)
remains separate. Recovery must inspect existing controller receipts and role
states, preserve native state and producer inventory, and avoid repeating an
ambiguous apply or paid request.

Self-hosted startup/resume, stable private SDK delivery, genuine selected-account
full-thread qualification and qualified release-artifact consumption remain
pending. Draft #774 is source work, not automatic-learning activation or proof of
the complete self-hosted goal.
