# Relay stale close capability recovery

- Goal: recover an exact retained close capability after a definite Gateway 401 refusal, before the original authorization expires.
- Scope: ReviewRouter API. No schema, configuration, Gateway or Action change.
- Production: `blocked`. Installed API remains `5ab12e2d79a2d60351fd17cca871b32f3d039f13`; the new change has not been deployed.
- Staging: `pending`.

On 2026-11-27 production logged `relay_saturated` with 16 retained sessions. Pressure cleanup observed `unauthenticated`/401 with `not_dispatched`; the precise reason for those bearer refusals remains unconfirmed. The fix retains custody unless the original operation, saved binding and admission all match. It retries only the same close, never dispatches inference, and refuses the new refresh after authorization or admission expiry.

Before rollout, reconcile the current production release and Gateway compatibility, run the exact release checks and apply the ordinary API fleet procedure. Retain the previous image. Verify actual API health and normal review behavior, then update this record and the index. An applied patch or green CI alone is not production deployment.

Worker verification: all 181 relay tests passed against an isolated fixture. A separate network-isolated Gateway/native/PostgreSQL fixture with Prisma observed one injected 401, exact refresh and applied close; cleanup completed and occupied transports were zero. The same fixture observed that Gateway refused reissuance after expiry. These fixtures do not prove the historical 401 cause, real issuer-rotation behavior, or production recovery. Evidence: `/srv/workers/adhoc/iliya/rr-producer-959-20261126/diag-refresh-401-v3/summary.json`.

Rollback: use the normal API fleet rollback and retain uncertain Gateway custody. Do not mark unknown cleanup as complete or extend expired capabilities.

## Production attempt, 2026-11-27

The owner authorized an expedited ordinary fast-forward release. Source `6271ebe1f5e98bb376b4c7269394f806cb73041f` reached `main` without awaiting CI; independent review, 181 isolated relay tests, fixture typecheck and a joined Gateway/native/PostgreSQL check passed as described above. An exact-source Docker build on the Hetzner worker (agent-wait-on job `b63fb16cbc4800338260fe2a99ce6fa0`) failed with `ENOSPC` during the frozen dependency installation; no target image or fleet change resulted. Full production backup `20261127-052446F` completed with `error=false`. An earlier, superseded worker-only image was removed after verifying it had no container references, restoring worker free space from 2,941,542,400 to 5,740,953,600 bytes; this does not establish enough headroom for a new build. Production needs adequate worker scratch and a fresh exact-source build before activation. Historical 401 cause and actual production recovery remain unproven.
