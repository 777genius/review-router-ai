# Production review failure fixes and bounded accepted-source recovery

- Task ID: `2026-11-27-production-review-failure-fixes`
- Goal: respect GitHub retry boundaries, identify the failed companion settlement
  operation and preserve finite incomplete-review causes through evidence and
  publication; recover an exact accepted original finding result within its
  original authority, without replaying provider work or changing coverage.
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
  accepted-source recovery changes. The `1e8a6835` source/build checkpoint passed;
  generated runtime is now present in `f0fb4d4d`. Current-head reproducibility
  and paired qualification of the later cold fixture remain pending.
  [Native #8](https://github.com/agent-teams-ai/sub2api-standalone/pull/8) and
  [Gateway #125](https://github.com/agent-teams-ai/account-gateway/pull/125) have
  qualified the active non-entry proof producer. The corresponding RR/Action
  retry consumer remains unpublished and must not be activated by this record.
- Last updated: `2026-11-27`.

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
recovery need no SQL migration, new feature flag or budget increase. Any later
native-retry consumer checkpoint must update this record with its own additive
migration and exact dependency/qualification order before rollout. The existing
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
2. Deploy compatible ReviewRouter API and worker/evidence readers as one
   coherent batch. Existing producers remain compatible. Before any Action
   activation that emits the new causes, verify all readers accept the three
   new persisted values and record the compatible rollback floor.
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
8. Use the official protocol generator/check/export and Action bundle gates.
   Activate the qualified Action only after the reader-first prerequisite,
   through the separately authorized release process. Confirm healthy and
   partial reviews retain their existing progress outcomes before completion.

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
unpublished native-retry consumer or release unknown native custody. Action
source corrections do not activate a new runtime until its generated bundle
and release prerequisites are complete.

## Retry, partial completion, and rollback

Ordinary code rollback follows the release runbook. Once the new cause values
are persisted, every retained API/worker rollback image must decode them; an
older reader that rejects these values is not a compatible rollback. There is
no SQL schema or destructive data rollback. Preserve spent dispatch claims,
unknown effects, retained native custody, partial findings and their causes.

Do not replay customer reviews or model requests to verify this change.
A retry of the original rejected native request remains prohibited by its
existing contract. Reconcile any partially installed fleet before resuming.

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

## Source qualification checkpoint

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

The official Action build for source `1e8a6835` was imported unchanged as
`f0fb4d4dcc6871ba9a7a89b1c650c4f99a98f593` after artifact SHA-256 and complete
source-tree provenance verification. The paired CI pin now selects this
consumer, and the existing real PostgreSQL/compiled public-runner fixture
includes the accepted-result crash/restore boundary. Source lint and format
passed; final consumer CI and that new execution oracle remain pending.
Detailed run, artifact and original-source bindings are retained in the
[implementation checkpoint](../plans/2026-11-27-production-review-failure-implementation.md#compiled-consumer-qualification-checkpoint).
No deployed version, release registration or original request authority changed.
