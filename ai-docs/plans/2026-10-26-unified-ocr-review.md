# Unified OCR review and finding verification

## Status and owner-requested outcome

Planning draft v2, 2026-10-26. Implementation must start only after three
independent review rounds have been recorded and their blocking findings have
been addressed. This document and subsequent implementation belong to draft PRs.
No production deployment, moving release tag, existing customer workflow edit,
or live provider qualification is implied by a code-ready draft.

The owner requested one complete review behavior for every currently offered and
supported provider/connection combination: OCR discovers new findings; the
existing separate verifier checks previous findings; existing GitHub App
publication publishes the aggregate and performs only qualified resolutions.
Credential storage must not select the review engine. Explicit supported engine
choices remain explicit, and there is no hidden fallback.

The owner will supply test credentials later. Before that final stage, exercise
real application/runtime composition, disposable Git revisions, PostgreSQL,
loopback provider/OAuth/GitHub fixtures, and real browser rendering. Synthetic
credentials and responses are test evidence, not live OAuth, provider billing,
GitHub OIDC, or deployment qualification.

### Audited starting points

- Control plane: `777genius/review-router-ai` main
  `4c8f2804b5e53795ec8dd51d51d3b3b6c7d28188`.
- Public Action: `777genius/review-router` main
  `dc0b3b340f911af7efcfb2f4fc3170fe304c349e` (includes #344 effect fences
  and captured reasoning settings). The pending memory Action is not our base.
- Managed OCR: upstream `8eb83340a487b1150af00701b94f01af97e4b4d6`,
  upstream version 1.13.1, managed 1.13.1-rr.4, Go 1.26.9.
- Checked-in control-plane CI currently pairs Action `d4174897...`, while
  rotating and Hosted fixtures retain Action `66ac53a5...` / v1.0.171.
  These are source facts, not a statement about deployed configuration.
- Concurrent work: #704 Skills, #690 Hindsight memory, #715 CI cancellation,
  #716 superseded dispatch cleanup. Preserve their ownership and interfaces;
  reconcile changes from main without cherry-picking their unmerged product work.

The release source of truth remains
`ai-docs/operations/07-environments-and-release-management.md`. Coordinate the
final delivery/retired-writer evidence with the separate `rr: deploy` task.

## 1. Scope and exclusions

In scope:

1. A source-backed matrix of all connection paths offered today.
2. Qualified prepared model routes feeding the same OCR and verifier pipeline.
3. Official Codex authentication refresh and existing encrypted writeback.
4. Durable, shared per-run request allowance for runner-local inference, with
   unknown-effect fences and no automatic paid retry.
5. Hosted execution through the existing V2 admission/orchestration/publication.
6. A qualified Claude protocol adapter; it cannot be represented as an ordinary
   Responses API key or silently removed from supported combinations.
7. Automatic qualified history activation for new/existing connections and the
   next ordinary push; honest handling of unobservable older comments.
8. Existing installed-caller upgrade flows and truthful readiness UX.
9. Common behavior tests, adapter fault tests, visual desktop/mobile checks,
   independent implementation review, and a separately documented live test gate.

Out of scope:

- A second queue, publisher, verifier, review planner, configuration system,
  generic inference gateway, billing platform, or general protocol translator.
- New providers or authentication methods; moving secrets to ReviewRouter.
- Rewriting memory or Skills; changing task cancellation owned by other PRs.
- Invented historical resolutions, blanket legacy-comment backfill, or weakening
  existing history/citation/head/current-operation checks.
- Deployment/release promotion and final live acceptance before the required
  test credentials and actual deployment evidence exist.

## 2. Actual matrix, not UI labels

