# Usage reconciliation and Gateway fact budget

As of `2026-11-10T06:32Z`, [PR #847](https://github.com/777genius/review-router-ai/pull/847) is merged as `441796e1036d48d3e08f628c5c00351daab8bbad`, but is **not installed in production**. Its candidate source `6b85180f19b8883ec34c5cb185e94ab73afce8ad` is imported and passed the read-only owner protocol preflight: 64 required contracts, none missing or unsupported. Preflight evidence is `/srv/platform/projects/review-router/releases/owner-protocol-preflight-6b85180f-20261110/output/assessment.json`. The production SaaS fleet remains on the previous #844 candidate `50bb6fff` and image `sha256:4891df7c78d0695f7b96bebbd753019394909557a9bbe68a551b5872917f0376`; evidence `/srv/platform/projects/review-router/releases/fleet-overlay-50bb6fff-20261110/apply-receipt.json`. Wait for a safe drain before the planned single activation. Gateway #104 was installed separately; see [its record](2026-11-09-gateway-diagnostic-stream.md).

PR #847 changes temporary Gateway usage-source failures to remain eligible for retry with the existing capped backoff. It preserves reconciliation cursor, high-water mark and lease fencing; permanent errors still follow their existing dead-letter policy, and the change does not itself reset existing dead letters. Previously affected checkpoints were separately restored by an audited redrive; do not replay model requests or repeat that redrive merely to install #847.

## Phase-1 admission gate incident

At `2026-11-10T05:00:53Z`, a temporary deployment admission gate returned 503 while [review run 42758888309](https://github.com/777genius/agent-teams-ai/actions/runs/42758888309) failed to obtain authorization. The access log has no request identity: the gate hit and failure have strong temporal correlation, not identity-level proof. The incident audit found no matching authorization, execution, checkpoint, batch result, evidence or snapshot, and no model replay was started. The gate restored automatically. Its retained summary is `/srv/platform/projects/review-router/releases/drain-6b85180f-phase1b-20261110/incident-summary.json`.

The original intent was superseded by the ordinary [successor run 42759510491](https://github.com/777genius/agent-teams-ai/actions/runs/42759510491). That run later ended unsuccessfully with `review_superseded_by_newer_revision`; it is not evidence of a successful review. Preserve its unknown request/close outcomes without replay.

## Capacity and alerting

The temporary account-specific budget increase and its limits are recorded in the [Gateway deployment record](2026-11-09-gateway-diagnostic-stream.md). At `2026-11-10T06:32Z`, read-only counters showed service budget 2.32%, consumer budget 23.18%, and the highest account budget 11.03%. These are point-in-time observations, not a forecast; permanent idempotency namespaces still grow.

Gateway #104 emits a sanitized capacity warning only after a refusal. No working ReviewRouter-specific capacity alert route or delivery was established in this audit. Follow-up: sample all three existing database counters read-only, alert before exhaustion and on missing data, and verify the actual notification recipient and delivery. Do not mark a journal-only check as a delivered alert or delete legacy/unknown facts to reclaim space.
