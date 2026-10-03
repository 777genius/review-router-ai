# Account Gateway: First-Slice Execution Contract

Date: 2026-10-02. Status: A–D implementation in progress;
all product acceptance below remains NOT RUN until exact-candidate receipts.
Read with [plan 51](./51-account-gateway-modular-implementation-plan.md) and
[account/security authority 50](./50-reusable-account-gateway-and-personal-pool.md).
This card makes the initial boundary concrete; it does not qualify native
Sub2API APIs, live OAuth or production capacity.

Execution preference reaffirmed by the owner on 2026-10-03: all subsequent
hosted jobs use `serviceTier: default`, never fast/priority. Implementation uses
explicit `gpt-6.1-sol` and role-appropriate effort; exact-code PR review uses
`gpt-6.1-sol/xhigh`. Historical receipts retain their original mode.

## Readiness assessment - 2026-10-03

The first slice has enough specification to implement A and investigate B
without inventing product policy. It is not yet a frozen specification for
every native adapter, database transaction or capacity setting. Keep these
bounded decisions in their implementation packets; do not expand the platform
or postpone A while collecting unrelated future-profile evidence.

| Remaining decision | Required output before dependent work is accepted |
| --- | --- |
| B: native physical identity and generation pin | Exact engine API/patch and persisted identity proof, tested against deletion/reuse, reconnect and lost acknowledgement; inability to prove identity denies dispatch |
| B/C: concrete persistence and RR policy mapping | Selected existing-compatible DB/tooling, migration/unique constraints, atomic claim/fence/promotion transactions and RR membership/binding fields; real concurrent DB tests, not only HTTP fixtures |
| D: capacity and lifecycle bounds | Numeric enforced request/output/buffer/concurrency limits, approved deadline and cleanup target, with repeated-burst and supervisor-loss evidence on the pinned candidate |

Assessment: **8/10 for implementing the first vertical slice**, not production
readiness. The remaining details are bounded decisions below, resolved before
their dependent acceptance gates. They are not reasons to add a general plugin
platform, a second scheduler or migration of the old subscription pool.

Required implementation details from current review and CI evidence:

- Capture trusted consumer, command intent and native acknowledgement proof
  primitives before any await. A mutable caller object must never change the
  durable owner or physical execution/cleanup target during a DB lock wait.
- Every additive RR migration must register its exact checksum in the current
  checkout catalog and the explicit checkout-only exclusion set. Preserve all
  admitted historical manifests and the immutable historical96 rehearsal.
- Keep local transport occupancy until close acknowledgement, including revoke,
  crash and supervisor loss; permanently spent request/token allowance is a
  separate durable fact. Derive numeric capacity limits from the isolated
  workload and enforce them before D acceptance.
- Prove a real CLI run with tools, a final parsed review and publication at the
  approved head. A green workflow alone cannot satisfy that scenario. Include
  denial after deadline/revoke and operation after the OIDC mint has expired.

Concrete B persistence decision (implementation packet, 2026-10-03): dedicated
PostgreSQL 17.10, numbered SQL migrations and pg/@types/pg 8.23.1, verified from
the registry. No ORM or shared RR writes. The domain owns account/effect policy;
the PostgreSQL adapter owns atomic claims, CAS and durable cleanup. Real parallel
connection tests are required before acceptance; the choice alone is not proof.

Native B candidate uses opt-in private `RegisterGatewayNativeRoutes`, an
immutable native UUID/generation and creation identity, plus a fresh exact-row
check before one transport dispatch. Candidate patch `64912046` passed actual
Go compilation/HTTP tests and PostgreSQL 17.10 shape, erasure, tombstone and
two-session locking tests against stock source `96f4c115`. This selects a
concrete implementation path. Subsequent independent xhigh review requested
six corrections: mutation before the managed-account guard, timestamp equality,
false completion in the legacy bridge, reasoning-cache namespace collision,
multiline SSE parsing and completion waiting for upstream EOF. None is waived
by the earlier passing tests. The default-tier native repair job owns these
corrections; exact fixed-code regression/review, facade composition and live
provider use remain required. Stock route registration is not changed by the
candidate, and these tests do not qualify production deployment.

A documentation adoption is deliberately scoped to actual docs/ and package
READMEs. The supported Docs Protocol 0.6.2 catalog cannot express a repository-root
README collection. Root README remains bootstrap-owned; this limitation is
explicit in COMPOSITION and does not imply repository-wide protocol coverage.

Checkpoint A was merged as account-gateway PR 1 on 2026-10-03, commit
`07234f6064e202ed0d6a00922b8b3cca40a5bcad`. Independent xhigh approval covered
40 actual source fingerprints, all verified against reviewed head `226a0907`;
exact-head CI run `37087576311` passed. The merge tree equals that reviewed tree.
The private durable kernel prototype separately passed 2 domain and 9 real
PostgreSQL tests, but its opaque-attempt/binding/full-limit wire bridge is still
required. These are checkpoint results, not A–D product acceptance.

