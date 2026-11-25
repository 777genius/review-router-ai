# Full memory backend replacement: research and criticism

Date: 2026-10-23.
Status: research recommendation, not an accepted replacement ADR or deployment.
Owner intent: prefer a ready memory engine and permit removing the custom engine.
See [Memory product vision](../product/09-memory-product-vision.md).

Subsequent owner decision, 2026-10-23: **self-hosted Hindsight is selected**.
The [concrete replacement plan](../plans/2026-10-23-hindsight-memory-replacement.md)
records the later integration research, critic rounds and revised cross-repository
estimate. This earlier comparison remains a dated research record; its candidate
language and limited-slice estimate do not override that selection or plan.

## Recommendation

Stop treating development of the custom memory engine as the default direction.
Qualify a complete external backend that owns memory content, extraction,
consolidation, indexing, retrieval and native lifecycle. Keep the application
responsibilities that belong to ReviewRouter, without a second editable fact
store or a custom semantic engine.

Hindsight is the first candidate for that qualification. This is a conditional
recommendation based on current source and documentation, not proof that it wins
on ReviewRouter's conversations. MemOS is the most relevant OSS challenger from
the additional shortlist. Mem0 OSS is less aligned with automatic reconciliation
of changing facts. Managed Hindsight and Supermemory are separate options if
reducing infrastructure operation is a priority; selecting paid hosting or a
different data-retention policy is not implied.

An external engine can run in our infrastructure. Using an external engine does
not itself mean sending repository information to a managed third-party service.

## Evidence and scope

Three parallel GPT-6.1 Sol xhigh researchers examined Hindsight, competing
backends, and the current Router implementation. Three fresh GPT-6.1 Sol xhigh
critics challenged architecture, backend selection, and product/cutover claims.
The final recommendation incorporates their corrections below.

Pinned source snapshots:

| Project      | Checked version / commit                          |
| ------------ | ------------------------------------------------- |
| ReviewRouter | main at 296ddc0327b7dfc762c31b5b1d39e5461a41c12c  |
| Hindsight    | v1.1.0, a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5  |
| Mem0         | v2.2.1, 94c3fe9f238f3dbf29c9ce98643bd71eb13077cd  |
| MemOS        | v2.0.34, 41bf5c7fa89ee08ebedf3c662638b06fc29aca8d |

Hindsight's annotated tag object is df2bbce99a237a85bbcd3abc5eed099c220547f5;
it resolves to the commit above. Source and documentation were inspected, but no
native LLM quality benchmark, production load test, production data inventory
or live migration was performed. No runtime code was changed for this research.
Cognee/Graphiti adapters and Infinity Context internals were not re-inspected.

## What exists today

The current design keeps canonical memory in PostgreSQL and delegates a derived
search projection to an adapter. Search returns item IDs, versions and hashes;
the application reloads the corresponding PostgreSQL item. This cannot simply
be renamed into a full provider contract: independently derived provider
knowledge does not have a canonical Router item.

The current custom core is mostly CRUD, canonical lifecycle, exact-hash
deduplication, suggestions, approval, expiry/prune and projection bookkeeping.
It is not already a feature-equivalent semantic memory engine.

