# Analytics and review completion reliability: deployment

- Task ID: `2026-11-02-analytics-review-reliability`.
- Goal: attribute Gateway usage to the configured provider, recover Usage pagination after page errors, and settle partial reviews without retrying forever.
- Affected services: Web, API, worker; PostgreSQL read path only.
- Implementation PR: [#787](https://github.com/777genius/review-router-ai/pull/787).
- Qualified implementation reference: `44b06c141d056fa2779bc2bb29e18dbd9c84ea06`; included in deployed release226 source `6e6a0f07829c465202512f87fb6a3195412ca347`.
- Related work: [Statistics and Usage](2026-10-29-statistics-history-followthrough.md), [Analytics extensibility](2026-10-31-analytics-extensibility.md).
- Last updated: `2026-11-03`.

## Environment status

| Environment / target | Status        | Actual deployed version / image                     | Last verified (UTC) | Evidence / next step                                                           |
| -------------------- | ------------- | --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| staging              | `pending`     | Not verified                                        | Not verified        | Qualify changed browser and PostgreSQL paths in the isolated test environment. |
| production / Hetzner | `in_progress` | `6e6a0f078` / official `v1.0.226`, image `0114caaa` | 2026-11-03          | See current R1 evidence and remaining scope below.                             |

## Release226 live verification

The owner deployed release226 at source [6e6a0f0](https://github.com/777genius/review-router-ai/commit/6e6a0f07829c465202512f87fb6a3195412ca347), with public producer [fa3e87a](https://github.com/777genius/review-router/commit/fa3e87a71f500f63f9ef64bcbc63f640c4e4d7f8). The following are observed live results, separate from the earlier source/CI qualification:

| Observation                                                                                                                                                              | Canonical review                                                                                                                                         | Usage readback           | Statistics readback                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| [Canary A run41581680152](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41581680152), reviewed `b94250dbb65aedecbd6f85d044b6bc53f5f5fb01`              | Complete required coverage1/1; genuine critical ownership bypass found and App-published. Finding-based quality RED was accepted as the expected result. | 5 calls /22,395 tokens.  | 1 new critical issue fact.                    |
| [Fixed-source Canary B run41583013357](https://github.com/777genius/rr-codex-rotating-e2e/actions/runs/41583013357), reviewed `809f69d8744c5d10c051120c9634626bcf666f20` | Complete required coverage1/1, workflow success, 0 NEW findings. The prior issue is `NOT_VERIFIED`; this is not a resolution claim.                      | 10 calls /57,463 tokens. | Dedupe1; source-A fact and lineage unchanged. |

The separate [Payments PR29 run41581736184](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41581736184) remains **partial0/17**. It reached the immutable profile's 32-request bound despite Gateway capacity640; exactly32 Native requests completed, scope cleanup is `DONE`, and no33rd Native request was issued. Full Payments acceptance belongs to the pending [named capacity128 rollout](2026-11-03-model-dispatch-capacity.md). These A/B successes do not establish that Payments is complete or disclose an exact remaining FREE request quota.