Current qualification update, 2026-10-03: the selected-result SDK correction
was merged as PR 2, commit `83f0c7ca236d27b8576853c0b6a44d8b8e8d2283`.
Independent `gpt-6.1-sol/xhigh/default` review approved the actual source; all
59 public-file fingerprints matched reviewed head `9c7a97d9`. Exact-head CI
`37094694480` passed. A new hosted sandbox passed all 25 tests and two installed
outside consumers; the applied-result regression failed on the earlier schema.

Historical kernel PR 3 head `5f07a18be3e5650495bd0b942b09f9438df50309` fixes the
active-worker lease and restore-generation cleanup defects found on `8cc30167`,
plus the smaller source/test issues. A fresh assembled-code sandbox passed
15 of 15 actual PostgreSQL cases and all 26 root tests. Two new behavior cases
failed against the old production implementation. Exact-head CI runs
`37099157508` and `37099157453` passed. Independent
`gpt-6.1-sol/xhigh/default` review requested two additional fixes: classify
an expired in-flight owner before another request can claim spare concurrency,
and snapshot an account command before awaiting a transaction. All 69 reviewed
source fingerprints matched the exact Git tree. Remediation also freezes the
trusted consumer ID across awaits. Merge is not yet approved.
Current kernel head `aea6ed03` fixes those two findings and trusted-consumer
capture. Fresh PostgreSQL qualification passed 18/18 without skips; all three
new mutation/lost-owner regressions failed on old `5f07a18b`. Exact-head CI
`37103989743` and `37103989738` passed. Independent xhigh/default review,
bound to all 69 exact Git-tree fingerprints, requested one additional repair:
`acknowledgeCandidate` must snapshot its native proof before waiting for the
transaction. F3 is fixed in owner head `9f0f65bb`: all 19 actual PG cases passed, and the
one new proof-mutation case failed on unchanged `aea6ed03`. Exact-head CI
`37107294989` and `37107295009` passed. Final independent xhigh/default review
approved the bounded kernel; all 69 public-file fingerprints and the complete
tracked path set matched that exact Git tree. PR 3 was merged as
`1ea091f87443fa2d20b391dd0aaddbd5f1d44d89`; its tree equals reviewed `9f0f65bb`.
GitHub author is `777genius` with the owner's email and the squash message
retains `Refs #1`. B2 starts from this merged main, not a dirty spike checkout.
The private kernel is not yet a running facade/native service.

Native repair `1fa66c61` passed native/ordinary Go tests, the actual standalone
Redis repository test and actual HTTP/Redis isolation. Fresh real HTTP/PostgreSQL
still returned 409. A separate synthetic sandbox established the cause:
stock migration 175's billing trigger inserts
`openai_long_context_billing_enabled: false` before the private generation
trigger, violating its strict seven-key allowlist. The Go normalizer correction
alone was insufficient. A narrow native migration correction must preserve
ordinary billing-trigger behavior and private identity guards. A separate
sandbox experiment excluding private markers from the stock billing trigger
passed the actual HTTP/PostgreSQL test and all eight nested cases. This proves
the proposed direction; it does not qualify the future worker patch or fork.
Exact repaired-code qualification and independent review remain required.
Actual ambiguous-field regression also failed on the earlier native boundary
and passed on `1fa66c61`, including zero transport entries for duplicate policy
keys. This proof does not close the pending token-cap/profile gate.

The two isolated remediation jobs finished in `gpt-6.1-sol/high/default`.
Native guarded candidate `1359a3d1` preserves ordinary billing defaults while
excluding private marker rows from stock billing normalization. Its actual Go
native/ordinary checks and fresh HTTP/PostgreSQL test passed, including all
12 nested cases: ordinary SQL/repository billing behavior, both private
profiles, exact private extras, malformed marker denial and identity guards.
Standalone and HTTP Redis tests passed on dedicated empty fixtures. SQL shape
and concurrent locking qualification, canonical fork commit and independent
fixed-code review remain required; no facade or live-provider acceptance is
implied by these native boundary checks.

C1 returned guarded patch `3a5aed10` from the isolated RR `account-gateway-v1`
code workstream at canonical main `f0c18bf7`, with
`gpt-6.1-sol/high/default`. Its bounded scope is owner/connection/binding
persistence and existing workspace authorization. Main qualified pinned frozen
installation, full Prisma generation/validation, typecheck/build, architecture,
seven lightweight cases and six real PostgreSQL scenarios after all 115 SQL
migration files. The initial historical CONCURRENTLY fixture failure was fixed
by using actual psql, without changing historical SQL. PR 488 head `1a9fa9c8`
passed dedicated CI `37104443106` and the existing self-host E2E job. Full CI
found an unregistered current checkout catalog; its correction now passes all
205 affected catalog tests, preserving old manifests. Owner correction head `96b0b8b3`
is pushed. Independent review of `1a9fa9c8`, bound to all 22 exact fingerprints,
found R1 tenant command/nested-actor mutation across authorization awaits and
R2 adapter scope/revision/metadata mutation across transaction waits. The bounded
high/default repair returned guarded patch `58303820`, integrated as owner
`9e1e581f`. Fresh main qualification passed lint/type/build, architecture and all
16 auth/fixture cases. Old production with the new tests failed nine auth cases.
Separate new PostgreSQL17.10 clusters applied all115 SQL files: two new nested
adapter cases failed on old production; the fixed candidate passed all8 cases
including root, with zero skips. These remain receipts for the pre-reconciliation
candidate, not proof for a later numbered migration.