| Credential source / supported connection | Current route and engine | Current verifier | Required target |
| --- | --- | --- | --- |
| Gateway-bound account/model | Neutral `workflow-v1` caller, captured OCR/native profile | Qualified Gateway Responses profile | Preserve common path and native server allowance |
| Secrets or managed API key: OpenRouter | Immutable direct caller, `openrouter-api`, Codex | Unavailable | OCR + common verifier through controlled runner-local Responses route |
| Secrets or managed API key: MiMo Token Plan | Immutable direct caller, `mimo-token-plan-api`, Codex | Unavailable | Same, preserving endpoint/model/settings restrictions |
| Secrets Kimi Code API | Immutable direct caller, `kimi-code-api`, Codex | Unavailable | Same, preserving `k3-256k` and settings restrictions |
| Repository Codex subscription | T0 schema v2, repository provider instance, official auth/writeback, Codex | Unavailable | Auth-only official preparation, controlled subscription route, OCR + verifier |
| Hosted Codex Pool | Hosted relay custody/grant, Action V2 explicitly disabled, legacy runtime | Outside common V2 verifier | Same V2 scenario using one original hosted lease/model |
| Secrets Claude Code subscription | Native Claude auth/Anthropic route, `CLAUDE_CODE_OAUTH_TOKEN` | No qualified common route | Controlled native Anthropic OCR route + shared verifier semantics |

Gateway capability must also be checked per approved account/model/protocol; a
provider catalogue entry alone does not establish an executable combination.
Record route, authorizer, engine/profile, workflow SHA, refresh owner, transport
protocol and publication identity for each qualified row in completion evidence.
Managed API keys reuse `apply-provider-api-key.ts`: the stored key is applied to
the repository Actions secret before the same direct route runs. Do not invent
another transport. Test applied, stale and reconciliation-needed provisioning;
an account holding a key does not prove that a repository received it.

## 3. Reuse and architecture boundaries

### One application scenario

Reuse public Action `RunT0ReviewOrchestration` and its production composition.
The order remains:

1. Obtain validated captured authorization/configuration.
2. Prepare one route with its auth lifecycle and immutable selection.
3. Materialize the exact reviewed revision and captured previous-finding roster.
4. Execute OCR discovery under existing durable work slots.
5. Execute the existing separate lifecycle verifier under the same route/budget.
6. Build the existing common projection/evidence.
7. Request existing GitHub App publication and qualified resolutions.

Do not copy this sequence into each entrypoint. Auth wrappers may keep different
preparation/refresh/cleanup steps; they delegate review work to the same runner.

### Existing reusable modules

| Responsibility | Existing seam |
| --- | --- |
| Execution, leases, evidence, finalization | `review-router/src/review-orchestration/application/run-t0-review-orchestration.ts` |
| Production composition | `review-router/src/review-orchestration/infrastructure/production-t0-review-runner.ts` |
| Stable verifier work and adapter multiplexing | `lifecycle-verification-invocation.ts`, `lifecycle-verification-planning.ts` |
| Verdict/quote validation | `review-router/src/finding-revalidation/domain/packet.ts`, `validate-response.ts` |
| Persisted plan/witness restoration | `restored-lifecycle-invocations.ts` |
| Results and counters | `production-review-projection.ts`, `review-projection/domain/lifecycle-verification.ts` |
| Route capability capture | `apps/api/src/review-run-runtime-snapshot.ts` and domain snapshot parser |
| Durable model dispatch | Existing companion claim/settlement ports and Prisma repository |
| App publication/reconciliation | `apps/worker/src/review-v2-publication-executor.ts` and existing gateways |
| History transition | `activate-review-resolution-history.ts`, `PrismaReviewThreadResolutionHistory` |
| Client setup/update | Existing workflow provisioning, exact-source checks and activation helpers |
| Browser acceptance | Existing `scripts/accounts-reference-e2e` and provider visual tooling |

Extract only the narrow model-route capability currently embedded in
`LocalGatewayModelTransport`: controlled discovery endpoint, parent-owned verifier
generation, cancellation, normalized terminal/usage/model facts, and cleanup.
Domain/application code must not know secret names, `auth.json`, HTTP credentials,
GitHub Secrets, SDK response shapes, or hosted custody internals.

