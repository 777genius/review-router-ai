# Memory product vision

Recorded: 2026-10-23.

Status: owner requirements and selected direction for the next memory phase.
On 2026-10-23 the owner selected **self-hosted Hindsight** as the first complete
memory backend, behind provider-neutral application contracts. This selection
is not evidence of a production rollout or completed qualification. The initial
planning phase led to the accepted
[replacement plan](../plans/2026-10-23-hindsight-memory-replacement.md) and
[ADR-031](../decisions/031-complete-memory-provider.md). The owner subsequently
authorized implementation, end-to-end qualification and source merge, including a
usable management UI. Production activation and legacy-data cutover retain their
separate qualification gates.

## Intended outcome

ReviewRouter should use a capable, replaceable memory backend for code review.
A provider may own the useful memory lifecycle, including native extraction,
semantic reconciliation, consolidation, storage and retrieval. Reducing every
provider to a search index or a candidate extractor does not satisfy this vision.

Prefer mature libraries and their supported capabilities over implementing
another general-purpose memory engine inside ReviewRouter. Keep the integration
modular under Clean Architecture, SOLID and DRY, with Get Modular, Engineering
Foundation and the organization's engineering rules where applicable.

## Owner clarification: replacement is preferred

The owner clarified on 2026-10-23 that the custom memory implementation was
created hurriedly and was never intended to become a separately maintained
memory engine. Maintaining or developing that engine is not a product goal.
Investigate a complete replacement with a capable external memory backend first.

Removing the current engine implementation is explicitly acceptable if a ready
backend offers a faster, more useful and maintainable result. Preserve existing
code only where it serves a necessary product responsibility, not because it
already exists. A local Prisma memory backend is not a required fallback.

The owner subsequently selected Hindsight on their own server and requested a
deep plan for removing the current implementation and integrating the complete
backend. All provider implementation must remain behind adapters; domain,
application workflows and frontend must not acquire Hindsight-specific models.
The owner explicitly permits removing unnecessary custom-engine code. This does
not authorize discarding customer records or silently changing raw-source
retention. The concrete architecture, migration, operational profile and native
behavior must be researched and challenged before implementation.

## Owner requirements

1. **Workspace and repository scope.** Support personal and organization
   workspaces with many repositories. Provide shared workspace knowledge and
   repository-local knowledge. Keep workspaces isolated, make the applicable
   scope clear and control how knowledge becomes shared.
2. **Understandable organization.** Let people group knowledge by simple topics,
   groups or tags. The interface should make a growing knowledge base navigable
   without requiring users to understand a provider's graph or storage model.
3. **Useful accumulated knowledge.** Preserve facts, experience, project
   conventions, architectural decisions and review exceptions that improve later
   code reviews. Accumulation must remain maintainable and useful at larger
   volumes, rather than becoming an unstructured collection of text.
4. **Learning from GitHub discussions.** Identify useful knowledge in review
   conversations and comments. Evaluate separately how the system decides what
   is worth remembering, which parts the backend can supply and which
   product-specific policy remains in ReviewRouter.
5. **Updating existing knowledge.** A clarification may correct an existing
   fact. Find related knowledge and support an appropriate update, supersession
   or conflict workflow rather than always appending another independent entry.
   Preserve enough provenance and history to understand a change.
6. **A changing codebase.** Knowledge can become outdated as code changes.
   Design for source links, repository and revision applicability, revalidation
   and the distinction between an observed implementation fact and an intended
   project rule. A new code change alone does not settle which rule is correct.
7. **Quality at scale.** Evaluate useful retrieval and maintenance with diverse,
   growing project knowledge. Assess wrong, stale, conflicting and missed facts,
   as well as latency, operational reliability and cost, on code-review scenarios.
8. **Simple frontend.** Show knowledge, scope, groups, sources and changes in a
   clear UI using existing shared components. Keep the workflow understandable
   for people and visually inspect it during implementation. The initial request
   for a development notice was superseded by the authorized management UI phase;
   disabled or unavailable memory must still have a clear, honest empty state.
9. **Future LLM access.** Keep an application boundary through which a future
   chat or LLM tools can retrieve knowledge and propose or perform authorized
   saves and updates. The future chat is not part of the current delivery.
10. **Real provider replaceability.** Infinity Context, Hindsight or another
    qualified backend should fit behind application-owned contracts without
    making the domain or frontend depend on its SDK or internal storage model.
    This does not promise identical features or zero-effort migrations for every
    memory library.
11. **Practical delivery estimates.** When planning implementation, estimate
    integration, adapter work, useful-knowledge selection, update/reconciliation,
    UI and verification separately, including approximate lines of code and
    complexity. Account for existing implementation and reusable library
    functionality rather than estimating all of it as new custom code.
12. **Reviewed implementation.** Follow the requested critic/fix rounds for the
    implementation plan, then implement, verify affected end-to-end paths,
    inspect the UI, address review findings and push coherent checkpoints.
    This note itself records requirements and changes no runtime behavior.

## Proposed responsibility boundary

These are design constraints for evaluating the next architecture, not a new
storage-ownership decision.

