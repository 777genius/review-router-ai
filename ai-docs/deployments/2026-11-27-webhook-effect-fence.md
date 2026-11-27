# Webhook effect fence (work in progress)

- Scope: future additive database schema and guarded webhook effects.
- Staging: `pending`; the protocol is not integrated or qualified.
- Production: `pending`; do not install or enable takeover.

The design and initial database-effect fence primitives are incomplete. The helper is not wired to webhook handlers and must not be used to reclaim a live or legacy delivery until every effect writer, external effect and mixed-version transition meets the [fencing contract](../architecture/2026-11-27-webhook-delivery-fencing.md). A lease alone is not proof that the earlier worker stopped. This draft does not implement GitHub redelivery or recovery of old `processing` rows.

Before any rollout, finish the handler and outbox integration, durable claim/renewal and unknown-outcome protocol, and execute the isolated real-PostgreSQL and end-to-end race matrix in the design. Review the final schema, database privileges, indexes, migration version and mixed-fleet rollback independently. Apply migrations and rollout only after the exact integrated change is approved; preserve legacy rows and unknown effects. Record actual versions and evidence per environment here.