Prepared route identity binds authorization, original provider/account/lease,
model, protocol and captured settings. Both discovery and verifier consume the
same prepared instance; neither can choose another account/model or fallback.
Protocol-specific request/response normalization belongs in small adapters.

## 4. Mandatory bounded technical spikes

These are implementation tasks after plan approval, before enabling any new
default. Each records exact versions, executable checks and limitations.

### S1. Managed OCR and direct Responses

Use the real pinned managed OCR executable against the existing loopback bridge.
Prove discovery, strict findings, actual model receipt, cancellation, no ambient
credentials, no SDK retries and controlled request admission. Existing managed
OCR already supports a private Responses endpoint; do not patch upstream for the
three API-key routes unless the executable spike demonstrates a need.

### S2. Official Codex refresh without review inference

`refreshCodexAuthWithOfficialCli` currently runs `codex login status`. Pinned
Codex source shows this loads auth but does not establish proactive refresh.
Use official app-server `account/read` with `refreshToken: true`, without creating
a thread or turn. Its RPC success can hide refresh failures, so inspect resulting
auth freshness/expiry, original account identity and expected generation before
accepting existing encrypted secret writeback.

Run the pinned binary with synthetic old auth, an isolated private home and a
supported fake refresh endpoint. Exercise rotation, denial, timeout, cancellation,
malformed result, changed account and lost response. Preserve existing T0 order:
prelease/generation finalization -> writeback preflight -> refresh -> accepted or
idempotent encrypted writeback -> review. Never call a model before writeback is
safe. If the pinned binary lacks the required test override, qualify its process
protocol with a strict fake executable and separately retain the real-binary
refresh test as an explicit gate; do not label that fallback as real refresh.
Keep the auth-helper binary version/hash as a separate approved preparation
capability from the OCR engine profile. Execute `initialize -> account/read`
only; never create a thread or turn. Abort/timeout/failure terminates the process
group and removes the private home, including failures before a cleanup handle
can be returned. Do not log app-server payloads. Lost refresh response or
writeback ACK uses existing generation/writeback reconciliation; it never retries
the old refresh token automatically or admits inference from uncertain auth.

### S3. Claude controlled native protocol

Use OCR's existing native Anthropic implementation behind a controlled loopback
endpoint. The existing unpinned Claude CLI installer is not proof of a direct
subscription HTTP contract. Add a finite, versioned Claude subscription route
descriptor, with one approved endpoint, fixed model selection, a reviewed header
allowlist and bearer semantics; pin its source/version with the new profile.
Repository/environment/OCR input cannot supply arbitrary origins or headers.
Managed mode currently permits Responses only. Extend its finite protocol check
and native adapter only if required; do not build a universal Responses-to-
Anthropic translator. Keep credentials outside OCR config and preserve fixed
model, no SDK retries, cancellation and truthful usage/terminal state.

The common verifier retains the same prompt/verdict/citation rules. Only wire
request/response normalization varies. A failed spike leaves this row incomplete
in the draft; an existing explicit native path may remain available but cannot be
counted as completed OCR unification.

Select native non-streaming Anthropic Messages for this bounded first adapter.
Missing/unknown `stop_reason`, truncated JSON, `max_tokens` or incomplete tool
completion cannot confirm a final review. Qualify valid tool-use rounds and final
terminal states separately; validate actual model, full bounded response and
usage before normalization. Hash the actual native wire envelope, not a
Responses-shaped surrogate. Existing no-SDK-retry patch applies to Anthropic;
reuse it. Publish a new managed OCR artifact/profile for these changes, preserving
1.13.1-rr.4. Wire-fixture success and live subscription-token compatibility are
separate receipts. Candidate code stays non-default for production Claude until
live qualification. Setup-token replacement stays as currently supported; no
unsupported refresh behavior is invented.

### S4. Hosted V2 composition

