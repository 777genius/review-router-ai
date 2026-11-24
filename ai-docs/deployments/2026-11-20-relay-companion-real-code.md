# Relay returns the real cause of a failed companion request: deployment

- Task ID: `2026-11-20-relay-companion-real-code`
- Goal: when a companion (OCR and other Account Gateway model) request fails
  inside the SaaS relay, its closed cause (a Gateway code such as
  `upstream_failure` or `forbidden`, a local refusal such as
  `authorization_denied`, otherwise `relay_unknown`) is reported next to the
  unchanged generic `companion_request_failed`: as `cause` in the error body
  and as `relayCode` in the API log.
- Affected target: API only (`apps/api/src/review-run-gateway-relay.ts`).
  Web, worker, Gateway, native, the database and the public Action are
  unchanged.
- Implementation: the PR that adds this record; analysis in
  [plan 86](../architecture/86-review-failure-classes-fixes.md) (class 3).
- Implementation reference: the squash commit of that PR on `main`.
- Dependencies: none. No migration, configuration or feature flag. The native
  NVIDIA status diagnostic is a separate native change in the same bundle; this
  change does not need it.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status      | Actual image                         | Evidence                                                                                                    |
| ---------- | ----------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Staging    | `pending`   | Not verified                         | Ordinary API rollout                                                                                        |
| Production | `installed` | `1d92ee85`, image `sha256:abf7f4a9…` | [Bundle 3](2026-11-20-bundle3.md) at 07:20 UTC; no companion failure since, so `relayCode` not observed yet |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- The error body gains an optional `cause` field and the companion failure log
  line gains `relayCode`. The `code`, status 502, effect, `failureScope` and
  provider quota are exactly as before.
- The code is deliberately not replaced: the runtime stops retrying on
  `admission_limited` with `not_dispatched`, and the relay itself scopes a
  failure to the allocation for codes such as `model_dispatch_budget_exhausted`.
  Keeping `code` means retries, settlement, usage, scope and run outcome cannot
  change.
- The current Action ignores unknown body fields, so run logs still show
  `unrecognized` for these failures; the cause is in the API log, matched by
  `requestRef`. Showing `cause` in the run log needs a later Action change.

## Applicability and rollout

Ordinary API image rollout. Rides in bundle 3, NOT deployed.

## Verification and completion

After the rollout, read-only: the next companion failure in the API log
(`review_run_companion_gateway_request_failed`) carries `relayCode`, matched to
the run by `requestRef`.

## Retry and rollback

Revert the commit and roll the API back. No state is written by this change.

## Execution log

| Time (UTC)       | Environment | Operator | Actual version / image               | Step and observed result | Evidence                          | Next action                                                                        |
| ---------------- | ----------- | -------- | ------------------------------------ | ------------------------ | --------------------------------- | ---------------------------------------------------------------------------------- |
| 2026-11-20 07:20 | production  | D4       | `1d92ee85`, image `sha256:abf7f4a9…` | Installed with bundle 3  | [bundle 3](2026-11-20-bundle3.md) | Check the next `review_run_companion_gateway_request_failed` line for `relayCode`. |
