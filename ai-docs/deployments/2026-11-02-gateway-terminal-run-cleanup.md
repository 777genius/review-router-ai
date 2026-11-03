# Gateway terminal-run capacity cleanup: deployment

- Task ID: `2026-11-02-gateway-terminal-run-cleanup`.
- Goal: failed, terminal Actions runs stop occupying retained Gateway relay capacity after their exact native cleanup succeeds; new reviews can dispatch normally.
- Affected services: API; no migration or provider-setting change.
- Implementation PR: [#793](https://github.com/777genius/review-router-ai/pull/793).
- Implementation reference: `07df054820d4421c8d21e5621316dae679f4626e`; its runtime implementation is unchanged by subsequent main integration. Dependency: [#787](https://github.com/777genius/review-router-ai/pull/787), source `44b06c141d056fa2779bc2bb29e18dbd9c84ea06`.
- Incident: [PR786 incomplete review](https://github.com/777genius/review-router-ai/pull/786#issuecomment-6583396915), [run41486922185](https://github.com/777genius/review-router-ai/actions/runs/41486922185).
- Last updated: `2026-11-02`.

## Environment status

| Environment / target | Status    | Actual deployed version | Last verified (UTC) | Evidence / next step                                                                          |
| -------------------- | --------- | ----------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| staging              | `pending` | Not verified            | Not verified        | Remote strict API and focused regression qualification.                                       |
| production / Hetzner | `pending` | `57cc15137` baseline    | Not verified        | Merge, include in one coordinated qualified application rollout, then real review acceptance. |

## Observed failure

The exact run selected FREE Nemotron and received a SaaS relay HTTP 503 with `code=relay_saturated`, `effect=not_dispatched`, followed by one provider attempt with budget 1. It did not obtain review evidence. This is not evidence of an OpenRouter quota failure or of a wrong model default. Immediate later transport warnings inside the failed OCR process are local denied calls, not proof of repeated provider HTTP requests.

A bounded read-only production audit found 15 active authorizations created 12:20–13:30 UTC whose exact GitHub workflow runs had all completed with failure by 15:28 UTC. Their maximum deadlines were 18:20–19:30 UTC. Nine frozen prepare operations existed: five native executions fenced and four active. Six operation reads returned safe_error/effect_unknown; they are not proven absent. This is consistent with retained relay capacity pressure, but the audit does not expose the in-memory session map and cannot prove every retained slot's contents.

The existing pressure cleanup skipped active authorizations until their immutable maximum deadline. The fix permits an authenticated App read of the exact original repository/run/attempt to establish abnormal source completion, then invokes existing deny-first authorization termination and exact native close. A terminal workflow never proves no model effects. Successful source runs preserve the existing v4 publication-authority contract and do not enter cancellation through this seam. Unknown native closes, missing identity or failed GitHub access retain custody and cannot free a slot. Cleanup preserves the existing fair bounded scan and total time budget. Safe saturation counters identify local in-flight/session/close-authority pressure without logging credentials or request bodies.

## Ordered rollout and acceptance

1. Verify strict API typing, the real loopback relay regression (unknown close retains the slot, applied close frees it), existing relay custody tests and exact App source-run identity rejection cases. Demonstrate the new regression fails against the prior relay.
2. Follow the [release process](../operations/07-environments-and-release-management.md) and coordinate the existing shared release owner. This change requires ordinary API rollout only; no schema, cap increase, restart-as-repair, provider change or new flag.
3. Read back the actual installed source/image. During the agreed disposable review window, verify a fresh normal event obtains accepted evidence, App-authored publication, truthful coverage and Usage/Statistics accounting. A green mocked test is not this live acceptance.
4. Observe source-terminal cleanup and native custody readback; retain unknown operations for reconciliation. Do not blindly replay failed runs or inference.

## Wording and rollback

Attempt-neutral incomplete-review wording was already merged in public Action PR364 at `41c8d65d627bdf7eb0626b711fd57832ff63d7c3`, and confirmed as an ancestor of public release 226 Action `fa3e87a7` (ahead 1/behind 0); activation is still pending. Reuse that existing fix in the coordinated Action release rather than adding a duplicate change. The current incident's old “exhausted retry attempts” text remains misleading for a one-attempt run until that runtime is adopted.

A compatible API rollback restores the former delay in pressure cleanup; it must preserve native operations, authorizations, admitted work and all receipts. Never free unknown custody or revoke unrelated runs as a workaround. Preserve the shared test stand and repositories.

## Execution log

- 2026-11-02: GitHub comment/run logs, 15 exact terminal workflow states and safe native operation projections collected read-only in `tmp/pr786-review-failure/`. No production mutation, model replay, cap change or deployment executed by this lane. Server qualification passed: strict API typing and all 93 relay/App-reader/real-Octokit transport cases with zero skipped; the new relay regression failed on the prior relay as expected. Evidence: [sanitized relay qualification summary](#qualification-evidence). CI, production rollout, native custody reconciliation and live acceptance remain pending.

## API signal lifecycle follow-up

The installed server did not wire SIGTERM/SIGINT to Fastify close, so a normal container stop did not establish that retained Gateway cleanup ran. This implementation now installs idempotent signal handlers before listening: both signals share one awaited app.close call; repeated signals do not bypass a pending drain. A close rejection sets exitCode 1 and logs a fixed safe message without raw error data. There is no force exit and no claim that an unknown native close became physically closed. The currently running old API is not repaired by this source change.

A real Fastify child-process acceptance pauses its preClose hook, verifies both signal orders and a single close call while duplicate signals arrive, then allows natural exit. A real-close failure projection checks unsuccessful exit and secret-free logging. This follow-up passed strict API typing and all 3 real-child acceptance cases with zero skipped. Evidence: [sanitized signal lifecycle qualification summary](#qualification-evidence). Previously accepted relay cases were not repeated. The separate old-process custody handoff must be reconciled before replacing the old API.

## Additional authority-read bound and evidence limits

The exact original 503 saturation branch remains unproven. Sixteen was the configured session maximum, not an observed in-memory count; 15 SQL authorizations are not a session census. A single authorized invalid-token status GET at 18:34:10 UTC returned 401 in 4 ms, proving only that the global reservation could be acquired at that instant. It performed no tenant/native read. A point-in-time socket census likewise cannot establish the historical branch.

A separate source defect was confirmed: Responses reserves global in-flight capacity before its full SCM authority read, while the GitHub revision adapter had no explicit timeout for its PR/compare reads or hidden cold-token request. Each adapter read is now bounded at 15 seconds through request defaults, a fresh abort signal and a cancellation-aware await; cold token creation inherits the same bound. The relay's pure initial authority read is cancellable before session creation, and late authority completion cannot start preparation or inference. Cancellation after a durable dispatch claim settles through the existing proven pre-forward refusal path before any new Prepare. Effectful Prepare/close work is never raced or discarded by this change.

Remote qualification passed strict API and review-run-control typing plus all 82 closest relay/adapter cases with zero skipped. Two new relay cases and the cold-token case failed against their respective prior source as expected. The passing cases cover real App token/GET cancellation, an auth transport that ignores cancellation, six stalled pure authority reservations followed by cancellation and a fresh admitted request, and cancellation during the existing dispatch claim. Evidence: [sanitized authority-read qualification summary](#qualification-evidence). Previously accepted unrelated suites were not repeated. These are future reliability fixes, not retrospective proof of the original 503 branch or physical cleanup of old native executions. No local heavy process or production effect was used to implement them.

## Qualification evidence

These checked-in, secret-free summaries retain the isolated qualification results. They are not production acceptance or proof that an unknown native operation closed.

| Server qualification            | Result                                                                                                                                                        | Supplemental private receipt                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Relay and App source-run reader | Strict API typing; 93/93 cases passed, zero skipped. The new relay case failed against prior relay source.                                                    | `/srv/workers/rr-operator790-20261102-165027/relay-qualification/receipt.json`     |
| Signal lifecycle                | Strict API typing; 3/3 real Fastify child-process cases passed, zero skipped.                                                                                 | `/srv/workers/rr-operator790-20261102-165027/graceful-qualification/receipt.json`  |
| Authority-read bounds           | Strict API/review-run-control typing; 82/82 cases passed, zero skipped. Two relay cases and the cold-token case failed against their respective prior source. | `/srv/workers/rr-operator790-20261102-165027/authority-qualification/receipt.json` |

The qualified runtime source is `07df054820d4421c8d21e5621316dae679f4626e`. Its [published CI record](https://github.com/777genius/review-router-ai/actions/runs/41503985520) has mixed results: the dedicated Release Authority PG17 contract and source/certification checks passed; the aggregate and several other jobs were cancelled. It does not replace the isolated server results above or establish final-batch CI completion. Private originals are retained; no publicly downloadable receipt artifact is asserted. Deployment and live native-custody reconciliation remain pending.
