# PR #1028: production review failure fixes and qualification

Status: implementation plan; runtime changes and E2E are not yet completed.
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
   valid HTTP-date Retry-After, strict numeric/header validation, and the later
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

| Area | Verified source finding | Consequence |
| --- | --- | --- |
| RR GitHub revision reads | retryAfterMs parses Number(header); rateLimitWaitMs returns Retry-After before considering exhausted primary reset | Valid HTTP dates are missed; a short Retry-After can cause an early retry while primary quota remains exhausted |
| Companion EOF | phase remains native_status through usage.outcome and companionDispatches.settle | Different failed boundaries are indistinguishable in the diagnostic |
| Stream diagnostics | SDK httpStatus is omitted; companion log discards existing safe HTTP/category/cancellation detail | Operators cannot distinguish the safe HTTP failure class already available |
| Coverage | Accepted progress policy deliberately distinguishes completed execution from incomplete source coverage | Do not change deriveCoverageState or falsely make partial coverage complete |
| Native retry | Gateway non-entry and transport closure ACK are separate facts; ordinary rejected status says retry.kind=never | RR cannot safely convert rejection into the existing local_before_forward proof |
| Observed revision-guard incident | The recorded review_action_v2_revision_guard_unavailable is emitted by the separate public Action client | An RR adapter correction alone does not prove that incident fixed |

The reference worker GitHub policy already parses HTTP dates and combines quota
boundaries. Use its parsing semantics as evidence, while keeping the revision
adapter's interactive deadline policy. Importing apps/worker into a feature or
moving its durable scheduling behavior would expand the correction.

## Implementation sequence

### A. Existing GitHub read adapter

Change
`packages/features/review-run-control/src/infrastructure/github/octokit-github-review-revision-source.ts`
and its existing transport test.

- Parse trimmed decimal delta-seconds and canonical HTTP dates deliberately.
  Blank, negative, hexadecimal, exponential, nonfinite, overflow and malformed
  values are not an immediate retry instruction.
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

| Boundary | Required observation |
| --- | --- |
| HTTP-date within read deadline | Read resumes after the announced boundary and returns the current revision |
| HTTP-date or exhausted reset beyond deadline | One request, no early retry |
| Conflicting Retry-After and primary reset | Later boundary wins |
| Invalid/missing wait, ordinary permission 403 | Conservative refusal; no unauthorized retry |
| Revision changes during wait | RevisionMoved/fail-closed remains effective |
| Gateway status failure after EOF | native_status, safe HTTP detail, no successful terminal or replay |
| Completed usage write fails | usage_outcome; unknown outcome retained; one model POST |
| Completed dispatch settlement fails | companion_settlement; unknown fallback retained; one model POST |
| Throwing logger or secret-bearing exception | Same failure/cleanup; no raw secret output or accessor invocation |
| Healthy stream / client cancellation / retained close | Existing positive and negative transport tests remain valid |
| Finished execution with partial producer coverage | Review remains incomplete, useful findings preserved, baseline not advanced |
| Old Gateway/producer | Existing strict proof and no-retry semantics unchanged |

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
- The public Action's independent GitHubClient has its own wait policy and
  requires its own source/bundle qualification to address that incident path.
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
- Round 3: implementation and final-source qualification pending.

## Progress

- [x] Inspect initial PR source, instructions, incident evidence and ownership.
- [x] Write the bounded plan and incorporate initial independent criticism.
- [ ] Implement GitHub wait correction and transport regressions.
- [ ] Implement settlement diagnostics and failure-injection regressions.
- [ ] Review complete diff and correct critical findings.
- [ ] Run exact-source static, PostgreSQL and E2E qualification.
- [ ] Record actual validation and deployment applicability.
- [ ] Complete external native retry/public Action dependencies.
