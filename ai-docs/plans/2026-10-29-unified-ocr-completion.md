# Unified OCR: bounded completion plan

Status: proposed completion plan, awaiting independent critic rounds. No product
implementation is approved by this document until the blocking plan findings
are closed. The existing [product plan](2026-10-26-unified-ocr-review.md) remains
the scope and behavior contract; this document closes the current integration
and acceptance gaps. Root owns GitHub publication and the existing draft PRs
[SaaS #718](https://github.com/777genius/review-router-ai/pull/718) and
[Action #346](https://github.com/777genius/review-router/pull/346).

## 1. Current observations and limits

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
  both `scopedModelInvocations` and `memoryAdmission`.

These are source observations and reported failures, not newly passed checks.
Live provider qualification still needs the owner's designated credentials.

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
main's admitted `memoryAdmission`. Preserve existing Skills and memory
interfaces. Do not copy the review scenario into provider entrypoints.

Combine the feature's native Anthropic OCR patch with main's opaque-template
patch in the existing ordered patch/build system. Inspect the combined patch
application and regenerate its real reproducibility receipt. Use one unique,
unpublished managed artifact/version identity after checking the existing
catalog; never overwrite released `1.13.1-rr.5`, an old manifest, or immutable
binary bytes. Keep the pinned upstream source/toolchain explicit. Rebuild and
verify the actual OCR binary and qualify native wire behavior with that exact
combined artifact.

Touch the conflicting runner, existing OCR patch/version/manifest definitions,
their existing qualification tests, canonical exported contract/wrapper inputs,
and generated `dist/*` only where the established scripts produce changes.
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

| Prepared route | Full runner proof |
| --- | --- |
| Account Gateway | Retain and rerun the existing full-runner proof, including a qualified dynamic saved-model selection. |
| OpenRouter API key | Add the same real two-head runner scenario through the existing controlled direct route. |
| MiMo Token Plan API key | Add the same scenario with its existing endpoint/model/settings constraints. |
| Kimi Code API key | Add the same scenario with its existing endpoint/model/settings constraints. |
| Repository Codex subscription | Use the existing official auth-only refresh and encrypted writeback preparation, then the same runner. |
| Hosted Codex Pool | Preserve the original bound grant/lease/account/model and exercise the same V2 runner and publication. |
| Claude Code subscription | Exercise the native Anthropic route with the combined real OCR artifact and existing opaque token lifetime rules. |

For each route, head A publishes new findings; head B proves a fix, retains an
active finding, leaves an unprovable finding unverified, discovers a new issue,
and resolves only the eligible proven fix. Assert the original account/model/
route for discovery and verifier, shared durable allowance, accepted usage and
model receipts, configured App author identity, and completed replay with no
new paid or GitHub effects. Managed API-key provisioning is a focused existing
provisioning test, not another identical transport row. The explicit supported
supplied-diff Codex alternative gets a focused regression, not an invented OCR
supplied-diff mode.

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

1. Finish source and fixture changes; run focused SaaS checks, actual API/worker
   builds, generated-contract checks, and required architecture/lint/format
   gates. Build canonical SaaS artifacts and commit the frozen source as **S**.
2. Finish Action main integration. Export contracts and sync the curated public
   wrapper from exact committed **S** with existing scripts. Build/qualify the
   combined immutable OCR artifact, run Action typecheck/lint/tests/artifact
   checks, rebuild committed bundles, and commit the Action as **A**.
3. Run complete paired acceptance against exact **S/A**, including common 18,
   all finite full-runner routes, comparison publication, adapter faults, and
   actual Next screenshots. Fix concrete failures and deliberately recreate
   the source handoff if executable source changes; do not fake provenance.
4. Set the canonical SaaS CI Action pin to **A** in a metadata-only descendant
   **P** of **S**. Record that generated inputs/wrapper still come from **S**.
   Do not re-export only because the pin/documentation commit changed the SHA.
5. Run the final required SaaS CI and paired gates on **P/A**, verify exported
   content/provenance and committed bundle parity, and record exact SHAs,
   commands, run links, pass/skip counts and inspected screenshots. A skip is
   not a pass. Keep fresh remote-head checks before each push.
6. Reconcile the checkpoint, acceptance evidence and existing deployment
   task/index. Distinguish implemented, synthetic E2E verified, real executable
   qualified, browser inspected, live verified, and deployed. Root commits and
   pushes each coherent slice to the existing draft PRs as authorized.

If required credentials prevent final live checks, finish all other authorized
work and record the exact remaining live gate. Do not label synthetic success
as complete live acceptance or deployment.

## 7. Critic rounds and implementation gate

Two independent cross-critic rounds are required before product edits. Use a
third round only for a substantial unresolved correction; close every blocking
finding and record its recheck before implementation. Reviewers assess both
the smallest safe scope and whether the final evidence proves the stated
behavior. A pending review is not approval.

| Round | Focus | Reviewer verdicts and finding disposition |
| --- | --- | --- |
| 1 | SaaS/Gateway policy, Action merge/artifact identity, finite acceptance coverage and final-pair provenance. | Pending independent Action and acceptance critics. |
| 2 | Recheck round-1 corrections; auth/budget/publication fences; no-users scope; reproducible final validation order. | Pending. |
| 3, if needed | Recheck only material unresolved findings introduced by the prior correction. | Not started; use only if needed. |

Implementation review follows the tested final changes, with exact file/line
findings and meaningful rechecks. Do not carry historical plan GO verdicts
forward as approval of this completion plan or its implementation.
