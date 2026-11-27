# Retry retained completed Gateway closes before expiry

- Task ID: `2026-11-22-relay-completed-close-recovery`.
- Goal: a lost or unknown acknowledgement while completing a v4 review does not leave its relay slot waiting for a failed source workflow before retrying the same close, including allocations restored from a durable binding by another API process.
- Affected target: API process memory and Gateway close calls.
- Implementation PR: [#970](https://github.com/777genius/review-router-ai/pull/970).
- Implementation reference: `ddec400c9b98b1b042b524e83f56b9cc90588fe0`; this identifies the initial source and is not proof of deployment. The restored-session followup must accompany it before claiming this recovery path is complete.
- Dependencies: existing Gateway idempotent close-operation contract; no Gateway deployment required.
- Last updated: `2026-11-23`.

## Environment status

| Environment | Status      | Actual version / image          | Last verified (UTC) | Evidence / next step                                                          |
| ----------- | ----------- | ------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| staging     | `pending`   | Not verified                    | Not verified        | Include this implementation in an authorized API rollout and verify recovery. |
| production  | `installed` | `f20a75ed` / `sha256:2a601d6b…` | 2026-11-26          | Fleet installed; task-specific real Gateway verification remains pending.     |

## Applicability and prerequisites

Select a release containing this implementation using the [release process](../operations/07-environments-and-release-management.md). Ordinary API code rollout is sufficient. There are no migrations, configuration, feature flags, native, public Action, Web or worker changes.

Completed v4 cleanup preserves parent publication authority. An already closed local session retries its original close under capacity pressure without requiring the source workflow to fail. A bounded background retry also runs without incoming traffic: up to eight attempts per retained authorization, starting at one second and doubling to a 30-second cap, shortened near the original deadline. All attempts reuse the exact close operation ID and never replay inference. Existing cleanup concurrency, owner identity, immutable snapshot, deadline and joined cancellation fences remain required. Original deadline timers remain until slot release; shutdown clears deadline and retry timers.

Restoring a cleanup-only allocation from its durable binding must retain the effective first close reason before attempting native cleanup and install the original immutable deadline timer. The initial implementation did neither for newly restored sessions: an unknown completed close could retain a full slot while pressure and background recovery skipped it. A synthetic loopback regression on exact initial PR head `b5812be63806b88bc2558a45aa3acac0b5159384` reproduced that admission failure. The followup preserves a previously captured parent cancellation when choosing a restored allocation's first native close reason; it does not replace an existing operation or its first intent. It also pins the restored session's immutable authority before awaiting cleanup, so a deadline or cancellation joining that first close cannot terminate a replacement identity or snapshot.

## Ordered rollout

1. Reconcile the target environment and applicable pending deployment tasks for the selected version.
2. Complete the ordinary authorized API rollout; record actual source/image and time here.
3. Verify on a disposable synthetic fixture that a completed active-parent v4 execution whose first committed close acknowledgement is lost receives an exact-ID close retry and releases its slot. Verify both capacity-pressure and background recovery, including a fresh API process restoring an existing durable binding. Do not induce ACK loss or run inference in a real user project.
4. Inspect normal admission, close failures and retained-session diagnostics. Preserve unknown custody and record unresolved debt; do not evict slots, replay inference or restart to manufacture successful cleanup.

## Verification and completion

Local regressions must demonstrate the prior failure and the corrected behavior, stable close IDs, unchanged inference count, preserved completed publication authority, eight-attempt bound, original expiry, changed-owner rejection, concurrent cleanup/cancellation and shutdown. Real Gateway/SDK/SQL evidence must remain distinct from synthetic native transport and physical teardown.

The restored-session followup passed 150 loopback fixture tests, including eleven focused regressions for pressure, idle recovery, bounded retries and the restored deadline timer, changed identity/snapshot and failed owner reads, joined cancellation across two restored allocations, deadline joins during the first held restore (including an already expired restore), and shutdown. Native TypeScript 7.0.2 checked the actual relay, preparation, fixture and local verification configuration with the owning strict API settings. Native lint, formatting and whitespace checks passed. These are local implementation checks; exact-head required CI and independent custody review are delivery gates, not deployment evidence.

A Gateway execution bearer expires at the original hard deadline. This implementation does not claim automatic reconciliation after expiry or after its retry budget is exhausted; those slots remain fail-closed unless a close can be authoritatively confirmed. It is not proof of the historical production incident's cause or the composition of production's retained slots.

## Retry, partial completion, and rollback

Before a rollout retry, reconcile the actual installed image and task evidence. Retry only ordinary deployment steps that remain incomplete. Follow the release runbook rollback procedure to restore the prior API image. Preserve durable authorizations, bindings, usage and native cleanup state. Process memory and local retry timers do not constitute durable Gateway cleanup proof.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Result                                                                    | Next action                                         |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Implementation and disposable verification only; no deployment performed. | Complete normal delivery and an authorized rollout. |

## Production build attempt (2026-11-25)

An authorized build of `95201f4e0d63d3ab7c4d585a1e55a6317e84ca6b` succeeded on production as `sha256:d27fe909487003c294ebe70e51d27acad505bd9b00e3ca36da4c158dab21e0c2`, but free disk dropped to 379,858,944 bytes. No backup, migration, fleet swap or verification was started. The newly built image was removed after confirming no container referenced it; free disk rose to 3,187,478,528 bytes. The installed fleet remains on the prior image; production remains pending. Preserve the build directory and log for reconciliation. Do not retry the build until adequate disk headroom is established.

After the attempt, three exact private immutable cache records created by this build (`v70n9i4x9mglol4alhwis86ey`, `lnn9a9oe9xsxx24xh5ucg36me`, `p9dnr1ijjhd8hq45qspmptp49`) were removed in dependency order after reference checks. Free disk increased from 3,186,040,832 to 6,938,902,528 bytes. The source archive, checksum, source tree and build log remain in build custody; `image.id` is historical and no longer identifies an installed image.

## Production installation — 2026-11-26

Production installed ReviewRouter `f20a75edbc7eff11be4f2423fb2e723f6e484223`, image `sha256:2a601d6bffaebea0c2cdd4e1cf82c95a10312136b173f56e837f15a09aa0d810`; API, web, worker and skills scanner verified running without restarts, API readiness 200. The exact image passed 175 relay fixture tests on the isolated worker, including completed-close timer and restored-session recovery. This is synthetic evidence, not proof of real Gateway teardown, historical slot cause, or recovery after bearer expiry. Task-specific real Gateway/SDK/SQL qualification and naturally occurring production diagnostics remain open.

A failed first image import had unreadable source permissions and `migrate` refused before a database write; the corrected image passed a real runtime-user read check. The completed production rollout applied RR migration 000161, native 260–266 and Gateway 013, backed up both PostgreSQL estates, and retained old fleet containers. Gateway/native startup initially failed because a private engine binary was mistaken for its launcher; the correct `cmd/account-gateway` artifact fixed startup. Admission was restored after each failed attempt. Production free disk was approximately 2.4 GiB after rollout; preserve backups, rollback and active work and plan targeted cleanup. Gateway backup was decoded but restore on actual production data was not exercised.

Evidence: `/srv/platform/projects/review-router/releases/fleet-overlay-f20a75ed-oLiXCpng`, `/srv/platform/projects/review-router/account-gateway/rr959-prepared-20261126/v7-ready-fenced.json`, `/srv/platform/projects/review-router/account-gateway/backup-rr959-20261126-v7`, and worker job `0bd9edbb9f45641ab207141b4df18ff0`.

## Gateway close readback — 2026-11-26

Production Gateway `a3dafad640689bf08c614a0e0eea3b4cff605bb8` ([Gateway PR #124](https://github.com/agent-teams-ai/account-gateway/pull/124)) is installed and active with the existing ReviewRouter `f20a75ed` and native `9fc45a44`. Admission was restored after the cutover; API readiness returned 200. The current Gateway config, including the separately activated native connection methods, was preserved. Before the switch both Gateway databases were backed up and archive decoding checked; the previous Gateway bundle remains available for rollback. Production backup restore was not exercised.

A disposable worker E2E used the production ReviewRouter relay and PostgreSQL binding with Gateway and native, and intentionally dropped a committed `applied` close acknowledgement. A new relay process restored its durable binding, retried the original close and marked cleanup complete; the final fixture had no open executions, occupied transports or unresolved cleanup. Worker job `34f30cd6043a9ccc0d89aff31ec2b9bb`; evidence `/srv/workers/adhoc/iliya/rr-producer-959-20261126/diag-joined-relay-v8/summary.json`. This test used synthetic data and the fixed Gateway source, not a production review. The historical production saturation cause remains unproven. The original admission expiry and bounded retry budget still prevent claiming unconditional recovery; slots retain custody fail-closed after those limits.

The staged release archive SHA256 is `a2156bf0297bcf568d084efebbd92fb0070e645ab3ed97abdf2bc4ba979d8a90`; cutover evidence is under `/srv/platform/projects/review-router/account-gateway/rr124-prepared-20261126` and backup `/srv/platform/projects/review-router/account-gateway/backup-rr124-20261126-v2`. Free production root space after installation was approximately 1.67 GB; preserve active data and backups while arranging targeted cleanup. Staging and naturally occurring production close-recovery verification remain pending.
