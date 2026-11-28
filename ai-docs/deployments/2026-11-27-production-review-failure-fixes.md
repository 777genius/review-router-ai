# Review failure fixes, accepted-source recovery and attested request retry

- Task ID: `2026-11-27-production-review-failure-fixes`
- Goal: respect GitHub retry boundaries, identify the failed companion settlement
  operation and preserve finite incomplete-review causes through evidence and
  publication; recover an exact accepted original finding result within its
  original authority, without replaying provider work or changing coverage.
  Permit one fresh successor for an individually attested native admission
  conflict within the same original model request authority and spent budget.
- Affected services/targets: ReviewRouter API, workers and evidence readers,
  consumers of its GitHub revision-read adapter, and the public Action.
- Implementation PR: [#1028](https://github.com/777genius/review-router-ai/pull/1028).
- Initial implementation reference: `dd17dc481b7d2dadbc62be734d2858de5c51da71`.
  The candidate also includes the later leap-second correction and custody
  regressions. Use the final PR head recorded in its description for exact-source
  qualification; the initial commit alone is not the final candidate.
- Dependencies: existing compatible runtime/producer and ordinary release gates.
  [Action #411](https://github.com/777genius/review-router/pull/411) contains the
  independent GitHub wait, completed-output preservation, cancellation and
  accepted-source recovery changes. Source `ccbcabb8` passed the official
  source, test and build steps; at that checkpoint its exact generated artifact still needed normal
  provenance verification and committed-runtime integration. Earlier bundle
  `b2227915` was the paired fixture pin then. The current immutable Action
  source and qualification are recorded in the 2026-11-28 checkpoint below.
  [Native #8](https://github.com/agent-teams-ai/sub2api-standalone/pull/8) and
  [Gateway #125](https://github.com/agent-teams-ai/account-gateway/pull/125) have
  qualified the non-entry proof producer source. The RR/Action consumer
  checkpoint adds the bounded retry path; final joined compiled qualification
  and separate ordinary producer activation remain required. Both producer PRs
  were merged by their owner with source-equivalent trees and passing post-merge
  checks. A merge does not establish deployment or active fleet configuration.
- Last updated: `2026-11-28`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                   |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Qualify final PR source, then use the ordinary authorized release path |
| production           | `pending` | Not verified                    | Not verified        | Staging acceptance and ordinary release prerequisites remain required  |

Pending does not assert that older related changes are absent. This task does
not grant deployment permission.

## Applicability and prerequisites

The release must contain the rate-wait correction and companion diagnostic
changes from this PR. Reconcile fleet version and existing unfinished tasks
before an authorized rollout. The published RR corrections and accepted-source
recovery need no SQL migration, new feature flag or budget increase. The native
retry checkpoint additionally needs migration `000165_attested_model_request_retry`
and the ordered dependency/qualification steps below. The existing
quality-flags field gains three accepted values;
this semantic contract extension requires compatible API and worker readers
before the corresponding Action producer is activated.

Required evidence: focused GitHub transport and companion failure-injection
tests; relevant static/type/architecture checks; existing real PostgreSQL
admission/settlement and paired Action regression checks at the accepted source.
Draft CI aggregation with skipped lanes is not runtime qualification.

## Ordered rollout

1. Use the existing [release procedure](../operations/07-environments-and-release-management.md)
   after the normal source/review/CI gates. Record the exact source/image.
   Qualify the exact Native/Gateway proof producer and packed SDK, then apply
   `000165_attested_model_request_retry` through the approved migration path
   before the reader batch below. Even with retry disabled, these Prisma readers
   select the new nullable `nativeRetryProofJson` and `retryOfDispatchId`
   columns. Verify those columns, the unique predecessor-use index and bounded
   scope check before proceeding.
2. Deploy compatible ReviewRouter API and worker/evidence readers as one
   coherent batch only after the schema expansion in step 1. Existing producers
   remain compatible. Before any Action activation that emits the new causes,
   verify all readers accept the three new persisted values and record the
   compatible rollback floor.
3. In isolated staging fixtures, verify that GitHub waits do not precede either
   announced primary/reset boundary and that a wait outside the read deadline
   refuses without another read, including valid leap-second dates.
4. Inject status-read, usage-outcome and companion-settlement failures after
   stream EOF. Confirm the corresponding phase, allowlisted HTTP/category
   detail, uncertain settlement, no successful terminal and no additional model
   request. Verify a throwing diagnostic sink does not change cleanup.
5. Qualify retained-close pressure after all eight background retries and
   expired-credential refusal. An unconfirmed close retains the slot; an applied
   close before the original deadline permits the next admission. Preserve the
   original close identity and verify that inference is not repeated.
6. Qualify the rebuilt Action with the paired compiled-entrypoint/PostgreSQL
   fixture: a failed phase with full path coverage keeps its useful finding and
   publishes the finite reason; a preserved filter remains advisory. Require
   unchanged server work completion, partial producer coverage where applicable,
   and no baseline advancement for incomplete coverage.
7. Qualify accepted-source recovery with the exact official public runner and
   real PostgreSQL before enabling its new Action implementation. Require an
   applied original source-lease release, a held acknowledgement and process
   termination before Gateway cleanup. A cold invocation must discover and
   adopt the exact accepted source with no new provider request, dispatch,
   preparation, execution start or provider lease; the existing adoption term
   is allowed. The real old-reader compatibility gate must remain passing.
8. With the migration from step 1 applied and readers from step 2 deployed,
   verify the compatible RR claim/receipt/relay consumer before registering or
   selecting `model-dispatch-policy.native-retry.v1`. Preserve the legacy and
   capacity128 release identities and their complete contract tuples.
9. Use the official protocol generator/check/export and Action bundle gates,
   then execute the existing joined native consumer oracle with that official
   Action bundle and real PostgreSQL in private and public modes on each
   pinned Node 24/26 version. Preserve a prior paid turn, hold the
   original rejected request's actual close acknowledgement, and require zero
   RR proof reads before closure. After closure require one authenticated proof
   read, exactly one fresh successor with identical bytes/route and three charged
   requests total. Negative proof, lost original custody, unknown effect,
   expired authority, exhausted budget, changed body/route and further retry
   must produce no additional native request or preparation. Record passing
   receipts for all four executions against the exact qualified sources and
   bundle. Missing or skipped cases do not qualify activation.
10. Only after the reader-first prerequisite and the passing joined receipts from
    step 9, register or select the new native-retry policy and activate the
    qualified Action through the separately authorized release process.
    Confirm healthy and partial reviews retain their existing progress outcomes
    before completion.

## Accepted incomplete-review causes

The closed values `review_main_incomplete`, `review_round_incomplete` and
`review_phase_incomplete` refine `context_inspection_incomplete`; none is
accepted or restored without that existing flag. They add no reuse penalty and
remain immutable attempt metadata. Retrying the same attempt with different
flags conflicts rather than rewriting its accepted observation.

The Action maps only finite classifications and structured phase states.
A failed filter with `filterDecisionValid: false` remains advisory even beside
an unrelated round, normalization or path gap. Genuine non-filter failures,
non-preserved filter failures and compression stops retain their phase cause.
Required accepted lanes contribute these causes to the existing localized
incomplete-summary section. Raw native prose remains local.

The wire field and envelope are unchanged; official generation and handoff
checks must establish the actual exported bytes. Tests and rebuilt artifacts
qualify source behavior separately from deployment or producer activation.

## Verification and completion

Use the [implementation acceptance matrix](../plans/2026-11-27-production-review-failure-implementation.md#acceptance-matrix).
Preserve secret-free evidence and actual versions separately per environment.

This correction improves RR behavior and attribution. It does not prove the
root cause of every historical 502, eliminate long GitHub quotas, qualify the
native-retry consumer without its joined oracle or release unknown native custody. Action
source corrections do not activate a new runtime until its generated bundle
and release prerequisites are complete.

## Retry, partial completion, and rollback

Ordinary code rollback follows the release runbook. Once the new cause values
are persisted, every retained API/worker rollback image must decode them; an
older reader that rejects these values is not a compatible rollback. There is
no destructive data rollback. Keep the additive retry columns/index and preserve
immutable proof, lineage, spent dispatch claims,
unknown effects, retained native custody, partial findings and their causes.

Do not replay customer reviews or model requests to verify this change.
The original rejected native request remains spent and keeps `retry.never`.
Only a separately admitted successor may use the new immutable capability.
Before activating it, record a rollback floor that understands the new profile
and its receipt fields. An older server can reject a new profile; nullable SQL
columns do not make that server a compatible reader. Roll back producers to a
qualified old profile before removing new readers, preserve/drain original
in-flight authority, and never translate retained native proof into legacy
`local_before_forward`. Reconcile a partially installed fleet before resuming.

## Attested request retry scope

The consumer is limited to `finding_discovery` on the existing V3 single
prepared `account_gateway` route. Other transport declarations remain available
with their existing capacity policy; V4 allocations and auxiliary roles do not
gain a retry. The same original prepared ExecutionClient supplies the pinned
origin and execution bearer. Gateway enforces consumer scope; RR binds exact
execution/request identities and stores the finite returned consumer ID only
as provenance. No new consumer configuration, client reconstruction, authority
renewal, preparation or scheduled wakeup is introduced for a successor.

Current RR authority, original lease/fence and retained Gateway custody are
required at receipt visibility, successor claim and forwarding. A rejected
root cannot be relabeled as an ordinary next turn by omitting lineage. The
original proof stays immutable, and a successor cannot acquire another retry.
Both runner and native unknown effects remain fenced.

## Accepted original result: rollout boundary

RR `fc7503f4` and Action `5f3ea626` add the bounded source-discovery/adoption
path. A computed `persistedPlan.unattachedAcceptedManifests` hint does not
change original canonical plan or assignment bytes. Only the original Running
execution and its Exhausted single-attempt finding slot may supply the exact
accepted source from the original Released/Expired provider lease, within the
original reporting window.

The Action restores a read-only invocation and requires the ordinary exact
same-execution lookup plus fresh-CAS adoption. Missing, ambiguous, changed or
failed source proof stops before provider admission or fallback. A known hint
cannot disappear into a new paid attempt. Retain original authorization,
revision, lease/fence/owner, immutable payload and hard deadline.

The existing `gateway-multi-reviewers-paired.e2e.test.ts` fixture owns the
single cold scenario, `accepted-result-recovery`. It runs the unchanged
official `dist/index.js` against real RR HTTP/SQL with the fixture's existing
synthetic Codex engine. The second public process receives a separate Git
clone, HOME, temporary directory and output file, and the same original
deadline; no accepted-source IDs or prior local result files are supplied.
The normal paired CI invocation must report that exact case once as passed,
with no failed tests. A skipped or missing case is not qualification.
The proposed alternate lifecycle scenario and setup driver are not retained.
Execution of this exact new oracle remains pending.

This capability needs an explicit later invocation before original Gateway
cleanup. It adds no durable wake-up, recovery after normal transport closure or
authority extension. Broader recovery remains with its existing owner in #1021.

## Cold recovery and progress qualification (2026-11-28)

The paired candidate uses immutable Action
`1ce5d0abc8300d024ec75c556df1ebbb41c3cbe7`. Its complete runtime tree equals
the owner-merged Action `519026120e1769a9ff1f3ca8f26341f983969b5a`, while
retaining the handoff's required ancestry through
`36bf99ae7fba5553a428eeb1e641945e7afa99ac`. The ancestry verifier remains
required; runtime tree equality alone does not satisfy that contract.

The [Source run on RR `85719b03`](https://github.com/777genius/review-router-ai/actions/runs/46131214658/job/140954121988)
passed 47 paired cases and failed the accepted-result cold case. The two
separately selected joined cases were not executed there, and the later four
joined executions did not run. Captured-v4 restoration reached the original
accepted source and same-execution lookup. Two identical adoption requests
returned `500 ambiguous_outcome / handler_failed`; only the two original
provider children completed, with no repeated inference.

Source review identified an incompatible progress guard inside the adoption
transaction. The allowed Exhausted-to-Satisfied transition reduces the current
exhausted count while increasing completed work. Progress now retains the
completed-plus-exhausted total separately for required and optional work,
instead of requiring each exhausted count to grow forever. A completion in
one cohort cannot hide a regression in the other. The existing completed,
cancelled, recovered, identity, generation, timestamp, phase, terminal and
file-coverage guards remain in force.

This correction uses the existing progress snapshot and schema. It adds no
migration, configuration, feature flag, new provider attempt or authority
extension. Ship the ordinary API/worker code batch after its normal checks.
Ten domain regressions cover accepted recovery and rejected reopening,
cancellation and cross-cohort compensation. One additional production
PostgreSQL case verifies atomic progress advancement, exactly one semantic
attempt, replay without another write and unchanged original source lease.
The existing production cases and compiled cold-recovery authority and
no-replay oracles are retained.

The [native qualification of candidate `1e40b748`](https://github.com/777genius/review-router-ai/actions/runs/46146653437/job/140984071063)
passed progress/API types and all 34 domain tests, with no skipped tests.
The native formatter required one property-access line wrap in the new
PostgreSQL case. Its idempotent canonical output was imported as Git blob
`5825f3be89b9126f0fe654c2f5ef64dcb7b63ad8`; all non-whitespace bytes
and all existing assertions are unchanged. The original native job remains
failed on that format check; the canonical correction is part of this source.

The [separate original diagnostic run](https://github.com/777genius/review-router-ai/actions/runs/46145204735/job/140979637328)
on owner source `0c8544b2` reproduced `progress_count_regressed` inside
the adoption transaction. Both failed requests retained the same original
request identity; one selected cold case failed and eight other cases were
unselected. The original failed result remains recorded.

The [focused PostgreSQL and compiled cold run](https://github.com/777genius/review-router-ai/actions/runs/46145764941/job/140981373033)
on candidate `1e40b748` passed all 34 domain and 19 production PostgreSQL
cases, including exhausted-slot adoption and exact replay. Its original
format failure predates the canonical output imported above. The cold
process then restored the completed execution and passed the original
no-new-admission, dispatch, request, provider-lease, evidence and authority
checks. It failed the later generic catalog-read count: two fresh public
Action processes produced four reads, while the single-process expectation
allowed only two. This run is not a complete cold-recovery pass.

Each Action bootstrap checks out its Gateway binding and reads the selected
account models. These authenticated catalog reads do not dispatch inference.
The fixture now captures the two original full model-selection requests
before termination, requires the retained request prefix to stay identical,
and requires exactly one additional identical selection for each account.
Only the accepted-result cold scenario expects four total catalog reads;
all other scenario counts and all paid-effect and publication assertions
remain unchanged.

The corrected cold fixture, its receipt verifier, current-head CI and all
four original joined Node/mode executions still require successful execution.
Neither a focused PostgreSQL pass nor the earlier failed cold run replaces
those gates.

## Earlier source qualification checkpoint (2026-11-27)

- Native source `f6e05bf4` was merged as `157b07f2` with the same complete
  tree; all 16 post-merge checks passed. Gateway source `90739814` was merged
  as `b181fe3a` with the same complete tree; all 23 source checks and both
  post-merge checks passed.
- RR uses the official SDK archive from Gateway `90739814`, with its source
  provenance and integrity recorded under `vendor/account-gateway/`. The
  committed archive digest matches the recorded SHA-256; this does not replace
  the final consumer gates.
- [Action source `ccbcabb8`](https://github.com/777genius/review-router/actions/runs/46066994364)
  passed lint, retained and strict TypeScript 7.0.2, the required test step,
  native OCR MCP and the official build. Committed-runtime freshness failed
  because the earlier `b2227915` bundle is still tracked. Official artifact
  `15231463229` has archive SHA-256
  `0c1087e9d182de9a324fd997518abbe5375cecea4f6c9d2e16656b628d4c0ecc`;
  its normal extraction, source provenance verification and exact generated
  file integration remain pending. The build checkout and source commit have
  the same complete tree. The separate real-CLI qualification passed all
  three suites and 21 tests.
- Final RR own-repository CI, accepted-result cold recovery and the joined
  private/public Node 24/26 consumer gates must use the qualified final Action
  bundle. Earlier passes do not qualify later source changes. Current exact
  heads and outstanding checks are recorded in PR #1028 and Action #411.

## Historical source qualification checkpoints

- [Action `1e8a6835`](https://github.com/777genius/review-router/actions/runs/46051135263)
  passed lint, retained and strict TypeScript 7.0.2, full Jest with the immutable
  pre-change restore reader, native OCR MCP and the official build. Only
  committed-runtime freshness failed. Official artifact `15225485338` retains
  the generated files and checkout provenance; archive SHA-256 is
  `d541340361d10f1346fdbdd8156fe43c98066eb9d26664c461aacab6c4924a4f`.
  Commit `f0fb4d4d` adds the generated runtime; its build checkout and reviewed
  source have the same complete tree. Current-head reproducibility is still
  required. Action `5bcf65db` removes the unused alternate cold setup driver;
  its complete tree equals `f0fb4d4d`. Neither source build qualifies the
  existing public-entrypoint cold fixture.
- [Gateway package `8563fe86`](https://github.com/agent-teams-ai/account-gateway/actions/runs/46046364093)
  passed both pinned Node lanes, all 106 tests, strict types, Foundation/docs,
  packing and installed consumers. Official SDK archives still require normal
  extraction, provenance verification and exact RR dependency/lock integration.
- Gateway `305fedb5` has all 23 current checks passing, including both pinned
  native-client Node lanes and the existing producer/rollback gates.
  [Its browser caller](https://github.com/agent-teams-ai/account-gateway/actions/runs/46049610770/job/140677839862)
  qualified RR `b832f80a`: 40 captures, all three setup/connection flows and
  the separate native-visibility flow passed. No capture failed or skipped.
- Current RR own-repository CI, real accepted-source readback, official protocol
  export, final bundle and compiled paired consumer gates remain distinct.
  Earlier source/build/browser results do not establish these later gates.

## Related links

- [PR #1028](https://github.com/777genius/review-router-ai/pull/1028)
- [Dependent Action #411](https://github.com/777genius/review-router/pull/411)
- [Historical incident investigation](../plans/2026-11-27-production-review-failure-investigation.md)
- [Attested request retry dependencies](../plans/2026-11-27-attested-request-retry.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

No staging or production rollout has been performed for this task. Source
changes, code review and tests must be recorded separately from deployment.

At the earlier checkpoint, the official Action build for source `1e8a6835`
was imported unchanged as
`f0fb4d4dcc6871ba9a7a89b1c650c4f99a98f593` after artifact SHA-256 and complete
source-tree provenance verification. The paired CI pin selected that
consumer at that checkpoint. The existing real PostgreSQL/compiled public-runner
fixture includes the accepted-result crash/restore boundary. Source lint and format
passed at that checkpoint. Subsequent qualification status is recorded above;
the final consumer CI and exact execution oracles remain required.
Detailed run, artifact and original-source bindings are retained in the
[implementation checkpoint](../plans/2026-11-27-production-review-failure-implementation.md#compiled-consumer-qualification-checkpoint).
No deployed version, release registration or original request authority changed.
