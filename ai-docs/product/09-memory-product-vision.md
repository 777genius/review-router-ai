# Memory product vision

Recorded: 2026-10-23.

Status: owner requirements and design direction for the next memory phase.
This document records the owner's clarification; it is not an accepted
architecture decision, a provider selection, or evidence of a production rollout.
The existing memory ADRs remain the implementation baseline until an explicit
replacement decision is approved.

## Intended outcome

ReviewRouter should use a capable, replaceable memory backend for code review.
A provider may own the useful memory lifecycle, including native extraction,
semantic reconciliation, consolidation, storage and retrieval. Reducing every
provider to a search index or a candidate extractor does not satisfy this vision.

Prefer mature libraries and their supported capabilities over implementing
another general-purpose memory engine inside ReviewRouter. Keep the integration
modular under Clean Architecture, SOLID and DRY, with Get Modular, Engineering
Foundation and the organization's engineering rules where applicable.

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
   for people and visually inspect it during implementation. The current Memory
   page remains a development notice until a separate implementation phase.
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

| ReviewRouter application | Memory provider |
| --- | --- |
| Workspace/repository identity, membership and authorization | Native memory storage and indexing, where assigned by the next design |
| Which sources are allowed and who may approve a project rule | Fact extraction, entity resolution and semantic matching |
| Product-specific applicability and approval policy | Deduplication, conflict detection and update proposals |
| User-facing scope, grouping, provenance and workflows | Consolidation, derived knowledge and relevant retrieval |
| Integration events, operation tracking and audit requirements | Supported lifecycle operations, export and deletion execution |

Delegate algorithms the selected engine already provides. Qualified algorithms
for reconciliation and freshness assessment can also be delegated; owning
product policy does not require implementing those algorithms in ReviewRouter.
Keep product authority explicit: detecting a semantic contradiction does not itself authorize changing
an approved project rule. Automatic behavior must fit the chosen approval policy.

Assign one authoritative owner to each mutable record. ReviewRouter's database
can keep users, permissions, source identities, approval decisions and audit
metadata without independently maintaining a second writable memory engine.
Whether confirmed text and revisions remain canonical in PostgreSQL or move to
the provider is an open architecture decision. Audit snapshots are not a second
editable current state.

Provider independence and provider optionality are different choices. A local
Prisma-based memory fallback is not required merely to achieve Clean
Architecture. Existing configuration and behavior are unchanged by this note.
Decide explicitly whether memory requires a configured backend,
can be disabled, or offers a deliberately limited local mode. Do not silently
represent a reduced mode as having the selected backend's full capabilities.

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
allowed source retention, approval and tenancy with these decisions. This note
does not amend them, enable automatic capture, change configuration or restore
dashboard functionality.

## Provider evaluation context

- Evaluate Hindsight as a candidate for a complete memory provider. An
  extraction-only experiment can be an early qualification step, but must not
  replace evaluation of its useful end-to-end memory lifecycle.
- Infinity Context is already integrated as an optional SDK search adapter.
  Its role as a complete memory provider remains a candidate for separate
  qualification; the search integration does not prove that its full memory
  capabilities are integrated.
- The owner reports that Infinity Context already has Cognee/Graphiti adapters,
  possibly incomplete. Record this as owner-provided context. Their
  implementation was not inspected or requalified for this clarification.
- No provider is selected by this document. Separate native OSS capabilities,
  paid-service capabilities and behavior actually verified in our integration.

## Next design questions

1. Which backend best handles our representative learn, correct, retrieve,
   revalidate and delete scenarios?
2. Which component owns each kind of memory, confirmed text, revision and
   derived knowledge, and how is that state recovered or migrated?
3. How do workspace and repository scopes, groups and approvals map to the
   backend without weakening authorization or duplicating its algorithms?
4. What may be processed and retained from GitHub, and how is source freshness
   represented and checked?
5. What capability, quality, reliability and portability checks must an adapter
   pass before it can serve real reviews?
