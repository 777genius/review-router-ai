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