Verify the current hosted grant/relay can provide the same prepared-route
capabilities while V2 owns snapshot, leases, results and App publication. Preserve
custody expiry/cleanup and original selected account. Existing positively safe
pre-work account selection may occur before the route is fixed; no failover
between discovery and verifier or after a possibly paid effect is permitted.

At admission, bind original `bindingId`, `bindingVersion`, `invocationLeaseId`,
repository, source run/attempt and head to the V2 authorization; the hosted
grant/relay must confirm that exact tuple. This is a typed Hosted preparation
branch, never a finite API-key mode. A grant obtained before a failed V2 join is
released without inference. After any possible paid dispatch the original grant
and account remain fixed. New runtime uses grant only for inference/necessary
reads; publication belongs exclusively to V2 App authority. Old admitted runs
finish with their immutable legacy runtime. New V2 admission never treats legacy
snapshots or legacy comment tokens as V2 evidence/publication authority.

## 5. Durable shared allowance and uncertainty

Do not equate work-slot attempts or `requestCount()` with model request allowance.
OCR can make multiple requests inside one discovery slot. Existing companion
rows currently allow only one request per optional work slot.

Extend the existing dispatch ledger/ports with an explicitly versioned path for
runner-local model dispatch. Preserve old v1 behavior and records. The new path
needs a request ordinal within the existing authorization/work-slot/attempt, the
original prepared invocation manifest identity, a separate exact outbound
request-envelope hash, route identity, bounded request bytes/output reservation,
and a durable terminal receipt. No credentials or prompt bodies enter this ledger.

The initial contract is one immutable `maxRequests`, bounded request/response
bytes, a per-request output-token ceiling, and the original absolute deadline.
Direct admission is sequential (`maxConcurrentRequests = 1`). The reviewed
shared direct-policy descriptor initially selects 32 requests, 16 MiB request,
8 MiB response and at most 32,768 output tokens per request, clamped downward by
the approved model/profile capability. These values are exported once from the
shared policy and frozen in admission; adapters cannot select local defaults.
Native Gateway/Hosted bounds remain additional constraints and may be lower.
There is no new cumulative-token or dollar accounting contract in this scope.

Use `dispatchVersion` and `requestOrdinal`, defaulting historical rows to 1.
The unique key becomes `(authorizationId, workSlotId, attemptOrdinal,
requestOrdinal)`. V2 permits discovery plus existing companion roles, all on
attempt 1. Deterministic dispatch ID includes immutable scope/ordinal but excludes
request hash: changed bytes at the same ordinal conflict instead of spending a
new ID. Verify the original invocation manifest separately from per-turn wire
hash. Verifier keeps its stricter exact prepared-envelope equality.

Claim is persisted before upstream I/O under the same authorization/budget lock.
All discovery, verification and optional description requests consume the one
captured run allowance. Each reservation permanently consumes one request, even
when positively not dispatched. Verifier does not receive a separate budget.
All roles of a V2 budget-bearing authorization use V2 claims; old V1 companion
calls are refused for that authorization so they cannot escape the shared count.

Gateway/Hosted native quota remains authoritative in addition to common execution
limits. Do not replace native quota with a local counter. Runner-local adapters
enforce the captured output cap before dispatch and report normalized usage as
observed evidence; absent usage remains unknown, never zero. Usage neither
refunds nor expands the permanent request allowance.

Repeated identical claims return the original state and never permission for a
second provider call. A mismatched request/route/manifest is rejected. A claim
that might have dispatched fences further model work on that route until its
definite terminal state is recorded. Direct completion requires a fully consumed,
protocol-valid terminal response matching the model and request. An HTTP status,
report ACK, exception, restart or missing usage cannot establish completion.
Only the authenticated qualified runner parent reports that terminal receipt;
it remains distinct from accepted review evidence. A dead worker cannot restart ordinal 1 or
invent a new ordinal to evade the fence. New direct OCR invocations use one paid
attempt; generic retry classification must not repeat ambiguous requests.

