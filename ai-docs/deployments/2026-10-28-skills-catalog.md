# Skills catalog: bounded production repair

- Task ID: `2026-10-28-skills-catalog`; last updated: 2026-10-29.
- Goal: working UAP Preview → native static check → acknowledged text import → repository assignment, plus Context tools in the persistent sidebar.
- Targets: UAP binary/systemd/Caddy; private scanner/egress; Web, API, ordinary worker and dedicated scan worker; existing Skills database tables/configuration.
- Implementation: [ReviewRouter #735](https://github.com/777genius/review-router-ai/pull/735), [UAP #555](https://github.com/777genius/universal-agent-plugins/pull/555), merged as `4fe44c439eee7ccc3ddca3d1cd63114527508e0c`.
- Current source integration is tracked by [PR #740](https://github.com/777genius/review-router-ai/pull/740); the earlier #735 checkpoints below retain their bounded repair evidence.
- Host: `prod-hel1-01` / `37.27.125.57`, verified machine ID `b28fc7b17042414386eb9b114046e50c`. Owner authorized the live repair, review and merge.

Historical Skills-only review follow-up: the 12-line `/dashboard?section=context-tools` redirect now runs after authorized workspace selection. Checkpoint `1e3a5379ea6268692ed7f0545c9ebd0c9049c5b9` is directly based on `7bda7a1b2`, with only that reviewed redirect and three red/green regression cases. Native full-web typecheck/build passed; all 336 API-dist files, lock and canary source are unchanged. Image `sha256:ffae730f7715171675f7025c2bbb0966cbb32649b8bd068d1c9425112a947eaa` was adopted once across all four application roles, and a new canary passed HTTP 200, three fresh role proofs and write/read. Final signed-in query-redirect readback and the new durable combined summary passed; prior receipts were retained without replay.

## Environment status

| Environment / target | Status     | Actual version / image        | Last verified (UTC) | Remaining work                                                                                                        |
| -------------------- | ---------- | ----------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| staging              | `pending`  | Not verified                  | Not verified        | Reconcile independently; no staging completion claimed.                                                               |
| production / Skills  | `deployed` | `533c040d` / image `e1578f75` | 2026-10-30 17:35    | Deployed with the 2026-10-30 rollout; see [Production rollout 2026-10-30](2026-10-30-production-rollout-533c040d.md). |

## Applicability, provenance and exclusions

Follow the [release process](../operations/07-environments-and-release-management.md), existing recovery witness and reviewed hash-bound operators. The original Skills-only PR integrated main for review; it did **not** authorize shipping arbitrary main. [Review History](2026-10-28-review-history.md), migration `000151`, its capture/activation and [dynamic model catalog #733](https://github.com/777genius/review-router-ai/pull/733) were excluded from that original Skills-only artifact/rollout. History was pending at that checkpoint; the later coordinated rollout and its completion evidence are recorded separately below. Skills tables/grants through `000150` were exercised; this repair introduces no application migration. No paid AI or complete skill-bundle execution is qualified.

| Component                        | Before / selected source                                                                      | Actual or prepared artifact                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original application             | `418c0ff848443d7a3a0553be22eb63c45a51f53b`, manual `v1.0.218`                                 | Prior image `sha256:64b092d075237e3981ad8c77610664a71242a50a4ed2227c94729887f46e07ab`                                                                          |
| Prior Skills-only checkpoint     | `366fa74c9fae6a992d264c54e625e9220fc50740`, directly based on `418c0ff84`                     | Superseded image `sha256:29135fbaa6bb9a1d092a2cd2ab7ea0315a527b617783278125ca8ac86e92b478`; retained adoption/rollback evidence                                |
| Prior canary-repaired checkpoint | `7bda7a1b21204e404c51daf1c42bed44a85ed0c9`, directly based on `366fa74c9`                     | Superseded image `sha256:96bbb4549f41f959678d4618dcda15784d45d66202db8e0ab11f637ee24aef07`; prior full canary/UI acceptance retained                           |
| Accepted Skills-only checkpoint  | `1e3a5379ea6268692ed7f0545c9ebd0c9049c5b9`, directly based on `7bda7a1b2`                     | Superseded image `sha256:ffae730f7715171675f7025c2bbb0966cbb32649b8bd068d1c9425112a947eaa`; bounded Skills acceptance and four-role adoption receipts retained |
| UAP                              | Replaced Oct 24 binary `db71ae6a`; resolver source `a504642cb7af4e2e2ad441e4baac34700e51bd00` | Installed binary SHA-256 `f75896cdf4e542baf4b10876673e32520fd9d7d3a833918482aa3668c017dfe0`; unit/proxy fixes from merged #555                                 |
| Scanner                          | Previously absent; exact source `418c0ff84`                                                   | Running image `sha256:172e73e8f63b7e4a8a889ee9a8c925c45330fac2c6331cc92bcd3c64512325d8`; private composition, static profile and separate scan worker          |

## Completed production work and verification

- Configured private resolver/scanner capabilities. Fixed systemd implicit `PrivateTmp` by using a separate 256 MiB resolver tmpfs; preserved UID/cgroup admission. Exact resolver proxy path retains Authorization, strips Cookie and allows 40 seconds; anonymous routes retain both header removals and 12 seconds.
- Actual signed-in session completed public `grilling` Preview, native static check with one warning, explicit acknowledgements and exactly one library import. `diagnosing-bugs` remained legitimately incomplete for missing references; no gate was relaxed.
- Independent pinned source `59db609eb1e18aaf59b63284d0e52255aff0c63c`, path `skills/productivity/grilling`, matched the actual normalizer, candidate and stored instructions: 1,860 UTF-8 bytes, SHA-256 `176cf0bcbae1b34d6db8d849bb9b2c28b0c26db1de313f7860585412cbee6167`. Candidate canonical digest matched the completed scan; leading/trailing newlines were preserved.
- One assignment was saved/read back on existing disposable `777genius/reviewrouter-e2e-prod-20260529-000305`. Its unsupported workflow was explicitly observed: assignment metadata succeeded; **no repository code review was executed**.
- UI cleanup removed that assignment and imported library original. Existing `Оверинженеринг` retained its two assignments. On the prior accepted `7bda7a1b2` checkpoint, signed-in Context tools showed active desktop/compact navigation with the workspace ID, eight connection forms and no overflow; Web/API health returned 200. The owned browser tab was closed.

## Completed rollout and final acceptance

1. Reconciled the four roles, existing schema and scanner health, drained scans, and retained completed operations/snapshots rather than replaying them.
2. Reviewed the minimal `7bda7a1b2` artifact and a new hash-bound adoption plan; adopted it once across Web/API/ordinary worker/dedicated scan worker while preserving credentials, mounts, startup witness, producer registry, Action pins and the separate scan-worker command.
3. A new canary nonce produced HTTP 200, all three fresh role proofs and `writeRead: true`, verified at `2026-10-28T19:33:01.188Z`. Health and signed-in navigation passed on that prior artifact.
4. After the final redirect review, adopted `1e3a5379`/`ffae730f` once across all four roles. A separately issued new canary again passed HTTP 200, all three fresh role proofs and write/read, verified at `2026-10-28T19:55:44.092Z`.
5. Reused successful unchanged import/readback evidence without duplicate scans/imports. Actual signed-in Brave opened `/dashboard?section=context-tools&workspace=777genius` and landed on `/dashboard/context-tools?workspaceId=cmorhxrep000129nh3m13qn1c&workspace=777genius`; header/eight forms, active desktop/compact links and no overflow were observed. Fresh Web/API health returned 200. The final safe combined summary was persisted and hash-verified in durable custody. All bounded environment steps passed; exact-head PR #735 CI/merge remains separately pending.

## Failure, retry and rollback boundary

At `2026-10-28T19:03:55.408Z`, the first fresh canary created its challenge and all three role proofs by `19:03:56.448891Z`, then Prisma failed decoding PostgreSQL `RETURNS VOID` through `$queryRawUnsafe`; no passed write/read receipt exists for that first attempt. That nonce and receipt remain immutable and were not replayed. Checkpoint `7bda7a1b2` uses `$executeRawUnsafe`, backed by real Prisma/PostgreSQL red/green regression, six focused cases and typecheck. Subsequent fresh canaries passed after the separate `7bda7a1b2` and `1e3a5379` adoptions; neither relabels or replaces that failed attempt.

Follow the release guide's rollback protocol preflight and existing guarded operators. Retain prior containers, snapshots, source/image evidence, Skills data and outbox state. Reconcile any uncertain effect against exact receipts/IDs before continuation. Do not start an obsolete writer, remove cache/state, or rewrite shared ingress as cleanup.

## Durable evidence custody

Paths below are on the verified production host and remain root-private; never copy secret snapshots/environment contents into Git. Local ignored scratch alone cannot close this task.

- Env/service repair: `/srv/platform/projects/review-router/releases/skills-runtime-20261028-v1/apply-receipt.json`; same directory retains `snapshot.json`, prior unit and prior Caddy bytes.
- Scanner recipe/artifacts and reviewed operators: `/srv/platform/projects/review-router/releases/skills-production-20261028/`.
- Prior image cut: `/srv/platform/projects/review-router/releases/skills-ui-adoption-366fa74c-20261028/apply-receipt.json`; same directory retains the pre-cut snapshot and failed `fresh-runtime-canary.json` (no passed receipt).
- Prior accepted image cut: `/srv/platform/projects/review-router/releases/skills-canary-adoption-7bda7a1b-20261028/apply-receipt.json`, with `snapshot.json` retained in the same directory.
- Prior successful canary: that `7bda7a1b` directory contains `fresh-runtime-canary-v2.json` and `fresh-runtime-canary-v2.passed.json`.
- Prior combined safe summary: that `7bda7a1b` directory contains root-mode-0600 `production-feature-evidence.json`, SHA-256 `c26aaa00708bd8ead5402df99a0268d0ff66788183637ac3ade720bb391bff40`; local and remote hashes matched. It binds UI/import/cleanup, exact text digest, artifact/build and canary results.
- Accepted Skills-only cut: `/srv/platform/projects/review-router/releases/skills-canary-adoption-1e3a5379-20261028/` retains `apply-receipt.json`, `snapshot.json` and the new successful `fresh-runtime-canary-v2.passed.json`. Final signed-in query-redirect readback and fresh Web/API health checks passed. Root-mode-0600 `production-feature-evidence-final.json` in that same directory binds the final build/canary/redirect and prior exact-import/cleanup evidence, SHA-256 `e36133608ddc6bf172f98f47caae855767effdb1cc282f208e825aa7880c956d`; local and remote hashes matched. The prior `96bbb454` summary remains separate.

## Execution log

| Time (UTC)                   | Environment / operator              | Actual version                           | Result and next action                                                                                                                                                               |
| ---------------------------- | ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-28, before 19:03     | production / owner-authorized agent | Baseline `418c0ff84`; scanner `172e73e8` | Service repair, live import/assignment/readback and UI cleanup observed; retain initial apply receipt.                                                                               |
| 2026-10-28, before 19:03     | production / owner-authorized agent | `366fa74c9` / `29135fba`                 | Four-role Skills-only adoption/navigation observed; History/151/#733 excluded.                                                                                                       |
| 2026-10-28 19:03:55-19:03:56 | production / owner-authorized agent | `366fa74c9` / `29135fba`                 | Fresh role proofs created; VOID decoder failure prevented full canary. Preserve failed attempt.                                                                                      |
| 2026-10-28 19:33:01.188      | production / owner-authorized agent | `7bda7a1b2` / `96bbb454`                 | Four-role adoption complete; fresh canary HTTP 200/writeRead/three proofs passed; final UI/health and durable summary verified. Prior checkpoint accepted; PR #735 CI/merge pending. |
| 2026-10-28 19:55:44.092      | production / owner-authorized agent | `1e3a5379` / `ffae730f`                  | Four-role adoption/new full canary, signed-in query redirect, fresh health and final durable summary passed. Production deployed; PR #735 CI/merge pending separately.               |
| Not verified                 | staging / unassigned                | Not verified                             | Remains pending.                                                                                                                                                                     |

## Related links

[Skills implementation #723](https://github.com/777genius/review-router-ai/pull/723), [repair #735](https://github.com/777genius/review-router-ai/pull/735), [UAP resolver #540](https://github.com/777genius/universal-agent-plugins/pull/540), [UAP repair #555](https://github.com/777genius/universal-agent-plugins/pull/555), [scanner setup/limits](../../services/skill-scanner/README.md), [Skills plan](../plans/2026-10-27-skills-catalog-security.md), [release process](../operations/07-environments-and-release-management.md), [quality gates](../operations/03-quality-gates.md), [excluded History task](2026-10-28-review-history.md).

## Subsequent coordinated application rollout

The accepted Skills-only fleet above was first superseded at 20:19 UTC on
2026-10-28 by the [model catalog / History rollout](2026-10-28-model-catalog.md):
source `4dd75ecfe3d22701ba741f451b046f0b5e440231`, image
`sha256:3d2fd2dfd5ff4c4b4c02cd513aeaecd450d6508b0fd1d04c01b7c80516891939`.
That is a historical checkpoint, not the latest recorded fleet.

The latest recorded four-role application adoption completed at 00:32:50 UTC on
2026-10-29: source `b8eac8ec11ec9fe0db5c3a8da2974a30a269a8cc`, image
`sha256:fd52caab0a1a55d92711010e36b98c77f939b60eb1f62d9db7548b532d693cc8`.
Web, API, ordinary worker and dedicated scan worker use that recorded image.
The [catalog task](2026-10-28-model-catalog.md#current-fleet-and-final-e2e-blocker-2026-10-29)
records the preserved configuration, retained prior containers, fresh runtime
canary and signed-in readback. Protected receipts remain under
`/srv/platform/projects/review-router/releases/model-history-adoption-b8eac8ec-20261029/`.
This reconciles existing records; no new live fleet observation was performed
by this documentation correction.

The coordinated rollouts preserve the bounded Skills repair and its original
receipts. They do not establish a new Skills import/AI qualification or replace
that earlier acceptance. The UAP binary/proxy repair, private scanner image and
credential-bearing configuration were preserved. Follow the catalog and History
tasks for subsequent migration, activation and live review evidence. This task
remains `deployed` for the bounded Skills repair; staging remains `pending`.

## Evidence log

2026-10-30: production moved to main `533c040de09d2609c8ebb44474812e2b35f0e7ea` (image `sha256:e1578f75207de943031a6652ab94318433ef311c85fcaa5a1428fef26d08227a`). Migrations through `000154` are applied (including `000152` and `000153`); full evidence is in the [Production rollout 2026-10-30](2026-10-30-production-rollout-533c040d.md). Task-specific checks were not run separately.
