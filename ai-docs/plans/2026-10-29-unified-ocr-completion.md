# Unified OCR: bounded completion plan

Status: the reviewed current-main joins and canonical source/wrapper handoff are
published as SaaS **S2** `8080881802d87f3bf700b15faa7cebb02f54ee9b` and Action **A3**
`fb132c4ed337141339d487e7c388518178c24b10`. The SaaS metadata descendant pins A3 while
preserving S2's exported bytes. Three changed-fact plan rounds, source peer
reviews and artifact/provenance reviews returned GO. See the
[current checkpoint](../operations/2026-10-29-unified-ocr-integration-status.md)
and [SaaS](https://github.com/777genius/review-router-ai/pull/718/checks) /
[Action](https://github.com/777genius/review-router/pull/346/checks) PR checks for
required exact-pair results. Prior **D/A2** hosted gates passed; earlier pending
entries below record their status at that historical checkpoint. Live effects,
registration and rollout remain separately authorized. The existing
[product plan](2026-10-26-unified-ocr-review.md) remains the behavior contract;
this document records its bounded completion. Root owns Git publication.

## 1. Initial observations and limits (historical planning input)

- Inspected SaaS #718 at `5ef7c8d299e13a5f5c7cce339b0a696d24f52472`,
  against local main `89ce21c`. Main integration `bcebb274` is already in the
  feature history. The checkpoint and deployment record incorrectly describe
  integration/registry work as absent; reconcile them with fresh ancestry.
- Both Gateway verifier capture branches in
  `apps/api/src/review-run-runtime-snapshot.ts` still use static
  `modelIds.includes`. Dispatch and dashboard probes already share
  `gatewayProfileAcceptsRequestedModel`. Current #740/#739 remove the catalog
  opt-in; integrate their current matcher policy coherently, without adding a
  new flag. Inspected #740 at `192638cf4f8b875440199eba42151780b6580ff3`:
  its snapshot calls `gatewayProfileAcceptsRequestedModel(profile, model)`
  without a flag, and relay reexports the shared helper from
  `review-run-gateway-model-qualification.ts`. Reuse that existing narrow module
  and `GatewayModelQualificationProfile` type; apply it to the additional V2
  branch introduced by this feature as well as the older branch.
- API production emit includes `src/test-support/**`, whose Hosted fixture
  imports a feature test fixture outside `rootDir`. Worker emit includes tests,
  including a gate test importing an external history fixture. These explain
  the reported TS6059 build boundary; preserve ordinary test typechecking.
- CI reports a useless regex escape at
  `packages/features/codex-oauth-rotating/src/domain/runtime-migration.ts:94`
  and one stale source-literal assertion. Reproduce their exact failing checks.
- The comparison paired fixture requests lifecycle publication without writer
  witness environment or actual history activation. The real gate correctly
  refuses a missing/mismatched cut. The lifecycle paired fixture already has a
  signed loopback writer witness, real PostgreSQL identity/generation binding,
  restoration cleanup, and actual activation; reuse that existing approach.
- New Action main `8a6bb7395556ddabbda4b8275bc9e2de6fea4f8e` includes memory
  #350. Recheck both PR heads before merge. The production runner must retain
  both `scopedModelInvocations` and main's composite
  `reviewMemoryAdmissionForSessions(reviewMemory, descriptionMemory)`.
- Main's `ocr-managed-v4` catalog entry is already bound to `1.13.1-rr.5` and
  binary `9c666b25f7b189d5af8e59beb877e0a449869166116975fbd8e634bd1b370969`.
  The feature fixture still hardcodes `rr.5` and the different binary
  `a7bed0cea8ab05503c7de53f8c3825a75c285eb8364c832accc42dbebb0d42db`.
  Build/hash the combined artifact before freezing SaaS **S** and update the
  fixture's exact identity first; preserve main's immutable catalog entry.

These were the inputs to the approved completion plan. Their integration and
fixture repairs are now committed; current results and remaining gates are in
the checkpoint and acceptance record. Live qualification still needs the owner's
designated credentials.

## 2. Scope and invariants

The owner confirms there are no users. Add no schema migration, backfill,
rollout coordinator, hypothetical customer upgrade framework, or compatibility
scaffolding. Use the existing schema, application scenarios, admission,
provisioning, runner, verifier, allowance ledger, and GitHub App publisher.
Retain existing credential custody, refresh/writeback identity, cancellation,
current-head/ownership checks, original in-flight identities and deadlines,
unknown-effect fences, and exact GitHub reconciliation. No route/account/model
fallback, extra inference probe, allowance reset, or paid retry is permitted.

Existing release/rollout records remain truthful and pending. This code-ready
draft does not authorize deployment, tag promotion, real provider spending, or
changes to installed external workflows. Preserve existing operational
safeguards without creating new rollout machinery for nonexistent customers.

## 3. Small SaaS corrections

1. Reuse the current #740 Gateway model matcher in both verifier capture
   branches. Supply only the profile fields it actually needs; preserve the
   saved model, protocol/profile identity, original authorized binding,
   unique qualification and lower limits. Integrate the same existing policy
   into capture, relay and probe paths; do not introduce another toggle.
   Touch `review-run-runtime-snapshot.ts`, its existing capture tests, the
   existing `review-run-gateway-model-qualification.ts` module from #740, and
   production composition/relay/probe typing only as required by that join.
2. Exclude test roots and test-only support roots from API/worker production
   build configs. Do not widen `rootDir`, move/copy fixtures into production,
   or exclude tests from normal typechecks. Add exclusions only for proven
   test-only roots reached by the emit graph.
3. Remove the useless regex escape without changing accepted/rejected branch
   semantics. Correct the exact stale assertion against the final source or
   replace it with an existing behavioral assertion when that preserves its
   purpose. Do not reshape production code to satisfy a stale literal.
4. Reproduce the comparison failure. Reuse/extract the existing narrow signed
   writer-witness fixture, bind it to the actual disposable PostgreSQL identity
   and recovery generation, restore the original database comment on cleanup,
   and activate history through the real use case. Keep the production effect
   gate intact. Preserve three-head comparison, actual App publication,
   exact resolve count, receipts and no-extra-effects replay assertions.

Meaningful focused checks: dynamic compatible models outside the enrollment
anchor capture the same verifier route; incompatible profile/auth/protocol,
missing/duplicate qualification and insufficient limits stay unavailable;
static allowlists still work; current binding revocation still blocks
inference. Run both actual package emit builds and ordinary full typechecks,
the regex domain tests, existing publication gate tests, and the comparison
paired test with PostgreSQL.

## 4. Action integration and immutable OCR artifact

Merge the freshly recorded Action main into #346 and resolve the shared runner
by retaining both the feature's durable `scopedModelInvocations` wrapper and
main's composite `reviewMemoryAdmissionForSessions(reviewMemory,
descriptionMemory)`. Preserve the captured snapshots for both review and
description tasks, investigation memory, and admitted memory behavior in both
runner branches. Keep existing Skills interfaces. Do not copy the review
scenario into provider entrypoints.

Combine the feature's native Anthropic OCR patch with main's opaque-template
patch in the existing ordered patch/build system. Inspect the combined patch
application and regenerate its real reproducibility receipt. Use one unique,
unpublished managed artifact/version identity after checking the existing
catalog; never overwrite released `1.13.1-rr.5`, an old manifest, or immutable
binary bytes. Keep main's `ocr-managed-v4` / `1.13.1-rr.5` / `9c666b25...`
catalog binding unchanged and append a fresh immutable agent catalog entry for
the union artifact; retain the main opaque-template artifact and manifest.
Keep the pinned upstream source/toolchain explicit. Build and verify the real
union binary, record its exact new version/hash/manifest, and qualify native
wire behavior before freezing SaaS **S**. Update the production paired fixture's
old version/hash at both profile construction sites and its executable hash
check to this new identity before **S** is committed.

Touch the conflicting runner, existing OCR patch/version/manifest definitions,
`src/control-plane/review-agent-profiles.json`, existing qualification tests,
the SaaS paired fixture's exact artifact/profile identity, canonical exported
contract/wrapper inputs, and generated `dist/*` only where the established
scripts produce changes.
Do not hand-edit exported source, protocol digests, or bundled output. Rebuild
and commit the generated Action bundles. Keep the external `modelTransport`
union at its existing public values; finite internal route descriptors must
not leak into the public transport contract.

## 5. Finite end-to-end acceptance

Run the existing common 18-case lifecycle/production acceptance matrix once.
Extend its full real production-runner path to each remaining finite route,
without multiplying all 18 scenarios by all routes. Reuse shared assertions
and the existing PostgreSQL, real Git revisions, ordinary authenticated
admission/checkout/renewal, pinned OCR executable, verifier and App worker.
The integrated route proof must enter real SaaS admission and the existing
native prepared-route adapters, then run real OCR, the verifier, and App worker
against synthetic external boundaries. Reuse the public runtime bootstrap if
it already provides this path; inspect it before extending the existing harness.
Do not build a new bootstrap framework or duplicate production orchestration.

| Prepared route                | Full runner proof                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account Gateway               | Retain and rerun the existing full-runner proof, including a qualified dynamic saved-model selection.                                                                                 |
| OpenRouter API key            | Add the same real two-head runner scenario through the existing controlled direct route.                                                                                              |
| MiMo Token Plan API key       | Add the same scenario with its existing endpoint/model/settings constraints.                                                                                                          |
| Kimi Code API key             | Add the same scenario with its existing endpoint/model/settings constraints.                                                                                                          |
| Repository Codex subscription | Exercise the native prepared subscription adapter in the same admitted runner; qualify official auth-only CLI refresh and sealed writeback separately with the existing helper tests. |
| Hosted Codex Pool             | Preserve the original bound grant/lease/account/model and exercise the same V2 runner and publication.                                                                                |
| Claude Code subscription      | Exercise the native Anthropic route with the combined real OCR artifact and existing opaque token lifetime rules.                                                                     |

For each route, head A publishes new findings; head B proves a fix, retains an
active finding, leaves an unprovable finding unverified, discovers a new issue,
and resolves only the eligible proven fix. Assert the original account/model/
route for discovery and verifier, shared durable allowance, accepted usage and
model receipts, configured App author identity, and completed replay with no
new paid or GitHub effects. Managed API-key provisioning is a focused existing
provisioning test, not another identical transport row. The explicit supported
supplied-diff Codex alternative gets a focused regression, not an invented OCR
supplied-diff mode.

Report the integrated route results separately from focused official CLI
auth-only refresh and sealed-writeback helper qualification. Passing those
helpers alone does not prove a complete subscription runner path. These seven
route proofs use synthetic upstream/GitHub/OIDC boundaries; they are not seven
live-provider or full remote GitHub workflow E2Es. Retain any existing real
public-bootstrap coverage without claiming fixture boundaries were live.

Reuse existing adapter fault suites for the concrete protocol/auth differences:
official rotation and writeback uncertainty, Hosted custody, Anthropic terminal
and model validation, cancellation, truncated/unknown effects, missing usage,
and unavailable/exhausted allowance. Add cases only for a demonstrated gap;
do not recreate the common fault matrix per route. Synthetic external services
establish application and executable qualification, not live entitlement,
billing, OAuth, GitHub OIDC, or deployment acceptance.

Run the actual Next app at desktop and narrow mobile widths in both light and
dark themes. Exercise current setup/readiness transitions through the existing
browser harness, inspect every resulting screenshot, and correct concrete
layout or interaction failures using shared UI primitives. Inspect canonical
rendered GitHub summary/banner mixed results. No new results page is required.

## 6. Final pair and validation order

Use one directional source handoff to avoid export/pin hash ping-pong:

1. Integrate Action source and build/qualify the union OCR binary first. Record
   the exact unique version, binary hash and manifest; append its catalog entry
   and update SaaS's paired fixture identity. Do not freeze **S** while it still
   names the old feature `rr.5` / `a7bed0...` binary.
2. Finish SaaS source and fixture changes; run focused checks, actual API/worker
   builds, generated-contract checks and required architecture/lint/format
   gates. Build canonical SaaS artifacts and commit the frozen source as **S**.
3. Export contracts and sync the curated public wrapper from exact committed
   **S** with existing scripts. Run Action typecheck/lint/tests/artifact checks,
   rebuild committed bundles, and commit the final Action as **A**. Run focused
   **S/A** stabilization checks as necessary; a broad preliminary run is optional
   only to resolve a concrete risk, not an additional mandatory duplicate run.
   If executable source changes, deliberately recreate the source handoff;
   do not fake provenance.
4. Set the canonical SaaS CI Action pin to **A** in a metadata-only descendant
   **P** of **S**. Record that generated inputs/wrapper still come from **S**.
   Do not re-export only because the pin/documentation commit changed the SHA.
5. Run the full final required SaaS CI and paired acceptance on **P/A**:
   common 18, all finite admitted runner routes, comparison publication,
   existing relevant adapter fault suites and actual Next screenshots. Verify
   exported content/provenance and committed bundle parity; record exact SHAs,
   commands, run links, pass/skip counts and inspected screenshots. This final
   exact-pair gate is mandatory. A skip is not a pass. Keep fresh remote-head
   checks before each push. Repeat checks only for changes, failures or a
   concrete unresolved risk.
6. Reconcile the checkpoint, acceptance evidence and existing deployment
   task/index. Distinguish implemented, synthetic E2E verified, real executable
   qualified, browser inspected, live verified, and deployed. Root commits and
   pushes each coherent slice to the existing draft PRs as authorized.

If required credentials prevent final live checks, finish all other authorized
work and record the exact remaining live gate. Do not label synthetic success
as complete live acceptance or deployment.

## 7. Critic rounds and implementation gate

All three bounded independent cross-critic rounds are required before product
edits. Close every blocking finding and record its recheck before implementation.
Reviewers assess both the smallest safe scope and whether the final evidence
proves the stated behavior. A pending review is not approval.

| Round | Focus                                                                                                             | Reviewer verdicts and finding disposition                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | SaaS/Gateway policy, Action merge/artifact identity, finite acceptance coverage and final-pair provenance.        | Action: **NO-GO**, two P1 findings. Acceptance: **conditional GO**, one P2 finding. Corrections in v2 are recorded below and verified in round 2.                                              |
| 2     | Recheck round-1 corrections; auth/budget/publication fences; no-users scope; reproducible final validation order. | Action: **GO**, both P1 corrections verified. Acceptance: **GO**, preparation boundary, all three rounds, finite coverage and final exact-pair gate verified. No blocking findings.            |
| 3     | Final bounded pass over corrected scope, memory/artifact preservation and exact-pair evidence requirements.       | Action: **GO**, corrected round-1 history, artifact order, immutable catalog and composite memory verified. Acceptance: **GO**, all four recheck-packet points verified. No blocking findings. |

### Round 1 finding record

| Reviewer / severity | Finding                                                                                                                                                                  | v2 disposition and recheck                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action / P1 #1      | Building the union OCR artifact after SaaS freeze leaves the paired fixture on the old `rr.5` / `a7bed0...` identity.                                                    | Build/hash/qualify the union before **S** and update both SaaS fixture profile sites and the executable check before freezing **S**. Action critic verified the correction in round 2: GO.                                                                                                                  |
| Action / P1 #2      | The plan omitted a fresh immutable agent catalog entry for the combined OCR artifact.                                                                                    | Append a distinct entry for the exact union artifact; preserve main's `ocr-managed-v4` / `rr.5` / `9c666b25...` binding and immutable artifact/manifest. Action critic verified the correction in round 2: GO.                                                                                              |
| Acceptance / P2     | Integrated route evidence and standalone auth-helper qualification are conflated, risking claims of seven full live/workflow E2Es or an unnecessary bootstrap framework. | Require real SaaS admission/native prepared adapters plus real OCR/verifier/App against synthetic boundaries; reuse existing public bootstrap where present. Report CLI/sealed-writeback helper qualification separately; no live/workflow claim. Acceptance critic verified the correction in round 2: GO. |

Composite memory preservation was an Action review clarification, not a third
blocking finding: retain `reviewMemoryAdmissionForSessions(reviewMemory,
descriptionMemory)`, both task snapshots, investigation and admitted memory,
together with `scopedModelInvocations`. This clarification remains explicit in
section 4 and was accepted in round 2.

The owner also corrected the review/validation process: all three bounded plan
rounds are mandatory; use **S/A** only for needed stabilization and run the full
required acceptance once on final **P/A**. These process corrections were
verified by the Acceptance critic in round 2.

### Round 3 recheck packet

Review this corrected plan as the final bounded pass before product edits:

1. Verify the artifact dependency order: build/hash/qualify the unique union,
   append its immutable catalog entry and replace the SaaS fixture identity
   before freezing **S**; preserve main's existing OCR artifact and memory
   composition while retaining durable model-invocation scope.
2. Verify the acceptance boundary: the common 18-case matrix runs once, each
   finite route enters real admission/native preparation and the common real
   runner against synthetic external boundaries, and focused auth-helper
   qualification is reported separately. No Cartesian matrix, new bootstrap
   framework, public transport-union expansion, or unsupported live claim.
3. Verify the handoff and final gate: exact committed **S** exports to rebuilt
   **A**, then metadata-only **P** pins **A**; final **P/A** runs the complete
   mandatory acceptance and verifies provenance/bundle parity. Repeat only
   checks justified by changes, failures or a concrete remaining risk.
4. Verify no-users scope and safeguards: no new migration/backfill/upgrade
   coordinator; preserve credentials, original in-flight identities, shared
   allowance, unknown-effect fences, current authority and App publication.
   Fix the comparison fixture through signed witness/actual activation and
   inspect actual Next at two widths in both themes.

Round 3 is complete. The Action critic returned GO after verifying the corrected
round-1 finding history, artifact dependency order, fresh immutable catalog
entry and composite memory preservation. The Acceptance critic returned GO
after verifying all four packet points. Neither reported a blocking finding.
All three required plan rounds are complete. Root published the approved plan
in `e499e5ed7824afb687d43cc2d027512a7efa4264` before source implementation.

Implementation review follows the tested final changes, with exact file/line
findings and meaningful rechecks. Do not carry historical plan GO verdicts
forward as approval of this completion plan or its implementation.

## 8. Bounded delivery prerequisite: preserve the conversation contract

Status: Action critic GO preceded the bounded canonical edits, now included
in committed **S**.
This preserves a contract already imported by Action main; it does not import
the separate memory/conversation product feature from draft SaaS
[#734](https://github.com/777genius/review-router-ai/pull/734).

Action main's sole additional generated file is `conversation.ts`, exported
from canonical SaaS `157eed60e97ecfc31d9ceaea8c8c989eb9e9e3be`; its generated
SHA-256 is `d31309c5667a8aa37d9ef8e59b055d3ffdfeb59ba6bb7723fad09fb137d1493b`.
It contains only finite request/result types, imported by Action's existing
conversation client. Exporting the older canonical tree would remove this
managed file and break main's preserved source imports.

Minimum closure: take that exact canonical
`packages/protocol-review-action-v2/src/conversation.ts`, its existing
`./conversation` package export, and the existing generator entry from #734.
Generate `src/generated/conversation.ts` through the normal protocol generator;
never restore it only inside the Action or hand-edit a handoff digest. Extend
the existing export-handoff test to cover its exact managed bytes and digest.
The existing exporter validates safe paths and SHA-256 for every generated
file; it has no finite filename whitelist to widen. This type-only companion
adds no operation to the core review protocol or JSON schema. Keep their
schema/negotiation identities unchanged and verify that with normal protocol
determinism, protocol package build/typecheck, and export/release tests.

No #734 runtime route, memory application feature, schema migration, backfill,
or UI is imported. Ordinary PR OCR does not call the conversation interaction
path. Memory capture is optional and catches unavailable bundle requests,
returning no memory snapshot while OCR continues; non-review tasks require
explicit server purpose authority. Current SaaS's strict bundle request schema
does not accept main Action's new `task` field, so enabling contextual memory
against this older server degrades unavailable rather than granting another
task's memory. Do not mask that mismatch with permissive parsing or a fallback.

Contextual memory and managed conversation behavior require #734's separately
reviewed server implementation and rollout. Preserve Action main's capability,
but do not claim this contract-only addition qualifies those features or a
complete live memory/conversation pairing. Record that dependency in the final
integration/deployment evidence without expanding Unified OCR's product scope.
The contract files join frozen source **S** before the existing **S → A → P**
handoff; final generated bytes/provenance and Action imports must remain intact.

| Addendum review | Verdict and disposition                                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action critic   | **GO**: exact canonical provenance and minimal generation/export closure verified; no core-schema/transport expansion or runtime/migration import. Optional memory and separate #734 runtime dependency accepted; strict parsing remains unchanged. |

## 9. Acceptance-discovered admission deadline correction

The new integrated direct/native route proofs exposed an admission mismatch:
the first capture rounded every route's deadline to Gateway whole seconds,
then ordinary admission restored only the outer snapshot deadline to its
original millisecond maximum. Nested V2 model-dispatch deadlines retained the
rounded value. The exact production fence recaptured against the persisted
millisecond maximum and correctly rejected the different snapshot.

The correction in `b0239454bf5cad4ef61419d425f302efb231e244` selects the
transport-appropriate deadline before the first capture: Gateway keeps its
existing whole-second bound; direct/native routes retain their existing
millisecond maximum for both outer and nested capabilities. Exact snapshot
comparison, original deadlines/allowances and restore identities remain intact.
A nonzero-millisecond regression exercises actual production capture/recapture
for Responses, native Codex and native Anthropic; the integrated route proofs
also passed in the 25-case source qualification. Root authorized this necessary
E2E correction; it remains in the final implementation review scope.

## 10. Historical D/A2 implementation review and qualification checkpoint

| Round | Review scope                                              | Recorded disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Action/SaaS cross-review and acceptance fidelity          | Core source/transport/receipt boundaries accepted. P2: comparison witness opened before harness setup cleanup ownership; corrected in **S**, then comparison 1/1 passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2     | Default profile/readiness and committed artifact delivery | Acceptance **GO**: exact v5 defaults, finite routes, immutable pins versus Gateway channel and no new migration/framework. Action delivery P2: CI `npm ci` prepare rebuilt `dist` before the actual-artifact tests. Correction locally verified: restore tracked `dist` after install and assert entrypoint bytes against the Git HEAD blob; existing three cases passed again on committed runtime bytes, all ten runtime hashes unchanged. Corrected Action `cfe2b78...` / SaaS pin `ff033fd...` published; CI was pending at this review and later passed on D/A2. Source implementation reviews returned GO; documentation recheck returned GO, both P2 wording findings closed. |
| 3     | Final pair after CI                                       | Source implementation and final documentation recheck GO; both P2 wording findings closed. Full published **M/A** CI was pending at this review; required hosted gates later passed on D/A2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

The plan's three rounds used two critic roles; implementation reviews above
reuse the relevant roles and do not imply additional independent reviewers.
Local qualification passed **25/25** (17 shared lifecycle cases, seven actual
route runners and comparison), followed by the overlapping isolated cleanup
rerun **1/1**. Actual Next **2/2** plus Sol visual GO, actual bundle **3/3** and
separate official helper **1/1** retain their exact source/effect boundaries in
the acceptance record. Failed ENOSPC evidence was preserved separately.

Main integration, registry integration, source export and bundle regeneration
are complete. The published pair is SaaS **M**
`841f44f0900409692559286cdbb00ac319a40664` and Action **A**
`cfe2b78fba925e3e7741d8c7f479324aa785d12b`; canonical source **S** was unchanged.
The later D/A2 hosted gates passed, as linked in section 12. Current S2/A3
qualification uses the linked PR checks; designated live credentials and
separately authorized release/registration/environment verification remain
separate. Optional memory/conversation still depends on #734 as described
in section 8. No new migration or customer rollout framework was added.

## 11. Current main join: test-only History source coverage

Status: SaaS critic returned **GO** before the merge and **GO**, no findings,
on the resolved shared harness. The earlier
implementation/review GO scopes and 25-case qualification precede this join;
the final critic must recheck the shared fixture after final CI.

Current main is `8ea78b9df1398e64fce917eecdc18d95e52d9e9f` (PR #741,
`408a1a7` and `8f9c7fd`), newer than the previously recorded main `89ce21c`.
Its exact eight-file delta is:

- `ai-docs/deployments/2026-10-28-review-history.md`
- `ai-docs/plans/2026-10-28-review-history-reviews.md`
- `scripts/review-action-v2-production-e2e/review-action-v2-production.e2e.test.ts`
- `scripts/review-action-v2-production-e2e/support/fake-github.ts`
- `scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness.ts`
- `scripts/statistics-e2e/README.md`
- `scripts/statistics-e2e/browser-qualify.ts`
- `scripts/statistics-e2e/history-source.ts`

The approved recipe merged current main into
`ff033fd0056e84f522c2b62799a48c56e5613cbd` with
`git merge --no-commit origin/main`, preserving the five dirty documentation
records in place. Resolve only the shared harness conflict: retain the native
Claude `subscriptionAuthMode` option/property/constructor forwarding and caller
predicate together with main's opt-in `historyProfile` / `fixtureScope`, scoped
fetch/cleanup ownership and dynamic source-run identity. Preserve both genuine
History source-to-browser coverage and all seven OCR routes; no new framework,
production behavior, migration or base/source rewrite is included.

Before/after checks must preserve the five documentation contents, compare the
existing protected runtime/canonical/wrapper hashes, and retain the exact Action
pin `cfe2b78fba925e3e7741d8c7f479324aa785d12b`. Canonical export source **S**
remains `dccf5b628680bd7f3f8c9501e3108e432053495b`: these eight test/docs files
require neither a new export nor an Action rebuild.

Run focused TypeScript/lint/format checks over the joined support and tests.
If disk permits, run the existing paired comparison and the existing production
harness cases for borrowed construction cleanup and two manual source runs.
Do not rerun the full 25 cases under ENOSPC or claim this focused check reruns
the browser matrix. Preserve earlier receipts and any new failures separately;
existing final-pair CI must qualify the merged join. Root published the merge
with parents `ff033fd...` and `8ea78b9...`; the implementation agent made no
commit or push.

### Observed join checks

Published merge **M** `841f44f0900409692559286cdbb00ac319a40664` has parents
`ff033fd...` / `8ea78b9...`.
Only three append conflicts in the shared harness required resolution; both
sides were retained. The merge contains exactly the eight main paths, no
unmerged paths remain, the five dirty records were hash-identical through the
merge, all 77
protected files match and the A2 pin is unchanged. The SaaS critic independently
rechecked the resolved diff, protected hashes, pin and exact staged scope: **GO**.

Focused strict TypeScript, lint, formatting and staged/working whitespace checks
passed. The selected existing PG cases passed **3/3** with **11 intentionally
filtered cases**: comparison publication, failed borrowed History construction
cleanup, and two genuine manual source runs through publication and reads.
Receipt: `tmp/ocr-completion-checks/main741-focused-result.json`; 32.24 seconds.
This is neither a new full 25-case run nor a browser rerun. Earlier review/25/UI
receipts retain their pre-join scope. Final CI must qualify this merge descendant
of **P** with the same **A/S**; no canonical export or Action rebuild is needed.

The final documentation critic found P2 wording: ten generated runtime files
were incorrectly described as ten committed `dist` files. The record now
distinguishes all ten generated files from the seven tracked artifacts. The final critic recheck returned **GO**, with both P2 wording findings closed
and no remaining findings. This adds no new test or CI result.

## 12. New Action main join: preserve Gateway reviewers and Unified OCR

Status: **all three original and correction plan rounds GO; reviewed source
implementation and S2/A3 publication are complete**. Current exact-pair checks
are linked in the header; the following planning inputs and prior receipts keep
their historical scope. Published SaaS
**D** `072ad865bd78ab66050fa6bac4fbaa31300c81ec` / Action **A2**
`cfe2b78fba925e3e7741d8c7f479324aa785d12b` passed their required hosted
checks. [SaaS full CI 40882645913](https://github.com/777genius/review-router-ai/actions/runs/40882645913)
passed all 13 executed jobs; one existing conditional full private rehearsal was
skipped. Source and Certification's existing five-file paired gate passed
**40/40 tests, zero skips**, including lifecycle 24 and comparison 1. The other
SaaS workflows, Unified OCR UI and
[Action CI 40878588227](https://github.com/777genius/review-router/actions/runs/40878588227)
also passed. These results remain evidence for **D/A2**, not for the new join.

While those checks ran, Action main advanced from
`8a6bb7395556ddabbda4b8275bc9e2de6fea4f8e` to exact merge target
`fea226e5ee98aae2e3475c3e8ef26ea5da5e5d52`, merging
[#351](https://github.com/777genius/review-router/pull/351) Gateway reviewers.
Draft #346 is now conflicted. SaaS main remains
`8ea78b9df1398e64fce917eecdc18d95e52d9e9f`.

### Resolve the difficult composition points first

Read-only three-way comparison against common base `8a6bb739...` confirms
four true nonartifact conflict files:

| Action path                                                                    | Conflict blocks | Minimal resolution                                                                                                                |
| ------------------------------------------------------------------------------ | --------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/review-orchestration/infrastructure/production-t0-review-runner.ts`       |               8 | Keep main's `prepareLane` and single parent orchestrator; port Unified OCR route/scoped-dispatch behavior into those lane bodies. |
| `src/review-orchestration/infrastructure/account-gateway-model-transport.ts`   |               3 | Keep reviewer identity and native request/response behavior through callers, headers and auxiliary clones.                        |
| `src/review-orchestration/infrastructure/ocr-review-invocation-adapter.ts`     |               1 | Keep `attemptBudget?: 1`, `reviewerId` and `reviewerRequired`.                                                                    |
| `__tests__/unit/review-orchestration/lifecycle-verification-transport.test.ts` |               1 | Keep reviewer parameterization/header assertion and `maxOutputTokens: 4096`.                                                      |

Four other overlapping source/test/docs paths merge textually. The handoff has
three generated metadata conflicts. Three overlapping bundles (`dist/index.js`,
`dist/index.js.map`, `dist/single-t0-plan.js`) require regeneration from resolved
source, not selection of either parent's built bytes.

1. Main's `prepareLane(input, reviewer, ...)` shadows the parent input. Resolve
   `preparedRoute` and `modelDispatchCapability` from that **lane input** so a
   secondary reviewer cannot borrow the primary transport, capability, model or
   settings. Preserve the absent-reviewer-plan path, existing native/direct
   routes, `scopedModelInvocations`, original deadlines, shared finite allowance,
   unknown-effect fences and effect-free completed replay. Main's reviewer
   cancellation, concurrency groups and required votes remain in the existing
   orchestrator and publisher; add no duplicate coordinator.
2. Constructor argument eight is `reviewerId?: string`; argument nine is the
   native Codex route. Update the native startup caller and every affected
   auxiliary description/lifecycle clone consistently. Keep native-body callbacks
   and native/hosted credential headers alongside the reviewer selector.
3. Keep primary-only PR-description/lifecycle verifier custody, reviewer-scoped
   investigation dispatch/recording, composite
   `reviewMemoryAdmissionForSessions(reviewMemory, descriptionMemory)`, both task
   snapshots and main's unavailable-lane behavior. Strengthen only the existing
   two-OCR composition case: give the children distinct bridge base URLs and
   capability authorizations, then assert each constructed OCR adapter receives
   its reviewer's exact pair. The shared transport fixture currently cannot
   detect a stale outer route.

### Canonical union before the next export

Main's reviewer-plan contract comes from canonical SaaS
`1a21c33f39ff42fa8c640d9cfd4980f8ff88f8e7`, generated SHA-256
`bbef9f5bd70778cf7b0858a84e1d866b5d2e8f97c2738c0210ff45705c7cf4c5`,
descriptor
`sha256:f6a45d7039129a813690f5f769052d3ba078418eb123b0c0c710ef790d2919d6`.
Import only this ten-path canonical/tooling closure from its owner:

- `packages/shared/src/review-reviewer-plan.ts` and `packages/shared/src/index.ts`;
- `scripts/generate-review-action-v2-protocol.mjs`;
- normal generated `packages/protocol-review-action-v2/src/index.ts`,
  `packages/protocol-review-action-v2/src/generated/manifest.json` and
  `packages/protocol-review-action-v2/src/generated/review-reviewer-plan.ts`;
- `scripts/lib/review-reviewer-plan-release-profile.ts`;
- `scripts/lib/review-action-v2-release-manifests.mjs`;
- `scripts/lib/review-action-v2-release-verifier.mjs`;
- `scripts/generate-public-review-action-v2-release-manifest.mjs`.

The existing release parser would silently drop optional `reviewerPlanProfile`;
preserve its parse/bind/build/read/registration projection and verifier handling
through the maintained tools. Retain current manifest fields, current agent
profile and the three Unified OCR modules, plus conversation SHA-256
`d31309c5667a8aa37d9ef8e59b055d3ffdfeb59ba6bb7723fad09fb137d1493b`.
The normal union handoff should have **64 generated-file entries**. Core schema,
negotiation, canonicalizer and golden identities remain unchanged. Do not edit
generated files or digests by hand.

Use the owner's existing shared reviewer-plan test and bounded release-manifest
case, plus an assertion in the existing generated/export test for exact module
bytes and descriptor. Run normal protocol generation/determinism and affected
package/tooling checks. Import no #738 server implementation, API/V4 activation,
UI, migration, backfill or feature flag. Its runtime/rollout remains separately
owned; section 8's optional #734 memory/conversation boundary remains unchanged.
There are no users requiring a migration or upgrade coordinator in this work.

### Freeze, build and qualify the new exact pair

After three brief plan rounds return GO, implement only this closure. Preserve
both merge parents **A2** / `fea226e5...` and main's updated `AGENTS.md`.
Freeze/publish canonical SaaS **S2** before sanctioned export to the resolved
Action, with exact source/branch/base checks. Verify the union and curated
wrapper bytes through existing export/sync checks. Rebuild JavaScript
reproducibly: all ten generated runtime files, including seven tracked artifacts.
Retain A2's post-install tracked-`dist` restore and Git-HEAD-blob guard so tests
execute committed bytes. Publish coherent two-parent Action **A3**, then the
SaaS metadata pin to A3; record exact identities. Do not relabel D/A2 evidence or
export again solely for that metadata descendant.

Native OCR remains `1.13.1-rr.6` / `ocr-managed-v5`, v3 qualification manifest,
binary SHA-256
`9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`.
Native patches, dependencies, toolchain and workflow definitions need no change.
Use existing checkouts/dependencies; no new clone/install, large helper
extraction or native rebuild. The retained OCR binary supports bounded checks;
mandatory CI reinstalls the exact official auth helper normally.

Run affected main reviewer/session/orchestration and Unified OCR transport,
lane, protocol and actual-dist regressions. Then require existing full Action
CI (real Docker, native and official-helper gates), full SaaS CI including the
**40-case five-file Source and Certification gate**, and the existing Unified OCR
UI workflow on the new pinned pair. Keep required skips explicit and overlapping
scopes separate. No Cartesian matrix, new server fixture/framework or weakened
gate. Fix concrete failures and review the resolved implementation before
qualifying the new pair. These checks claim no new live credentials, paid
provider effect, registration, deployment or rollout.

| Addendum review round | SaaS canonical/tooling critic | Acceptance critic             | Disposition                                                                               |
| --------------------- | ----------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| 1                     | **GO**, no P1/P2 findings.    | **GO**, no blocking findings. | Exact draft reviewed; source implementation remains held.                                 |
| 2                     | **GO**, no findings.          | **GO**, no findings.          | Canonical/profile/export and route/budget/evidence invariants rechecked; no scope change. |
| 3                     | **GO**, no blockers/findings. | **GO**, no blockers/findings. | Final scope, identities and gates accepted; implementation held for root publication.     |

### Current-main correction: inherit merged #738 before S2

Status: **all three correction rounds returned GO; correction plan published
before implementation, now delivered in S2/A3**. S2 contains the actual
157-entry source migration union with both original SQL files unchanged. The
current six-file paired/fresh-replay results must come from the linked CI;
prior D/A2's 156-entry/40-case receipts are historical. The resolution and
bounded check summary are in the current integration checkpoint.

This correction supersedes only the import-only assumptions and old merge targets
above. SaaS main is now `78434bee6344ff497e0791140887ea9522d94ef6`, the merge
of #738 with parents `8ea78b9...` / `cb6068d...`. Action's exact target is
`46e3cfd484e2d1a7e0a1cd8b257206b12c179ce5`, whose parent is `fea226e5...`.
The latter changes only three curated wrapper/test paths; the four reviewed
Action source/test resolutions and lane-local strategy above remain unchanged.
The previous three review rounds remain historical. Three brief correction
rounds below cover these newly observed main/schema/CI/provenance facts only.

The stopped preparatory canonical patch is preserved in the approved SaaS
checkout; no generator/build/test ran before the stop. Inherit current main's
canonical contract and release tooling once, rather than reimplementing the
ten-path subset. Keep the independent exact generated-byte assertion and all
Unified OCR exports. Merge the current-main sources with the reviewed plan
descendant, preserving both SaaS histories and the inherited deployment registry
entry. Update the existing Unified OCR deployment record/index at final evidence;
this does not authorize deployment.

Read-only merge-tree comparison of `19a92b0...` and `78434bee...` found
**28 true conflict paths** among **49 overlapping paths**:

| Resolution group                     | Existing owners and required join                                                                                                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime capture and checkout         | `review-run-runtime-snapshot.ts`, `review-run-gateway-checkout.ts`, `review-run-gateway-relay.ts`, their capture/byte-limit tests, and the runtime-snapshot port: retain V4 reviewer/allocation capture alongside all existing V3/native/direct routes and the no-new-flag Gateway qualifier. |
| Admission and primary auxiliary work | `review-action-v2-production-composition.ts` and `review-lifecycle-verification.ts`: retain shared V2 dispatch admission, exact V4 allocation liveness/lock ownership, and the primary reviewer's verifier/description identity and allowance.                                                |
| Immutable producer metadata          | Configured attestation, Prisma producer repository and shared exports: preserve both `modelDispatchProfile` and `reviewerPlanProfile`, existing lifecycle projection, current agent profile, conversation and the 64-entry canonical union.                                                   |
| Migration/history tooling and tests  | Preserve both sides of existing transition, historical96, schema-handoff, checkout-admission and migration-rehearsal cases; derive the combined inventory from real files instead of choosing either branch's old count or checksum.                                                          |
| Delivery and fixtures                | Preserve both deployment index entries, inherited six-file paired command, native-route lifecycle fixture and exact Action-pin policy. Regenerate both wrapper bundles; do not merge built bytes manually.                                                                                    |

Textually merged code still needs semantic review. Keep supported Gateway-only
multi-reviewer **V4** on main's exact reviewer/allocation/request/invocation
fences; no primary-only V2 capability may be inherited by a child, and no new
V2 field is added to the immutable reviewer-plan wire contract. Ordinary
single-route API/native/Gateway **V2 dispatch** retains its existing V3 snapshot
path and shared dispatch allowance. Do not invent direct/native auth ×
multi-reviewer combinations or route/authority fallback.

In recursive `captureMultiple` calls, use the child-selected provider row and
its qualified `defaultAgentProfileRef` / explicit supported agent profile:
retain Unified OCR's approved default, not main's legacy `ocr-managed-v2`
fallback, and read that child's `agenticContext`/settings rather than
`configuration.providers[0]`. The single-route preparation guard must not
disable V4 capture. Checkout/Action child configuration selects the exact
reviewer model/profile; primary-only description/verifier uses the selected
primary and its allocation. Preserve shared finite allowance, V4 allocation
cleanup, cancellation, required votes, current-revision authority,
unknown-effect fences and effect-free replay through the existing owners.
Use existing multi-reviewer and seven-route cases to expose wrong-child/default
or primary-capability borrowing; add no universal executor or new coordinator.

Main contributes the already-merged
`000152_review_run_gateway_allocations/migration.sql` and its Prisma model;
the feature retains `000154_unified_model_dispatch/migration.sql`. There is no
152 name collision and these SQL files change different columns/constraints.
Preserve both byte-for-byte; author no new migration and do not renumber history.
The stopped feature inventory has 156 entries, so the union is expected to add
one; the fresh-database gate must record the **observed** count, ordered identities
and checksums rather than carry forward 156 as current evidence.

The inherited schema requires a matching Prisma client. Use the existing pinned
generator with output isolated to this new checkout if the linked client is old;
do not regenerate or modify the original checkout's dependency/client install.
Then run normal protocol generation/determinism, affected typechecks and existing
capture, checkout, relay, lifecycle and allocation/dispatch regressions.

Keep main's existing
`apps/api/src/gateway-multi-reviewers-paired.e2e.test.ts` in
`review-investigation:paired-e2e` and qualify it on the new exact pair. The
inherited command has six files; report its observed totals. Prior D/A2's
156-migration, 40-case and UI receipts remain historical. Existing full CI,
paired/native/official-helper and Unified OCR UI gates remain required.

Freeze canonical/wrapper **S2** with the reviewed plan descendant and
`78434bee...` as SaaS parents before Action export. Preserve the pending Action
merge; the sanctioned S2 sync covers all three `46e3cfd...` curated paths.
Root publishes the final Action with parents **A2** / `46e3cfd...` after ancestry
and tree-completeness checks, then updates only the SaaS canonical pin.
Hold canonical/runtime source during export; report any unavoidable follow-up
instead of silently moving S2. Keep rr.6/v5/native/helper/toolchain identities
unchanged. Inherited #738 behavior is preserved, with no new feature/API/auth
mode/flag or deployment activation; section 8's separate #734 boundary remains.

| Correction review round | Action critic                    | Acceptance critic                | Disposition                                                                                           |
| ----------------------- | -------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1                       | **GO**, no P1/P2 findings.       | **GO**, no blocking findings.    | Exact changed-facts draft reviewed; SaaS merged implementation remains held.                          |
| 2                       | **GO**, no findings.             | **GO**, no findings.             | Inherited-main authority/default, SQL, six-file gate and exact provenance rechecked; no scope change. |
| 3                       | **GO**, no blockers or findings. | **GO**, no blockers or findings. | All three correction rounds complete; freeze for root publication before amended SaaS implementation. |

## 13. Gateway multi-reviewer paired fixture correction

Status: **all three brief Action/Acceptance plan rounds GO; frozen for root publication before fixture edits**.

### Observed failure and scope

Final P3 `7e8924765be586e1c1e82e21603748dccc1bddd6` / A3
`fb132c4ed337141339d487e7c388518178c24b10` Source/Certification
[attempt 2, job 123602099175](https://github.com/777genius/review-router-ai/actions/runs/40909630937/job/123602099175)
passed protocol, handoff, wrapper parity, hosted proofs and exact OCR identity,
then its six-file paired gate reported **40 passed / 4 failed / 0 skipped**.
All four failures are the existing `gateway-multi-reviewers-paired.e2e.test.ts`
scenarios: shared, independent, unavailable-primary and mixed-engines. Other
five files, including comparison and the seven-route lifecycle proof, passed.
The earlier official PostgreSQL-key network timeout was cleared on unchanged
P3; it is separate from this fixture failure and remains preserved evidence.

The fixture's `nativeGateway()` omits `/v1/account-models/read`. Its observed
requests therefore receive the fixture's final 404. Production checkout fails
closed with captured `model_settings_unavailable`; Action rejects that captured
unavailable reason before starting an engine. The generic engine warning and
later empty child log/partial execution are consequences, not proof of a binary
or production-bootstrap defect. Root and both independent critics identified
this boundary read-only. No production correction is justified by that trace.

A second, prospective coverage gap is distinct: the fixture does not approve a
model-dispatch default, and its mixed OCR row explicitly selects old v2. The
other three cases intentionally exercise supported supplied-diff Codex with
`agenticContext=false`; preserve that intent. Do not force Codex onto the mixed
row or replace those alternative cases with an expanded OCR matrix.

### Minimal owned changes

Edit **only** `apps/api/src/gateway-multi-reviewers-paired.e2e.test.ts` after this
plan is reviewed and published:

1. Add the missing account-model read branch to its existing synthetic Gateway,
   using the maintained paired fixture's current contract envelope. Validate the
   control bearer and requested account/owner/profile/epoch, and return the two
   fixture models with their supported high/medium reasoning settings and
   existing tool/fast-mode semantics. Keep missing/disabled account behavior
   fail-closed; change no production metadata reader, admission or fallback.
2. In the existing **mixed-engines** case only, use the bundled
   `ocr-managed-v5` / rr.6 identity as the local synthetic OCR approval and the
   existing `ReviewModelDispatchProfileV2` harness option with
   `account_gateway` default ref v5. Row 0 remains explicit supported
   supplied-diff Codex with no repository tools. Row 1 keeps
   `agenticContext=true`, omits an explicit profile and must capture the qualified
   OCR default. Its existing synthetic binary/version/hash mapping follows that
   selected profile. Assert row-0 Codex / row-1 v5 and absence of a borrowed V2
   dispatch capability on V4. Preserve both per-reviewer and allocation authority.
3. Keep all four cases and their existing assertions for exact model/settings,
   shared versus independent allowance/concurrency, unavailable-primary partial
   output, accepted observations, child homes/capabilities, request/admission
   identity, single App publication, close/readback and no unexpected errors.
   Add no case matrix, helper framework, bypass or permissive expected result.

This remains the original compiled-Action + real API/PostgreSQL + synthetic
Gateway/engine fixture. Its engine substitution is not real OCR qualification;
the unchanged seven-route lifecycle proof uses the actual native OCR binary.
Do not modify the Action catalog, binary, release profile, compiled bytes or
production code to make a synthetic fixture pass. Ordinary single-route V2 and
Gateway V4 remain separate; do not add a V2 capability to the reviewer plan.

### Finite verification and publication

Run scoped format/lint and the existing **four-case file** against exact A3 and
a matching disposable 157-entry database when the prepared local environment
can support it; no installs, new database framework or broad local rerun.
If a new failure remains, diagnose it before changing scope or assertions.
Verify all protected S2 runtime/canonical/wrapper/schema/SQL bytes remain exact.
After peer review, root commits/pushes the fixture correction immediately and
the unchanged existing full CI/Unified gates qualify that final descendant,
including the six-file paired gate's actual observed count. Preserve both
failed P3 receipts; do not relabel them as a green run or invent a live result.

Canonical/export source stays S2 `8080881802d87f3bf700b15faa7cebb02f54ee9b`;
Action stays A3 and the canonical pin stays unchanged. A plan/fixture-only
SaaS descendant requires no re-export, wrapper rebuild or hash loop. This adds
no migration, version, flag, runtime contract, release registration or rollout.

| Fixture-plan round | Action critic                    | Acceptance critic                | Disposition                                                                                                                                                      |
| ------------------ | -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                  | **GO**, no P1/P2 findings.       | **GO**, no findings.             | Both critics confirmed the metadata404/pre-child cause, mixed-only qualified default and preserved four-scenario intent; no fixture edits.                       |
| 2                  | **GO**, no findings.             | **GO**, no findings.             | Mixed-only v5 default, explicit Codex alternative, V4 authority/no borrowed V2 capability and synthetic proof boundary rechecked unchanged.                      |
| 3                  | **GO**, no blockers or findings. | **GO**, no blockers or findings. | Final one-file scope, finite verification, unchanged S2/A3 and protected bytes, preserved failures and required CI rechecked; publish plan before fixture edits. |

## 14. Mixed empty Skills capture alignment

Status: **all three brief Action/Acceptance plan rounds GO; frozen for root publication before implementation**.

F1 `fb2975ca53cef3df9ad36d949ad4586b5dd96026`
[Source/Certification job 123620188505](https://github.com/777genius/review-router-ai/actions/runs/40922780536/job/123620188505)
reported **43 passed / 1 failed / 0 skipped** in the six-file gate. The three
original supplied-diff Gateway scenarios now pass. Only the strengthened
mixed-engine case fails, at authorization before checkout/model work:
`review_skills_capture_required`. Preserve that failed receipt; section 13's
metadata repair and current qualified v5/default assertions remain intact.

### Proven owner mismatch and delivery boundary

The harness uses the actual `composeReviewActionV2ProductionRoutes`, which
already instantiates `ProductionReviewSkillsSnapshot`, supplies the capture port,
and installs its prelock/current-selection admission fence. This is not an
omitted harness port. The production adapter calls the real Skills admission
capture first, then returns `null` for an empty selection whenever any reviewer
lacks Skills1. The authorization domain requires a non-null frozen capture
whenever any V4 reviewer has Skills1. Legacy supplied-diff Codex plus qualified
v5 therefore contradict those two predicates despite an authentic empty
selection.

Delivery is already child-scoped: `createReviewRunSkillsReader` requires the
exact V4 reviewer selector, checks that selected profile's Skills1 capability,
and returns only its authorization's base-bound frozen document. Action A3
fetches for the first Skills-capable reviewer and permits a legacy child only
when the shared capture is empty; it rejects nonempty delivery to that child.
Keep those guards, the domain requirement, real capture, base SHA, locking,
current authority and restore semantics unchanged. No fake empty document or
capability downgrade is allowed.

### Minimal implementation and regression scope

Only three implementation/test files are owned after publication:

1. `apps/api/src/review-run-skills-snapshot.ts`: align the existing capture
   decision after real `admission.capture`. At least one Skills1 reviewer plus an
   authentic **empty** selection uses the existing canonical capture builder.
   A **nonempty** selection with any unsupported reviewer retains the existing
   `skills_engine_unsupported` denial. No Skills1 reviewer plus empty selection
   retains `null`; all-supporting behavior is unchanged. Change no port, stored
   document format, domain invariant, reader, fence or policy authority.
2. `apps/api/src/review-run-skills.postgres.test.ts`: extend the existing real-PG
   owner case that captures Git roots and rejects unsupported producers. Keep
   its current positive/negative checks; add mixed nonempty denial, then remove
   the selected roots through the existing service and verify real mixed empty
   capture is canonical/base-bound while legacy-only empty stays null. Use
   existing helpers and the real capture owner; no mocked selection or new test
   platform. The existing compiled mixed case verifies full authorization and
   execution on the qualified v5 path.
3. `apps/api/src/gateway-multi-reviewers-paired.e2e.test.ts`: register the existing
   `registerReviewRunSkillsRoute(app, fixture.routes.reviewSkills!)`, exactly as
   the passing lifecycle fixture does. This wires the real frozen reader for
   the predictable post-checkout Skills request; it adds no fake capture, custom
   port or new endpoint implementation. Preserve v5/default/no-V2-cap and every
   existing model, allocation, allowance, child-isolation and App assertion.

These are an intentional API adapter correction and its existing owner/paired
regressions. Do not claim every production byte is unchanged. Before freezing,
verify this owner is outside both the canonical generator/export source surface
and the curated wrapper dependency surface; independently rehash the unchanged
canonical64/root index, exact curated8, schema/SQL and previous protected packet.
If that boundary does not hold, report it before any artifact/source movement.
When it does hold, canonical export remains S2 and Action/pin remain A3; no
re-export, wrapper rebuild or hash loop is needed. No Action source, profile
version/capability, transport/auth union, migration, flag or rollout is added.

### Finite verification and reviews

Run scoped lint/format and meaningful existing owner/mixed regressions when the
prepared environment is safe. The known local PG is unavailable and memory/disk
pressure forbids starting a replacement stack; state any unrun local PG result
explicitly and use the unchanged required hosted Skills-PG and six-file gates.
Do not weaken or skip those gates. Root publishes the reviewed plan before code,
then promptly commits/pushes the peer-reviewed coherent fix. Current CI/PR
results qualify the final descendant; earlier 40/4 and 43/1 results remain
failures. Live/provider/deployment and separate #734 boundaries do not change.

| Skills-alignment round | Action critic                    | Acceptance critic                | Disposition                                                                                                                                       |
| ---------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                      | **GO**, no findings.             | **GO**, no findings.             | Both critics verified the actual production owner mismatch, authentic selection and unchanged authority/delivery guards; no implementation edits. |
| 2                      | **GO**, no findings.             | **GO**, no findings.             | Real-PG empty/nonempty regression, three-file scope, existing reader route and explicit artifact boundary rechecked; no new delivery seam found.  |
| 3                      | **GO**, no blockers or findings. | **GO**, no blockers or findings. | Final authentic capture/authority guards, three-file regressions and conditional artifact boundary rechecked; publish plan before implementation. |
