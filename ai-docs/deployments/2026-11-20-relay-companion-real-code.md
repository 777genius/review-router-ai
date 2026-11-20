# Relay returns the real cause of a failed companion request: deployment

- Task ID: `2026-11-20-relay-companion-real-code`
- Goal: when a companion (OCR and other Account Gateway model) request fails
  inside the SaaS relay, the runtime and the API log get the closed cause
  (Gateway code such as `upstream_failure` or `forbidden`, a local
  `authorization_denied`, provider quota, otherwise `relay_unknown`) instead
  of the generic `companion_request_failed` that runtime logs showed as
  `unrecognized`.
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

| Target     | Status    | Actual image | Evidence                    |
| ---------- | --------- | ------------ | --------------------------- |
| Staging    | `pending` | Not verified | Ordinary API rollout        |
| Production | `pending` | Not deployed | Rides in bundle 3 (the API) |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- Only the code in the relay's error body changes, and the companion failure
  log line gains `relayCode`. Status stays 502, the effect is the one the relay
  already settled (`effect_unknown`, or `not_dispatched` for a local admission
  limit), and no `failureScope` or concurrency group is passed on. Retries,
  settlement, usage and run outcome are unchanged.
- The runtime already lists the codes this path produces in practice
  (Gateway codes, `authorization_denied`, `gateway_unavailable`,
  `relay_unknown`; see `ocr-review-failure-diagnostic.ts` and `observeRelay` in
  `action.ts`), so "Managed OCR failure" lines show the real code with the
  current Action. A rarer RR-local code still shows as `unrecognized` there but
  is in the API log. One visible difference: an NVIDIA rejection that the
  Gateway reports as `upstream_failure` now arrives with that code and
  `effect_unknown`, so the summary uses the
  existing "upstream failure, outcome unknown" notice instead of the generic
  "request outcome unknown" one (plan 71 wording, no new text).
- `companion_request_failed` is no longer emitted.

## Applicability and rollout

Ordinary API image rollout. Rides in bundle 3, NOT deployed.

## Verification and completion

After the rollout, read-only: the next companion failure in the API log
(`review_run_companion_gateway_request_failed`) carries `relayCode`, and the
matching run log line "Managed OCR failure" shows that code instead of
`unrecognized`.

## Retry and rollback

Revert the commit and roll the API back. No state is written by this change.

## Execution log

| Time (UTC) | Environment | Operator | Actual version / image | Step and observed result | Evidence | Next action         |
| ---------- | ----------- | -------- | ---------------------- | ------------------------ | -------- | ------------------- |
| -          | -           | -        | -                      | Not deployed             | -        | Ship with bundle 3. |