Known completed output is committed through existing evidence acceptance before
it is reused. Lost settlement/evidence ACK is resolved by readback. Restored
verifier work without accepted evidence remains unverified; restoration does not
rerun the verifier. A head/ownership/lease change invalidates new dispatch and
resolution authority but cannot erase an already paid reservation.

`authorizationId` is already the correct budget owner: the existing authorization
repository locks the source-run tuple and rejects another authorization for the
same source run/attempt even with a different protocol offer. Reuse this guard;
no new budget-owner table is needed. Test competing changed-offer admissions,
renewal and recovery. Retain all reservations through the original maximum
authorization lifetime plus restoration/reconciliation windows; pruning cannot
restore live allowance. Metadata admission guarantees the qualified trusted
runner's behavior; it is not an upstream spending cap against a compromised
runner that already holds credentials.

## 6. Contracts and compatibility

- Extend shared source contracts and their generated Action exports together.
- New prepared-route/dispatch/verifier capabilities are explicit approved producer
  facts. Never infer them from a provider label, profile name, semver or storage.
- Preserve exact historical schemas, profile hashes, signed producers and old
  snapshot parsers. Old admitted work completes under its original contract.
- Add new immutable profiles instead of editing the meaning of approved profiles.
- Permit managed OCR for each qualified transport only after its adapter and
  verifier authority exist. Enable default selection centrally for supported new
  producers; preserve explicit saved alternatives and fail closed on unavailable
  explicit choices.
- Do not route subscription OAuth through the API-key finite contract.
- Keep cancellation and terminal/unknown receipts correlated with the exact
  prepared model route and actual provider response model.

Change the independent gates together: shared `review-agent-profile.ts`,
`selectProviderApiReviewAgentProfile`, Action `approvedProviderApiAgent`,
`ProductionT0ReviewRunner` input guards, `generateLifecycleVerification`, runtime
snapshot capture/parser, `review-lifecycle-verification.ts`, and
`assertLifecycleLeaseEvidence`. Replace the Gateway-only witness requirement
with the qualified versioned dispatch witness for the new route, never with
an unbound runner assertion. Preserve the original Gateway branch unchanged.

## 7. Automatic resolution-history activation

Current code creates `legacy_open` connections. The activation use case exists
but is called only by tests; production has no writer-qualification adapter.
Setting `guarded` by default would fabricate history and is prohibited.

First read existing guarded state and verify applicable fleet qualification in
one narrow `ensureResolutionHistoryActivated` composition. Missing/invalid
evidence returns unavailable without mutating `legacy_open`. Only then reuse
`beginDrain -> qualify -> activate` with the same stable verified proof and
mutation-boundary applicability check, the existing repository lock,
known-operation import, PostgreSQL activation cut and idempotent proof identity.
Wire this once at ordinary supported review admission before previous-comment
capture and first publication, including zero previous targets. This covers
existing connections, new connections and next pushes; dashboard reads never
trigger activation.

Qualification must come from the existing trusted release/deploy authority. A
signed executable descriptor proves bytes, not that old executors are retired.
The deployment witness must bind the complete relevant old executor inventory,
their nonrestartability and removed ingress, or positively establish managed
handler settlement. A health check, empty local counter, suspended service,
user-supplied JSON or merely registered new producer is insufficient.

Add only the narrow witness production/verification necessary to the existing
release process. Lazy activation reads verified stable evidence; the normal user
does not toggle it. Real initial retirement evidence is supplied by `rr: deploy`,
not fabricated by this implementation. Missing evidence keeps closure disabled
and yields truthful history-unavailable facts while safe discovery can continue.
Concurrent pushes share one cut and version; failed qualification is retryable
without inventing a new history or dropping unresolved effects.