Sources: [current adapter plan](../plans/2026-10-22-memory-engine-adapters.md),
[search port](https://github.com/777genius/review-router-ai/blob/296ddc0327b7dfc762c31b5b1d39e5461a41c12c/packages/features/memory/src/application/ports/memory-search-index-port.ts),
[runtime retrieval](https://github.com/777genius/review-router-ai/blob/296ddc0327b7dfc762c31b5b1d39e5461a41c12c/packages/features/memory/src/application/use-cases/build-action-memory-bundle.ts).

### Measured code inventory

Physical lines include comments and blank lines; the trailing newline is not
counted as another line. Categories below are not additive deletion estimates.

| Area                                                    | Files | Physical LOC |
| ------------------------------------------------------- | ----: | -----------: |
| Memory feature production source                        |    72 |        9,365 |
| Application, included above                             |    34 |        4,044 |
| Domain, included above                                  |    12 |        1,047 |
| Infrastructure, included above                          |    22 |        3,435 |
| Composition, included above                             |     1 |          234 |
| Interaction interface and public barrel, included above |     3 |          605 |
| Feature tests and fixtures, separate from production    |    12 |        7,846 |

A 10-file search/projection-specific subset is 2,464 production LOC. Another
15-file canonical aggregate/persistence subset is 1,869 LOC, but includes useful
application responsibilities. Neither number means every line should disappear.

Outside that package: action memory routes are 680 LOC; worker projection
maintenance/operator code 294; general memory maintenance 396; dashboard
dependencies/export 220; the old management panel 1,651. These are mixed
surfaces, not entire-file deletion instructions. Four memory Prisma models and
six enums occupy 166 lines, plus eight relation backlinks. Five SQL migrations
contain 276 lines; migration history must not be rewritten.

## Target responsibility boundary

| Ready backend owns                                        | Router owns                                                |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| Current knowledge and its native revisions/lifecycle      | Workspace/repository identity, membership and access       |
| Extraction and native knowledge-selection configuration   | Allowed source policy and source revision identity         |
| Semantic matching, consolidation and derived knowledge    | Approval authority and user decisions                      |
| Embeddings, graph, indexes and retrieval ranking          | Scope-to-provider mapping and review applicability         |
| Native edit, invalidation, deletion and export operations | Operation status, retry coordination and relevant audit    |
| Provider administration and storage maintenance           | Product UI and future LLM tools through the same use cases |

Router may configure the engine and orchestrate native operations. It should not
gain another embedding store, semantic deduplication service, consolidation
scheduler, generic graph engine or independent reconciliation model.

Application contracts should express actual intake, read, correction, deletion,
export and operation-status needs. Keep vendor SDKs inside adapters and assemble
one configured provider through the existing composition boundary. Get Modular
and Engineering Foundation enforce dependencies; they do not require a new
plugin platform or a provider-optional local implementation.

Replace the PostgreSQL reload requirement and local lexical fallback. If memory
is disabled or unavailable, ordinary reviews continue without memory. The
application database still stores users, authorization, operation metadata and
other non-memory product data.

One provider adapter is sufficient for the first implementation. Additional
providers must meet the meaningful contract and expose extra capabilities
honestly; do not emulate a missing engine capability with a large Router
subsystem. Infinity need not be an obligatory intermediate service in front of
a directly qualified backend.

## Backend comparison

| Candidate           | Evidence relevant to this product                                                                                | Main qualification concern                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Hindsight           | Native extraction, evidence-backed observations, hybrid recall, document updates, curation and source references | Current-rule correctness across separate discussions; approval/version ordering; chosen privacy profile  |
| Mem0 OSS            | Native extraction, retrieval, manual update/delete/history and self-host tooling                                 | Current extraction is deliberately ADD-only; automatic semantic replacement would need another mechanism |
| MemOS               | Native feedback correction and optional reorganization, cube-based organization                                  | Destructive conflict fallback, multi-step corrections and disabled-by-default advanced modes             |
| Supermemory managed | Document/memory API with updates, history and managed operation                                                  | Current server is non-public; semantics, portability, terms and data policy need qualification           |
| Letta               | Active agent runtime and memory work                                                                             | Current direction is a larger runtime integration; old standalone SDK is experimental                    |

Fit estimates: Hindsight 8/10, Mem0 OSS 5/10 for this changing-facts scenario,
MemOS 6/10 as a replacement requiring no engine fixes, Supermemory managed 7/10,
Letta 4/10 for a narrow backend integration. These are engineering judgments,
not benchmark results. Confidence in qualifying Hindsight first is 7/10.
Operational reliability has not been measured and is not inferred from stars.

### Hindsight

Native facts, observations, recall and curation provide considerably more than
a search projection. Re-retaining a stable document replaces its source content;
delta processing preserves unchanged chunks and rebuilds changed evidence.
Native curation edits or invalidates facts and updates related derived state.

A new discussion with a different document ID does not necessarily retire old
facts. Consolidation can represent changed beliefs while preserving historical
evidence. The acceptance criterion is that a review receives the applicable
current knowledge with understandable provenance, not that every historical fact
must be physically overwritten.

Curation does not change the original source. Reprocessing can reset a manual
fact edit. Authored project rules should therefore have stable provider-owned
knowledge documents rather than being maintained only as edits to extraction
from an ever-growing thread.

Sources: [observations](https://hindsight.vectorize.io/developer/observations),
[memories and curation](https://hindsight.vectorize.io/developer/api/memories),
[documents](https://hindsight.vectorize.io/developer/api/documents),
[pinned retain implementation](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py).

#### Correction to the initial research: deletion and mental models

Do not repeat the blanket claim that deleting facts never refreshes mental
models. Fresh critics found native retraction handling in the checked release:
single-model staleness checks missing cited facts, and delete/curation paths
queue refreshes for automatically refreshed models.

Remaining concerns are eventual consistency, best-effort scheduling, manual
models, temporarily optimistic batch-list freshness, and the case where every
cited ID is missing. The latter has an unresolved-grounding path that preserves
prose to avoid destroying imported knowledge with remapped IDs. Test these
cases; do not build a Router retraction engine to compensate pre-emptively.

Source: [memory_engine.py](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/memory_engine.py)
and [retractions.py](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/reflect/retractions.py).

### Mem0 OSS

The current migration guide explicitly describes single-pass ADD-only
extraction. Manual update and delete still exist; saying Mem0 cannot update
anything would be wrong. Its current additive intake is less aligned with this
product if native consolidation and changing-fact handling are mandatory.

Current self-host tooling is richer than a bare library. Nevertheless, a
self-host UI or API key is not our workspace/repository permission model.

Sources: [OSS migration](https://docs.mem0.ai/migration/oss-v2-to-v3),
[manual update](https://docs.mem0.ai/core-concepts/memory-operations/update),
[pinned implementation](https://github.com/mem0ai/mem0/blob/94c3fe9f238f3dbf29c9ce98643bd71eb13077cd/mem0/memory/main.py).

### MemOS

MemFeedback natively locates and corrects memories. Optional graph
reorganization also detects contradictory/redundant memories and can merge
them. These are real backend features, not just an extraction facade.

However, pinned reorganization code has a fallback that physically deletes the
older conflicting memory by update time. The full example configuration disables
reorganization and memory version mode by default. Feedback correction uses
several store calls; an atomic semantic update should not be assumed from the
documentation alone. These make it an evaluation challenger, not a clear safer
choice.

Sources: [MemFeedback](https://memos-docs.openmem.net/open_source/modules/mem_feedback/),
[pinned handler](https://github.com/MemTensor/MemOS/blob/41bf5c7fa89ee08ebedf3c662638b06fc29aca8d/src/memos/memories/textual/tree_text_memory/organize/handler.py),
[example configuration](https://github.com/MemTensor/MemOS/blob/41bf5c7fa89ee08ebedf3c662638b06fc29aca8d/docker/.env.example-full),
[feedback implementation](https://github.com/MemTensor/MemOS/blob/41bf5c7fa89ee08ebedf3c662638b06fc29aca8d/src/memos/mem_feedback/feedback.py).

### Managed options and Letta

Supermemory's technical self-host documentation states that its server binary
comes from a non-public codebase. Public SDK licensing must not be presented as
OSS engine licensing. Managed Supermemory remains relevant if operational
maintenance matters more than source availability.

Hindsight also has a managed offering. Using OSS source and outsourcing
deployment are separate choices; a promised service level is not our measured
reliability. No paid plan has been selected.

Letta's current repository points active development to letta-code and identifies
the old V1 API server as retired. Its experimental memory SDK should not be
treated as a mature drop-in backend without a new evaluation.

Sources: [Supermemory hosting](https://supermemory.ai/docs/self-hosting/overview),
[Hindsight hosting options](https://vectorize.io/pricing),
[Letta](https://github.com/letta-ai/letta),
[Letta memory SDK](https://github.com/letta-ai/ai-memory-sdk).

## Scope, approval and writes

Recommended initial mapping is a bank per actual authorization boundary:
workspace-shared knowledge and repository-local knowledge are separate banks.
Router resolves authorized banks; native recalls can use separate budgets and
context sections. This does not provide a single graph across those banks and
does not require a custom semantic ranker.

Topics/groups are organizational tags initially. If a group changes who may
read knowledge, it is an authorization boundary. Hindsight has native
observation scopes and strict tag modes, but tags and their derived unions are
not automatically equivalent to Router ACLs.

At thousands of banks, qualify native vector-index threshold configuration:
the documented default creates per-bank indexes immediately, which can create
planning/lock pressure. The documented 10,000-row threshold is a starting point
to test, not a benchmarked capacity promise.

Source: [banks](https://hindsight.vectorize.io/developer/api/memory-banks),
[configuration](https://hindsight.vectorize.io/developer/configuration),
[pinned consolidation](https://github.com/vectorize-io/hindsight/blob/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py).

Do not require a staging bank for every scope. Native preview extraction can
support immediate review; durable provider-owned drafts are needed only where
the product requires long-running approval. This optional preview does not
reduce the target backend to an extractor: approved knowledge and its complete
native memory lifecycle remain in that backend.

The reviewed API has no public expected-revision/ETag CAS. The small integration
must control production writes, order mutations of one stable source, check the
user's expected revision and retain one operation identity across retries.
Direct provider UI writes and future LLM tools must not bypass that path.
Timeout is an unknown outcome, not permission to issue a fresh operation.

A recoverable command needs a durable provider draft or reproducible source
revision. An HTTP request body that was never persisted cannot be recovered from
an operation-ID-only ledger. If no durable input exists, keep the prior published
version and show a retry/resubmission state; do not invent a hidden second fact
store.

## Privacy decision remains explicit

Current ADR-018 prohibits storing raw discussion/code material in the control
plane. Choosing another engine does not silently change that requirement.

Hindsight can disable original document/chunk text, but async operation payloads
and LLM traces are separate storage paths. A text-storage flag alone is not
evidence that raw input is never retained. Initial qualification can use synthetic
data. Real-source use needs an explicit profile covering input, tasks, traces,
derived evidence, exports and backups.

Options to evaluate are approved/normalized knowledge only, a verified transient
processing profile, or explicitly permitted retention in a defined self-hosted
or managed boundary. Choosing a stricter profile can reduce native reprocessing,
history or async-retry capabilities; report that tradeoff instead of recreating
those mechanisms ourselves.

Sources: [ADR-018](../decisions/018-balanced-memory-privacy-boundary.md),
[operations](https://hindsight.vectorize.io/developer/api/operations),
[configuration](https://hindsight.vectorize.io/developer/configuration).

## Small qualification before migration

Use two workspaces, with two repositories in the primary workspace, and 30–50
synthetic discussions with expected outcomes. Keep model, provider configuration
and corpus fixed when comparing candidates.

Required scenarios:

1. New useful fact, duplicate, rejected suggestion, hypothetical statement and
   non-durable conversation noise.
2. A newer decision from another PR: current knowledge is retrieved, earlier
   evidence remains explainable.
3. Reprocessing after a manual correction and a stable-source revision update.
4. Scope isolation through facts, observations, summaries and all UI read paths.
5. Edit, invalidation and deletion, including disappearance of every cited fact.
6. Repeated deliveries, older source arriving last, two approvals, worker restart,
   LLM failure and uncertain request completion.
7. Export/import of core knowledge, provenance and approved state; do not assume
   provider graph/embedding artifacts move losslessly.
8. A user can locate, understand, correct and remove a knowledge item.

Measure accepted-fact precision, obsolete/conflicting knowledge returned,
source attribution, isolation failures, latency and model cost. A small corpus
qualifies the integration; it does not prove large-scale quality or an SLA.

Stop and reconsider the backend if success requires implementing a new semantic
deduplication, contradiction-resolution, graph or consolidation engine in Router.
Prompt configuration and a narrow approval workflow are acceptable integration;
a growing parallel algorithmic subsystem is not.

## Cutover and deletion

The paused Memory page is not proof that the backend is disabled. Action bundle,
candidate and command routes and worker maintenance still exist.

Prefer a short memory-only pause over dual writes if the inventory permits:

1. Inventory canonical records, suggestions, active clients, outbox, provider
   exports and unknown deletion/write outcomes.
2. Stop every memory ingress and drain or settle outstanding work. Ordinary
   reviews may continue without memory.
   During pause and rollback, verify service/workspace disable through
   `MemoryPolicyConfigPort`: runtime bundles and new writes/proposals/confirmations
   are blocked while authorized pending-suggestion rejection, retire/forget and
   export remain available. Pending native cleanup reports progress honestly.
3. Export eligible knowledge; decide how pending, expired, invalidated and audit
   data are handled. Import once and verify scopes and provenance.
4. Switch one configured generation. Keep any old snapshot read-only for a
   bounded recovery window.
   Repeat disabled-mode cleanup/export checks before re-enabling memory.
5. Complete old remote cleanup before removing projection receipts and adapters.
6. Remove obsolete source code and add forward schema migrations.

The old outbox reloads body from MemoryItem; it cannot survive unchanged after
that body moves to the provider. MemoryUsageEvent's item FK and support counts
also require deliberate replacement. Projection receipts intentionally survive
canonical deletion and cannot be discarded while external cleanup remains.

After new provider writes, switching to an old snapshot loses changes. The
minimal rollback is to disable memory and recover forward, unless reverse
migration is separately implemented and tested. User permission to remove code
does not mean customer records may be silently discarded.

Sources: [routes](https://github.com/777genius/review-router-ai/blob/296ddc0327b7dfc762c31b5b1d39e5461a41c12c/apps/api/src/action-memory-routes.ts),
[outbox](https://github.com/777genius/review-router-ai/blob/296ddc0327b7dfc762c31b5b1d39e5461a41c12c/packages/features/memory/src/infrastructure/outbox/memory-index-outbox-handlers.ts),
[receipt contract](https://github.com/777genius/review-router-ai/blob/296ddc0327b7dfc762c31b5b1d39e5461a41c12c/packages/features/memory/src/infrastructure/projection/memory-projection-receipt-store.ts).

## Effort estimates

These are added/rewritten production LOC estimates for a limited useful first
version, reusing existing auth, GitHub integration, queue and shared UI. They
exclude changes to upstream engines, new infrastructure platforms, full LLM chat,
and universal cross-engine migration.

| Work                                                 | Estimated production LOC |
| ---------------------------------------------------- | -----------------------: |
| Native adapter, configuration and operation handling |                500–1,200 |
| Small contracts and application admission/approval   |                  400–900 |
| Source/revision applicability and mapping            |                  400–900 |
| API/worker/export changes and cutover tooling        |                  400–900 |
| Simple frontend                                      |                  500–900 |
| Total                                                |              2,200–4,800 |

Meaningful tests/fixtures: another 1,500–3,500 LOC. Native extraction configuration
and proposal wiring belong inside these ranges; a new general-purpose extraction
or reconciliation subsystem is deliberately excluded.

Potential gross removal/replacement is roughly 4,000–6,500 existing production
LOC, with the old UI panel considered separately. This is not a net reduction
promise, and the 9,365-line feature total is not a deletion budget. Privacy
remediation, unusual migration history or a provider gap can exceed the estimate.

The expected gain is avoiding long-term ownership of memory algorithms and
storage lifecycle. Calendar acceleration, retrieval quality and inference costs
remain unmeasured until qualification.

## Critic findings and disposition

| Finding                                                       | Disposition                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Search-adapter substitution preserves the custom engine       | Replace the ownership/read contract, not its name                  |
| Native deletion/mental-model support was understated          | Corrected against the pinned source; test remaining edge cases     |
| Tags were at risk of becoming an assumed ACL                  | Banks follow access boundaries; topics remain organizational       |
| Mandatory staging per scope overcomplicates the first version | Preview first; durable drafts only where needed                    |
| Approval ledger alone cannot recover an unrecorded payload    | Require durable input or an honest resubmission outcome            |
| Changing source and changing project truth were conflated     | Separate source revisions, authored rules and derived observations |
| Paused UI was mistaken for a stopped backend                  | Inventory and stop routes/workers as part of cutover               |
| LOC could be read as measured savings                         | Distinguish measured inventory, estimates and gross replacement    |
| Self-hosting was conflated with minimum operations            | Evaluate engine choice and hosting choice separately               |

Before implementation, the concrete replacement decision must reconcile all
accepted memory ADRs 018–024 and 026. This research and the owner's clarification
open that design discussion; they do not silently amend those ADRs.