Full CI `37107000439` found a historical through79 fixture returning the new
`Workspace.personalOwnerUserId` through current Prisma. Owner `613ad69d6`
limits fixture create/delete output to `id`; all31 actual historical PG cases
then passed on a new cluster with the stock CI role-provisioning sequence.
The initial isolated harness omitted that earlier CI role provisioning; its
handoff refusal is retained as a setup failure, not a product failure or PASS.
Both repair commits are pushed to PR488.

Main advanced to `e47607f4` and released another migration numbered116. Primary
merged that exact main into preparation `e4597001` and renumbered our never
released provider migration to117, preserving its SQL bytes. Published main
catalog authority was retained. A separate medium/default worker now registers
117's exact checksum, adds the new24-extension manifest, preserves old0..23 and
historical96, and reconciles current test catalogs. Final new-source full-schema
qualification, exact-head CI and independent xhigh review remain required before
merge; no production migration occurred.
Provider mutations, Accounts UI, repository configuration, OIDC and actual CI
publication are later C/D work; the C1 exit status cannot close those gates.

The reusable native source now has an explicit home:
`agent-teams-ai/sub2api`, a public fork of `Wei-Shaw/sub2api`.
Its `release/account-gateway-v0.2.11` baseline is pinned to `96f4c115`;
no private-native change has been merged there yet. Generated spike patches
are qualification artifacts, not a second runtime source authority. Production
composition will pin the independently reviewed fork commit/image. Upstream
latest stable was v0.2.13 on inspection; moving from the qualified baseline
requires focused compatibility/security qualification, not a silent upgrade.

Canonical native PR 2 head `d70ddf46` passed focused CI `37100218591`.
Independent review of `719c61e9` requested five repairs, with all 30 source
fingerprints verified: case-folded policy aliases, strict buffered completion,
checked buffered delivery, consistent terminal decoding and private diagnostic
suppression. Head `d70ddf46` changes only inherited CI SHA pins relative to that
review. Full CI additionally found five errcheck violations, a bulk-update test
stub regression and existing Axios production audit failures. These gates are
not waived by focused native success; both PRs remain open.

Native owner head `fa16ac72` now fixes all five review findings and the
errcheck/API stub problems. Actual native/ordinary/API Go contracts, fresh
HTTP/PostgreSQL12 nested cases and dedicated Redis repository/HTTP checks pass.
New behavioral tests fail on old `d70ddf46` with no compilation failure,
covering all five independent defect categories. A minimal actual pnpm-generated
Axios1.20 lock correction passed frozen install, typecheck, all302 critical
frontend cases and the unchanged audit exception policy; no Axios advisories
remain in the fresh audit. Existing unrelated advisories are not declared fixed.
Full exact-head CI `37107359703`, Security `37107359682` and native qualification
`37107359658` passed. Independent xhigh/default review of `fa16ac72` requested
four additional bounded corrections. All 36 changed and 16 supporting public
fingerprints matched the exact Git tree; this is not an approval:

- Private legacy dispatch must bypass ordinary Fast-policy transformation.
  A global ordinary `missing`/`force_priority` rule must not inject priority
  into an admitted default-tier private request. Preserve the ordinary rule.
- Qualify decoded critical response members before terminal delivery: native
  buffered `status`, SSE event `type`/`response` and nested response `status`.
  Duplicate or aliased names, including escaped names and either duplicate
  order, must yield unknown effect rather than successful completion. Preserve
  unrelated tool/user payload fields.
- The private legacy scanner must process complete, bounded SSE events, join
  data lines and require the blank-line delimiter. Two JSON chunks in one event
  and an unfinished DONE event cannot complete; one valid multiline JSON event
  must work. Preserve the ordinary scanner's compatibility behavior.
- Before legacy conversion completes, function-call indices must be dense
  `0..n-1`. Reject `{1}` and `{0,2}` without completed/DONE; accept out-of-order
  fragments `{1,0}` when both final calls are preserved.

The high/default W5 worker owns these native service fixes and actual transport
regressions. Main must qualify the fixed candidate and run the new cases on old
production where possible, then obtain a new exact-source xhigh review.
No native facade, provider traffic or production bootstrap is enabled.

