# Relay stale close capability recovery

- Goal: recover an exact retained close capability after a definite Gateway 401 refusal, before the original authorization expires.
- Scope: ReviewRouter API. No schema, configuration, Gateway or Action change.
- Production: `pending`. Implementation is not deployment evidence.
- Staging: `pending`.

On 2026-11-27 production logged `relay_saturated` with 16 retained sessions. Pressure cleanup observed `unauthenticated`/401 with `not_dispatched`; the precise reason for those bearer refusals remains unconfirmed. The fix retains custody unless the original operation, saved binding and admission all match. It retries only the same close, never dispatches inference, and refuses the new refresh after authorization or admission expiry.

Before rollout, reconcile the current production release and Gateway compatibility, run the exact release checks and apply the ordinary API fleet procedure. Retain the previous image. Verify actual API health and normal review behavior, then update this record and the index. An applied patch or green CI alone is not production deployment.

Worker verification: all 181 relay tests passed against an isolated fixture. A separate network-isolated Gateway/native/PostgreSQL fixture with Prisma observed one injected 401, exact refresh and applied close; cleanup completed and occupied transports were zero. The same fixture observed that Gateway refused reissuance after expiry. These fixtures do not prove the historical 401 cause, real issuer-rotation behavior, or production recovery. Evidence: `/srv/workers/adhoc/iliya/rr-producer-959-20261126/diag-refresh-401-v3/summary.json`.

Rollback: use the normal API fleet rollback and retain uncertain Gateway custody. Do not mark unknown cleanup as complete or extend expired capabilities.
