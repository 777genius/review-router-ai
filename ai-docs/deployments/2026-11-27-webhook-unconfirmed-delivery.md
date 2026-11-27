# Do not acknowledge an unconfirmed webhook delivery

- Scope: API webhook delivery repository; no schema, configuration or GitHub App change.
- Staging: `pending`.
- Production: `pending`.

An exact duplicate whose previous attempt is still `processing` previously returned HTTP 200, even if its handler died before completion. A repeated or mismatched delivery now returns an opaque server error unless the persisted, exact delivery is `processed`; an exact `failed` record can still be reclaimed through the existing guarded update. This preserves the failed GitHub delivery for subsequent investigation instead of asserting successful processing.

This change does not automatically redeliver webhooks, recover abandoned `processing` records, fence handler effects, or guarantee no lost events. GitHub does not automatically redeliver failed webhooks. A safe later takeover requires a durable owner/generation fence that applies to all effects, including pre-admission processing and installation/outbox writes, plus recovery for an unknown external outcome. Do not reset historical records to force a retry.

Before rollout, review the exact image and applicable deployment registry items; install the ordinary API fleet change. Verify signed duplicate responses in an isolated fixture and service health, then update the actual environment and evidence. Rollback uses the ordinary API fleet procedure; it restores the earlier ambiguous-acknowledgement behavior. No production mutation or webhook replay has been performed by this change.
