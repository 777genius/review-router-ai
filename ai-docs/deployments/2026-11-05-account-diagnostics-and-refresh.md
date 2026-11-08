# Account refresh and source diagnostics

- Task ID: `2026-11-05-account-diagnostics-and-refresh`
- Goal: workspace quota refresh reaches the authorized server action, and
  connection tests explain validated source failures through one neutral
  diagnosis contract.
- Affected targets: SaaS Web, the API probe-access endpoint and existing Gateway
  adapters. No SQL migration or new Native/Gateway deployment is planned.
- Implementation PR: [#831](https://github.com/777genius/review-router-ai/pull/831).
- Implementation reference: `27026aed4da374e03e679e00ca991aec0b0581c3`
  (tested source candidate; subsequent review commits require exact-head CI).
- Dependencies: existing Gateway SDK contracts, normal Web/API release
  procedures and their current authorization and protocol compatibility gates.
- Owner instruction: merge only; **do not deploy this batch** until separately
  authorized.
- Last updated: `2026-11-08`.

## Environment status

| Target     | Status    | Installed version | Evidence                 |
| ---------- | --------- | ----------------- | ------------------------ |
| staging    | `pending` | Not changed       | No rollout in this task. |
| production | `pending` | Existing (below)  | No rollout in this task. |

The last read-only production census showed Web source
`bb077235730d484f1f390a86f2ba9029c2da45f9`, image
`sha256:5d8783e366fbbdbd7296f79338e3cf9dd72d7ecb30eeccaf7250ae244df969b5`,
running with zero restarts. This patch was not deployed. Reconcile the actual
installed version again before any separately authorized rollout.

## Confirmed causes and boundaries

The client quota-refresh adapter forwarded `workspaceId` even when a signed
context already fixed the workspace. The server action correctly rejects that
extra selector. Previous production verification exercised the internal owner
service, not the client-adapter/action boundary. Regression tests must cross
the actual adapter and action, mock only composition and preserve rejection of
a real duplicate selector.

The connection probe collapsed `GatewayError` into unavailable. The installed
Native/Gateway/SDK already support attested provider quota diagnostics. The SaaS
probe must preserve validated diagnostics, never display raw provider messages.
The UI and quota refresh use one neutral diagnosis contract; source translation
remains in the adapter. Authorization and generation loss must still remove
protected numeric quota data.

Read-only evidence at 2026-11-04 22:25–22:26 UTC shows Native OpenRouter 429
responses with limit 1000, remaining 0 and reset at
`2026-11-05T00:00:00Z` (02:00 Europe/Kiev). Three probe observations closely
match those times; the dedicated account/model probe precedes the final 429 by
221 ms. The journal lacks a request ID, so temporal correlation is not formal
per-request attestation. Historical dispatch effects remain unknown and must
not be replayed. UI copy depends on validated wire diagnostics, not this
inference.

## Qualification and future rollout

1. Finish focused red-to-green tests, strict Web TypeScript including tests,
   lint/format and independent review.
2. Merge through the normal owner PR and exact-head required CI process.
3. **Do not build or deploy in this task.** A later authorized coherent SaaS
   rollout uses the existing
   [release process](../operations/07-environments-and-release-management.md).
   No migration or repeated Native activation is required by this Web/API patch.
4. After that rollout, verify the public refresh/action path and displayed safe
   diagnosis. Internal owner-service success alone is insufficient. Preserve
   stale observations on transient failures; do not relabel old data as fresh.

No Brave or heavy local Mac processes. Existing test stands, prior reports and
unknown requests remain retained. No new provider/model request is required to
prove the mapper: use the real SDK with a bounded HTTP fixture.

## Retained qualification

Hosted fixtures passed 47 probe/diagnosis cases across six files, plus quota
adapter/action regression and service/cache privacy checks. These are fixtures,
not a new production model request or authenticated browser acceptance.
Production Web image was read back unchanged on November 7.

Final Web source and tests passed TypeScript 7.0.2; the affected API suite
passed 10/10. The repository-pinned ESLint parser uses TypeScript 6.0.3.
That is not TS7 parser conformance. Exact-head CI must pass; do not bypass
its gates or infer deployment completion.

November 7 read-only follow-up could not attribute the UI failure to a
source: Web and Gateway had no recent diagnostic lines. Separately, API
reported review relay session saturation (16/16 retained sessions). This is
not an account quota, and the dashboard probe does not use that relay. No
inference request was repeated.

## Retry, partial completion and rollback

There is no deployment in this task. If a future Web/API rollout or verification
fails, first inventory actual Web and API image/source SHAs, health, active
sessions, authorization generations, and any partially updated replicas.
Record the last successful step and preserve cached quota snapshots and
diagnostics. Repeat read-only health and authorization checks only after
reconciling their actual state. Do not replay an uncertain provider request
or infer quota consumption from a generic 502.

Use the normal
[rollback procedure](../operations/07-environments-and-release-management.md#rollback)
for a compatible coherent release or repair forward. Any API replacement
requires the
[API rollback protocol preflight](../operations/07-environments-and-release-management.md#api-rollback-protocol-preflight),
including active authorizations and retained producers. There is no schema
reversal or Native cleanup to repeat. Re-verify the actual public action path,
safe diagnosis, saved observation preservation and authorization denial before
recording a deployed environment.

## Related links

- [Implementation PR #831](https://github.com/777genius/review-router-ai/pull/831).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).