Extend existing `AttestReleaseWitnessBinding` signer/verification infrastructure
with a separate purpose/version receipt. Bind environment, physical database
generation, complete executor/job and ingress scope, actual old/new executable
digests, nonrestartability, observation and stable retirement digest to the
current deployment authority. Existing rollback/cutover must revoke or refuse
incompatible bindings, so receipt replay after old-writer reintroduction fails.
Do not reinterpret the schema-3 deployment witness as retirement evidence.
Actual Render inventory is relevant only to Render; a Hetzner/Docker fleet needs
its actual supervisor and ingress observation from `rr: deploy`. Initial rollout
uses `retired_legacy_writers_quarantine.v1` for all unqualified connections;
current writer instrumentation or connection creation time alone never proves
the managed-handler qualification branch. Synthetic signed observations test the
adapter but cannot activate the real fleet.

Initial quarantine intentionally excludes parent comments created at or before
the activation cut. Preserve this both in planning and capability issuance.
Known pending/unknown operations remain reconciled by existing App authority.
Product language: earlier comments remain open for manual review. If showing a
date, use the actual per-connection activation cut, not deployment time. Do not
label excluded old comments as verified.
Do not promise that transport unification recovers absent historical closures.

## 8. Installed clients and rollout

Backend deployment alone cannot change immutable customer Action pins. Reuse the
existing setup/update PR and exact merged-source verification for Secrets/Hosted.

1. Qualify and publish the new Action candidate and managed OCR artifact, preserving
   previous immutable releases.
2. Register exact compatible producer/profile/contract facts and deliver the
   control plane with old/new overlap.
3. Coordinate actual retirement/activation evidence with `rr: deploy`.
4. Promote Gateway `workflow-v1` only through existing ABI + previous-SHA CAS gates.
5. Generate Secrets/Hosted update PRs using existing onboarding/namespace/binding
   helpers and exact new approved tuple.
6. Verify merged default-branch source, namespace/generation and exact pins before
   activating new calls; retain old authority for already admitted runs.

This draft prepares and tests the upgrade path. It does not edit real customer
repositories or release tags merely to demonstrate code readiness.

## 9. UX within current product flows

No additional OCR/verifier toggle or duplicate connection form. Preserve the
provider -> credential storage -> model/settings flow and shared components.
Default review behavior is selected centrally. Existing explicit engine choices
remain understandable and valid only when supported.

Repository readiness currently compares transport families, so same-transport
stale immutable pins can appear current. Extend the canonical readiness facts
with a shared `compatible | update_required | unknown` runtime fact. Use
`WorkflowProvisioning.actionVersion` as installed evidence only for a matching
`configured` row: `beginAttempt` overwrites it before merge. Pending/failed
candidate pins never count as installed. The compatible-new-feature set is
separate from old producers permitted to finish admitted work. Both the
dashboard and repository search use the same helper. Unknown evidence is not
ready. Avoid adding GitHub network probes to every first paint.

Use existing Update setup / Merge setup PR / Verify setup steps. Explain new
findings, still-valid issues, verified fixes and unverified issues using existing
projection facts. Old comments and missing history must not look like all clear.
Do not expose internal schema/profile/ledger vocabulary to ordinary users.

Visually inspect actual rendered Next screens at desktop and 390px/narrow mobile,
light/dark where supported. Cover loading, empty state, stale runtime, pending
setup merge, verified readiness and retryable setup failure.
Reuse existing sections and inline status; avoid nested bordered cards.
Use existing banner/comparison and compact-comment tooling for history-unavailable,
legacy limitations and mixed new/fixed/open/uncertain output. Render that canonical
output locally for visual inspection; do not create a new Next results page.
Actual GitHub rendering and bot identity remain part of final live qualification.

## 10. Implementation slices and ownership

After plan review, implement in focused commits and push each coherent slice.

1. **Spikes and acceptance harness:** real managed OCR, official auth preparation,
   Claude protocol, Hosted V2 viability; preserve exact executable receipts.