B2's separate high/default packet owns only the private kernel. It makes the
existing server `maxConcurrent` bound an account-wide occupied-transport ceiling
across executions, including old generations and fenced/closed executions,
while retaining each execution's narrower approved limit. Claim and counting
share consumer serialization. Unknown effect, expiry, revoke or credential
erasure do not free occupancy. Exact private closure proofs and cleanup-owner
descriptors allow confirmed local transport closure after lease loss without
refunding spent allowance or changing unknown effects. Migration 001 stays byte
identical; numbered 002 and real concurrent PG tests qualify this contract.
Actual supervisor/transport closure remains a B3/D acceptance requirement.

E/F remain separate profile qualification, especially protected OAuth custody
and refresh. Neither SDK success nor MiMo BYOK closes those gates. The estimate
in plan 51 remains a range; implementation evidence may revise it. Completion
is measured by the acceptance scenarios below, not by generated LOC or a
worker's successful exit.

## Goal, scope and exclusions

First real slice: one workspace-owned MiMo connection -> server-side repository
binding -> existing RR CI runner -> tools/final review -> actual publication.
Own BYOK needs normal workspace authority, not an operator shared-pool grant.
Build the separate TS package and static Get Modular seam immediately.
Full personal sharing, new OAuth custody, additional protocols and old-pool
retirement are later checkpoints. No credential/history migration, generic
scheduler, dynamic plugin system or per-org engine instance is included.

## Proposed private facade v1

These are OUR facade routes, not existing stock Sub2API routes. Freeze schemas
and status semantics in A before the HTTP client and service diverge.
Authentication binds the consumer namespace and control/execution role;
caller-provided `consumerId`, native account/group IDs and origins are rejected.

