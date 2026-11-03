# Analytics and review completion reliability: deployment

- Task ID: `2026-11-02-analytics-review-reliability`.
- Goal: attribute Gateway usage to the configured provider, recover Usage pagination after page errors, and settle partial reviews without retrying forever.
- Affected services: Web, API, worker; PostgreSQL read path only.
- Implementation PR: [#787](https://github.com/777genius/review-router-ai/pull/787).
- Implementation reference: `44b06c141d056fa2779bc2bb29e18dbd9c84ea06`; not yet released.
- Related work: [Statistics and Usage](2026-10-29-statistics-history-followthrough.md), [Analytics extensibility](2026-10-31-analytics-extensibility.md).
- Last updated: `2026-11-03`.

## Environment status

| Environment / target | Status        | Actual deployed version / image                     | Last verified (UTC) | Evidence / next step                                                           |
| -------------------- | ------------- | --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| staging              | `pending`     | Not verified                                        | Not verified        | Qualify changed browser and PostgreSQL paths in the isolated test environment. |
| production / Hetzner | `in_progress` | `6e6a0f078` / official `v1.0.226`, image `0114caaa` | 2026-11-03          | See current R1 evidence and remaining scope below.                             |

## Findings and data preservation

The existing native usage reconciler was working: the two workspaces contained 1,420 requested FREE Nemotron calls, with 1,228 complete native measurements at the audit boundary. Their requested provider was incorrectly recorded as `codex` because the recorder used the runtime engine kind. Missing observed provider/model remains unknown; a requested model is not proof of an observed response model.

All 36 Statistics settlement events were processed and all 36 eligible review facts existed; seven issue facts were present. Pre-activation executions and legitimately partial reviews are outside that capture contract. No blanket replay or invented historical findings is warranted.

The affected partial review used a `v7-lifecycle-verification` artifact whose outer coverage was completed while canonical projection coverage was partial. The worker recognized canonical coverage only for v5/v6, then a pending snapshot retried incomplete coverage indefinitely. Preserve the partial result and its publication; never manufacture full coverage or repeat publication to obtain a green check.

## Ordered rollout

1. Qualify future and historical requested-provider attribution, including tenant isolation and unchanged immutable source facts.
2. Qualify Usage cursor recovery with the actual Next/PostgreSQL/Chromium harness and the existing Statistics flow. Keep all retained live test repositories and the shared memory stand.
3. Qualify v7 partial completion and recovery of an already pending snapshot without a successful full snapshot or duplicate publication.
4. Follow the [release process](../operations/07-environments-and-release-management.md), coordinate the shared memory rollout window, and deploy Web/API/worker coherently. No new schema migration, feature flag, data rewrite, or provider credential change is required by this slice.
5. Read back actual fleet versions, check authenticated reports and allow the existing worker to reconcile retained completion processes. Run one bounded live review in an existing disposable repository and verify App-authored publication, correct Usage attribution/tokens, truthful completion status and Statistics eligibility.

## Retry and rollback

Preserve all receipts, immutable Usage facts and native observations. Historical labels are corrected at the report boundary using matching frozen authorization metadata, not by editing existing identities. Resume only the unproven phase. Do not replay inference or publication after an ambiguous outcome. Use the release guide for a compatible rollback; old code may display the historical label incorrectly again.

## Execution log

- 2026-11-02: read-only production audit completed; implementation and qualification in progress. No deployment, inference replay or database mutation has been performed for this batch.

## Qualification before rollout

- API, Web, worker and changed feature projects passed strict TypeScript 7.0.2 checks.
- API attribution/callers: 29 tests passed; the old helper failed four new regressions.
- Usage UI/model: 30 tests passed, including independent run/observation cursor histories and recovery after a page-only503.
- Historical attribution: 20 real PostgreSQL 17.11 cases passed, including malformed/ambiguous snapshots, tenant/run/attempt boundaries, filters/facets/accounting and unchanged immutable identity/unknown observed values.
- Existing real PostgreSQL 17 Usage suite: 16 tests passed; the opt-in211k-volume qualification was not enabled. An isolated fresh UTF8 cluster ran the normal cold migration path. Earlier attempts exposed local fixture encoding/global-role contamination and are retained; no migration guard was relaxed.
- Review completion/capture: 35 focused tests passed. A partial process awaiting its snapshot now rechecks terminal publication facts; missing or uncertain facts never cause a new publication or a full snapshot.
- Read-only production SQL qualification mapped all1,420 eligible historical FREE calls to their frozen OpenRouter configuration under a five-second statement budget. Five stored-unknown calls remain unknown. This was a source query qualification, not deployment of the new reader.
- The initial local browser qualification stopped before browser startup: ordinary cold migrations and seeding passed, but Next exited during authenticated boot. Zero browser tests ran; it is not a pass. At the owner’s explicit request all local heavy processes and three owned temporary PostgreSQL clusters were stopped with data preserved. The four Usage scenarios now run in the existing Linux CI acceptance job, including both503/error and Previous-recovery screenshots. Exact-head Linux run [41489941032](https://github.com/777genius/review-router-ai/actions/runs/41489941032) passed all8 browser cases, including all4 Usage scenarios. Four error/recovery PNGs from artifact13164273757 were verified and inspected. This is isolated CI acceptance, not staging or production deployment; the remaining mandatory CI and actual application rollout are separate.
- Exact OpenRouter free-request quota is not exposed by the installed Gateway cached `account-limits/v1` SDK: both configured OpenRouter accounts return `unsupported`. No provider credential was extracted, request quota invented, or credit purchase performed.

- Shared rollout coordination: Memory owner will include this batch in the single paired private release226 after PR #785 and this implementation merge; no separate deployment is started here. Selective server build-cache GC reclaimed4,466,106,368bytes; exact image/container/volume inventories were unchanged. Receipt: `/srv/workers/rr-selective-buildcache-gc-20261102-153044/receipt.json`.

## Production R1 /226 — 2026-11-03

The [shared R1 release and environment evidence](evidence/2026-11-03-memory-production-r1-226.json) records official application source `6e6a0f078`, image
`0114caaa…`, all four running roles with zero restarts, and verified 226 producer/channel adoption.

The coherent Web/API/worker fix is installed. A/B prove full coverage and complete Usage/Statistics accounting, with genuine App publication. B has zero new issues and preserves one A lineage with the original caughtAt; its prior issue is NOT VERIFIED, not resolved. Payments is PARTIAL 0/17 after 32 completed requests and 508,896 tokens; full fresh payments acceptance remains pending. Retain partial/unknown observations and natural completion recovery; no historical inference/publication was replayed.

Staging remains unchanged and unverified by this production batch.

Payments API returned HTTP 400 `model_dispatch_request_invalid` at 05:20:45 UTC.
The frozen Gateway allowance is 640 requests while installed dispatch allows 32.
Ordinal 33 is a source/count explanation, not an observed request body. A
versioned 128-request successor is source-only in the neighboring workstream;
immutable 226 producer `fa3e87a71…` is unchanged. A fresh normal payments run
after that successor is pending; the old run is not replayed or relabelled.
