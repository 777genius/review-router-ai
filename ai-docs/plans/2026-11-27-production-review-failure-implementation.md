# PR #1028: production review failure fixes and qualification

Status: reviewed plan; scoped runtime corrections implemented, qualification pending.
Owner request: fix the issues tracked by [PR #1028](https://github.com/777genius/review-router-ai/pull/1028), review and improve this plan before implementation, keep the ReviewRouter changes in this PR, and push each commit immediately.

## Source and outcome

Reviewed starting source: `1b73cfbb5fae6fb1551b94d3263feaca768cd7ae`.
The [incident investigation](2026-11-27-production-review-failure-investigation.md)
remains the historical evidence record. Its failures have several observed
causes or unknown boundaries; a failed merge gate with blocking findings is
not an infrastructure defect.

Deliver concrete ReviewRouter corrections with rejecting tests and exact-source
qualification. Preserve incomplete review results, provider-effect uncertainty,
existing request budgets, lease/fence admission and physical resource custody.

## Exact scope

1. Correct the existing GitHub revision-read adapter's wait calculation:
   all three HTTP-date forms and leap seconds in Retry-After, strict numeric/header
   validation, and the later
   applicable Retry-After/primary-quota reset. Preserve its single 15-second
   deadline, finite attempts, read-only operations and fail-closed revision guard.
2. Attribute companion EOF failures to native status readback, usage outcome
   persistence or companion dispatch settlement. Retain only allowlisted
   diagnostic fields; preserve current error, settlement, cleanup and no-replay
   behavior.
3. Verify the existing distinction between execution completion and review
   coverage. Keep useful partial findings, accurate coverage and incomplete
   progress; correct reporting only if an actual downstream regression is
   reproduced.
4. Record the required external work for attested request retry and the public
   Action GitHub-read policy. Do not count these dependencies as implemented by
   this PR.
5. Update deployment tracking and the PR description; run relevant existing
   transport, PostgreSQL and paired-Action regression checks at the final source.

No new retry scheduler, feature package, database schema, flags, request-budget
increase or provider implementation belongs to this correction. Keep the
separate webhook delivery work in #1027 and broad recovery work in #1021 with
their current owners.

## Verified findings and counterevidence

| Area                             | Verified source finding                                                                                            | Consequence                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| RR GitHub revision reads         | retryAfterMs parses Number(header); rateLimitWaitMs returns Retry-After before considering exhausted primary reset | Valid HTTP dates are missed; a short Retry-After can cause an early retry while primary quota remains exhausted |
| Companion EOF                    | phase remains native_status through usage.outcome and companionDispatches.settle                                   | Different failed boundaries are indistinguishable in the diagnostic                                             |
| Stream diagnostics               | SDK httpStatus is omitted; companion log discards existing safe HTTP/category/cancellation detail                  | Operators cannot distinguish the safe HTTP failure class already available                                      |
| Coverage                         | Accepted progress policy deliberately distinguishes completed execution from incomplete source coverage            | Do not change deriveCoverageState or falsely make partial coverage complete                                     |
| Native retry                     | Gateway non-entry and transport closure ACK are separate facts; ordinary rejected status says retry.kind=never     | RR cannot safely convert rejection into the existing local_before_forward proof                                 |
| Observed revision-guard incident | The recorded review_action_v2_revision_guard_unavailable is emitted by the separate public Action client           | An RR adapter correction alone does not prove that incident fixed                                               |

The reference worker GitHub policy already parses HTTP dates and combines quota
boundaries. Use its parsing semantics as evidence, while keeping the revision
adapter's interactive deadline policy. Importing apps/worker into a feature or
moving its durable scheduling behavior would expand the correction.

## Implementation sequence

### A. Existing GitHub read adapter

Change
`packages/features/review-run-control/src/infrastructure/github/octokit-github-review-revision-source.ts`
and its existing transport test.

- Parse trimmed decimal delta-seconds and all three HTTP-date forms from
  [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7), with a
  calendar round-trip check, leap-second normalization and the two-digit-year
  interpretation. A valid
  excessive delay or reset must exceed the deadline rather than become absent.
  Blank, negative, hexadecimal, exponential and malformed values are not an
  immediate retry instruction.
- Use the later valid Retry-After and exhausted-primary reset boundaries.
- A rate-limited answer with no usable wait retains the conservative one-minute
  fallback; it cannot fit the existing 15-second read deadline.
- A delay that does not fit the remaining deadline refuses immediately.
- Keep authentication/permission 403, invalid answers and ordinary 404 behavior.
- After a bounded retry the caller still validates the current revision;
  a moved PR remains rejected.

### B. Companion settlement diagnostics

Change `apps/api/src/review-run-gateway-relay.ts` and reuse the real loopback
Gateway/SDK/relay fixture in `review-run-gateway-byte-limits.test.ts`.

- Use the existing settle helper, with an optional local stage observer, to
  distinguish native_status, usage_outcome and companion_settlement.
- The phase belongs to each pull operation. Cancellation must not overwrite it.
- Read SDK httpStatus/status/statusCode through own data-property descriptors.
  Emit bounded HTTP status, existing SDK code, fixed error category and
  signalAborted; never messages, SQL/Prisma metadata, stacks, headers or payloads.
- A logger failure cannot change settlement, stream failure or cleanup.
- All failed persistence/status paths retain uncertainty and withhold a
  successful terminal response. Exactly one model POST is permitted.
- native_status describes the preparation status boundary, which also invokes
  authority checks; its label does not prove which database or upstream failed.

### C. Coverage and custody regression evidence

Reuse existing tests for completed execution with partial producer coverage,
incomplete published summary, no baseline advancement, terminal-frame gating,
client disconnect, retained native close and capacity pressure. Do not introduce
a status migration or change accepted coverage semantics without a reproduced
defect. HTTP EOF, cancellation and unknown close never prove released occupancy.

### D. Review and qualification

1. Review the original retry design for ownership and proof safety.
2. Critique this narrowed implementation plan independently for protocol,
   operational and testing gaps; incorporate accepted findings before code.
3. Review the resulting diff independently, fix every critical finding and
   review the corrections. Keep code review distinct from runtime qualification.
4. Push coherent commits immediately; keep this existing PR as the delivery.
5. Run focused transport/failure-injection tests and the repository's relevant
   static/type/architecture checks. Use the pinned toolchain.
6. Qualify the final source through existing CI, real PostgreSQL and paired
   Action regression lanes. Draft aggregates with skipped heavy jobs are not
   runtime evidence; the existing ready_for_review trigger starts those lanes.
7. Record exact source, actual results and unresolved dependencies. No new
   native retry canary or production remediation is claimed from RR regression
   fixtures.

The execution environment became unavailable during initial inspection.
GitHub read/write access remains usable. No local test result can be claimed
until a working runtime is available; remote CI is a separate execution path.

## Acceptance matrix

| Boundary                                              | Required observation                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| HTTP-date within read deadline                        | Read resumes after the announced boundary and returns the current revision  |
| HTTP-date or exhausted reset beyond deadline          | One request, no early retry                                                 |
| Conflicting Retry-After and primary reset             | Later boundary wins                                                         |
| Invalid/missing wait, ordinary permission 403         | Conservative refusal; no unauthorized retry                                 |
| Revision changes during wait                          | RevisionMoved/fail-closed remains effective                                 |
| Gateway status failure after EOF                      | native_status, safe HTTP detail, no successful terminal or replay           |
| Completed usage write fails                           | usage_outcome; unknown outcome retained; one model POST                     |
| Completed dispatch settlement fails                   | companion_settlement; unknown fallback retained; one model POST             |
| Throwing logger or secret-bearing exception           | Same failure/cleanup; no raw secret output or accessor invocation           |
| Healthy stream / client cancellation / retained close | Existing positive and negative transport tests remain valid                 |
| Finished execution with partial producer coverage     | Review remains incomplete, useful findings preserved, baseline not advanced |
| Old Gateway/producer                                  | Existing strict proof and no-retry semantics unchanged                      |

## Additional investigation received during implementation

Concurrent commits `3a7d20f5` and `3cb53583` expanded the historical incident
record while this implementation was being reviewed. Preserve both additions.
The follow-up source review found that the eight-attempt background close limit
is deliberate and tested: pressure recovery and the original deadline still
make exact-ID cleanup attempts. Neither expiry nor an unknown close releases
custody. The public Action returns PR-closed cancellation without a corresponding
server execution terminalization in the examined path; this is a concrete
reproduction lead for a green workflow followed by later expiry, not proof that
any cited run took that path. Preserve RR expiry/coverage semantics while the
explicit Action outcome/reason and run identity are investigated. Do not reuse
the after-expiry proof proposal rejected by automatic safety review.

## Follow-up source review and bounded custody checks

Concurrent documentation commits `46a9a89a` and `a1a79ff6` add a
[cross-execution investigation](2026-11-27-review-follow-up-multi-round.md).
Both additions are preserved; the earlier provider-effect and physical-close assumptions
remain unproven for a separately started review.

A fourth review pass found that valid HTTP leap-second dates could become
absent after the strict JavaScript calendar check. Normalize the final UTC
`23:59:60` through a validated `:59` and add one second, including in the
RFC 850 century comparison. Transport cases cover all three representations
inside the deadline and refuse a longer leap-second wait on both 403 and 503,
including when a shorter primary reset is present.

The existing real HTTP fixture now also exercises two concrete acceptance gaps:

- After the initial close and all eight background retries remain unknown,
  a distinct authorization under `maxSessions=1` attempts the exact original
  close and is refused. An applied close before the original deadline then
  frees the old slot and admits one new inference. Identity, reason, custody,
  publication authority and inference counts are independently asserted.
- After native close returns a structured expired-credential refusal at the
  original deadline, a distinct live authorization is still refused under
  pressure. No preparation-operation read, capability refresh or inference
  replay occurs. This is a controlled response fixture, not proof of actual
  native/PostgreSQL expiry behavior.

The Action wait fix is prepared in dependent
[public Action PR #411](https://github.com/777genius/review-router/pull/411),
source `3064adbb81b00d4b4359011310807c17101d140b`.
Its own 15-second accepted-wait policy is preserved. The source and tests
passed independent static review; official Node 24 regeneration of committed
`dist`, TypeScript 7.0.2 and all runtime gates remain pending. A source-only
Action draft does not change deployed behavior.

## External dependencies still required for the full incident goal

The [attested retry design](2026-11-27-attested-request-retry.md) is not
implemented by a diagnostic or header fix. Its owning source is outside this PR:

- Gateway/native must provide authenticated exact non-entry plus completed
  transport-closure evidence and trustworthy transient eligibility.
- RR must verify and persist a distinctly negotiated proof, bound to existing
  dispatch/body/route/native reference/current authority. Spent claims stay spent.
- The public Action must retry only the individual eligible request with a new
  ordinal/reference within the original budget and deadline. OCR attemptBudget
  stays 1; preceding model turns are never replayed.
- Lifecycle verification and PR description currently admit one request;
  do not silently broaden them. A first retry capability can retain those
  exclusions; widening them needs deliberate admission/evidence changes.
- The public Action's independent GitHubClient has its own wait policy. PR #411
  contains the source correction; generated bundle and runtime qualification
  still need a working build environment.
- Long waits beyond the interactive read window still require durable deferred
  recovery with current-revision and previous-effect revalidation. Conservative
  refusal in the header adapter does not implement or qualify that behavior.
- Exact incomplete-phase explanations need an intentional finite RR/Action
  vocabulary extension: the real RR receiver and persistence reader reject
  arbitrary quality flags despite the broad generated JSON schema. Existing
  flags do not distinguish these causes. Preserve immutable observation identity,
  reuse behavior and the advisory preserved-filter exception; qualify a
  compatible persistence reader and rollback target before producer activation.
- Require joined Gateway/native/PostgreSQL/Action fault injection and staged
  rollout before claiming safe native retry or production resolution.

One RR pull request cannot change those separate repositories. This remains an
explicit incomplete part of the requested outcome, not an implied success or
unused local adapter. Do not manufacture proof locally or copy native ownership.

## Estimates and engineering judgment

For the independent RR correction, excluding docs/generated code/deployment:
approximately 100-200 production/integration LOC and 300-600 test/fixture LOC,
1-3 focused engineer-days with a working test environment. Complexity 4/10
(higher is harder), expected reliability within this bounded scope 9/10,
confidence in fit 8/10. Estimate confidence is moderate. These are judgments,
not measured availability or a claim that all historical incidents are solved.

## Review record

- Round 1: three independent agents inspected retry proof/ownership, GitHub and
  coverage behavior, and transport/CI. Accepted: separate closure evidence;
  no generic rejection retry; no dormant proof scaffolding; preserve one-request
  role constraints; distinguish public Action ownership.
- Round 2: the concrete RR plan was circulated before implementation.
  Accepted: strict wait parsing and max boundary; local per-pull phase observer;
  SDK own-data httpStatus; tests assert no replay and unknown custody even when
  logging fails. Coverage change rejected after tracing accepted downstream
  partial projection.
- Round 3: independent implementation review accepted the diagnostics patch.
  Rate review found two additional P2 cases: obsolete HTTP dates and excessive
  valid numeric waits could become absent on 503. Corrected both, added
  rejecting transport cases and re-reviewed. Runtime qualification remains
  pending; static review does not establish test success.
- Round 4: independent review found and corrected the leap-second omission,
  reviewed the dependent Action patch and strengthened its long-date oracle.
  A separate reviewer accepted the pressure-after-budget and expired-capability
  fixtures; their exact counters prevent false success from an in-flight close.
  No runtime tests have executed.

- Round 5: CodeRabbit's completed source review raised four minor findings.
  Replace fixed event-loop yields with a held ninth HTTP close joined through
  the actual relay operation; observe past the next possible uncapped retry and
  count local close starts; require the deadline timer to initiate its first
  close before joining it; and choose the first valid own-data HTTP failure
  status instead of letting an invalid SDK field hide a valid fallback.
  Extend the existing EOF matrix to eight cases. Independent source review
  covers these corrections; execution evidence remains pending.
- A concurrent investigation identified the RFC 850 century rollover edge.
  Both read clients now derive the candidate century from the existing
  50-year future limit, retaining the exact timestamp/leap-second cutoff.
  The same HTTP 503 boundary regression covers 2099 to 2100 in both clients;
  normal 2026 interpretation is unchanged.

## Progress

- [x] Inspect initial PR source, instructions, incident evidence and ownership.
- [x] Write the bounded plan and incorporate initial independent criticism.
- [x] Implement GitHub wait correction and transport regressions.
- [x] Implement settlement diagnostics and failure-injection regressions.
- [x] Review complete diff and correct critical findings.
- [ ] Run exact-source static, PostgreSQL and E2E qualification.
- [ ] Record final validation and deployment applicability.
- [ ] Complete external native retry/public Action dependencies.

## Runtime evidence ledger

Initial runtime implementation commit: `dd17dc481b7d2dadbc62be734d2858de5c51da71`.
The subsequent leap-second and custody-test correction is part of the current
PR candidate; the exact current head and check links are recorded in the PR
description. Qualify the final head, not the initial implementation alone.
Source review: two independent reviewers found no remaining P0/P1/P2 in the
scoped implementation after corrections. Supplemental pure-JavaScript parser
probes are not Node/Vitest/typecheck/E2E evidence.

The settlement relay cases use the existing companion V1 in-memory admission fixture
with real loopback HTTP/SDK/Fastify streaming. They do not establish PostgreSQL
or V2 concurrency. The existing database and paired Action CI lanes must supply
those distinct results; no skipped or queued job counts as passed.

At qualification start, the existing self-hosted impact runner had no assigned
runner for this job, and this repository had queued runs dating to 04:23 UTC.
The existing `ci:github-hosted` PR label selects the workflow's supported hosted
fallback for applicable lanes; no workflow, required check or test was weakened.
Other lanes retain their configured runners and remain subject to actual results.

## Executable follow-up and precise phase reporting

The execution environment became available again on 2026-11-27. The first
actual Action run exposed a Jest callback-arity error in two optional-column
date rows. An explicit default on the first optional callback argument fixes
that error without changing the oracle. The standalone GitHub suite then passed
60 tests; four related Action suites passed 93 tests, and the documented strict
TypeScript 7.0.2 project check passed. Action lint reported no errors and its
existing warnings. The initial combined run killed with exit 137 is not a pass.

The RR HTTP transport suite passed 50 tests. The relay suite exposed an existing
timer-close test race: the next admission ran after the HTTP request counter
advanced but before relay cleanup settled. Hold each timer response, observe its
automatic start, join the exact close operation, release it, and await settlement.
The revised relay suite passed all 191 tests. These are local boundary results;
PostgreSQL, compiled paired Action, complete CI and rollout remain separate gates.

The next independent slice retains exact incomplete-phase explanations through
the existing accepted evidence and publication paths. Review found that local
OCR diagnostic prose is intentionally absent from canonical observations; only
the finite accepted quality vocabulary can carry this information safely.

### Scope and invariants

- Add exactly three explanatory quality flags: `review_main_incomplete`,
  `review_round_incomplete` and `review_phase_incomplete`. The RR domain accepts
  them only together with `context_inspection_incomplete`; retain duplicate,
  unknown-value and 16-item rejection. The Prisma reader accepts the same values.
- Give the explanatory flags zero additional reuse penalty. Existing incomplete
  context, coverage, accepted findings and baseline rules keep their authority.
  Same-attempt flag changes remain an immutable-evidence conflict.
- The Action maps only finite accepted classifications and structured native
  phase state. A preserved advisory filter must not acquire a phase-failure cause
  when another round or normalization problem exists. A real failed plan,
  compression or relocation phase, or a non-preserved failed filter, may explain
  existing incomplete context. Native prose never becomes canonical metadata.
- Required observations contribute these flags to the existing summary cause set.
  Optional reviewers do not make required coverage incomplete. Extend the existing
  summary vocabulary and all eleven locale dictionaries; no new summary channel.
- The wire schema already carries bounded identifiers. Run the owning protocol
  and handoff checks, then use the official fenced export if rebinding to the
  accepting RR commit. Never hand-edit generated handoff or runtime bundles.
- Activate the accepting RR reader before a producer emitting the new values.
  Once persisted, rollback must retain a reader for those values. This source
  change does not authorize a production activation or rewrite old evidence.

### Review and acceptance

An independent source investigation traced the API enum, durable decoder, reuse
ranking, normalization, optional-reviewer handling and all publication locales.
Root's first critique removed any new endpoint, schema column, raw diagnostic
field, feature flag or phase-specific recovery policy. A second independent
compatibility critique accepted this scope after requiring the mixed preserved
filter cases, required-only projection, every-reader deployment order and actual
generator/export evidence. Those refinements are included above.

Extend the existing immutable-acceptance, SQL readback, signed API restoration,
OCR adapter and publication tests. Reuse the existing compiled-Action/PostgreSQL
paired fixture for (1) failed plan with every path represented and a useful finding,
and (2) advisory preserved filter with otherwise complete work. Assert persisted
flags, accurate visible cause, retained finding, unchanged request counts and the
appropriate baseline decision. Test preserved-filter plus round stop separately.
An expected incomplete-coverage process result is accepted only by that named
fixture and must itself be asserted.

Estimated handwritten scope: 110-165 production/integration lines, 260-420 test
lines, and 30-50 documentation lines, excluding generated artifacts. With existing
fixtures and a working environment: 1-3 focused engineer-days. Complexity 4/10,
expected reliability within this reporting scope 8/10, confidence in fit 8/10;
estimate confidence is moderate. This slice is independent of native retry proof
and does not claim durable resumption after earlier paid work.

## Second executable review checkpoint

Parent source: `e72d9910b8ee5c8ba79adf2990c3b3b99b74bbf3`. Preserve its two
concurrent conflict-detection investigations unchanged; their separate dispatch
races do not expand this runtime correction.

CodeRabbit's completed review of `a2e23003` raised four further minor findings.
The diagnostic returns to `downstream` after successful settlement. A held
settlement/cancellation regression checks the completed row and single native
request. The EOF matrix checks complete one-argument log calls and rejects raw
Error arguments. Teardown consumes an already rejected joined-close promise.
The retained-close fixture holds, joins and awaits each of eight real background
attempts, freezing fake time during HTTP and excluding the original deadline
close. Two independent source reviewers approved these corrections.

Actual local evidence from the formatted working copy:

- Corrected relay suite: 192 tests passed.
- Evidence acceptance, reuse, Prisma decoder and API-composition suites:
  137 tests passed. Two suites initially could not load a locally copied Prisma
  runtime dependency; after repairing that private dependency link, their
  82 tests passed. No repository dependency or lockfile changed.
- All 170 ordinary migrations applied successfully on a fresh disposable
  PostgreSQL 17.10 cluster through the existing migration entrypoint and
  version preflight. Earlier killed/partial-cluster attempts were discarded.
- Real observation readback was killed before a result. The full protocol
  command generated its canonical output but was killed in the required
  control-plane typecheck. Neither command passed. New Action phase tests,
  paired compiled Action, complete type/architecture/CI gates and rollout remain
  pending. This source checkpoint still requires its own CI qualification.

The executor subsequently disconnected and is unavailable. Preserved GitHub
source blobs and connected CI remain usable. Missing, killed, queued and skipped
checks are not passes.

### Closed-pull-request cancellation follow-up

The executed Action baseline includes a test that starts a running server
execution and returns Cancelled for a closed PR without durable terminalization.
The bounded Action #411 correction reuses exact-scope supersede with the original
revision hash and current stream version, preserving authenticated already-terminal
readback. A missing or ambiguous acknowledgement becomes an explicit unconfirmed
cancellation failure; closure before any admission stays mutation-free. The
existing adapter must not manufacture success from a forbidden same-revision
supersede. This separately reviewed follow-up adds no scheduler, provider replay,
expiry policy or endpoint. Its new source and runtime gates remain separate from
the relay/evidence results above.

## Hosted CI follow-up

On RR source `0caf58b2219c019bf664df7414fd8447d8601ac8`, the actual Next/OCR
lifecycle, Skills Next/PostgreSQL, Memory PostgreSQL and rendered Memory UI lanes
passed. In [catalog run 46028807261](https://github.com/777genius/review-router-ai/actions/runs/46028807261),
the complete catalog receipt passed; the provider-connection branch passed six
scenarios and failed three before their connection submissions. Its shared
helper selected Provider radio cards from the setup dialog, while these tests
opened the distinct account-connection dialog with a Provider combobox.

The bounded correction extracts the existing combobox helper and changes only
the two affected specification imports. The setup radio-card branch, selection
waits, real server actions, database assertions, secret checks and receipt gates
stay intact. A second scope review enumerated all five redirected helper calls;
none enters the radio-card setup. The three affected browser scenarios still
require a fresh authoritative CI result.

[Action run 46041858637](https://github.com/777genius/review-router/actions/runs/46041858637)
on `cd2140516d32c10650c1e37f4470d10c767806b2` passed lint, retained and strict
TypeScript 7 checks, the full Jest step, native OCR MCP qualification and the
official build. Its committed-runtime gate correctly failed because generated
`dist` had not yet been committed; the actual build archive and provenance were
retained for review. This is source/build evidence, not final bundle or release
qualification. The separate real CLI qualifier passed all 21 tests.

The Native/Gateway producers also completed the actual PostgreSQL non-entry
fixture through both private and public ingress on Node 24.21.0 and 26.11.1.
Those joined producer results do not stand in for the remaining RR ledger and
compiled Action consumer acceptance. Main RR checks, official protocol/export,
paired publication and final runtime integration remain separate gates.

## Bounded discovery of an accepted, unattached original result

The completed-output correction in Action #411 preserves finite validated bytes
before the post-provider GitHub guard. The next separately reviewed slice lets
an explicit later invocation discover those bytes after the original source
lease has been released. This is a bounded recovery capability, not evidence
that the incident contained an accepted orphan or that automatic long-wait
continuation has been completed.

### Contract and authority

The restore response may add `unattachedAcceptedManifests` inside its existing
computed `persistedPlan`. The original assignment JSON/hash, plan hash, canonical
work slots and satisfied-only `acceptedManifests` retain their meanings. No new
endpoint, request field, database column, SDK method, feature flag or scheduler
is introduced.

A hint requires the current Running execution and an Exhausted
`finding_discovery` slot with attempt budget 1, next ordinal 2, no active lease
and no accepted attachment. Select only the exact original execution/slot,
scope, trust domain and reviewer vote; a bounded two-row query rejects
ambiguity without using the ranked cross-execution candidate search. The
accepted source must bind the original authorization, revision, plan, provider
manifest/invocation, attempt, lease, owner and fence. Only the original
Released/Expired provider lease at ordinal 1 can supply it. Existing same-attempt
acceptance uniqueness supplies the concurrency bound.

Reapply the existing canonical-payload, original-source and reporting-window
validator before emitting the hint. Passing the provider work cutoff does not
itself prohibit reporting or adoption: the original `resultReportUntil` and
current authorization must still permit the existing operation. Preserve the
existing expiry equality and idempotency rules; do not extend any ceiling.

The Action keeps the original manifest and reconstructed committed coverage in
the existing read-only restore wrapper. Its invocation cannot execute. Before
adoption, the ordinary lookup must yield `Hit` with `same_execution` and the
exact hinted observation/payload/invocation/vote/lease/fence/owner tuple. The
existing adoption RPC performs the authoritative transition after fresh current
execution CAS. Check the outer abort and hard execution deadline before lookup
and again after that refresh. No provider start window is required for adopting
completed work.

A known hint remains sticky if a subsequent restore omits it: exact current
lookup/adoption can still prove the original source. A missing, changed,
ambiguous or failed proof ends the run before admission, reviewer fallback,
cross-execution reuse or context replay. Without any hint, keep the existing
exhausted-slot behavior. Other task kinds and multi-attempt slots are unchanged.

### Review and acceptance boundary

Root and two independent reviewers reduced the proposal to this single-attempt,
same-authority path. They required a production-reachable crash boundary,
explicit stale-hint failure, the existing report/work cutoff distinction, and
compatibility outside immutable plan bytes. The exact twelve-file production
diff received independent static approval. The source checkpoint also contains
lookup/store/API, strict-decoder, read-only wrapper and orchestration tests,
including an available fallback reviewer and abort/deadline races. Actual
format, strict compiler, test and final bundle results remain required.

The old Action decoder rejects new top-level keys but ignores unknown members
inside `persistedPlan`; its existing satisfied-only list stays unchanged.
Qualify this using the actual unchanged old decoder bytes, not a reimplemented
parser or an assumption that optional JSON is compatible. Source inspection
alone is not that executable compatibility result.

The mandatory joined oracle uses the existing real RR PostgreSQL and compiled
public Action runner. Complete and commit one provider result, make the next
GitHub guard unavailable once, apply the actual source-lease release, and hold
only its acknowledgement. Kill the first child before outer transport cleanup;
then explicitly invoke a cold child with only the original authorization/runtime
capture. It must discover all source IDs through restore and adopt the exact
stored bytes without a new provider lease, attempt, dispatch, Gateway preparation
or authorization grant. The ordinary adoption term may be created. Preserve
original execution/lease identity and next ordinal 2. A direct database rewrite
to Exhausted or an assumed lease sweeper is not this oracle.

The original execution, Gateway preparation and report authority must still be
live. This slice adds no wakeup owner, recovery after normal transport close,
automatic runner replacement, or continuation past the original deadline.
The durable trigger/long-wait boundary remains outstanding and is not subsumed
from separately owned PR #1021. That PR has no file overlap with this checkpoint.

Estimated handwritten scope after review: 380-500 production lines, 700-1,100
test lines including the joined fixture, and 80-110 documentation lines.
With the existing fixtures and usable execution tooling: 2-4 focused
engineer-days. Complexity C=5/10; scoped utility U=8/10; expected reliability
N=8/10 after all gates, with moderate estimate confidence. The source checkpoint
does not establish runtime qualification, production deployment or a completed
durable long-wait recovery feature.

### Compiled consumer qualification checkpoint

Action source `1e8a6835238709f137a0b58cb27815e5c6a650d3` passed lint,
retained and strict TypeScript 7, the full Jest step including the actual
unchanged pre-B decoder, native OCR MCP and the official build in
[run 46051135263](https://github.com/777genius/review-router/actions/runs/46051135263).
Only the stale committed-runtime check failed. Artifact `15225485338` has
ZIP SHA-256 `d541340361d10f1346fdbdd8156fe43c98066eb9d26664c461aacab6c4924a4f`.
Its recorded merge checkout and reviewed source have the same complete tree
`dbae9a8e464cf6501acb067b3bc1c23ca57d1706`. The three changed generated files
were imported unchanged in Action `f0fb4d4dcc6871ba9a7a89b1c650c4f99a98f593`;
the canonical paired CI pin selected that exact consumer at that checkpoint. This is no
release registration or producer activation.

The existing compiled Gateway/PostgreSQL fixture now includes
`accepted-result-recovery`. One ordinary reviewer finishes before a second
commits its result and encounters an injected GitHub guard outage. The fixture
holds only the acknowledgement of its real source-lease release, kills the
first public Action process and cold-enters the same compiled artifact using
a separate clean Git clone, HOME, temporary directory and output file.
It supplies no source observation or lease IDs. The oracle requires exact
stored evidence and provider-lease preservation, original ordinal 2, no new
provider request or Gateway preparation, one original authorization/execution,
and ordinary App-authored publication. Only the exact injected HTTP error is
exempted from the existing zero-error assertion.

Independent source review and pinned native lint/format passed for this fixture.
Its strict project typecheck, actual PostgreSQL/compiled execution and the
final Action/RR required gates remain pending; earlier source passes do not
qualify this new consumer checkpoint.

### Consolidated cold qualification scope

Keep the single `accepted-result-recovery` case added to the existing compiled
Gateway/PostgreSQL public-entrypoint fixture. Its separate process, checkout,
HOME, temporary directory and output file exercise the actual cold boundary.
The existing synthetic Codex engine is a fixture seam; B recovery consumes
already accepted immutable evidence. A second lifecycle fixture and alternate
setup driver do not provide a separate required boundary and are not retained.
Action `5bcf65db` removes that unused driver and has the same complete tree as
`f0fb4d4d`, preserving the official generated runtime.

The acceptance oracle must join the persisted observation-reference row to its
original observation, slot and source lease, rather than compare unlike IDs.
Preserve original authorization version, expiry/max-expiry, runtime snapshot,
Gateway binding, provider lease and reporting window. Require exactly one
ordinary adoption and the named cold case as an executed PASS in the existing
CI invocation. Final strict compilation, PostgreSQL execution and current-head
bundle reproducibility remain required; source review is not runtime evidence.

Gateway `305fedb5` has all 23 checks passing, including both native-client Node
lanes, the producer/rollback gates and all browser flows. The separate active
retry consumer still requires the official SDK archive and lock integration,
the real generated/exported protocol, a complete release-binding tuple and
its joined consumer gate. Retained legacy/capacity128 source tuples must never
authorize the new request-retry marker.

### Bounded attested request retry consumer checkpoint

Implement the remaining consumer through the existing model-dispatch claim,
settlement and receipt paths. The new immutable producer profile is
`model-dispatch-policy.native-retry.v1`; its capability retains the existing
capacity128 marker and adds `retryPolicy: native-rejection-once.v1`. Legacy and
capacity128 profiles keep their current behavior. Only `account_gateway`
`finding_discovery` requests may consume the distinct
`native_rejection_after_forward` settlement proof.

The Gateway must attest the original request's protected admission conflict and
physical transport closure while its original authority is live. RR binds that
authenticated proof to the immutable original request before any unknown-effect
settlement. Add only two nullable fields to the existing dispatch row: immutable
`nativeRetryProofJson` and `retryOfDispatchId`, with a unique predecessor-use
constraint. A successor is exactly one new dispatch, with the same body, route,
limits, original lease/fence and authorization, and the next existing ordinal.
Both requests remain charged to the original budget. A successor cannot itself
have a successor; unknown effects, expired authority and auxiliary roles stay
fenced. No new scheduler, ledger, wakeup, credentials or whole-slot replay.

Receipt reconciliation must refresh the row after proof persistence and expose
the actionable two-field `nativeRetryProof` only while original authority remains
live. A successor claim repeats current authority, lease, scope and budget checks
and enforces lineage atomically. Historical receipt retention does not grant a
new dispatch allowance. Action retains the exact request bytes and allows one
bounded, abortable delay before its one fresh successor.

Independent Action review accepted this boundary and called out the mandatory
proof-before-unknown ordering, strict readback identity, unchanged spent budget,
same request limits and concurrent one-successor checks. Expected handwritten
scope is 400-650 RR production lines and 600-1,000 focused test lines; Action
adds about 150-300 production and 300-500 test lines. Complexity C=6/10,
expected reliability N=8/10 after gates, estimate confidence 7/10. The main risks
are cross-repository protocol export, lost acknowledgement reconciliation and
concurrent successor admission. Source, strict compiler, focused PostgreSQL,
official SDK/export binding, compiled Action and the existing joined native
consumer oracle remain required evidence. This checkpoint authorizes no release
registration, deployment or broader retry policy.

The implemented boundary is the existing V3 single prepared model route. The
new producer profile retains all existing transport declarations; only its
`account_gateway` capture carries the retry marker. V4 reviewer allocations,
lifecycle verification and PR descriptions keep their existing behavior.
Consumer scope comes from the same original prepared SDK client, its pinned
origin and execution bearer. Gateway authenticates that consumer; RR verifies
the exact execution/request and retains the returned consumer ID as provenance.
There is no invented independently configured consumer ID or replacement client.

Independent producer review additionally required a latest-predecessor gate:
omitting `retryOfDispatchId` cannot turn a rejected request or failed successor
into a fresh root. The HTTP claim and forwarding boundaries also require the
retained original Gateway session; a lost session never starts preparation for
a successor. Readback refresh and current authority checks preserve lost-ACK
reconciliation without upgrading either a runner or native unknown effect.
The additive SQL migration is `000165_attested_model_request_retry`.

Local PostgreSQL 17 executed all 51 dispatch tests after ordinary migrations,
including the native successor, auxiliary exclusions and negative authority cases. The
capture, Gateway relay and split run-access suites passed all 323 tests; the
canonical contract and complete release-binding tuple suites passed 16 tests.
These focused source results remain separate from final strict checks, compiled
Action provenance and the joined Native/Gateway/RR/Action gate. The formatted
production patch is approximately 700 added lines plus the small migration;
the repeated current-authority checks account for the difference from the
pre-implementation estimate. No separate ledger or retry scheduler was added.

### Final receipt, cancellation and rollout review

The next review pass is limited to the implemented retry path and its existing
qualification fixtures. It adds no retry profile, durable ledger, scheduler,
authority renewal or provider replay.

1. Transport review keeps the attested native request identity through the real
   RR HTTP response, including cached public 202 status. Error responses expose
   the selector only for a verified pre-dispatch rejection; quota and unknown
   failures retain their existing behavior. The header does not grant a retry.
2. Authority review checks every asynchronous handoff: proof preparation must
   still be uncancelled, the retained session must still be open, and the
   original dispatch proof cutoff must still be live when readback finishes.
   Carry the DB-derived cutoff, including receipt retention and the original
   Gateway deadline, internally using elapsed monotonic time; do not add a
   public field or compare the database deadline to a skewed wall clock.
3. Receipt review limits actionable proof visibility to the original matching
   receipt token. Bearer-only historical readback remains available. An already
   committed settlement remains acknowledged if optional proof enrichment
   expires or fails; this does not make a historical receipt actionable.
4. Stream review gives the final EOF/status/settlement path responsibility for
   its outcome across all of its awaits. Cancellation may not race it with an
   equal-revision unknown usage outcome. Failure still follows the existing
   unknown path; cancellation before EOF keeps its existing behavior.
5. Qualification review observes the actual client EOF/proof boundary, returns
   finite refusals for bad fixture headers, verifies the real lost-custody
   callback, and propagates upstream response errors in the public ingress.
   Preserve all earlier paid-turn, close-ACK, immutable-body and no-replay
   assertions.
6. Rollout review requires exact producer/SDK/protocol/bundle qualification and
   all four private/public Node 24/26 joined executions before activation.
   Migration 000165 must precede every new Prisma reader. The coherent reader
   batch precedes Action/profile activation. The owning
   [rollout record](../deployments/2026-11-27-production-review-failure-fixes.md#ordered-rollout)
   records the executable order and current evidence.

Source review, focused regressions and full CI remain distinct. Action source
`ccbcabb8` has passed the official source/test/build steps and real-CLI
qualification, while its generated bundle still requires exact artifact
integration and committed-runtime freshness. Final RR qualification must pin
that qualified consumer and execute the existing cold recovery and joined
oracles. This review checkpoint grants no deployment, release registration or
customer replay.