| Route                                                   | Minimal input/result                                                                                                         | Contract                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /v1/profiles`                                      | Safe profile IDs, protocols, model IDs and auth kinds                                                                        | Server-owned catalog; no upstream URL or credential                           |
| `POST /v1/accounts`                                     | Operation ID, opaque owner ref, profile, display name, write-only credential                                                 | Stage a new connection; never expose native admin response                    |
| `GET /v1/accounts`                                      | Opaque owner filter and bounded cursor; safe account summaries                                                               | Control role only, consumer-bound; RR filters by live product authority       |
| `GET /v1/accounts/:accountRef`                          | Safe metadata, state, metadata revision, authorization epoch                                                                 | Foreign/unknown references share a non-disclosing response                    |
| `PATCH /v1/accounts/:accountRef`                        | Operation ID, expected metadata revision, display name                                                                       | Rename only; cannot transfer ownership or replace a credential                |
| `POST /v1/accounts/:accountRef/reconnect`               | Operation ID, expected metadata revision, new write-only credential                                                          | Stage/promote a new generation; old authority invalidated                     |
| `POST /v1/accounts/:accountRef/disable`                 | Operation ID, expected revision                                                                                              | Logical deny first; no implied erasure of accepted effects                    |
| `GET /v1/operations/:operationRef`                      | Pending/applied/rejected/unknown and safe error code                                                                         | Readback after timeout; no credential-bearing intent body                     |
| `POST /v1/executions`                                   | Operation ID, opaque invocation/attempt refs, permitted account refs, policy subject/revision, binding revision, profile, limits, absolute deadline | Prepare one sticky account and bounded server-only permission                 |
| `POST /v1/executions/:executionRef/requests`            | Stable request ID, trusted admission envelope, native request payload                                                        | Stream the selected protocol; no independent retry                            |
| `GET /v1/executions/:executionRef/requests/:requestRef` | Safe effect state and terminal status                                                                                        | Readback does not replay inference or return prompt bodies                    |
| `POST /v1/executions/:executionRef/close`               | Operation ID, terminal/cancel reason                                                                                         | Deny new claims; persist cleanup without erasing accepted effects; idempotent |
| `POST /v1/policy-fences`                                | Operation ID, subject ref, monotonic revision                                                                                | Acknowledged fencing blocks old dispatch admission                            |

Keep secret-submission schemas private to server ingress. Public safe DTOs use
positive allowlists; no generic passthrough object or raw vendor exception.
Management CAS uses metadata revision; execution authority uses authorization
epoch and policy/binding revision. Rename changes metadata, not credential
authority. Routine fenced OAuth refresh can change credential generation while
preserving the account/epoch; explicit reconnect does not.

The facade/kernel bridge preserves the opaque string attempt reference and
persists the binding revision and complete approved limits with preparation.
It must not narrow the attempt reference to a number or reconstruct independent
binding revision from policy revision. Claim checks use the persisted envelope;
transport enforces body/output bounds and the qualified profile's token policy.
The current bounded kernel prototype needs this bridge before HTTP acceptance.

Common safe error: code, trace reference, operation/request reference where
applicable, effect state and an explicitly justified retry hint. No raw upstream
body/header, native ID, key, token, prompt or credential fingerprint.

- `202`: operation accepted/pending, never synonymous with applied.
- `400`: invalid schema/profile combination; `401/403`: local authorization.
- `404`: unknown or foreign reference; `409`: revision/idempotency conflict.
- `429`: our admission limit returns not-dispatched plus safe retry timing.
- Upstream `401/429/5xx` alone does not prove no paid effect. The qualified
  adapter must supply the effect classification; ambiguity fences the invocation.
- `5xx` or lost response after mutation/dispatch requires status readback. The
  SDK does not automatically repeat a secret mutation or inference POST.

### References that survive a lost acknowledgement

- Within the authenticated consumer namespace, `operationRef` equals the
  client-supplied stable `operationId`. It is an identifier, not a credential.
  A caller can read `GET /v1/operations/:operationRef` even when the initial
  response never arrived. A server-generated reference available only in that
  lost response is insufficient.
- Operation readback has a strict, bounded result union: account mutations may
  return the safe account reference/revisions; execution preparation may return
  the safe execution reference/deadline/state plus the actually selected
  `accountRef` and `authorizationEpoch`. Both preparation acknowledgement and
  operation readback return that same persisted tuple. It never returns a submitted key,
  upstream document, admission envelope or CI capability. RR issues its own CI
  grant through the existing authorized control plane.
- Within an execution, `requestRef` equals the stable caller `requestId`.
  After losing the request response, the caller already has the readback URL.
  No readback operation resumes a stream or dispatches another inference.
- Readback `404` means no visible durable record, not proof that retrying a
  paid request is safe. Once transport has been entered, RR stops that attempt
  and reconciles the original identity. An uncertain result remains fenced;
  neither a new operation ID nor a fresh execution can bypass the same
  invocation/attempt fence.

### Preparation identity and MiMo token policy

Independent readiness review on 2026-10-03 identified two integration omissions;
these decisions close their specification, not their implementation gates.

The gateway may choose one sticky account from the approved set. RR retains the
outgoing preparation intent and obtains the selected account/epoch ONLY from
the applied preparation result or its operation readback. Construct subsequent
admission from that persisted tuple plus the saved profile, subject, revisions,
limits and deadline. Do not infer the chosen epoch from a later account GET or
narrow the contract to singleton sets to avoid returning it. The selected tuple
must belong to the approved set/profile. Reconnect before/after preparation and
lost acknowledgement need actual facade/DB tests with zero stale dispatch.

The merged A SDK now requires both selected-result fields through its single
`executionResult` schema (PR 2, `83f0c7ca`). Applied-result HTTP and installed
archive regressions passed; actual facade/native selection remains a B gate.
Safe readback contains no admission capability, credential, native descriptor
or prompt/output body.

For initial MiMo native Responses, `limits.tokens` means the maximum generated
output tokens PER REQUEST, including reasoning; input is separately bounded by
request bytes and the qualified model context. It is not a currency/credit or
execution-total input/output budget. Execution's conservative output ceiling is
`limits.requests * limits.tokens`; no tokenizer/billing/refund subsystem is added.
Each atomic dispatch claim permanently consumes one request slot and fixes its
approved cap. Completion or missing usage does not recycle slots; uncertain
effects retain the slot/cap and fence the attempt. Concurrent claims cannot
exceed the approved request/concurrency limits. The prototype kernel currently
limits concurrency per execution. Before B dispatch acceptance, enforce the
profile's account-wide bound across executions in the same durable admission
authority; two executions sharing an account must not each consume the full
account capacity. A second independent scheduler is not required.

Track occupied concurrency separately from permanently consumed request/token
allowances. An unknown request retains its occupied slot until the exact local
transport owner acknowledges that its request context and response body are
closed. Deleting an old credential generation alone is not that acknowledgement:
an already opened response stream can outlive the generation lock. Cleanup can
release local occupancy without changing `effect_unknown`, refunding the spent
allowance or claiming that the upstream did not bill. Qualify this distinction
with a held-open stream, revocation and supervisor loss before enabling dispatch.

The server-owned profile injects `max_output_tokens` when absent and clamps a
valid larger caller cap to the approved per-request cap. Invalid/non-integer or duplicate top-level
caps are rejected before native entry; first-key/last-key JSON ambiguity must
not bypass the approved cap. The profile also narrows the generic SDK
ceiling to the provider's qualified range. MiMo's published Responses reference
documents output plus reasoning, a 1–131072 range, `usage.output_tokens` and an
incomplete response on cap exhaustion:
[MiMo Responses API](https://mimo.mi.com/docs/en-US/api/chat/responses), observed
2026-10-03. This is a documented candidate policy, not proof for Token Plan's
specific endpoint/model/catalog. Preserve protocol-native bytes except that
approved request parameter; the SDK does not convert or meter the protocol.

B tests the actual capped outgoing payload and atomic claim counts against a
controlled HTTP upstream; D proves the selected live Token Plan profile obeys
the cap, including exhaustion and usage. Missing/oversized cap, two tool requests,
concurrent claims, lost usage and uncertain dispatch must preserve the bound.
Cap exhaustion must not synthesize successful completion/final publication.
If the selected endpoint cannot enforce the cap, finish profile compatibility
work before enabling it; output byte bounds are not token enforcement evidence.

Reject case-folded aliases and duplicate critical policy/terminal fields before
different JSON decoders can disagree. Buffered legacy responses need a supported
choice and qualified finish reason; `{}`, error-only bodies and truncated output
cannot become synthetic successful completion. Stream and buffered delivery must
check full writes and flush errors before acknowledging completion. These are
native adapter guarantees; the public SDK continues to pass the selected protocol.

## Canonical records and constraints

Names below describe responsibilities, not a required ORM/table naming scheme.
RR and gateway have distinct authorities; no shared database writes.

| Authority | Canonical records / constraints                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| RR        | Account owner is exactly one stable User or org Workspace; personal scope explicitly linked to User; immutable owner in this slice           |
| RR        | WorkspaceAccountBinding unique by workspace/account; active/revoked state and revision; repository policy references only an allowed binding |
| Gateway   | Account mapping unique by consumer/accountRef; ownerRef, state, metadata revision, authorization epoch and active credential generation      |
| Gateway   | Native route mapping unique by account/generation/profile; private engine identity proof; no native-ID-only lookup                           |
| Gateway   | Account operation unique by consumer/operationId; stable target, revision and private request fingerprint; safe status/result                |
| Gateway   | Invocation/attempt unique in consumer namespace; selected account/epoch, subject revision, limits, deadline and active/fenced/terminal state |
| Gateway   | Request identity unique per execution; durable claim/effect state; no new request ID bypasses an invocation fence                            |

Gateway owns engine routing/operations. RR owns membership, workspace bindings,
repo/model policy and publication. Engine groups are derived routing, not a
second tenant authority. Credential-bearing operation data is not a plaintext
journal; use protected transient custody where reconciliation requires it.
Conflict fingerprints are private and secret-safe, not public/logged key hashes.

### C: concrete Review Router integration decisions

Inspected canonical RR main `f0c18bf7759c030f311cf21050d6a61718e9dcd4`
on 2026-10-03. Its schema, provider catalog/runtime plan and review configuration
save/resolve sources match the previously inspected `99f5e97c` files. This
inspection is not implemented C behavior. Freeze the following in the C packet:

- Reuse live `assertWorkspaceAdminAllowed` for workspace account and settings
  mutations: stable User identity first, existing immutable GitHub-ID fallback,
  existing owner/admin policy and explicitly configured local-admin override.
  Ordinary members cannot submit/reconnect/disable keys. UI hiding is not
  authorization. Own BYOK does not require a shared-pool operator grant.
- Add canonical RR connection ownership with exactly one User or Workspace
  owner enforced by a DB check; never derive a personal owner from display name,
  login or oldest membership. The present Workspace schema has no personal-owner
  field. This slice may create workspace-owned connections; personal provisioning
  must record its stable User link explicitly before personal connections are
  admitted. Ownership transfer and personal-to-org sharing stay deferred.
- Keep one connection record and separate unique workspace/connection binding
  with active/revoked state and revision. Initially bind only to its owning
  workspace. Foreign consumer bindings need the later explicit sharing grant;
  copying a key or connection row is not a substitute.
- Accounts connects/renames/reconnects/disables. Models selects the connection,
  model and repositories, and changes server-side configuration. Preserve
  existing repository override -> workspace default -> safe default precedence.
  A workspace default applies only to repositories without an override.
  Credential submission/reconnect uses a dedicated one-off server ingress.
  Provider keys must not enter React Query mutation variables/cache, browser
  storage, readback DTOs or refetch results; interactive cached data contains
  only safe connection/binding metadata.
- The initial Codex/MiMo route needs a new explicit gateway auth mode in the
  existing provider catalog plus a binding reference in versioned provider
  configuration. Preserve that mode in normalization; its required secret names
  are empty. Keep upstream profile/model selection server-owned. The current
  catalog has no MiMo or gateway mode; changing only its visible label cannot
  make the CI path work. Other agent/profile combinations require their own
  qualification, not a new engine-specific product domain.
- Persist the selected binding in ordered provider versions and the primary
  representation together; DB relations must keep configuration, repository and
  binding in the same workspace. Provider-row identity/deduplication must retain
  the selected connection. Exact Prisma/SQL field names and constraints belong
  to the bounded C persistence patch, with actual DB tests.
- Reuse per-target `expectedVersion` CAS. Batch preflights every target's live
  workspace/repository authority, then returns an individual applied/conflict/
  rejected result with stable operation identity. Do not overwrite a stale
  target, silently drop a selection or claim all-or-nothing success. A network
  timeout causes readback of that target, not a new secret submission. Refetch
  retains selected targets and truthful results.
- OIDC registration resolves the current repository configuration and active
  binding server-side, pins its revision/account/profile/approved head and
  issues only the bounded RR relay grant. CI cannot choose another owner,
  account, origin or longer deadline. Revocation must deny new local admission
  immediately and remain pending until the gateway fence is acknowledged.

The C packet must include tests for member/foreign binding denial, repository
override precedence, binding surviving version serialization, two-target CAS
partial failure and revocation between registration and transport claim. Use
the nearest real boundary for each risk; UI fixtures alone cannot prove DB or
gateway isolation.

Idempotency rules:

1. Same consumer/operation ID and same intent returns the existing operation.
2. Reused ID with different target, expected revision or credential intent
   returns `409`; never silently apply the second body.
3. Record the native step/owned candidate before its possible effect. Lost
   native acknowledgement means unknown, not permission to create another row.
4. Reconcile only through the exact owned candidate and adapter-supported proof.
   If identity/effect proof is missing, quarantine and deny use; do not guess by
   name, latest native row or reused integer ID.

## Account transitions and partial failure

```text
new -> staging -> active
              -> quarantined / rejected
