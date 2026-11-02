# Analytics and review completion reliability: deployment

- Task ID: `2026-11-02-analytics-review-reliability`.
- Goal: attribute Gateway usage to the configured provider, recover Usage pagination after page errors, and settle partial reviews without retrying forever.
- Affected services: Web, API, worker; PostgreSQL read path only.
- Implementation reference: branch `fix/analytics-review-e2e-20261102`, based on `15314c6d2`; not yet released.
- Related work: [Statistics and Usage](2026-10-29-statistics-history-followthrough.md), [Analytics extensibility](2026-10-31-analytics-extensibility.md).
- Last updated: `2026-11-02`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                             |
| -------------------- | --------- | ------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Qualify changed browser and PostgreSQL paths in the isolated test environment.   |
| production / Hetzner | `pending` | Baseline `57cc15137`            | 2026-11-02 14:59    | Apply one coherent qualified batch after the shared rollout window is available. |

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
- Actual Next/PostgreSQL/Chromium Usage qualification is running; outcome and screenshot inspection remain pending.
- Exact OpenRouter free-request quota is not exposed by the installed Gateway cached `account-limits/v1` SDK: both configured OpenRouter accounts return `unsupported`. No provider credential was extracted, request quota invented, or credit purchase performed.
