# Bound relay close-authority work

- Task ID: `2026-11-23-relay-close-authority-bounds`.
- Goal: avoid a burst of simultaneous deadline closes issuing unbounded close-authority database work; drain accepted close work during shutdown.
- Affected target: API relay process.
- Dependencies: completed-close recovery and restored-session follow-up [#970](https://github.com/777genius/review-router-ai/pull/970) and [#988](https://github.com/777genius/review-router-ai/pull/988).
- Last updated: `2026-11-23`.

## Environment status

| Environment | Status      | Actual version / image          | Last verified (UTC) | Evidence / next step                                                                   |
| ----------- | ----------- | ------------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| staging     | `pending`   | Not verified                    | Not verified        | Ship a qualified release including both dependencies; perform disposable verification. |
| production  | `installed` | `f20a75ed` / `sha256:2a601d6b…` | 2026-11-26          | Fleet installed; live diagnostics remain pending.                                      |

## Applicability and prerequisites

Ordinary API rollout; no configuration, migration, Gateway, native or public Action changes. Close-authority database phases share a per-process gate sized by the existing `maxInFlight` policy. Cancellation keeps local denial immediate and receives bounded priority; accepted cleanup is drained on shutdown. New no-session closes over the separate limit return unknown without modifying custody. This limits these close phases, not all database traffic. It does not establish tenant fairness, bounded completion during stuck database I/O, recovery after bearer expiry, or the historic incident's root cause.

## Ordered rollout and verification

1. Qualify the exact release head and reconcile all applicable target-environment deployment records in the release runbook.
2. Roll out the API with the two prerequisite fixes; record actual source, image and time.
3. On an isolated disposable fixture, hold authorization reads while deadlines coincide; verify the close-authority limit and that accepted work drains after reads settle. Verify unknown close followed by shutdown/restart preserves ownership, original operation identity and cancellation. Do not replay inference or evict real customer sessions.
4. Inspect production admission and cleanup metrics without deliberately saturating or restarting customer workloads.

## Retry, partial completion, and rollback

Reconcile the installed source/image and durable state before a retry. Roll back the API image by the release runbook; preserve authorizations, bindings and uncertain cleanup custody. A rollback or process restart does not prove Gateway cleanup.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Result                                                   | Next action                                    |
| ------------ | -------------------- | ---------- | ---------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Local synthetic regressions and independent review only. | Complete exact-head CI and authorized rollout. |

## Production installation — 2026-11-26

API code and both prerequisites installed as RR `f20a75edbc7eff11be4f2423fb2e723f6e484223`, image `sha256:2a601d6bffaebea0c2cdd4e1cf82c95a10312136b173f56e837f15a09aa0d810`; fleet and readiness checks passed. The exact image passed the 175-case relay synthetic suite on the isolated worker (job `0bd9edbb9f45641ab207141b4df18ff0`). This does not prove physical Gateway teardown, fairness, or recovery after expiry. Inspect naturally occurring admission and cleanup diagnostics; task-specific live evidence remains pending.
