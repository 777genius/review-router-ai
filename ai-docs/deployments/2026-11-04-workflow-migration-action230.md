# Installed Gateway workflows and Action230

- Task: retire the three remaining managed legacy OAuth callers, confirm their installed Gateway bindings, and deliver clear diagnostics for unknown request outcomes.
- Source: private [#812](https://github.com/777genius/review-router-ai/pull/812), public [#370](https://github.com/777genius/review-router/pull/370).
- Production code: `installed`; positive live E2E is `blocked` by the external OpenRouter free quota. Staging remains unverified.
- Last updated: 2026-11-04.

## Actual installed baseline

The documented Hetzner host build/swap/verify path installed private source `d184d13e56733586ba65d31aacb076d4eefbee7d`, image `sha256:6d8d7f2d164877676b55f6a8d2936780d902dae705ed1c3a1878e82af72b57ca`. All four roles converged, have zero restarts, and readiness returned200. Seven known worker privileges passed. The source includes foundation #810 and installed-binding #812. No database/schema migration was introduced. Formal private v1/v1.0.228 tags remain at a3; this delivery does not claim a private230 tagged release.

Public Action `v1.0.230` and `v1` resolve to `8328c2e6c3a2a7767a0667a2669982bc6ef71f64`. [Release41825127619](https://github.com/777genius/review-router/actions/runs/41825127619) passed and published a non-draft release. The checked canonical manifest binds that exact executable and committed runtime digest. The installed API read-only protocol preflight passed with zero missing/unsupported contracts. Registration used the installed trusted materializer once; no limit/SLO/profile creation and no model calls occurred.

Two normal fleet overlays first appended the new approved producer and then switched the primary ref, API/Web Gateway refs and complete installer tuple. Registry58 retains all57 prior producer rows; the installed Gateway-only OCRv5/default model dispatch profile and capacity128 per review are unchanged. No additional account-wide limit was introduced. [Promotion41828717562](https://github.com/777genius/review-router/actions/runs/41828717562) passed, and `workflow-v1` independently resolves to the exact230 executable. Existing containers and rollback evidence were preserved.

## Installed repositories

| Repository                         | Managed source changes                                                                             | Live confirmation                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| agent-teams-ai/agent-runtime       | #249/#251 retire old Codex and interaction files; canonical Gateway caller and policy test updated | `ready`, configured reusable/workflow-v1, revision1 |
| 777genius/clean_disk               | #5/#6 install canonical Gateway caller and retire both legacy files                                | `ready`, configured reusable/workflow-v1, revision1 |
| 777genius/agent_teams_orchestrator | #209 cleans main; #212/#213 clean active PR bases dev and fix/managed-mcp-authorization-oct28      | `ready`, configured reusable/workflow-v1, revision1 |

Each confirmation used the actual scoped operator API, source/tenant/installation checks, complete active-base workflow inventory and optimistic metadata update. No direct database repair, policy weakening, changed protection or authorization bypass was used. Retired OAuth workflows must not be reinstated for these installations. Discussion handling remains unqualified and disabled; it must not be enabled merely to satisfy old workflow inventory.

## Live review and statistics

Final candidate: existing [clean_disk#7](https://github.com/777genius/clean_disk/pull/7), head `fd2b5d7ca610a724948410e02c03841c06dad134`; one eligible documentation file. The earlier GitHub-incident dispatch became terminal `dispatch_outcome_unknown`, with zero authorizations/model calls. It was preserved and not replayed. A normal ready-for-review event after channel activation created a new request and [run41829266811](https://github.com/777genius/clean_disk/actions/runs/41829266811). The run waited approximately13minutes for a GitHub-hosted runner, then authorized the exact230 producer and reached OpenRouter through the installed OCRv5 profile. It failed on a real upstream quota fact: `0 of 1000 requests remaining`, reset `2026-11-05T00:00:00Z`. The Action exposed that specific message; transport returned502 and native outcome remained `effect_unknown`. This is an external provider-quota blocker, not evidence of a completed review or an unknown cause being guessed. No automatic replay or provider/model substitution was attempted.

The installed API revoked the authorization and Gateway close returned `applied`. Readback at12:40:42UTC found one unique Usage call, with native `unknown` state, null tokens/cost and partial completeness; it did not invent zero tokens or successful model usage. No finalized review artifact, completed-review Statistics fact or issue was recorded. Progress correctly showed0/1 satisfied and1 exhausted. The operational execution was still `running` at that observation; later cleanup is not claimed by that receipt. Positive review/publication/statistics verification must resume after the provider reset or an explicitly selected alternative provider, rather than redeploying this unchanged code.

## Scope and retained work

The public change explains an unknown provider outcome without claiming an HTTP cause or blindly replaying a possibly executed request. Valid provider-quota facts retain their specific message; invalid/missing quota details use the safe unknown-outcome message. Dispatch, settlement and coverage acceptance are unchanged. Exact-head CI passed;84 focused diagnostic/projection/transport tests passed.

OCR coverage redesign is owned by another agent and is outside this delivery. Pure-deletion no-model outcomes and prior partial/unknown observations remain preserved. Memory semantic qualification, authenticated dashboard journeys, self-hosted distribution and GitLab remain separate. Existing test stands were retained. Do not repeat this deployment or old unknown model calls to close those verification gaps.

## Evidence custody

Root-private host preparation and receipts: `/srv/platform/projects/review-router/releases/action230-ond184-prepared-20261104`; overlay custody: `fleet-overlay-action230-overlap-20261104` and `fleet-overlay-action230-primary-20261104` beneath the same releases root. The actual server build remains `/srv/platform/projects/review-router/builds/rr-build-d184d13e5673`. These contain no new credential identity; raw inspection/env files stay private and must not be committed. The sanitized summary is maintained with this record.
