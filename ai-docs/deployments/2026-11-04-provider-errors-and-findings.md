# Provider errors and security findings: deployment

- Task ID: `2026-11-04-provider-errors-and-findings`.
- Goal: retain accepted security findings and explain confirmed provider failures
  without presenting an incomplete review as approval or guessing quota exhaustion.
- Affected services/targets: public Action, Gateway/native diagnostics, SaaS SDK
  and relay, producer registry and `workflow-v1`.
- Implementation: [Action #368](https://github.com/777genius/review-router/pull/368),
  [Action #369](https://github.com/777genius/review-router/pull/369),
  [SaaS #809](https://github.com/777genius/review-router-ai/pull/809),
  [Gateway #99](https://github.com/agent-teams-ai/account-gateway/pull/99) and
  [native #91](https://github.com/agent-teams-ai/sub2api/pull/91).
- Implementation references: Action merge `80c63cdbc23e32d099ba1779f9d09ff220a0370c`;
  Action229 merge `755a6443420b4e6eaa9dd953a9df157bafc73f74`;
  SaaS merge `a3db73fd77eda829480f57ffe3f40ed7c9f9da06`. Source/CI and installation
  are recorded separately below.
- Dependencies: the [release process](../operations/07-environments-and-release-management.md),
  exact producer compatibility/registration and App-first publication. Memory
  semantic qualification is separate and does not block this ordinary review rollout.
- Last updated: `2026-11-04`.

## Environment status

| Environment / target               | Status     | Actual deployed version / image                                  | Last verified (UTC) | Evidence / next step / blocker                                                                                                                                            |
| ---------------------------------- | ---------- | ---------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staging                            | `pending`  | Not verified                                                     | Not verified        | No staging installation or acceptance credited.                                                                                                                           |
| production / Gateway and native    | `deployed` | Gateway `c3676038`, native `83e3353e`; exact release below       | 2026-11-04          | Diagnostic pair installed; readiness 200.                                                                                                                                 |
| production / private SDK and relay | `deployed` | Private228 `a3db73fd`, image `0ffbaadc`; exact tuple below       | 2026-11-04          | All four roles, seven worker privilege checks and readiness 200 verified. Publication recovered separately after failed final workflow push.                              |
| production / Action                | `deployed` | Action229 `755a6443` on private228 `a3db73fd` / image `0ffbaadc` | 2026-11-04          | All four primary refs and 57 registry rows verified, all 56 old rows retained; readiness 200. Final grounded canary complete; publication, Statistics and Usage verified. |
| production / workflow channel      | `deployed` | `workflow-v1=755a6443`                                           | 2026-11-04          | Promotion41766365156 succeeded; exact755 channel independently verified. Final canary complete; critical merge block expected.                                            |

The current ordinary production review batch is **deployed**: required coverage,
issue publication, Statistics and Usage acceptance passed on the final grounded
fixture. The workflow intentionally blocked merging its critical finding. Staging,
dashboard live journey, Memory semantic qualification, self-hosted and GitLab
remain separate. Historical Action228 PARTIAL evidence is preserved below.

## Applicability and prerequisites

The actual selected private228 application is
`a3db73fd77eda829480f57ffe3f40ed7c9f9da06`, image
`sha256:0ffbaadca4d257d8b9f49c4d9e6292c4683669fcf3477cfa202303442522a3c2`.
All four roles, seven worker privilege checks and readiness 200 were verified.
Later main `87f340` (#810 foundation refactor) arrived after release dispatch and
is outside this selected image; this record does not claim latest main deployed.

Public `v1.0.229` and public `v1` resolve to
`755a6443420b4e6eaa9dd953a9df157bafc73f74`. The approved229 producer is registered;
all four roles select that exact primary and share 57 registry rows, preserving
all 56 prior rows/profiles and producer overlap. Capacity128 and the installed
Gateway-only profile are unchanged. Readiness returned 200. The actual-a3
read-only compatibility assessment reported zero missing/unsupported contracts.
Promotion41766365156 succeeded; `workflow-v1=755` was independently verified.

Historically, Action228 `80c63cdbc23e32d099ba1779f9d09ff220a0370c` was adopted
first on unchanged private856/image1962: source
`8561576c61abcead21419520e9bc350446017fc5`, image
`sha256:1962f5e6f60e465a5d902c28bf8f4a2f35280b88186f9d0c8d79fdd49f039b9c`.
That phase registered80c, retained all55 old rows in registry56, verified four-role
refs/readiness and promoted `workflow-v1=80c`. The later private228 activation
preserved that registry; the final229 adoption then appended one producer. These
are separate completed phases, not replacement versions of the same receipt.

The quota-aware Gateway/native pair is installed at
`/srv/platform/artifacts/review-router/account-gateway/releases/provider-quota-83e335-c367603-20261104/release`.
Gateway source `c3676038` is merged through #99; native source
`83e3353e7c25cd16bf2d978e807c5d46fa6d632c` is merged through #91. The actual
Node process and both native child executable paths were checked. Native binary
SHA256 is `a9401cebc92eb373f6a7e700f664bdbbab7da3834569d7f7a4149b97937dcdf0`.
Service configuration executable path/digest agree; readiness is 200. Activation
receipt and prior configuration are retained in that release's parent. This
supersedes the older Gateway/native paths in the account-concurrency record.
No schema migration, model/default change or admission-limit change was made.

Structured quota display is supported by Action228/229 and the installed
private228 SDK/relay propagation. This is a code-installation fact; no fresh live
quota-exhaustion acceptance is inferred. Generic closed upstream failures explain
that the provider did not return a usable result, the failed request's outcome may
be unknown, and an incomplete review is not approval. They advise waiting for the
current run to finish before a new review; they do not infer an HTTP status,
vendor or quota from an unclassified failure.

## Ordered rollout

1. **Completed: public release.** Action #368 merged as exact 80c after required
   CI. [Official release run 41750361002](https://github.com/777genius/review-router/actions/runs/41750361002)
   succeeded and published public 228. The maintained canonical manifest/checker
   bound the exact source and committed runtime bytes.
2. **Completed: Action-only production adoption.** Followed the documented
   [compatible Action-only seam](../operations/07-environments-and-release-management.md#compatible-action-only-hotfix-on-the-installed-private-image)
   on unchanged private 856/image 1962: verified installed compatibility, retained
   old registry/overlap, registered 80c, then aligned the complete Action/installer
   tuple. All-role refs/registry and health were read back before promotion.
3. **Completed: channel promotion.** [Promotion run 41759562333](https://github.com/777genius/review-router/actions/runs/41759562333)
   succeeded. `workflow-v1=80c` was verified after its ABI/protocol and previous-SHA
   comparison. Do not repeat completed adoption/promotion to close later checks.
4. **Observed: fresh live Action acceptance is PARTIAL.** Payments PR #30 head
   `09d7a2f07642f2ac824d652ed561ffa8a46ecbfa`,
   [run 41759772607](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41759772607),
   finished PARTIAL on exact Action 80c. It published one major security finding
   at file level (comment `6620833692`), confirming retention of the previously
   filtered finding. Scope was1/1, but the native result remained partial for
   `unverified_native_span`: `acceptedPartial=true`, `normalizationPartial=true`,
   `classificationPartial=false`. Fail-closed grounding was preserved; this is
   not full review acceptance.
   The human “Coverage not completed” reason was blank, a confirmed presentation
   defect. The separate compatible Action229 repair is now installed to display
   the finite cause while preserving grounding; the separate final229 canary
   completed successfully without relabeling this partial run.
5. **Completed: later paired private SDK delivery, with recovered publication.**
   SaaS #809 merged as exact a3db after [full PR CI41750438825](https://github.com/777genius/review-router-ai/actions/runs/41750438825).
   [Trusted main CI41758839860](https://github.com/777genius/review-router-ai/actions/runs/41758839860)
   passed on exact a3db, including PG17 and PG16 rehearsals. The
   [official private228 run41761230654](https://github.com/777genius/review-router-ai/actions/runs/41761230654)
   **FAILED** only at final Git tag publication: the GitHub App workflow token
   lacked workflow permission. Preparation, image publication and attestation
   passed; the failed run remains failed. Under the documented
   [qualified publication recovery](../operations/07-environments-and-release-management.md#recover-a-workflow-permission-failure-in-final-publication),
   the owner completed only the remaining publication through the existing
   authorized GitHub CLI credential. Atomic expected-OID updates created the
   absent exact tag and fast-forwarded `v1` from DBC to a3, without force.
   [Release433459945](https://api.github.com/repos/777genius/review-router-ai/releases/433459945)
   was published as a normal GitHub Release with the same two verified assets:
   image identity SHA256 `69a4ff13378061d282ecf98a2b1a382e7fbf3713845102f8330a969f9f8404d6`,
   installer descriptor SHA256 `4e784ca3ff708e9bad5e40ffdc0d4eb5d7d3f5971cb3b4fcd941b70b20e8f4ec`.
   The exact a3/image0ff tuple above is installed and verified. The earlier
   candidate5ee/image8ac build remains historical candidate evidence, not the
   selected official image. No CI, successful artifact job or image build was rerun.
6. **Completed: Action229 release and production adoption.** #369 merged exact755;
   required [CI41761577549](https://github.com/777genius/review-router/actions/runs/41761577549)
   passed on head `7190b0b1`. [Official release41762973918](https://github.com/777genius/review-router/actions/runs/41762973918)
   succeeded; exact/stable tags both resolve to755 and the release is neither
   draft nor prerelease. Canonical source/runtime proofs and the actual installed
   a3 compatibility assessment passed. Registered229, all four primary refs,
   registry57 retaining all56 old rows/profiles, and readiness200 were verified.
   The private source/image and release metadata were preserved.
7. **Completed channel promotion and final positive canary.**
   [Promotion41766365156](https://github.com/777genius/review-router/actions/runs/41766365156)
   succeeded using workflow source `7025478` after auto-sync; its immutable target
   remained229/755. `workflow-v1=755` was independently verified. The owner then
   advanced the positive canary branch once to8ddef95c. Final run41766852161
   completed full coverage and published the critical fixture finding; its merge
   gate correctly blocked merging. Workflow source and runtime target remain distinct.

## Verification and completion

Action source 11315289 passed 75 focused transport/projection tests, typecheck and
both affected bundle builds. The exact production finding failed on old
projection and passed on the repair;58 projection tests passed on source 32bb167.
Required CI passed on final Action source 11315289 before merge 80c. These source
checks remain distinct from the observed PARTIAL live result above.

SaaS #809 passed 100 focused SDK/relay cases. The retained source-pack record is
[provider-quota-sdk-source-pack.json](../../vendor/account-gateway/provider-quota-sdk-source-pack.json);
[consumer provenance](../../vendor/account-gateway/llm-sdk-provenance.json)
continues to reference it through `packedSource`. The historical commit
association's `packProvenance` points to
[candidate-sdk-provenance.json](../../vendor/account-gateway/candidate-sdk-provenance.json).
That file is an exact-byte alias of the existing source-pack record, SHA256
`4d03842c3cbb46af8c67e73337faaa93009d14ca53b9f47996306759ffeff77c`.
The alias resolves the retained association without rewriting historical fields,
repacking the SDK or claiming another qualification/release.

### Current 228 canary readback and remaining verification

The release owner's scoped read-only readback binds exact runtime 80c and the new
PR #30 head 09d7a2f0. Execution is completed and authorization revoked. All seven
model dispatches completed. Usage contains seven unique OpenRouter calls with
actual native token metadata. Statistics contains **zero review facts and zero
issues because the review is partial**; these counters are not full Statistics
acceptance or evidence that the finding was absent.

The retained readback is `tmp/release228quota/canary228-readback.json` in the
release-owner workspace. Run and comment identities above bind the observation;
the historical observation is retained in the durable delivery summary.

### Final229 positive canary: complete, expected critical merge block

[Run41766852161](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41766852161)
binds exact head `8ddef95c20c0095e21c43dc69832884c0edd5033` and producer/runtime
`755a6443420b4e6eaa9dd953a9df157bafc73f74`. The inverted buyer comparison is
present in HEAD. Native OCR reported `acceptedPartial=false`,
`classificationPartial=false`, `normalizationPartial=false`, no partial reasons,
and one finding. Required scope completed1/1 with zero unreviewed files.

One **CRITICAL** ownership-check inversion was published at `authority.ts:20`,
with a verified HEAD span and suggested correct `===` comparison. The
[GitHub App summary](https://github.com/agent-teams-ai/payments-sdk/pull/30#issuecomment-6621731904)
carries the complete marker. The workflow conclusion is **FAILURE only because
of `review_merge_gate_failed`**: the critical fixture intentionally blocks merge.
Required coverage and review execution completed; this is not an infrastructure
or required-coverage failure.

The release owner's scoped read-only DB readback confirms completed execution,
revoked authorization and six completed model dispatches/native effects. Usage
contains six rows for six unique OpenRouter calls; all six actual native token
totals are known, summing to **23,393 tokens**. Requested selection was FREE
Nemotron; `actualModel` is null, so no response-model identity is inferred.
Statistics contains **one review fact, one current issue fact and one total
PR30 issue lineage**. No unknown dispatch effects were observed. No separate
blanket physical-custody probe was performed or is claimed.

The retained scoped readback is `tmp/release228quota/canary229-readback.json` in
the release-owner workspace. Its digest and sanitized metadata are retained in
[the durable delivery summary](evidence/2026-11-04-provider-errors-delivery.json),
without private Usage samples. The original228 partial case remains the negative
grounding observation. This one positive fixture establishes the named ordinary
review acceptance; it does not establish general model quality or close staging,
dashboard live-identity, Memory semantic, self-hosted or GitLab qualification.

## Preserved historical live observations

Before the daily reset, the exact Payments PR #30 request exposed authenticated
OpenRouter quota metadata: limit 1000, remaining 0, reset 2026-11-04T00:00:00Z.
This is an observed exhausted provider allowance, not an internal account lane.
After reset, [fresh run 41743723435](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41743723435)
completed required coverage 1/1. Its exact execution produced one Statistics
review fact and two unique Usage calls. The model returned no finding for that
example; successful transport is not evidence that every defect is detected.

The stronger, single-file production authorization fixture in
[run 41744471499](https://github.com/agent-teams-ai/payments-sdk/actions/runs/41744471499)
completed required coverage 1/1 and returned one major security finding. The old
Action filtered it as a suggestion, publishing zero findings. This is a confirmed
projection bug, not a model miss. Seventeen model calls completed; one optional
description call remained unknown and was not retried. These historical facts do
not establish the outcome of the new head/run.

Memory qualification remains separate. Candidate 809 r1 was UNAVAILABLE after 13
complete responses and a provider 502 at event 14/50; its request is closed/ACKed
and cleanup DONE. Fresh isolated serial r2 used new request identities and
observed all 50 events: 46 completed/closed model calls, three settled no-call
replays and one `catalogUnavailable` refusal before dispatch, with zero unknown
effects. A missing eligible endorsement and an invalid model output leave r2
**UNAVAILABLE**, without an official score or semantic activation. Preserve the
stand/holdout and the [Memory qualification record](2026-11-03-memory-one-turn-learning.md).

## Retry, partial completion, and rollback

Use the authoritative [release and rollback runbook](../operations/07-environments-and-release-management.md#rollback).
Inspect existing exact tags, producer/attestation rows, fleet receipts, channel
refs and active namespaces before resuming. Retain every prior producer/profile
and admitted namespace; no fixed-length pruning or in-place namespace rewrite.
An uncertain request, registration or channel write is reconciled through its
existing readback/receipt, not blindly replayed. Generic 502 is not confirmed
quota exhaustion; unknown effects remain unknown. Preserve partial review and
Usage evidence, including the old optional description unknown.

## Related links

- [Current dashboard verification](2026-11-03-dashboard-read-boundaries.md).
- [Memory code versus qualification](2026-11-03-memory-one-turn-learning.md).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment / target                | Operator      | Actual version / image                   | Step and observed result                                                                                                                                                    | Evidence                                                | Next action                                                                                    |
| ------------ | ----------------------------------- | ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Not verified | staging                             | Release owner | Not verified                             | No staging completion credited.                                                                                                                                             | This record                                             | Reconcile staging independently.                                                               |
| 2026-11-04   | production / Gateway-native         | Release owner | c3676038 /83e3353e                       | Diagnostic pair installed, executable/digest bindings and readiness 200 verified.                                                                                           | Retained release path above                             | Preserve pair during later SDK rollout.                                                        |
| 2026-11-04   | production / Action                 | Release owner | public 228/80c on private 856/image 1962 | Official release, producer registration, all-role refs/registry 56 and ready200 verified;55 old rows retained.                                                              | Release41750361002 and production readback              | Observe fresh live canary.                                                                     |
| 2026-11-04   | production / workflow-v1            | Release owner | 80c63cdb                                 | Promotion succeeded and channel readback matched 80c.                                                                                                                       | Promotion41759562333                                    | Do not repeat promotion.                                                                       |
| 2026-11-04   | production / live canary            | Release owner | PR #30 head 09d7a2f0 /Action 80c         | PARTIAL: one major security/file-level finding published; scope 1/1, unverified_native_span, seven complete dispatches/Usage calls, Statistics 0/0.                         | Run 41759772607 / comment 6620833692 / scoped readback  | Preserve partial evidence; complete separate Action 229 repair and future acceptance.          |
| 2026-11-04   | source / private SDK                | Release owner | #809 merge a3db73fd                      | PR/main CI passed with PG17/PG16 rehearsals; official release dispatched (later publication recovery/install below).                                                        | CI 41750438825 /41758839860                             | Preserve source gates and separate later publication/install evidence.                         |
| 2026-11-04   | production / private228 publication | Release owner | a3db73fd / image0ff                      | Run41761230654 failed only final permission-limited tag push; owner completed remaining atomic refs/release publication using unchanged verified assets.                    | Release433459945; recovery above                        | Preserve failed workflow and separate publication proof.                                       |
| 2026-11-04   | production / private228 fleet       | Release owner | a3db73fd / image0ff                      | All four roles, seven worker privilege checks and ready200 verified.                                                                                                        | Selected exact tuple above                              | Preserve settings and unqualified Memory state.                                                |
| 2026-11-04   | production / Action229              | Release owner | 755a6443 on a3/image0ff                  | Producer registered, all four primary refs and registry57 verified, retaining all56 old rows; ready200.                                                                     | Release41762973918; durable summary                     | Preserve verified channel and final live acceptance.                                           |
| 2026-11-04   | production / workflow-v1            | Release owner | 755a6443                                 | Promotion41766365156 succeeded; workflow-v1 independently verified755.                                                                                                      | Promotion41766365156                                    | Preserve channel proof.                                                                        |
| 2026-11-04   | production / final positive canary  | Release owner | head8ddef95c / Action755                 | COMPLETE1/1; one critical at authority.ts:20, Stats1/1, six unique completed Usage calls/23,393 actual native tokens. Workflow FAILURE solely expected critical merge gate. | Run41766852161 / Appcomment6621731904 / durable summary | Ordinary review acceptance complete; preserve partial history and separate qualification gaps. |
