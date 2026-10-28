# Complete entry-history forgetting

Follow-up to the accepted Hindsight replacement plan and ADR-031. The first implementation merged through PR #690; the Action integration merged through review-router#328. This follow-up completes the update-then-forget lifecycle without replacing the native engine or adding native dependencies to domain/application code.

## Confirmed gap

The first operator inventories surviving facts for the current document. Native document replacement can remove older fact identities while leaving derived observation history. The operator also resets observations across a bank and requires at least one extracted source fact. Consequently, it cannot complete every history-bearing or unextracted entry safely while preserving unrelated derived knowledge.

## Implementation boundary

1. Install an append-only identity ledger in a fresh, quiescent native database before the first writer. Record original fact-to-document identity and every historical observation-to-source edge. The ledger stores IDs only; Hindsight continues to own text, extraction, consolidation and retrieval.
2. Bind activation to the exact native source/image, schema, namespace and generation. Verify live function/trigger/table definitions and the reviewed SQL before maintenance. Reject retrospective activation, unknown identities, cross-bank edges and changed provenance definitions.
3. Under the existing Router pause, host deployment lock and complete native executor/session drain, collect all historical source/observation IDs and related operations. Use the public native document/operation cleanup where supported. The pinned API lacks exact archived fact deletion: perform only the missing, precisely scoped native schema maintenance inside the private operator.
4. Lock the native fact/archive/history tables, remove only ledger-bound original/derived heads, verify their absence, and remove history by the exact bank and observation IDs. Preserve unrelated documents, original facts, observations and history. Shared derived observations containing forgotten evidence are removed as a whole.
5. Require signed full-history coverage and before/after-restart absence. Zero extracted facts are allowed only with the verified fresh ledger and complete operation/payload absence; missing evidence leaves cleanup pending.
6. Share a provider-neutral current-target policy between API preflight and atomic cleanup settlement. Validate the current physical row, metadata, revision, scope and revocation. Dispose all older unresolved commands and bounded envelopes in the same transaction; late delivery acknowledgements cannot resurrect them.
7. Wire the existing v2 memory client consistently into supported authenticated Action execution lanes. Preserve disabled-provider and unavailable-initial-retrieval fallback behavior.

## Required evidence before merging

- Independent critics for native lifecycle maintenance and neutral authority/architecture.
- Real PostgreSQL races and all nonterminal forget states, current-target rejection, all-revision disposal and late acknowledgements.
- Real native identity-trigger tests: rollback, source rewrites, archives, orphan history, shared sources, unrelated preservation, zero-source entries, bounded retry and restart.
- Signed receipt, HTTP API and Action workflow/runtime regressions.
- Foundation dependency checks and all 23 mutation fixtures on the final policy.
- The pinned Hindsight Docker qualification and memory UI/PostgreSQL CI on the exact proposed commit. Existing memory UX and its reusable components remain the user-facing interface.

Production activation remains separate from source merge and retains the model/egress, capacity, restore and legacy-data gates in the accepted plan. A green deterministic fixture is not a claim about production model quality.
