# Conversational memory implementation record

Implementation of [the reviewed plan](./2026-10-28-conversational-memory-and-shared-llm.md), authorized by the owner on 2026-10-28. The plan's three design-review rounds are historical. This delivery receives **three new implementation-review rounds**. Implementation, deterministic qualification, live model quality and production activation are separate states.

## Delivery

- Control plane: draft [PR #734](https://github.com/777genius/review-router-ai/pull/734), branch `feat/conversational-memory-e2e`, base `main`.
- Action: draft [PR #350](https://github.com/777genius/review-router/pull/350), branch `feat/conversational-memory-runtime`, stacked on the native delivery fix in #349.
- Implementation and independent review delegates use `gpt-6.1-sol`, `xhigh`.
- No merge, release registration, deployment or contextual-profile activation is part of the completed source checkpoints.

The configured-provider default from #729 is included: a configured backend enables existing memory policy by default, and explicit disable wins. The new transient conversational capability additionally requires its scoped deployment qualification; an environment declaration alone is not qualification evidence.

## Plan coverage

| Plan requirement                              | Implementation and evidence                                                                                                                                                      | Remaining qualification                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source-processing/privacy/authority successor | [ADR032](../decisions/032-conversational-memory-source-processing.md), strict scoped qualification parser, exact repository/runtime provisioning, API-only conversation metadata | Real native privacy/log and App-first deployment proof                                               |
| OCR one-pass native rendering                 | New rr.5 patch/profile/manifest, ordinary executable CLI **13/13**; literals survive plan/main, no-Skills/Skills, second round and compression cases                             | Candidate binary is not published or activated                                                       |
| Portable memory library                       | `context-memory` native preview/read/list/exact-write/status/recall mappings, real Router consumer, actual packed ordinary npm consumer **5 capabilities**                       | No registry publication claim; reflect/full physical forget explicitly unsupported by the library    |
| Strict native preview                         | One chunk/provider, no split/retry/partial-empty success, strict completion header, source-control fixture; selectable/context privacy canary included                           | Latest real native image/API/privacy workflow and selected native-model semantics                    |
| Managed conversation entry point              | Qualified immutable caller, signed OIDC reusable source facts, App custody, process/status/publication endpoints and real `app.ts` wiring                                        | Disposable installed Gateway-only caller and configured App author                                   |
| Plain inference without ar                    | Application-owned text/JSON port, independent Gateway SDK Responses adapter, selected account/model, one request, bounded SSE/cancel/output semantics                            | Live selected-account profile/model qualification                                                    |
| Full thread and source coherence              | All pages/authors, source actor/PR/revision, code/base/head/vector checks; **105-comment** actual request witness                                                                | Final independent core review and live source integration                                            |
| Learning independent of reply gates           | Shared native selection/exact persistence; replies-off/capped paths; no model retry after missing output                                                                         | R1 memory admission repair; semantic corpus execution                                                |
| Replay and uncertainty                        | Stable accepted identity, frozen bounded intent/output, SQL reply reservations, one-use publication claim, marker reconciliation and body purge                                  | R1 core review                                                                                       |
| Automatic source cohorts                      | Atomic visibility, late callback fences, quota-full replacement, suppression/relearn and maintained detachment; real PostgreSQL tests                                            | **R1 found interrupted command admission and stale invalidation races; fixes in progress**           |
| Common source eligibility                     | API/dashboard shared App reader, bodyless current-source checks, generation/epoch/source/actor binding, derived evidence filtering                                               | R1 conditional invalidation repair                                                                   |
| Review/investigation/description inputs       | Shared capture owner with distinct internal/PR-reader audiences, exact task/hash receipts, separate investigation grant hook, issued-lease replay retained                       | Required remote checks on final paired heads                                                         |
| Natural-language CRUD and truthful status     | Existing authorization/CAS/command owner, exact targets and exception rule references, bodyless stored-effect status reconciliation                                              | Ambiguous-intent and authority quality cases; live semantic gate                                     |
| App publication                               | Exact frozen marker/body/parent/PR/App verification; one atomic claim before first create; lost claim/create ACK reconciled                                                      | Real disposable App publication proof                                                                |
| Quality corpus and scorer                     | 48 whole threads, 32 tuning/16 protected, 8 linked pairs; actual product/native runner; unavailable configuration cannot pass                                                    | **R1 found incomplete inventory accounting and missing revision/authority cases; fixes in progress** |
| Focused integration and UI                    | Real PostgreSQL, actual Action/HTTP/SDK boundaries, native OCR CLI; rendered UI **6 checkpoints/20 screenshots**                                                                 | Live provider/model/App claims remain excluded                                                       |
| Protocol and architecture                     | Canonical generation/export, official Action bundles, full `protocol:check`, Foundation and negative fixtures passed                                                             | Recheck changed gates after review fixes                                                             |
| Three implementation review rounds            | R1 runtime and memory reports received; core review active                                                                                                                       | R1 fixes, R2, R3                                                                                     |

## Current immutable checkpoints

| Checkpoint                                        | Purpose                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `c0c8c811`                                        | Native preview and automatic source lifecycle foundation                                                 |
| `6c59065b614e6f239742e616c29261f444541a8d`        | Supported native environment retry control; unsupported bank config removed                              |
| `60d8dc71c521117e1cab2f53def713cd6c330e29`        | Finite conversation core and durable processing                                                          |
| `04b8f065`                                        | Portable native mappings, shared current-source reader, quota-safe replacement and dashboard integration |
| `157eed60e97ecfc31d9ceaea8c8c989eb9e9e3be`        | Canonical one-use publication claim contract                                                             |
| `cb357029`                                        | Full API, workflow, scoped authority, task admission, ACL, ADR and native canary integration             |
| Action `7a4f5bbc7e8b6eb41c16d869be3b737e9e401811` | Final claim-aware source, official production bundles and canonical handoff                              |

The canonical CP-to-Action handoff digest is `ec10a4f95283381d97cdbf29809b8d91ed2f58b09e9b11d26cf7bf02dff78ba4`, generated by the sanctioned exporter from CP `157eed60`. The protocol remains deterministic and current after the API integration.

The locally qualified OCR candidate has upstream `8eb83340a487b1150af00701b94f01af97e4b4d6`, eleven-patch digest `a93258b4dc796d33e2174a989188edf88a966e14ec806d2cb305adc44d85aa61`, and binary SHA-256 `9c666b25f7b189d5af8e59beb877e0a449869166116975fbd8e634bd1b370969`. The existing rr.4 identity remains separate. This evidence describes actual local executable bytes, not a published release artifact.

## Verification completed before review fixes

Counts below overlap and must not be added into a single total. Local logs and JSON reports are retained under the task's `tmp/conversational-memory-implementation/` directory; the reproducible tests and native qualification owners are committed.

| Gate                                                        | Observed result and boundary                                                                                                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full migration chain                                        | Passed on isolated PostgreSQL **17.10**, using the unchanged ordinary role-free CI migration recipe                                                                                                  |
| Finite conversation final checkpoint                        | **12/12**, zero skipped, after the last source/status/hash edits: actual Action client/publisher → Fastify TCP → use case/Prisma → independent Gateway SDK HTTP fixture                              |
| Paired review, investigation and description                | **10/10**, zero skipped across three existing suites, on a separate fully migrated database; actual Action factories/manifests, SQL authority and App HTTP fixtures                                  |
| Existing investigation-store PostgreSQL file                | **22/22**, including rejected new grant and unchanged issued-lease replay after eligibility changes                                                                                                  |
| Memory/portable/dashboard focused set                       | **60/60**, including real PostgreSQL; additional full-quota replacement regression passed                                                                                                            |
| API memory runtime and SQL grant tests                      | **18/18**, including exact private text in internal input, its absence from public description, and wrong-task receipt rejection                                                                     |
| Source bootstrap, provisioning, SSE and scope qualification | **134/134** focused cases                                                                                                                                                                            |
| Strict parser and canonical export contracts                | **26/26**                                                                                                                                                                                            |
| Full protocol gate                                          | `protocol:check` passed: producer bootstrap, two deterministic generations, protocol build, action-control-plane typecheck and native API typecheck                                                  |
| Full architecture gate                                      | 592 domain/application files; Foundation 2.1.0 full coverage with zero diagnostics; **23** memory and **6** statistics real-workspace negative cases                                                 |
| Actual packed library                                       | Ordinary isolated npm installation, import by package name, five implemented mechanisms passed; no Router/organization credentials or product imports                                                |
| Rendered dashboard                                          | Chromium **156.0.8078.4**, six desktop/narrow checkpoints and twenty screenshots; keyboard/focus, repository selection, save/publish/retire/forget and unknown-result retry; synthetic HTTP fixtures |
| Final Action                                                | Full TypeScript check and both official builds passed; **54/54** claim/client/workflow/artifact cases, **159/159** task-audience/runner cases and **18/18** derived-evidence goldens                 |
| Actual native OCR                                           | **13/13** normal executable-path CLI cases plus focused native Go checks; deterministic model responses prove input delivery/integrity                                                               |
| Evaluation availability                                     | Structural corpus validation and real parser baseline observed; missing live configuration returns `UNAVAILABLE` without inference; **no quality PASS is claimed**                                   |

The shared host required bounded native compiler resources (`GOMEMLIMIT=768MiB`, `GOMAXPROCS=2`) while retaining the exact pinned TypeScript 7.0.2 compiler and full selected project. Earlier legacy heap exhaustion and unbounded-process termination are failures, not verification evidence.

## Implementation review ledger

The earlier nine design critics do not count toward this ledger. Reports distinguish confirmed faults, nonblocking corrections and external qualification blockers.

| Round and lens                        | Result                                                                                                                                                                                                                     | Disposition                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R1 runtime/native/portable/evaluation | P1: unexpected-source writes were filtered out before scoring. P2: corpus lacked genuine existing-source revision and ambiguous-authority sequences. README mission example omitted a required argument.                   | Author correcting complete observed inventory and bounded scenario coverage; no new framework |
| R1 memory/lifecycle/authority         | P1: crash between cohort reservation and child command admission strands selected statements. P2: stale work can invalidate a newer cohort without an observed-binding CAS. Both reproduced with actual Prisma/PostgreSQL. | Author repairing durable admission and conditional invalidation within existing owners        |
| R1 core/source/inference/publication  | Review active                                                                                                                                                                                                              | Pending report and fixes                                                                      |
| R2                                    | Not started                                                                                                                                                                                                                | Must review R1 fixes and the complete plan                                                    |
| R3                                    | Not started                                                                                                                                                                                                                | Must review final implementation and remaining evidence                                       |

## Deliberate refinements to the reviewed design

1. **Admit the frozen product model input before automatic cohort replacement.** Learning changes the same memory epoch. Reversing the order invalidates the operation's own receipt. This does not authorize context recapture, another model grant or a second extraction; new facts help subsequent turns. Native learning remains independent of a missing/malformed product answer.
2. **Capture a separate audience through the same owner.** Internal review/investigation retains existing authorized workspace knowledge. Description captures a separate bounded PR-reader projection with its own task-bound hash. A single universally public-filtered snapshot would silently remove useful authorized internal context.
3. **Claim publication once immediately before the first create.** The claim checks the frozen source/authority and original deadline, then atomically withdraws the fresh-create permission. It completes the already admitted model operation rather than reapplying the short recall-capture TTL after model execution and learning. Lost acknowledgements preserve uncertainty and never authorize another create.

These refinements are recorded in the canonical plan and ADR032. They introduce no agent runtime dependency, second retrieval policy, semantic verifier, workflow engine or parallel cleanup owner.

## External qualification and remote checks

The new contextual profile remains unavailable until its applicable native privacy/strict-preview deployment, real selected-model tuning/protected evaluation and disposable App-first Gateway interaction pass. Synthetic transport tests and a manually supplied proof-shaped configuration do not replace those gates. No protected live quality checkpoint has been consumed.

At the last recorded remote observation, most Linux jobs for the current draft were queued without a running executor; macOS jobs could run. An older Skills browser attempt failed one navigation timeout after 23 passing cases; newer heads are checked independently. Required checks are not removed, marked successful manually or bypassed. The final PR report must state the actual final-head status rather than inferring CI success from local tests.
