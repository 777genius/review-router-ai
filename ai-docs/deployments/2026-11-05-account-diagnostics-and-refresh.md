# Account refresh and source diagnostics

- Task ID: `2026-11-05-account-diagnostics-and-refresh`
- Goal: workspace quota refresh reaches the authorized server action, and connection tests explain validated source failures through one neutral diagnosis contract.
- Affected targets: SaaS Web, the API probe-access endpoint and their existing Gateway adapters. No SQL migration or new Native/Gateway deployment is planned.
- Implementation: current scoped PR, to be linked after creation.
- Owner instruction: merge only; **do not deploy this batch** until separately authorized.
- Last updated: `2026-11-07`.

## Environment status

| Target | Status | Actual installed version | Evidence / next step |
| --- | --- | --- | --- |
| staging | `pending` | Not changed by this task | Hosted tests are qualification, not staging installation. |
| production | `pending` | Web source `bb077235730d484f1f390a86f2ba9029c2da45f9`, image `sha256:5d8783e366fbbdbd7296f79338e3cf9dd72d7ecb30eeccaf7250ae244df969b5` | Read-only census: running, zero restarts. This patch is not deployed; preserve that distinction after merge. |

## Confirmed causes and boundaries

The client quota-refresh adapter forwarded workspaceId even when a signed context already fixed the workspace. The real server action correctly rejects the extra selector. The previous production verification exercised the internal owner service, not this client-adapter/action boundary. A regression must cross the real adapter and real action, mocking only composition, and preserve the server rejection for an actual duplicate selector.

The connection probe collapsed GatewayError into unavailable. The installed Native/Gateway/SDK already support attested provider quota diagnostics; the SaaS probe must preserve them rather than display an unverified raw provider message. UI and quota refresh consume a neutral diagnosis contract; source translation remains in the adapter. Authorization and generation loss must still erase protected numeric data.

Read-only evidence at2026-11-04T22:25–22:26UTC shows Native OpenRouter429 responses with limit1000, remaining0 and reset2026-11-05T00:00:00Z (02:00 Europe/Kiev). Three probe observations closely match those response times; the dedicated account/model probe precedes the final429 by221ms. The journal does not contain a request ID, so temporal correlation is not formal per-request attestation. Historical dispatch effects remain unknown and are not replayed. New UI copy must depend on validated wire diagnostics, not this journal inference.

## Qualification and future rollout

1. Finish focused rejecting/red→green tests, strict web TypeScript including tests, lint/format and independent review.
2. Merge through the normal owner PR and exact-head required CI process.
3. **Do not build or deploy now.** A later authorized coherent SaaS rollout uses the existing [release process](../operations/07-environments-and-release-management.md); no migration or repeated Native activation is required for this Web/API change.
4. After that rollout, verify the actual public refresh/action path and the displayed safe source diagnosis. Internal owner-service success alone is insufficient UI evidence. Preserve stale observations on transient failures and do not relabel old data fresh.

No Brave or heavy local Mac processes. Existing test stands, prior reports and unknown requests remain retained. No new provider/model request is required to prove the source error mapper; use a real SDK HTTP fixture with bounded safe diagnostics.

## Retained qualification

Hosted fixtures passed: 47 probe/diagnosis tests across six files and the quota adapter/action regression plus service/cache privacy checks. These are fixture and adapter checks, not a new production model request or authenticated browser acceptance. Production Web image was read back unchanged on November 7. Final exact-head qualification and PR link remain pending.
