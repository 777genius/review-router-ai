# Bounded model-dispatch capacity128: deployment

- Task ID: `2026-11-03-model-dispatch-capacity`.
- Goal: qualify an explicitly named 128-request profile and complete the Payments review's full 17-file required coverage within that bounded contract.
- Affected services/targets: shared model-dispatch contracts, their API/worker consumers, the public producer and its normal workflow channel; Usage and Statistics acceptance.
- Implementation: follow-up to [#787](https://github.com/777genius/review-router-ai/pull/787). Canonical generated source `cc3bbcc97a48a3197e6894c8fa549d47f961a39f`, test-only fixture correction `a57a2c091b5a7f7edca9f7e1f8d047c5195642a3`, and [public Action #367](https://github.com/777genius/review-router/pull/367), merged as `abff4814dccab046debd61f7f5e14f4524f54e5e`. Private PR802 merged as `dbc161c9865f88e9cf60c8ad21b2814ecec8eec2`; production release227 and the required live Payments review are verified below.
- Activated profile: `model-dispatch-policy.capacity128.v1`, `maxRequests=128`, paired production release227. The completed rollout and live evidence below supersede the preparation-time pending statements.
- Prerequisites: the deployed release226 analytics/readback baseline (A/B verified in the [analytics task](2026-11-02-analytics-review-reliability.md)), plus the existing paired release and protocol-compatibility procedures.
- Last updated: `2026-11-03`.

## Environment status

| Environment / target | Status     | Actual deployed version / image                             | Last verified (UTC)  | Evidence / next step                                                                                                                         |
| -------------------- | ---------- | ----------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| staging              | `pending`  | Not verified                                                | Not verified         | Source pair qualified; target rollout and acceptance remain pending.                                                                         |
| production / Hetzner | `deployed` | Release227 / `dbc161c`, image `89a28e11`, public `abff4814` | 2026-11-03 12:18 UTC | Required Payments coverage17/17, publication and Statistics verified; one optional description call has an explicitly unknown outcome/usage. |

The production row identifies the verified release227 cohort. Staging remains unverified. The optional unknown described below is preserved, not counted as zero usage or retried.
Use the registry [status contract](README.md#status-contract).

## Observed boundary on release226

The historical release226 control-plane source was [6e6a0f0](https://github.com/777genius/review-router-ai/commit/6e6a0f07829c465202512f87fb6a3195412ca347), paired with public [fa3e87a](https://github.com/777genius/review-router/commit/fa3e87a71f500f63f9ef64bcbc63f640c4e4d7f8). Canary A/B acceptance on this baseline is recorded in the [analytics task](2026-11-02-analytics-review-reliability.md#release226-live-verification).

[Payments PR29 run41581736184](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41581736184) reviewed head `dcfadb0c199e69654b0aa25280f1b2a828b6d04f`. Its canonical result was partial, with required work-slot coverage **0/1** and file coverage **0/17**. Exactly **32 Native requests completed**, totalling **508,896 tokens**. The API rejected the next model-dispatch body with HTTP400 / `model_dispatch_request_invalid`: the selected profile's hard limit was32 while the Gateway execution allowed640. Gateway capacity did not enlarge the signed profile's authority.

The retained Native32 scope is closed and scoped cleanup is `DONE`; no 33rd Native request was issued. Preserve that partial result and its receipts. It is evidence of the existing bound, not full Payments acceptance or a provider-quota measurement.

## Applicability and invariants

- Keep the published `model-dispatch-policy.v2` profile and its 32-request semantics immutable. Capacity128 has a distinct named identity, descriptor/capability binding and producer qualification; existing authorizations retain their original profile.
- Preserve database schema, OCR binary, MCP selection, model selection and flags. This slice requires no DB migration or change to those settings.
- Retain release226/fa3 compatibility and admitted-run evidence. The parser must accept the new qualified profile before any producer or workflow-channel selection can emit it.
- Bind the exact generated/exported contract and agent catalog to the approved producer. An unqualified manifest, a supplied digest or a successful build alone does not authorize activation.
- FREE provider quota remains unverified. The 128-request profile is a bounded execution contract; it establishes no exact remaining FREE allowance.

## Source qualification

The isolated server qualification passed 130 profile/snapshot/binder/handoff
checks and strict TypeScript 7.0.2 checks for shared, feature, API, Web and tooling
projects. All 33 dispatch-file cases are covered by composed evidence: 21 HTTP,
10 durable PostgreSQL 17.11 cases, and the two corrected negative policy cases.
The latter construct mismatched identities at initial INSERT; the immutable
snapshot trigger remains enabled. Both legacy32/33 and new128/129 boundaries,
shared-role accounting and unknown-effect fences passed. No database case was
skipped and no production authority or model call was used for qualification.

Forwarding has its own regression boundary: the former two-digit/32 header
parser would reject already admitted requests33/100/128. Gateway and Hosted
now derive that bound from the authenticated frozen capability before native
preparation; the exported default parser retains32. On the old runtime,
12 of20 focused cases failed. The corrected closest suites pass144/144,
including the20 cases; an existing paired budget case also passes. Gateway
positives cross the real HTTP route into a controlled SDK fixture. Hosted
positives prove header acceptance before an intentional authority denial;
they do not claim a live Hosted grant or provider call. Legacy33, new129,
and a clamped16 allowance reject17 without native preparation or forwarding.
No real provider/model was called for this source qualification.

The [public exact-head CI](https://github.com/777genius/review-router/actions/runs/41592288382)
and both native qualification workflows passed on the first attempt; its merge
tree is identical to reviewed head `d4d3db4e400507df268186c9a3f54f7c23f7e651`.
The rebuilt Action entrypoint SHA-256 is
`ba9464453771959a18267e86892efcce279dbc3769f23a7359573382a99f1e1e`.
The [official Action227 publication](https://github.com/777genius/review-router/actions/runs/41594020936) succeeded on 2026-11-03 at 07:14 UTC. Immutable `v1.0.227` and `v1` both resolve to `abff4814dccab046debd61f7f5e14f4524f54e5e`; the private CI pin selects that exact commit. These are source/artifact checks, not production acceptance. Private exact-head
CI, paired publication, parser-first fleet delivery and the fresh live review
subsequently passed as recorded below.

## Ordered rollout

1. Qualify the additive parser, claim and capability paths, including unchanged legacy32 rejection behavior and the new 128 boundary. Record exact source pins, generated-byte bindings, focused evidence and the normal required CI. Source checks, private exact-head/main CI and required production acceptance passed; actual evidence follows below.
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

## Release227 actual rollout and live acceptance

[Private PR802](https://github.com/777genius/review-router-ai/pull/802) merged as
`dbc161c9865f88e9cf60c8ad21b2814ecec8eec2`. Its [exact-main CI](https://github.com/777genius/review-router-ai/actions/runs/41609755870)
passed all14 jobs, including both non-skipped PostgreSQL release gates in attempt1.
The [official private227 release](https://github.com/777genius/review-router-ai/actions/runs/41623082062)
published successfully at11:26:42 UTC. Normal source-owned provenance verification
passed before activation. The installed image on all four application roles is
`ghcr.io/777genius/review-router-saas-runtime@sha256:89a28e11e9c3191b1160abd1fbdd12b1cdadcd3f820e75e52a3ea617f5a3947a`.

The target-build protocol preflight accepted the actual retained inventory:
54 configured attestations,52 registered producers and6 active authorizations,
with zero missing/unsupported contracts. The ordinary fleet controller applied
the parser-first stage, normal installed-API registration created the new
immutable128 producer, and a fresh controller stage aligned all four roles with
the complete227 installer tuple and public `abff4814` refs. The55-row registry
SHA-256 is `37c36b4aaae76fe2e68d5cc03842fc020edffb4659bd2d0714f3d192fdcb8d91`;
all54 legacy rows and their immutable32 profiles were retained. All four roles
were running with restart count0 and the public API readiness returned200.
[Workflow-channel promotion41630648819](https://github.com/777genius/review-router/actions/runs/41630648819)
passed its ABI check and CAS; actual `workflow-v1` now resolves to
`abff4814dccab046debd61f7f5e14f4524f54e5e`.

One normal synchronize event on the retained Payments PR29 advanced its owned
test head with an empty commit to `d74f697a7d147b26b5267d7bb3ddfdae73b2f2b8`.
The tree and real17-file diff remained unchanged. [Fresh run41631048975/1](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41631048975)
completed successfully. Public snapshot/profile parsers confirmed the actual
frozen `capacity128` policy, descriptor
`sha256:d529a458a0d6e6644df1d8e341f42988b5c137920f6883cd1467bfe524e8aadb`
and approved `abff4814` producer. Required work-slot coverage was1/1, file
coverage17/17, uncovered files0, required exhausted/cancelled0, accepted evidence1.
The artifact and completion were complete with `snapshot_committed`. Discovery
performed44 completed Native calls, including ordinal33 and maximum ordinal44.
This naturally exercised the repaired boundary without a manufactured extra call.

The artifact contains two minor findings. The configured App3599233 published
the [summary](https://github.com/agent-teams-ai/payments-sdk/pull/29#issuecomment-6603515930)
and successful managed check125910589901 for the exact new head. Statistics
processed one settlement event on its first attempt and stored one review fact
and two distinct minor issue lineages, each with durable key count1 and the
correct first-caught execution/time. No replay or manual ingestion was performed.

Usage correctly contains45 unique Native-authoritative call observations:
44 completed discovery calls and one optional `pr_description` call with
`effect_unknown` / partial usage. The measured subtotal is1,314,174 tokens
(input1,281,418; output32,756); the optional call's unknown tokens are additional,
not zero. The report explicitly exposes `partialCount=1` and
`unknownTotalTokenCount=1`; it does not establish complete usage for all45 calls.
Observed provider/model and costs remain unknown, and no remaining FREE quota or
zero billing is claimed. The optional description was omitted under the existing
one-attempt fallback policy; it is not a required review/coverage failure.

The authorization was revoked and both invocation leases released. Exact Native
custody matched all45 request refs:44 completed and the same one unknown optional
effect. The parent is terminal/fenced, occupied transports0, closure ACKs45/45,
and scoped cleanup `DONE` at12:14:06 UTC. The unknown effect was preserved and
never replayed. Old failed32 receipts, stands, containers and unrelated histories
remain retained. This is scoped physical closure, not global historical cleanup.

The [durable secret-free evidence summary](evidence/2026-11-03-capacity128-release227.json) includes externally readable release/CI/channel/live-review links and the explicitly partial optional-call usage. Private reproducible receipts are retained under
`tmp/release227-root-takeover/` and
`tmp/analytics-review-e2e-20261102/capacity128-fresh/` in the delivery worktree.
New one-turn Memory corrections are outside this deployed cohort and remain a
separate delivery, as requested by the owner.

## Retry, partial completion, and rollback

Resume only an unproven phase after reconciling its actual state. Retain the original 32-request partial result, A/B observations and all artifacts. Do not rewrite old profile snapshots, increase an existing authorization's limit or replay an ambiguous model/publication effect.

Use the release guide's [target-build protocol preflight](../operations/07-environments-and-release-management.md#api-rollback-protocol-preflight) before API replacement. Once capacity128 authorizations or producers exist, compatibility must include them and all retained approved producers; release226 is not automatically a valid rollback target. Keep parser support until that inventory proves a rollback safe, or use a compatible forward repair.

## Related links

- [Release process](../operations/07-environments-and-release-management.md), including parser compatibility and owner-controlled channel promotion.
- [Quality gates](../operations/03-quality-gates.md).
- [Analytics/review reliability and release226 A/B evidence](2026-11-02-analytics-review-reliability.md).
- [Payments PR29](https://github.com/agent-teams-ai/payments-sdk/pull/29) and [retained partial workflow](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41581736184).

## Execution log

| Time (UTC)             | Environment                | Actual version                                       | Observed result                                                                                                                                                                         | Next action                                                                 |
| ---------------------- | -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-11-03             | production baseline        | release226 / `6e6a0f0`, public `fa3e87a`             | A/B verified; Payments partial0/17 after exactly32 Native COMPLETE /508,896 tokens; scope closed, cleanupDONE, no33 issued.                                                             | Qualify the separately named capacity128 pair.                              |
| 2026-11-03 11:26-11:51 | production capacity128     | paired227 / `dbc161c` + `abff4814`, image `89a28e11` | Official publication, signed provenance, parser-first fleet, immutable128 producer and workflow-v1 CAS passed.                                                                          | Completed; retain the old producer and artifacts.                           |
| 2026-11-03 12:14-12:18 | production live acceptance | Payments41631048975/1, head `d74f697`                | Required17/17 and two minor findings; Statistics1 event/1 fact/2 unique issues;44 complete calls plus one explicitly unknown optional description; Native45 ACKs/occupied0/cleanupDONE. | Required rollout/review verified; preserve optional unknown without replay. |