active -> staged reconnect -> atomic promotion of new generation
active -> disabled -> tombstoned after independent cleanup/retention
```

- `staging` is not executable. Native setup/probes must not escape the approved
  profile or secretly enable model traffic while preparation is incomplete.
- During reconnect, the existing generation remains unchanged until promotion.
  Promotion atomically changes the active route/epoch; old permissions become
  unusable. A partially prepared candidate never becomes the default route.
- If native effect or promotion acknowledgement is uncertain, read back the
  canonical mapping/operation. Do not report success or create another candidate.
- Disable closes local admission, persists the matching fence and reports
  applied only after gateway acknowledgement. Pending cleanup does not grant use.
- Native cleanup may be delayed or fail. Keep an inert owned residue and safe
  status; cleanup retry cannot re-enable the account or select a foreign row.
- Native row deletion/reuse, restored stale mapping or descriptor mismatch
  quarantines the route. B must prove the adapter's actual identity mechanism;
  do not pretend stock engine IDs alone establish generation identity.

## Run lifetime, effects and restart

Use ONE capability bounded to the approved run deadline in the initial slice.
Validate OIDC when issuing it. Compute deadline on the server from existing
review timeout, run authority and policy limit; the client cannot extend it.
OIDC mint expiry does not prematurely truncate the approved run grant. No
renewal subsystem is required. If an actual supported runner needs renewal,
specify/qualify it as a separate change rather than adding it speculatively.

Run identity includes repository, workflow/run, run attempt and approved head;
reissue does not create another concurrent execution. Before publishing,
existing RR head/finality and publication-idempotency checks remain mandatory.
The PR author need not own the provider account; workspace authorization decides.

Use the acknowledged envelope/fence contract in document 50 section 5. Dispatch
claim and permission/epoch checks are atomic in gateway state. A fence denies
new claims; accepted effects remain classified. Keep account identity sticky,
with backup disabled until its profile-specific safe classification is proven.

```text
not_dispatched -> dispatch_started -> response_started -> completed
                       \____________________> effect_unknown
