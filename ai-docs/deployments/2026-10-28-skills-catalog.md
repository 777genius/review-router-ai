# Skills catalog: bounded production repair

- Task ID: `2026-10-28-skills-catalog`; last updated: 2026-11-01.
- Goal: working UAP Preview → native static check → acknowledged text import → repository assignment → actual Skills-consuming review and GitHub App publication, plus Context tools in the persistent sidebar.
- Targets: UAP binary/systemd/Caddy; private scanner/egress; Web, API, ordinary worker and dedicated scan worker; existing Skills database tables/configuration; qualified OCR component availability and the existing Action219 hotfix rollout.
- Implementation: [ReviewRouter #735](https://github.com/777genius/review-router-ai/pull/735). The separate [UAP #555](https://github.com/777genius/universal-agent-plugins/pull/555) was merged as `4fe44c439eee7ccc3ddca3d1cd63114527508e0c`.
- Final source delivery/check status is tracked on ReviewRouter #735. Production acceptance below is independent of the PR merge state; all required checks passed (21 successful checks and one skipped conditional rehearsal) on functional checkpoint `6f67390cd77b4a2d62211629da05fc42506bb571` before the final evidence-only documentation update.
- Host: `prod-hel1-01` / `37.27.125.57`, verified machine ID `b28fc7b17042414386eb9b114046e50c`. Owner authorized the live repair, review and merge.

Historical Skills-only acceptance (superseded by the fleet adoption below): the 12-line `/dashboard?section=context-tools` redirect now runs after authorized workspace selection. Checkpoint `1e3a5379ea6268692ed7f0545c9ebd0c9049c5b9` is directly based on `7bda7a1b2`, with only that reviewed redirect and three red/green regression cases. Native full-web typecheck/build passed; all 336 API-dist files, lock and canary source are unchanged. Image `sha256:ffae730f7715171675f7025c2bbb0966cbb32649b8bd068d1c9425112a947eaa` was adopted once across all four application roles, and a new canary passed HTTP 200, three fresh role proofs and write/read. Final signed-in query-redirect readback and the new durable combined summary passed; prior receipts were retained without replay.

## Environment status

| Environment / target    | Status     | Actual version / image                                       | Last verified (UTC) | Remaining work                                                                                                                                         |
| ----------------------- | ---------- | ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| staging                 | `pending`  | Not verified                                                 | Not verified        | Reconcile independently; no staging completion claimed.                                                                                                |
| production / Skills E2E | `deployed` | SaaS `b8eac8ec` / `fd52caab`; Action219 `298e7fca`; OCR rr.4 | 2026-10-29 01:23:58 | Full runtime/publication E2E passed on this historical checkpoint; newer fleet rollouts are recorded below. Source delivery: #735; staging unverified. |

## Applicability, provenance and exclusions

Follow the [release process](../operations/07-environments-and-release-management.md), existing recovery witness and reviewed hash-bound operators. The PR integrates main for review; it does **not** authorize shipping arbitrary main. The historical bounded Skills-only artifact excluded [Review History](2026-10-28-review-history.md), migration `000151`, its capture/activation and [dynamic model catalog #733](https://github.com/777genius/review-router-ai/pull/733). Those exclusions do not describe the current fleet. A subsequent authorized rollout installed History migration `000151` and adopted `4dd75ecf`, preserving this repair. This repair introduces no application migration. No paid AI scanner or executable skill-bundle installation is qualified. The text-only Skills runtime is qualified by the final acceptance below.

| Component                        | Before / selected source                                                                      | Actual or prepared artifact                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original application             | `418c0ff848443d7a3a0553be22eb63c45a51f53b`, manual `v1.0.218`                                 | Prior image `sha256:64b092d075237e3981ad8c77610664a71242a50a4ed2227c94729887f46e07ab`                                                                 |
| Prior Skills-only checkpoint     | `366fa74c9fae6a992d264c54e625e9220fc50740`, directly based on `418c0ff84`                     | Superseded image `sha256:29135fbaa6bb9a1d092a2cd2ab7ea0315a527b617783278125ca8ac86e92b478`; retained adoption/rollback evidence                       |
| Prior canary-repaired checkpoint | `7bda7a1b21204e404c51daf1c42bed44a85ed0c9`, directly based on `366fa74c9`                     | Superseded image `sha256:96bbb4549f41f959678d4618dcda15784d45d66202db8e0ab11f637ee24aef07`; prior full canary/UI acceptance retained                  |
| Historical Skills-only fleet     | `1e3a5379ea6268692ed7f0545c9ebd0c9049c5b9`, directly based on `7bda7a1b2`                     | Superseded image `sha256:ffae730f7715171675f7025c2bbb0966cbb32649b8bd068d1c9425112a947eaa`; all four application roles adopted once                   |
| UAP                              | Replaced Oct 24 binary `db71ae6a`; resolver source `a504642cb7af4e2e2ad441e4baac34700e51bd00` | Installed binary SHA-256 `f75896cdf4e542baf4b10876673e32520fd9d7d3a833918482aa3668c017dfe0`; unit/proxy fixes from merged #555                        |
| Scanner                          | Previously absent; exact source `418c0ff84`                                                   | Running image `sha256:172e73e8f63b7e4a8a889ee9a8c925c45330fac2c6331cc92bcd3c64512325d8`; private composition, static profile and separate scan worker |

Prior fleet reconciliation: all four application roles then ran source `4dd75ecfe3d22701ba741f451b046f0b5e440231`, image `sha256:3d2fd2dfd5ff4c4b4c02cd513aeaecd450d6508b0fd1d04c01b7c80516891939`. That checkpoint retains the reviewed Skills redirect through parent `9a93632` and the newer model/History integration. Migration `000151` was applied at `2026-10-28T20:17:13.889445Z`; fresh generation/canary role proofs were recorded at 20:19–20:21 UTC. Custody: `/srv/platform/projects/review-router/releases/model-history-adoption-4dd75ecf-20261028/`, with canonical ACL evidence in `history151-066220eb-20261028/`. No old image or issued canary was replayed during this reconciliation.

## Completed production work and verification

- Configured private resolver/scanner capabilities. Fixed systemd implicit `PrivateTmp` by using a separate 256 MiB resolver tmpfs; preserved UID/cgroup admission. Exact resolver proxy path retains Authorization, strips Cookie and allows 40 seconds; anonymous routes retain both header removals and 12 seconds.
- Actual signed-in session completed public `grilling` Preview, native static check with one warning, explicit acknowledgements and exactly one library import. `diagnosing-bugs` remained legitimately incomplete for missing references; no gate was relaxed.
- Independent pinned source `59db609eb1e18aaf59b63284d0e52255aff0c63c`, path `skills/productivity/grilling`, matched the actual normalizer, candidate and stored instructions: 1,860 UTF-8 bytes, SHA-256 `176cf0bcbae1b34d6db8d849bb9b2c28b0c26db1de313f7860585412cbee6167`. Candidate canonical digest matched the completed scan; leading/trailing newlines were preserved.
- One assignment was saved/read back on existing disposable `777genius/reviewrouter-e2e-prod-20260529-000305`. Its unsupported workflow was explicitly observed: assignment metadata succeeded; **no repository code review was executed**.
- UI cleanup removed that assignment and imported library original. Existing `Оверинженеринг` retained its two assignments. On the prior accepted `7bda7a1b2` checkpoint, signed-in Context tools showed active desktop/compact navigation with the workspace ID, eight connection forms and no overflow; Web/API health returned 200. The owned browser tab was closed.

## Historical Skills-only rollout acceptance

1. Reconciled the four roles, existing schema and scanner health, drained scans, and retained completed operations/snapshots rather than replaying them.
2. Reviewed the minimal `7bda7a1b2` artifact and a new hash-bound adoption plan; adopted it once across Web/API/ordinary worker/dedicated scan worker while preserving credentials, mounts, startup witness, producer registry, Action pins and the separate scan-worker command.
3. A new canary nonce produced HTTP 200, all three fresh role proofs and `writeRead: true`, verified at `2026-10-28T19:33:01.188Z`. Health and signed-in navigation passed on that prior artifact.
4. After the final redirect review, adopted `1e3a5379`/`ffae730f` once across all four roles. A separately issued new canary again passed HTTP 200, all three fresh role proofs and write/read, verified at `2026-10-28T19:55:44.092Z`.
5. Reused successful unchanged import/readback evidence without duplicate scans/imports. Actual signed-in Brave opened `/dashboard?section=context-tools&workspace=777genius` and landed on `/dashboard/context-tools?workspaceId=cmorhxrep000129nh3m13qn1c&workspace=777genius`; header/eight forms, active desktop/compact links and no overflow were observed. Fresh Web/API health returned 200. The final safe combined summary was persisted and hash-verified in durable custody. All bounded environment steps passed; exact-head PR #735 CI/merge was still separately pending at that historical checkpoint.

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
- Historical Skills-only cut: `/srv/platform/projects/review-router/releases/skills-canary-adoption-1e3a5379-20261028/` retains `apply-receipt.json`, `snapshot.json` and the new successful `fresh-runtime-canary-v2.passed.json`. Final signed-in query-redirect readback and fresh Web/API health checks passed. Root-mode-0600 `production-feature-evidence-final.json` in that same directory binds the final build/canary/redirect and prior exact-import/cleanup evidence, SHA-256 `e36133608ddc6bf172f98f47caae855767effdb1cc282f208e825aa7880c956d`; local and remote hashes matched. The prior `96bbb454` summary remains separate.

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

[Skills implementation #723](https://github.com/777genius/review-router-ai/pull/723), [repair #735](https://github.com/777genius/review-router-ai/pull/735), [UAP resolver #540](https://github.com/777genius/universal-agent-plugins/pull/540), [UAP repair #555](https://github.com/777genius/universal-agent-plugins/pull/555), [scanner setup/limits](../../services/skill-scanner/README.md), [Skills plan](../plans/2026-10-27-skills-catalog-security.md), [release process](../operations/07-environments-and-release-management.md), [quality gates](../operations/03-quality-gates.md), [History task](2026-10-28-review-history.md).

## Extended runtime acceptance — 2026-10-29

Native UAP Preview, complete static check and acknowledged text import succeeded for pinned `juliusbrussee/caveman` revision `9b68f7ed12b05e7efaff18e65c5a3fc2849fd0a4`, path `skills/caveman-review`. The imported instructions are 2,376 UTF-8 bytes, SHA-256 `5a61d4f0004b13171a9cd294dbe283c7a36a9ce236596560af33296a7a93225a`. One temporary assignment targets only disposable `rr-selfhost-direct-v2-e2e-20260730t120036z`, path `src/catalog-skill-e2e-20261029.js`; the original library skill and its two assignments remain intact.

Draft PR19 triggered ordinary review because this workspace enables draft reviews. Runs `40794191059` and `40794311834` failed before authorization/provider execution with `skills_engine_unsupported`. The API then explicitly pinned `REVIEW_ROUTER_AGENT_PROFILE=ocr-managed-v2`; this disabled the source-owned preference for a Skills-capable profile. The repository had no explicit engine override. Reconciliation found that only the live API container retained this pin: all four canonical runtime env files and the other three live roles already omitted it. The selected repair was therefore API-only recreation on the unchanged image, preserving all other environment/configuration and the existing generation witness. The PR was closed to stop automatic retries; no Ready transition or manual dispatch occurred. The runtime guard is correct and must remain enforced. The repair and subsequent runtime receipt are recorded below.

A separate isolation attempt created private disposable `rr-skills-catalog-disposable-20261029` (GitHub ID `1437758793`), without workflows, providers or PRs. Ordinary installation refresh revealed an existing inventory-writer ACL integration gap (`RepositoryConnection` direct DML denied); no grants were changed or bypassed. This unused repository was archived after verifying its exact ID, initial head and zero PRs. New-repository onboarding is not qualified by this task.

Subsequent fleet reconciliation at `2026-10-29T00:37:28Z`: another authorized rollout completed all four roles on source `b8eac8ec11ec9fe0db5c3a8da2974a30a269a8cc`, image `sha256:fd52caab0a1a55d92711010e36b98c77f939b60eb1f62d9db7548b532d693cc8`, rollout `rr-model-history-b8eac8ec-fd52caab0a1a`. The configuration repair must preserve this newer artifact; the earlier `4dd75ecf` and Skills-only receipts are historical evidence.

### Profile repair result

At `2026-10-29T00:46:23.445Z`, the reviewed one-shot API-only operator recreated the API on unchanged `b8eac8ec` / `fd52caab`, removing only live `REVIEW_ROUTER_AGENT_PROFILE=ocr-managed-v2`. Image defaults, all canonical files and the other three roles already omit that key. All other opaque env, startup, mounts, HostConfig, registry, policy, gates and metadata were retained and checked; the old API remains stopped in recovery custody. New API ID: `b3cf4247e245d1018bc87d1f0ee6d7864f667dfabfb67125a79a3bfa20e840be`. API health returned HTTP 200. A separately issued fresh canary then passed HTTP 200, all three new role proofs and write/read.

Operator SHA-256: `7c02bf2802a6e624b81595758cf993caf85940f89769315a71fc06a28ae39d5a`; reviewed canary helper: `15e515b6ea8418216fc19a943a87d37b553cffd7f11df5db5c179db707a9cff1`. Root-private durable custody: `/srv/platform/projects/review-router/releases/skills-canary-adoption-profile-b8eac8ec-20261029/`, containing `api-profile-snapshot.json`, `api-profile-repair-issued.json`, `fresh-profile-runtime-canary.json` and `fresh-profile-runtime-canary.passed.json`. No old nonce, rollout or image adoption was replayed.

Selection behavior is the maintained source policy: new implicit Gateway reviews on an exact producer with one approved OCR Skills1 profile use it, including reviews without assigned Skills. Older producers retain the v2 fallback; explicit repository engine choices and already admitted immutable snapshots remain unchanged. The OCR editor-selection gate and all producer approvals remain intact.

### Runtime component availability

The first post-repair ordinary run `40796543560` admitted OCR `ocr-managed-v3`, package `1.13.1-rr.4`, Skills1 and exactly the imported revision. Captured identity `sha256:971aa79a0a48e32b3132a32fdbcc629eff25073dd6da2d288e7d25d3f51d021b` includes the matching instruction hash. It then failed at `prepare_ocr` before execution because the fixed public bootstrap URL has no `ocr-v1.13.1-rr.4` release/tag. The PR was closed again and the temporary assignment removed before remediation; no provider execution or publication is claimed for that run.

The exact producer `056952b5a3d625fd1d19384942d452114804380f` is immutable Action `v1.0.218`; its successful [CI qualification](https://github.com/777genius/review-router/actions/runs/40559802950) builds the actual rr.4 CLI, compares the full checked-in manifest and runs required CLI integration tests. The selected remediation restored availability of that already-approved component, without a new profile/digest: reproduce the exact Go1.26.9/10-patch manifest and binary SHA `0553daafe39d7a9d7608f0d37b26d55c11d07b9d5bbfc5b36b0778f9cd9f3df5`, then publish a new `ocr-v1.13.1-rr.4` component release targeting that exact commit with the native three asset names. Review requires draft upload/verification first, `makeLatest=false`, no overwrite on a concurrent release and no change to Action channels or producer approval.

Component publication completed at `2026-10-29T01:01:05Z`: [OCR rr.4](https://github.com/777genius/review-router/releases/tag/ocr-v1.13.1-rr.4), exact target `056952b5a3d625fd1d19384942d452114804380f`. Reproducible build and independent review verified binary SHA `0553daafe39d7a9d7608f0d37b26d55c11d07b9d5bbfc5b36b0778f9cd9f3df5` (80,502,447 bytes, Linux x86-64 ELF), full manifest SHA `e5e8bcd40a369e161c6cabd3660fd6ef5a610715ec1bfd60bcc980fbbfb69145` and checksum sidecar SHA `00c76150d3a13c8bec27c7e6dc286497fb559f9b76839ff4874be85834b2556d`. All three Draft assets were downloaded and verified before publication. Anonymous download through the exact bootstrap URL then matched the binary digest. `v1`, `workflow-v1` and latest Action release `v1.0.218` were unchanged.

The profile activation should have followed this public-asset verification; the intermediate live failure exposed that missing prerequisite. The release source of truth now requires qualified component publication and anonymous fixed-URL verification before profile activation. Failed attempts remain separate evidence and were not relabeled as successful execution.

Post-publication run `40798137022` passed rr.4 bootstrap and created one required OCR discovery slot, but failed `review_action_v2_assignment_missing` before any invocation lease/model call or publication. PR19 was closed and its assignment removed again. The existing [Action #352](https://github.com/777genius/review-router/pull/352), merged as `298e7fca999edaee09b59d438a5694ed8961d394`, repairs this final-plan slot-reference mismatch while retaining full contract equality and the strict adapter guard. Its existing release workflow for `v1.0.219` was followed; no duplicate fix/release was started. Full runtime/publication acceptance was withheld until that qualified release, producer adoption and workflow-channel promotion completed, as recorded below.

## Final production runtime acceptance and cleanup

At `2026-10-29T01:23:58.692Z`, the entire text-only Skills path passed on SaaS
`b8eac8ec` / `fd52caab`, public Action `v1.0.219` / `298e7fca` and OCR rr.4.
The existing Action219 release and producer overlay completed before
`workflow-v1` promotion; all four roles retained the same private image and the
absence of the stale API profile pin. Its root-private adoption receipts are in
`/srv/platform/projects/review-router/releases/action219-adoption-298e7fca-20261029/`.
This task observed that existing rollout and did not duplicate it.

Ordinary [run 40799558176](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/actions/runs/40799558176)
on owned disposable PR19/head `3b3292ef43e58aabcbe39814e5c0cb28d500e6de` captured
exact Skill `270f3f70-6d94-40b5-a177-b323e4f81cfd`, revision
`afdb496c-58e3-41ad-8cc6-49151ae95557`, with matching instructions SHA `5a61d4f0…`.
The first OCR invocation was accepted; the required slot was satisfied, coverage
was 1/1 and no attempt was exhausted. Execution `0d95f277…` completed and finalized
artifact `d2704875…`, with one finding in the deliberately faulty fixture.

The finalized projection and actual
[App-authored summary](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/pull/19#issuecomment-6485218394)
both record one captured Web skill and one fresh accepted OCR invocation receiving
the controlled Skills rules. Captured identity:
`sha256:971aa79a0a48e32b3132a32fdbcc629eff25073dd6da2d288e7d25d3f51d021b`;
materialized identity:
`sha256:a9b950d2272474358952d24ad447361fe5980de450140d085237b53cd620df1d`.
All four publication operations succeeded. Review `5691739480`, summary
`6485218394` and [inline comment 4407769460](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/pull/19#discussion_r4407769460)
were authored by `review-router-ai[bot]` at the exact head; managed check
`123204752515` belongs to App `review-router-ai`. Its failing conclusion reflects
the one intended finding, not failed execution or publication. The receipt does
not prove model compliance with every instruction or delivery to every path.

Cleanup was verified through normal UI and read-only database/GitHub checks:
PR19 closed, its exact owned branch removed, imported fixture deleted, assignments
and own pending/active authorizations zero. Original `Оверинженеринг` remains with
two assignments. Policy workspace20/repository8 and digest `968a2729…`, plus old
PR17/18 heads, remain unchanged. The unused isolated repository remains archived.
Signed-in Context tools query navigation reaches the authorized workspace route,
with active desktop/compact links, eight forms and no horizontal overflow; the
owned browser tab was closed. Web `/api/health` and API `/health` returned 200.

The combined sanitized runtime, slot, publication, inline-author, cleanup,
component-artifact and source-CI evidence is stored root-owned mode0600 at:
`/srv/platform/projects/review-router/releases/skills-canary-adoption-profile-b8eac8ec-20261029/skills-runtime-e2e-final.json`.
SHA-256 `f6bb5388237bda79f791ea7acf6d3c18dc139c849a6adc4faf5bbad8da208f7f`;
local and durable remote hashes matched. Earlier failed attempts and canaries
remain separate evidence. Production is deployed and E2E-qualified; staging and
new-repository onboarding are not qualified by this record.

## Subsequent fleet and source reconciliation — 2026-11-01

The 2026-10-29 acceptance above is historical, not a claim about the current fleet. Main now retains the bounded Skills/sidebar/canary repairs through the model-catalog integration. Later coordinated production rollouts are recorded in [2026-10-30](2026-10-30-production-rollout-533c040d.md) and [2026-10-31](2026-10-31-production-rollout-d5f16400.md); they supersede the application version in the historical acceptance table. No new live observation or deployment is claimed by this reconciliation.

PR #735 now delivers the final runtime evidence and component-publication prerequisite documentation. The newer main browser fixture already warms Skills and Repositories client scripts; its implementation and runtime-readiness setup are retained instead of adding a second warmup helper. Main also retains the updated canary proof projection regression. No remaining product-code difference was found for the original Skills/sidebar task. Staging, paid AI scanner and executable bundle installation remain outside this acceptance.