2. **Contract/allowance core:** versioned route capability, durable dispatch
   admission/settlement, generated contracts, old/new compatibility fixtures.
3. **Runtime route composition:** narrow prepared port, common OCR/verifier,
   API-key routes, subscription auth-only adapter, Hosted/Claude integration.
4. **Activation and installed-runtime readiness:** production witness validation,
   ordinary admission activation, existing caller update and shared UI facts.
5. **Acceptance and hardening:** parameterized common E2E, PostgreSQL concurrency
   and recovery, adapter faults, browser/visual corrections, independent critics.
6. **Draft completion:** updated evidence/status, paired public Action draft/pin,
   unresolved live gate listed precisely. No false full-live-ready claim.

Parallel edits use non-overlapping ownership; shared protocol changes have one
owner. Runtime and control-plane changes are paired explicitly. Do not merge
other agents' unrelated branches or erase their recovery artifacts.

## 11. Acceptance matrix

For every qualified route, execute the same real scenario with synthetic external
boundaries: commit A produces new findings; commit B fixes one, retains one and
makes one unprovable. OCR finds new issues and the common verifier checks the
captured old roster with the same account/model/route. Only the proven fixed,
eligible target reaches App resolution. Mixed statuses remain visible.

Mandatory cross-cutting cases:

- Discovery consumes the allowance; verifier cannot overspend or obtain a hidden
  separate allowance. Restart and competing workers cannot reset reservations.
- Claim-before-I/O, upstream acceptance followed by disconnect, response before
  evidence commit, and accepted evidence before lost ACK never cause paid replay.
- Late head changes, ownership loss and cancellation stop new dispatch and stale
  resolution; temporary credentials and child processes are cleaned up.
- Unknown verifier output, wrong model, invalid quotes, omitted/duplicate targets,
  malformed/truncated stream, budget failure and absent history remain unverified.
- GitHub resolve success followed by disconnect is reconciled by actual state
  readback; no duplicate resolution or replacement publisher is introduced.
- Human replies, parent edits, reopening, unknown prior effect and pre-cut
  quarantine preserve existing conservative resolution rules.
- Ordinary new/existing/next-push activation, repeated/concurrent activation,
  missing/invalid deployment witness and pending legacy operations.
- Same-transport stale pin, unverified updated source, correct merged update,
  old admitted run during new admission, and explicit alternative-engine choice.
- All fixture publications are attributed to the configured App identity.

Use existing production paired E2E, real disposable PostgreSQL and Git, and actual
OCR/browser executables where available. Shared behavioral assertions are
parameterized; adapter-specific cases target real auth/wire/cancellation
differences. Do not create a huge matrix of redundant pure unit tests.

## 12. Three plan review rounds

Each round has multiple independent critics. Record concrete findings,
disposition and recheck; a missing concern is not an approval.

| Round | Focus | Status |
| --- | --- | --- |
| 1 | Executable matrix, architecture boundaries, OAuth/Claude/Hosted feasibility | Three critics NO-GO on v1; concrete corrections recorded in v2, recheck in round 2 |
| 2 | Shared allowance, uncertain paid effects, recovery and publication/history | Pending |
| 3 | Compatibility delivery, full user behavior, scope/DRY and honest acceptance | Pending |

Blocking findings must be addressed before product implementation. A real
provider limitation discovered by a spike stays explicit and does not authorize
pretending a synthetic route is production-qualified.

## 13. Final stage with user test credentials

After code and synthetic acceptance are complete, use a disposable repository
and designated test accounts for actual OAuth refresh/writeback, real selected
models, actual OIDC/admission, new/old findings, bot-authored comments, fixes and
thread resolution, bounded budget, interruption/recovery and installed-caller
upgrade overlap. Verify deployment retirement evidence separately with
`rr: deploy` before claiming automatic production history activation.

Record separately: implemented, synthetic E2E verified, real executable
qualification, browser visually inspected, live provider verified, deployed.
An unrun final stage must never be shown as passed.