```

Persist possible dispatch before entering native transport. If the owner dies
after that boundary, mark ambiguity and fence; lease expiry is not proof of no
upstream effect. A repeated request POST returns a safe status/readback reference,
never another inference or a reconstructed partial stream. Keep the output stream
ephemeral; recovery GET returns effect state, not recorded prompt/output bodies.
Partial SSE/cancel/timeout is not permission to retry with a fresh request ID.

Cleanup belongs to a durable gateway operation owner independent of the CI
capability and supervisor lifetime. After restart, reconcile nonterminal claims;
ambiguous attempts stay fenced, incomplete candidates stay inert. Do not resume
inference automatically. Native residue cleanup is scoped to its recorded owner.
Restore requires an explicit fresh admission/issuer epoch and quarantine check;
restored old grants/claims cannot dispatch or replay. Normal restart recovery
and backup restore are separate test cases.

At each asynchronous admission or mutation boundary, snapshot the trusted
consumer identity and accepted primitive intent before the first `await`. Use
that same snapshot for authorization, CAS, writes and idempotency fingerprints.
A mutable caller object must not switch consumers or recorded intent while a DB
lock is pending. A fresh worker lease must not admit another request into an
execution whose earlier in-flight owner has expired, even with spare concurrency.

## Primary acceptance owners

| Scenario                              | Expected evidence / nearest boundary                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package/static graph                  | Install the exact archive outside the source tree; public exports/type closure; correct graph; invalid slot/missing factory rejected before effects   |
| Consumer/owner denial                 | Real facade+DB denies foreign references/role and unsupported profile, with zero native dispatch                                                      |
| Create/reconnect lost acknowledgement | Native adapter fault injection leaves one owned candidate; readback/quarantine; no duplicate row or silent activation                                 |
| Rename vs reconnect                   | Metadata rename preserves execution identity; reconnect revokes old authority and new calls use only the promoted generation                          |
| Native ID reuse/restore               | Stale route cannot select a different physical account; old permission denied                                                                         |
| Revoke race                           | Pause between RR admission and gateway claim, acknowledge fence, resume: no dispatch; already claimed effect retained                                 |
| Long run/deadline                     | Request after OIDC mint expiry and before approved deadline succeeds; after deadline or revoke denies new dispatch                                    |
| Cancel/partial SSE/crash              | Unknown outcome retained; no inference replay, duplicate publish or second refresh writer; cleanup after supervisor loss/restart                      |
| UI batch                              | Two disposable repos, per-target CAS and truthful partial status; saved selection/result survives refetch; server bindings change without key copying |
| Real RR CI                            | Actual CLI spawn, tools, final parsed review and publication at approved head; missing final answer is failure; no master in CI/logs/artifacts        |

Reuse existing disposable repositories after fresh App/permission inspection:
`777genius/rr-selfhost-direct-v2-e2e-20260730t115357z` (ID 1317214237) and
`777genius/rr-selfhost-direct-v2-e2e-20260730t120036z` (ID 1317220367).
Both were freshly read through `gh` as unarchived E2E sandboxes on 2026-10-02.
No inference, workflow dispatch or repository mutation occurred in this review.

## Bounded implementation and qualification packets

Do not ask a worker to infer native capability from the facade route list. Each
checkpoint packet names its exact source/base SHA, owned paths, installed
toolchain, engine SHA/image when applicable, test project, commands and receipt
destination. Record observed results separately from planned assertions.

- **A freezes:** strict schemas for all routes and safe result unions; the
  stable-reference rules above; role separation; archive/public export closure;
  and zero-resource construction on invalid static wiring. Its HTTP fixture is
  evidence of client behavior, not native engine or tenant-isolation proof.
- **B decides from evidence:** the actual native account identity/generation
  proof, create/reconnect readback and account pin. Name the exact native API
  and persisted proof mechanism. If stock Sub2API cannot supply one, make the
  smallest pinned fork change and qualify it before allowing execution. Never
  replace the missing proof with a display-name lookup or shared group.
  First qualify MiMo's native Responses through explicit Sub2API API-key
  passthrough: the [official Codex guide](https://mimo.mi.com/docs/en-US/tokenplan/integration/codex-configuration),
  updated 2026-09-22 and observed 2026-10-03, documents Token Plan Responses
  and requires its model catalog for freeform lite custom tools. Pin the actual
  catalog, model, endpoint and CLI in D. Documentation alone is not live proof;
  retain the historical conversion profile separately, without automatic
  fallback after an uncertain dispatch. SDK/facade do not convert protocols.
- **C freezes:** the actual existing membership/role policy, canonical RR
  owner/use constraints, affected repo/model policy fields and per-target CAS.
  UI success follows acknowledged server state; pending/unknown is visible.
- **D records before its final gate:** a bounded workload and explicit numeric
  request/output/buffer/concurrency limits, run deadline and cleanup target.
  Capacity measurement chooses the supported values; the final candidate must
  pass them. A measurements-only report cannot claim these limits are enforced.

Every PASS receipt binds candidate SHA/image, scenario, test identity, command,
observed outcome and retained evidence. An actual paid canary is one planned
invocation; an uncertain response triggers readback, not an automatic re-run.
Missing tools, final parsed review or approved-head publication fails the real
CI gate even if the workflow itself reports success.

Rollback for A–D closes only the new gateway execution admission first, keeps
unknown-effect and cleanup records, and reverts the bounded code/config change.
It cannot replay inference, restore revoked capabilities or reactivate a legacy
pool. The existing production pool is not retired by this first-slice gate.

## Checkpoint prerequisites and open empirical decisions

- **A:** separate package/repository, freeze the above candidate schemas, exact
  artifact/toolchain and installed public API checks. B proves native use.
- **B/C:** prove native identity/pin, operation reconciliation, concrete DB
  constraints and local source gates. Native setup must stay private/inert.
- **D/release:** record numeric body/output/buffer/concurrency and cgroup limits,
  repeated-burst/retained-heap/cleanup SLOs, and their workload/source/image pin.
  Derive them from the bounded sandbox capacity measurement; do not invent PASS
  or use forced GC to repaint the historical RSS failure.
- **F:** choose and qualify protected OAuth custody across DB, both Redis
  projections, refresh/history, export/debug and restore paths; prove one refresh
  writer and live test-account setup. Server-only BYOK evidence is not this proof.
- **G:** retirement starts only after required D/E/F receipts. Disable old pool
  admission/refresh/grants without migration; preserve unrelated data. Unrelated
  explicitly configured standalone Action BYOK is not a gateway fallback.

Use actual package scripts discovered in A and focused affected RR gates, then
one exact-head final CI per mergeable PR. No installed artifacts, live OAuth,
capacity thresholds or deploy command are claimed qualified by this card.
