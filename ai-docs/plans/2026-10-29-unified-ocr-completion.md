# Unified OCR: bounded completion plan

Status: three plan rounds with two critic roles are complete; implementation,
main integration and canonical source handoff are committed in **S**
`dccf5b628680bd7f3f8c9501e3108e432053495b`. Local controlled qualification is
recorded in the [acceptance record](../operations/2026-10-27-unified-ocr-acceptance.md).
Published current-main merge **M** is `841f44f0900409692559286cdbb00ac319a40664`.
Final M/A CI remains pending. Source implementation review rounds and the final
documentation critic recheck returned GO; both P2 wording findings are closed. The existing
[product plan](2026-10-26-unified-ocr-review.md) remains
the scope and behavior contract; this document closes the current integration
and acceptance gaps. Root owns GitHub publication and the existing draft PRs
[SaaS #718](https://github.com/777genius/review-router-ai/pull/718) and
[Action #346](https://github.com/777genius/review-router/pull/346).

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

## 10. Implementation review and qualification checkpoint

| Round | Review scope                                              | Recorded disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Action/SaaS cross-review and acceptance fidelity          | Core source/transport/receipt boundaries accepted. P2: comparison witness opened before harness setup cleanup ownership; corrected in **S**, then comparison 1/1 passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2     | Default profile/readiness and committed artifact delivery | Acceptance **GO**: exact v5 defaults, finite routes, immutable pins versus Gateway channel and no new migration/framework. Action delivery P2: CI `npm ci` prepare rebuilt `dist` before the actual-artifact tests. Correction locally verified: restore tracked `dist` after install and assert entrypoint bytes against the Git HEAD blob; existing three cases passed again on committed runtime bytes, all ten runtime hashes unchanged. Corrected Action `cfe2b78...` / SaaS pin `ff033fd...` published; final CI pending. Source implementation reviews returned GO; documentation recheck returned GO, both P2 wording findings closed. |
| 3     | Final pair after CI                                       | Source implementation and final documentation recheck GO; both P2 wording findings closed. Full published **M/A** CI remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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
`cfe2b78fba925e3e7741d8c7f479324aa785d12b`; canonical source **S** is unchanged. The pending final CI/review gate is followed only by designated
live credentials and separately authorized release/registration/environment
verification. Optional memory/conversation still depends on #734 as described
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
