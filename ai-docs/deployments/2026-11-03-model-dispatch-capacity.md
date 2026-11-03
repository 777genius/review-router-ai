# Bounded model-dispatch capacity128: deployment

- Task ID: `2026-11-03-model-dispatch-capacity`.
- Goal: qualify an explicitly named 128-request profile and complete the Payments review's full 17-file required coverage within that bounded contract.
- Affected services/targets: shared model-dispatch contracts, their API/worker consumers, the public producer and its normal workflow channel; Usage and Statistics acceptance.
- Implementation: follow-up to [#787](https://github.com/777genius/review-router-ai/pull/787). The capacity128 implementation is not deployed or qualified; exact candidate commits, generated contract bindings and release images remain unassigned here.
- Candidate profile: `model-dispatch-policy.capacity128.v1`, `maxRequests=128`. Planned owner-coordinated cohort: paired release227.
- Prerequisites: the deployed release226 analytics/readback baseline (A/B verified in the [analytics task](2026-11-02-analytics-review-reliability.md)), plus the existing paired release and protocol-compatibility procedures.
- Last updated: `2026-11-03`.

## Environment status

| Environment / target | Status    | Actual deployed version / image           | Last verified (UTC)                         | Evidence / next step                                                                                            |
| -------------------- | --------- | ----------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| staging              | `pending` | Not verified                              | Not verified                                | Qualify the exact parser/producer pair and bounded profile before rollout.                                      |
| production / Hetzner | `pending` | Existing226 / `6e6a0f0`, public `fa3e87a` | Baseline 2026-11-03; capacity128 unverified | Capacity128 has not been deployed or qualified. Parser-first paired227 rollout and full live acceptance remain. |

The production row identifies the installed baseline, not completion of this task.
Use the registry [status contract](README.md#status-contract).

## Observed boundary on release226

The deployed control-plane source is [6e6a0f0](https://github.com/777genius/review-router-ai/commit/6e6a0f07829c465202512f87fb6a3195412ca347), paired with public [fa3e87a](https://github.com/777genius/review-router/commit/fa3e87a71f500f63f9ef64bcbc63f640c4e4d7f8). Canary A/B acceptance on this baseline is recorded in the [analytics task](2026-11-02-analytics-review-reliability.md#release226-live-verification).

[Payments PR29 run41581736184](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41581736184) reviewed head `dcfadb0c199e69654b0aa25280f1b2a828b6d04f`. Its canonical result was partial, with required work-slot coverage **0/1** and file coverage **0/17**. Exactly **32 Native requests completed**, totalling **508,896 tokens**. The API rejected the next model-dispatch body with HTTP400 / `model_dispatch_request_invalid`: the selected profile's hard limit was32 while the Gateway execution allowed640. Gateway capacity did not enlarge the signed profile's authority.

The retained Native32 scope is closed and scoped cleanup is `DONE`; no 33rd Native request was issued. Preserve that partial result and its receipts. It is evidence of the existing bound, not full Payments acceptance or a provider-quota measurement.

## Applicability and invariants

- Keep the published `model-dispatch-policy.v2` profile and its 32-request semantics immutable. Capacity128 has a distinct named identity, descriptor/capability binding and producer qualification; existing authorizations retain their original profile.
- Preserve database schema, OCR binary, MCP selection, model selection and flags. This slice requires no DB migration or change to those settings.
- Retain release226/fa3 compatibility and admitted-run evidence. The parser must accept the new qualified profile before any producer or workflow-channel selection can emit it.
- Bind the exact generated/exported contract and agent catalog to the approved producer. An unqualified manifest, a supplied digest or a successful build alone does not authorize activation.
- FREE provider quota remains unverified. The 128-request profile is a bounded execution contract; it establishes no exact remaining FREE allowance.

## Ordered rollout

1. Qualify the additive parser, claim and capability paths, including unchanged legacy32 rejection behavior and the new 128 boundary. Record exact source pins, generated-byte bindings, focused evidence and the normal required CI. No capacity128 qualification is claimed by this pending record.
2. The release owner selects the exact paired227 artifacts through the [release order](../operations/07-environments-and-release-management.md#release-order). Reconcile installed fleet and active-run/producer inventories using the existing replacement-safety procedure. Preserve the closed Payments attempt and all retained stand/data/artifacts.
3. Install and verify the compatible parser-consuming fleet **before producer selection or channel promotion**. Confirm actual versions and support for both the frozen legacy profile and the new qualified identity. Keep the current producer available to already admitted work.
4. After parser readiness, follow the normal owner-controlled producer registration, paired activation and `workflow-v1` promotion sequence in the release guide. Record exact Action/control-plane commits, images, profile identity and channel before/after values; do not mutate an old profile or force-move an immutable release tag.
5. After those gates pass, use one fresh normal App review of the existing Payments PR with its reviewed head and 17-file required inventory frozen. Do not replay run41581736184 or reopen its closed Native scope. A workflow rerun or a larger limit alone does not prove completion.

## Verification and completion

Record staging and production evidence separately. Production completion requires:

- Canonical required work-slot coverage **1/1** and file coverage **17/17**, truthful full completion and the matching configured GitHub App publication for the exact new request identity/head. Finding-based quality RED must be distinguished from transport or coverage failure.
- Usage readback reconciled to the actual Native requests and token totals for that same request/profile. Preserve unknown observed provider/model values and all immutable historical facts; record actual counts rather than projecting them from the128 bound.
- Statistics processing and issue deduplication consistent with that actual completed review. Preserve the already verified Canary A/B facts and source-A lineage; do not manufacture a resolved prior issue or replay settlement/publication to obtain counters.
- The new Native scope terminal with no occupied request slots and scoped cleanup `DONE`. Record any ambiguous effect or cleanup debt and stop before a replacement invocation.
- Actual paired227 fleet/producer/channel evidence and the successful task-specific readbacks. Capacity128 may still exhaust; retain a truthful partial result if full17-file acceptance is not achieved.

## Retry, partial completion, and rollback

Resume only an unproven phase after reconciling its actual state. Retain the original 32-request partial result, A/B observations and all artifacts. Do not rewrite old profile snapshots, increase an existing authorization's limit or replay an ambiguous model/publication effect.

Use the release guide's [target-build protocol preflight](../operations/07-environments-and-release-management.md#api-rollback-protocol-preflight) before API replacement. Once capacity128 authorizations or producers exist, compatibility must include them and all retained approved producers; release226 is not automatically a valid rollback target. Keep parser support until that inventory proves a rollback safe, or use a compatible forward repair.

## Related links

- [Release process](../operations/07-environments-and-release-management.md), including parser compatibility and owner-controlled channel promotion.
- [Quality gates](../operations/03-quality-gates.md).
- [Analytics/review reliability and release226 A/B evidence](2026-11-02-analytics-review-reliability.md).
- [Payments PR29](https://github.com/agent-teams-ai/payments-sdk/pull/29) and [retained partial workflow](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41581736184).

## Execution log

| Time (UTC)   | Environment                      | Actual version                           | Observed result                                                                                                             | Next action                                                                         |
| ------------ | -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 2026-11-03   | production baseline              | release226 / `6e6a0f0`, public `fa3e87a` | A/B verified; Payments partial0/17 after exactly32 Native COMPLETE /508,896 tokens; scope closed, cleanupDONE, no33 issued. | Qualify the separately named capacity128 pair.                                      |
| Not executed | staging / production capacity128 | paired227 candidate; exact pins pending  | Implementation is not deployed or qualified. No rollout or live request is performed by this record.                        | Parser-first qualification, owner-coordinated rollout, then full17-file acceptance. |
