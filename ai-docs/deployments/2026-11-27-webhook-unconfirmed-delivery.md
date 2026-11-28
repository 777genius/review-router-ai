# Do not acknowledge an unconfirmed webhook delivery

- Scope: legacy API webhook delivery adapter in [PR #1026](https://github.com/777genius/review-router-ai/pull/1026); this narrow change adds no schema, configuration or GitHub App change.
- Staging: `pending`.
- Production: `pending`.

In this legacy adapter, an exact duplicate whose previous attempt is still `processing` previously returned HTTP 200, even if its handler died before completion. A repeated or mismatched delivery now returns an opaque server error unless the persisted, exact delivery is `processed`; an exact `failed` record can still be reclaimed through the existing guarded update. This preserves the failed GitHub delivery for subsequent investigation instead of asserting successful processing.

The standalone #1026 change does not automatically redeliver webhooks, recover abandoned `processing` records, fence handler effects, or guarantee no lost events. In the legacy HTTP path, pull-request pre-admission runs before the generic delivery claim and can run again on a duplicate; its existing ingress idempotency remains necessary. GitHub does not automatically redeliver failed webhooks. Do not reset historical records to force a retry.

The combined implementation in [PR #1027](https://github.com/777genius/review-router-ai/pull/1027) already wires the fenced receiver into production composition, including an atomic delivery claim and initial pull-request ingress when ingress is enabled. For any image containing that implementation, follow the owning [webhook effect fence runbook](2026-11-27-webhook-effect-fence.md) for the writer drain, three additive migrations (`000165`, `000167`, `000168`), grant verification and rollback.

Before an authorized rollout, review the exact image and applicable deployment registry items. The ordinary API fleet rollout and rollback procedure applies to the standalone legacy-adapter change; its rollback restores the earlier ambiguous-acknowledgement behavior. Verify signed duplicate responses in an isolated fixture and service health, then update the actual environment and evidence. No production mutation or webhook replay has been performed by this change.
