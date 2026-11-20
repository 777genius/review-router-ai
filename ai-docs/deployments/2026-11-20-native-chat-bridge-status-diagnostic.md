# Native chat bridge reports the NVIDIA status behind its bare 502: deployment

- Task ID: `2026-11-20-native-chat-bridge-status-diagnostic`
- Goal: when the native Chat bridge answers a rejected NVIDIA request (non-2xx)
  or a lost upstream connection with its bare 502 `native_effect_unknown`, the
  Gateway journal gets one closed line saying which:
  `{"event":"gateway_native_response_failure","phase":"http_status","http_status":429}`
  or `{"event":"gateway_native_response_failure","phase":"transport"}`
  (`deadline` when the request deadline already passed).
- Affected target: native engine only
  ([agent-teams-ai/sub2api#105](https://github.com/agent-teams-ai/sub2api/pull/105),
  `f10a3801`). The Gateway already accepts this event, phase and field; no
  Gateway, API, worker, Web or Action change.
- Analysis: [plan 86](../architecture/86-review-failure-classes-fixes.md),
  class 3, step 1.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status      | Actual version                 | Evidence                                                                                          |
| ---------- | ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Native     | `installed` | `f10a3801`, binary `d6ecc3d2…` | [Bundle 3](2026-11-20-bundle3.md) at 07:00 UTC; no bare NVIDIA 502 since, so no line observed yet |
| Production | `installed` | native 105 under Gateway 115   | [Bundle 3](2026-11-20-bundle3.md)                                                                 |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- Diagnostic only. The caller's answer (502 `native_effect_unknown`, same
  body), the effect, retries and accounting are unchanged. Only the integer
  status leaves the process, never the provider body, headers or keys.
- Still silent: the buffered non-stream bridge paths. A 502 without a line
  after this rollout means one of those.

## Applicability and rollout

Bundle 3 native contents on top of prod `cfe50b7f`, in this order:
`7438a489` (#104, account model snapshots fresh for five minutes) and
`f10a3801` (#105, this change). Native goes first in the bundle order
native -> Gateway -> SaaS -> Action. Rides in bundle 3, NOT deployed.

## Verification and completion

After the rollout, read-only: the next NVIDIA `native_response/denied/502` in
the Gateway journal is preceded by a `gateway_native_response_failure` line
with `http_status` or `transport`.

## Retry and rollback

Roll the native engine back to the previous binary. No state is written by
this change.

## Execution log

| Time (UTC)       | Environment | Operator | Actual version / image          | Step and observed result                         | Evidence                          | Next action                                                                    |
| ---------------- | ----------- | -------- | ------------------------------- | ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------ |
| 2026-11-20 07:00 | production  | D4       | native `f10a3801` (`d6ecc3d2…`) | Swapped under the admission gate, `READY_FENCED` | [bundle 3](2026-11-20-bundle3.md) | Check the next NVIDIA `native_response/denied/502` for the `http_status` line. |
