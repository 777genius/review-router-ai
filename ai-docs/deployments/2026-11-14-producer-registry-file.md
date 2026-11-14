# File-backed producer registry deployment

- Task ID: `2026-11-14-producer-registry-file`.
- Goal: start all runtime roles with the complete producer registry, including retained historical profiles, without exceeding Linux's per-environment-string exec limit.
- Affected targets: API, worker, skill-scan worker, web, and review-v2 operator CLI.
- Implementation: shared [registry reader](../../packages/features/review-run-control/src/infrastructure/configured-producer-release-attestation.ts), operator preflight and Gateway provisioning presence check in the accompanying implementation. Source base `287a5bbfe0b9a7f5bdb4a10f796c262ea0c30908`; final PR/release provenance must be recorded on rollout.
- Last updated: `2026-11-14`.

## Environment status

| Target     | Status    | Actual version / evidence                                                                              | Next step                                                                                            |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| staging    | `pending` | FILE configuration not deployed                                                                        | Qualify the immutable successor with a complete file registry.                                       |
| production | `pending` | Signed 233 recovery uses the compatible original 60-row/232 configuration; FILE input is not installed | Normal paired successor, full retained registry and read-only mount, then coherent fleet acceptance. |

The 233 attempt with 61 minified rows produced a 132,399-byte environment entry and failed to exec before the skill-scan process could start. The file input retains the same JSON/attestation parser and registry authority; it is not a history-pruning or migration workaround.

## Ordered rollout and configuration

1. Follow the [release process](../operations/07-environments-and-release-management.md) for the normal reviewed paired successor. Do not modify a signed image or restart pre-156/157 readers against the migrated schema. This change adds no database migration.
2. Materialize the complete trusted registry as a regular UTF-8 file, maximum 1 MiB, including every retained row/profile plus the selected new release. Compare normalized immutable producer tuples with the approved input before deployment; never omit required null fields or prune history to fit an environment string.
3. Mount that file read-only into every runtime role at an absolute path such as `/run/review-router/producer-release-attestations.json`. Set `REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_FILE` to that path. **Remove** `REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON` entirely; even an empty inline value conflicts with FILE. Do not add file contents to `process.env` or use an environment-injecting wrapper.
4. Use the normal fleet configuration/CAS procedure. Confirm expected image/source, complete registry normalization, successful witness/startup, health and stable restart counts for all roles. Verify web readiness and operator preflight with FILE input. Restore admission only after the coherent rollout's applicable checks pass.

The reader rejects relative paths, final symlinks, nonregular files, oversized or invalid-UTF8 inputs with a sanitized error. The same existing parser validates JSON and every producer/profile. Both sources fail closed. Existing inline configuration remains supported for values that fit the operating system's exec limit; this change does not alter registry count limits.

## Verification and recovery

Focused hosted tests cover a 61-row file larger than 128 KiB, equality of normalized profiles/immutable producer identities, inline compatibility, ambiguous/malformed/missing inputs, and a real Linux child startup that reproduces `E2BIG` with oversized inline input but succeeds with FILE and an unchanged small child environment. A read-only check of the actual 132,340-byte 61-row registry also produced identical normalized tuples for all 61 rows. These are source/configuration checks, not deployment evidence.

Keep the prior configuration, trusted registry file, manifests and schema receipts. On partial startup inspect existing issuance/readiness receipts and actual fleet state before continuing. Prefer fix-forward with the complete FILE registry; do not assume an older image understands FILE or can run against the post-156/157 schema. Any compatible fallback must be explicitly reviewed and must not silently prune retained producer authority. Record actual version/image, timestamps, operator, file digest/row count, per-role verification and any residual limitation here after rollout.

No production effects or live model calls are authorized by this record. Existing NVIDIA synthetic-only boundaries remain unchanged.
