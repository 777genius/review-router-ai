# Attested request-level retry

Status: design only; no production retry is enabled. Incident examples: [45965433783](https://github.com/777genius/social-monitor/actions/runs/45965433783), [45942092660](https://github.com/agent-teams-ai/.github/actions/runs/45942092660). Their OCR work slots have a single attempt; that slot may contain earlier, successful model requests, so replaying the entire slot is unsafe.

## Evidence and boundaries

Gateway's `rejectBeforeDispatch` checks consumer, execution, request, worker, closure token, origin, engine incarnation, nonce, generation, and live lease before recording `rejected_before_dispatch`. The native transport obtains non-entry after physical close; Gateway's transport occupancy is acknowledged separately. A rejection is terminal for its existing request and currently advertises `retry.kind=never`. A new request must use a fresh request reference and ordinal; it consumes the existing request budget.

The RR model relay currently maps only an explicitly local `not_dispatched` fact to `nativeEffectState=not_dispatched`; rejected or ambiguous native results settle as `effect_unknown`. The v2 settlement proof `local_before_forward` cannot truthfully represent a native rejection after forward. The Action fences a forwarded failed ticket and reserves one OCR work-slot attempt for the managed transport. These safeguards must remain for old producers.

## Proposed implementation sequence

1. Specify an authenticated, exact Gateway request readback that proves both immutable non-entry and closure/occupancy release for the same consumer, execution and request. Preserve current response meanings for old clients; a lost, incomplete or mismatched readback is unknown.
2. RR must bind that proof to the authorization, dispatch ID, native request reference, model request hash and active lease. Persist a distinct native rejection receipt transactionally, never converting a user-supplied envelope or `effect_unknown` to success. Keep the original claim spent. Verify terminal proof, closed occupancy, deadline and current authority before any new dispatch.
3. Add a negotiated producer capability and settlement proof for a confirmed native rejection. Existing producers retain their existing fail-closed behavior. Return only a verified settlement readback to the same receipt-token holder; do not call the existing proof `local_before_forward`.
4. In the Action transport, retry the individual model request with the identical body and a fresh claim, ordinal and Gateway reference only after that readback. Bound retries and backoff; retain maxRequests, deadline, lease, authorization and cancellation limits. Never retry unknown effect, missing receipt, unfinished transport, quota/auth/invalid request, or a stale lease. Do not replay the OCR process or any previous requests.
5. Before enablement, test real PostgreSQL state, concurrency and independent Gateway fixtures: exact positive proof, duplicate and mismatched proof, response loss/readback, crash at each boundary, active transport, concurrent claims, stale lease, exhausted budget, retry limit, terminal conflict, cancellation and unknown effect. Validate backwards compatibility with old producer and deployed Gateway, and run a staged end-to-end provider request. Document rollout and rollback across Gateway, RR and public Action.

The incident logs do not establish the upstream root cause for every partial or failed review. This design reduces one verified class only and does not prove the cause or fix for 502s, stream errors, GitHub rate limits or relay saturation.

## Concrete implementation and qualification checklist

- **Gateway:** add an independently negotiated authenticated proof readback, bound to consumer/execution/request and a durable immutable non-entry observation plus completed transport-closure acknowledgement. The non-entry transition alone does not release `transport_occupied`. Preserve the existing strict `requestStatus` shape and its `retry.kind=never` for the original terminal request. Reject missing, retired, foreign or inconsistent evidence; never return closure tokens or native credentials. Native physical close precedes `rejectBeforeDispatch`, but durable owner acknowledgement follows it. See `services/account-gateway/src/native-transport.ts`, `postgres.ts` and the shared facade contracts.
- **ReviewRouter:** bind the trusted server-side proof to the actual `nativeRequestRef` already bound to authorization/dispatch, exact body hash, route, ordinal and lease/fence. The current `review-run-gateway-relay.ts` maps rejected to `effect_unknown`; `prisma-review-run-companion-dispatch-repository.ts` retains native proof and prevents concurrent unresolved claims. Extend the model-dispatch contract with a distinctly named, negotiated proof instead of misusing `local_before_forward`; make receipt settlement and readback idempotent, transactional and scoped to its holder.
- **Action:** `production-t0-review-runner.ts` forces one entire OCR slot attempt for model dispatch. Keep that limit; change only the individual request in `account-gateway-model-transport.ts` and `prepared-model-dispatch.ts`. After confirmed settlement/readback, reserve a new ordinal/reference within the original finite request allowance and deadline, with bounded delay and retry count. A retry is a new request, never replay or reinterpretation of the rejected request. Explicitly gate transient eligibility; native's generic `native_rejected` alone does not distinguish authentication, invalid request or quota from transient failure.
- **Mandatory tests:** exact bound rejection before and after closure ACK, claim budget and concurrency, negative cross-consumer/reference/route/body proofs, cancellation, expiry and stale lease, failed/ambiguous acknowledgements, response loss and repeated readback, crash between each durable step, concurrent retries, old producer and old Gateway compatibility, no replay of any earlier OCR model turn, and protection for `effect_unknown`. Run actual PostgreSQL and a joined Gateway/native/Action fixture on worker; preserve logs without secrets. Add tests for cost/budget ceilings and the `required_review_coverage_incomplete` path separately.
- **Release:** capability negotiation and a backward-compatible Gateway rollout precede RR proof verification; only a qualified public Action version uses the new proof. Deploy with existing registry, staged canary, retained images/receipts and rollback to old fail-closed behavior; never reset spent budget or clear unknown custody. This is an unimplemented plan, not approval to replay production reviews.

## Producer prerequisite review, 27 November

Exact inspected source: Gateway
`a3dafad640689bf08c614a0e0eea3b4cff605bb8` and native
`e047373eb3bc223bb460bb8b77c2f02a046b4441`. This review did not implement
or qualify the following producer additions.

Native lifetime observation can establish non-entry and physical closure,
but it retains no finite rejection cause. The native HTTP transport currently
discards the error returned by `ForwardGatewayRoute`. Admission phase names
such as `admission_account_lock` combine temporary, invalid and missing-state
failures; they cannot serve as retry eligibility. Repository failures are
collapsed into the generic identity error before receipt creation.

A first producer change must preserve a narrowly typed, trusted transient
cause through the existing lifetime and receipt. One candidate is specifically
recognized serialization/deadlock failure during protected storage admission
before provider entry; arbitrary database errors, timeouts, cancellation,
credentials and invalid state must remain excluded. The actual allowed codes
and paths require native PostgreSQL tests. The existing exact-nonce
`public-admit-capacity/v1` refusal occurs before the SQL claim and cannot be
used as proof for an already spent rejected request.

Gateway can persist a nullable finite non-entry reason on its existing request
row only during the authenticated original rejection transition. Never backfill
eligibility onto historical generic rejections. A separate negotiated proof read
must observe the exact immutable rejection and reason, acknowledged released
occupancy, live execution/grant/fence/deadline and original worker lease in one
committed scope. It must not invoke cleanup, renew authority or produce retry
proof after expiry. No new bearer, closure-token exposure or permit ledger is
needed.

The current private native receipt parser is strict. Adding an optional emitted
field is not automatically compatible: choose and qualify either an accept-first
Gateway rollout with ordered rollback, or explicit private-wire negotiation.
Ordinary public requestStatus and the original request's retry.never stay intact.

The Gateway SDK is consumed as a source-built private archive, not through an
npm publication. Build and pack the exact producer source with the repository's
pinned tools, record provenance, and update all three RR consumer pins plus the
lockfile together. The existing joined workflow pins an older native source;
a passing unchanged workflow cannot qualify the new producer. A usable runtime
for native/PostgreSQL tests and SDK generation is required before RR plumbing.

The RR/Action successor must carry explicit retry lineage: at most the allowed
bounded successor, identical body hash and route, fresh request identity and
ordinal, and still-current original authority. A resolved old row plus an
unrestricted next ordinal alone is insufficient. Keep single-request role
constraints and the OCR attempt budget as described above.

No dormant RR proof adapter is added before these real producer prerequisites.
The source-build and joined qualification requirements remain unfinished parts
of the original task, not evidence that the retry feature has been delivered.