| ReviewRouter application                                      | Memory provider                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Workspace/repository identity, membership and authorization   | Native memory storage and indexing, where assigned by the next design |
| Which sources are allowed and who may approve a project rule  | Fact extraction, entity resolution and semantic matching              |
| Product-specific applicability and approval policy            | Deduplication, conflict detection and update proposals                |
| User-facing scope, grouping, provenance and workflows         | Consolidation, derived knowledge and relevant retrieval               |
| Integration events, operation tracking and audit requirements | Supported lifecycle operations, export and deletion execution         |

Delegate algorithms the selected engine already provides. Qualified algorithms
for reconciliation and freshness assessment can also be delegated; owning
product policy does not require implementing those algorithms in ReviewRouter.
Keep product authority explicit: detecting a semantic contradiction does not itself authorize changing
an approved project rule. Automatic behavior must fit the chosen approval policy.

Assign one authoritative owner to each mutable record. ReviewRouter's database
can keep users, permissions, source identities, approval decisions and audit
metadata without independently maintaining a second writable memory engine.
The selected direction moves current knowledge ownership to the complete
provider; PostgreSQL is not to remain a parallel editable memory store. The
replacement plan must specify native revision fidelity, publication authority
and recovery metadata. Audit snapshots are not a second editable current state.

Provider independence and provider optionality are different choices. A local
Prisma-based memory fallback is not required merely to achieve Clean
Architecture. Existing configuration and behavior are unchanged by this note.
The replacement is to use a configured complete backend or be disabled.
Ordinary reviews must continue without memory when it is unavailable. A local
Prisma memory implementation is not a required runtime fallback.

Prefer small contracts for actual use cases and explicit optional capabilities.
Do not force every provider to implement every advanced feature, or hide
unsupported features behind a large custom emulation layer.

Proposed replaceability qualification includes exporting and importing core
knowledge, scope, provenance, approval state and revision identity. Define the
required history fidelity. Provider-specific embeddings, graphs and derived
summaries may need rebuilding; lossless transfer of every internal artifact is
not an assumed guarantee.

## Current implementation and the gap

The existing [memory adapter plan](../plans/2026-10-22-memory-engine-adapters.md)
preserves PostgreSQL as canonical storage and adds optional search projections.
Its ports abstract search and index updates; this is narrower than the complete
provider boundary described above. The default search adapter remains Prisma.
This describes current code, not a requirement that all future providers be
restricted to search.

Relevant accepted decisions:

- [ADR-018: privacy boundary](../decisions/018-balanced-memory-privacy-boundary.md).
- [ADR-020: canonical storage and derived search](../decisions/020-balanced-memory-storage-search-strategy.md).
- [ADR-021: confirmation authority](../decisions/021-balanced-memory-authority.md).
- [ADR-022: tenancy and data residency](../decisions/022-balanced-memory-data-residency-tenancy.md).

A future full-provider design must explicitly reconcile storage ownership,
allowed source retention, approval and tenancy with all accepted memory ADRs
(018–024 and 026), including the bounded context, rollback/disable, search
capability contract and transaction/outbox decisions linked above or in the
[memory adapter plan](../plans/2026-10-22-memory-engine-adapters.md). This note
does not amend them, enable automatic capture, change configuration or restore
dashboard functionality.

Research follow-up: [Full memory backend replacement](../spikes/2026-10-23-full-memory-backend-replacement.md) records the source audit, six-agent research/criticism, estimates and qualification conditions.

Selected direction: [Self-hosted Hindsight replacement plan](../plans/2026-10-23-hindsight-memory-replacement.md) specifies the provider boundary, native qualifications, actual Action-runtime integration, safe cutover and removal sequence. Independent critic/fix rounds are recorded in that plan.

## Provider evaluation context

- Hindsight is now the owner's selected complete backend, hosted on their own
  server. Qualification must cover its full useful lifecycle; an extraction-only
  experiment does not fulfill the selection.
- Infinity Context is already integrated as an optional SDK search adapter.
  Its role as a complete memory provider remains a candidate for separate
  qualification; the search integration does not prove that its full memory
  capabilities are integrated.
- The owner reports that Infinity Context already has Cognee/Graphiti adapters,
  possibly incomplete. Record this as owner-provided context. Their
  implementation was not inspected or requalified for this clarification.
- The selection is self-hosted OSS Hindsight, not its paid managed service.
  Separate native capabilities from behavior actually verified in our integration.
  Model hosting and permitted data egress require their own operational profile.

## Next design questions

1. Does the pinned Hindsight integration meet our representative learn, correct,
   retrieve, revalidate and delete scenarios without rebuilding an engine?
2. Which component owns each kind of memory, confirmed text, revision and
   derived knowledge, and how is that state recovered or migrated?
3. How do workspace and repository scopes, groups and approvals map to the
   backend without weakening authorization or duplicating its algorithms?
4. What may be processed and retained from GitHub, and how is source freshness
   represented and checked?
5. What capability, quality, reliability and portability checks must an adapter
   pass before it can serve real reviews?
