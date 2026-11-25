# ADR-031: Complete replaceable memory provider

## Status

Accepted, 2026-10-23. The owner selected self-hosted Hindsight and authorized
implementation of the reviewed replacement plan, including removal of the
unnecessary custom engine. Production activation still requires the plan's
qualification and cutover evidence.

## Decision

Use application-owned memory reader, writer, preview and operation contracts.
The first implementation is Hindsight on infrastructure we operate. The provider
owns current approved document bodies, native facts, observations, indexing,
extraction, consolidation and retrieval. Domain, application and frontend code
must not import its SDK or storage DTOs. Composition supplies the implementation.

ReviewRouter retains workspace/repository/user identity, authority, source and
revision applicability, approval, revocation and durable command coordination.
Its database stores metadata and bounded immutable approved delivery envelopes.
An envelope cannot serve a current-body read, list, recall or export. Purge it
after verified publication or explicit terminal resolution. There is no writable
Prisma content fallback and no Router semantic reconciliation engine.

All mutations use command identity, the full semantic digest and expected
application revision. One unresolved external mutation per entry prevents
reordering; an urgent retire/expire/forget intent can revoke admission immediately.
An old completion cannot clear a newer fence. Unknown native outcomes remain
visible. Native cancellation is not an execution-drained receipt.

The initial physical-forget profile uses an operator memory pause with confirmed
executor/database-session exit, stable native operation inventory, document and
payload cleanup, and verification after restart. Ordinary successful updates
remain online. Runtime excludes inactive entries; authorized management/export
can inspect retained inactive records. Forget fences every body-bearing read.

The paused cleanup uses a provider-private, append-only identity ledger installed
before the first write in fresh native storage. It preserves every original
fact-to-document identity and every historical observation-to-source edge. The
ledger stores IDs only and does not implement extraction, retrieval or semantic
reconciliation. Live catalog definitions and activation are bound to the exact
native source/image, schema, namespace and generation.

After the public native document/operation cleanup, the operator removes only
ledger-bound live and archived heads and observation history in one locked native
transaction. This narrow schema maintenance covers deletion that the pinned public
API does not expose. It never resets a whole bank or guesses provenance from text.
Unrelated source facts, observations and history remain intact. Shared derived
observations containing the forgotten entry are removed as a whole. Missing or
changed provenance, incomplete operation inventory or surviving target content
keeps cleanup pending. Qualification checks absence before and after restart,
zero-extraction entries, retries and preservation of unrelated knowledge.

Verified full-history cleanup atomically closes Forget and every older unresolved
operation for the same entry, including expired envelopes and claims whose native
executors have demonstrably drained. Exact current revision, physical/metadata
authority, generation and paused epoch fence completion. Late delivery callbacks
cannot reopen any terminal command. The API and store share the neutral current
target policy. See the [completion reference](../plans/2026-10-27-hindsight-complete-forget.md).

Preserve the approved no-raw-source ingress boundary. Manual approved statements
and permitted distilled candidates are first inputs. Whole-discussion extraction
requires its separately specified source-processing profile. Derived observations
are historical unless native readiness and selected-model quality are qualified;
they cannot silently amend an approved project rule.

## Review admission and idempotent source commands

The database transaction that grants a new inference-capable review lease is the
linearization point for memory eligibility. It checks the exact bodyless receipt,
current authorization, current repository/source availability, policy, generation,
maintenance pause and scope epochs before consuming the attempt budget. The check
has no native provider I/O. A stale receipt returns `input_stale`; the Action drops
that captured snapshot and prepares the same attempt without memory. It never
refetches a different memory snapshot midway through an ensemble.

A granted lease may finish with its immutable, already admitted context. A later
retire, expiry or forget excludes knowledge from subsequent admissions. Do not
release an issued inference capability and pretend its budget was unspent. Lost
ACK retries restore the original lease before current-input checks. Cache lookup
and attachment still check current eligibility. Sample the database clock again
after admission locks so execution and lease expiry use the actual grant time.

The approved-source profile sends a fixed server-owned retrieval query. Client PR
titles, paths, diffs and arbitrary query strings are not sent to the memory engine.
GitHub commands use metadata-only source checks and current stable-identity
permission checks. Replay retains a hash of the complete normalized wire request
and its original CAS revision in approval metadata. It returns the original
operation before fetching current content; changed input with the same UUID is a
conflict even after the approved delivery envelope has been purged.

## Reconciliation

- ADR-018: preserve raw-source and diagnostic privacy; explicitly permit the
  approved current provider text and bounded delivery envelope described here.
- ADR-019: preserve feature ownership and inward dependencies.
- ADR-020 and ADR-024: supersede Prisma-canonical/search-projection ownership with
  the complete provider lifecycle and meaningful conformance guarantees.
- ADR-021: preserve explicit authority; resolve stable identities and actual
  repository-maintainer roles. No production login-only administrator bypass.
- ADR-022: preserve tenant/residency policy through server-selected provider
  scopes, validated evidence and explicit model-egress configuration.
- ADR-023: preserve service/workspace disable, ordinary memory-free review and
  authorized rejection, retirement, deletion and export.
- ADR-025: preserve existing UI components and simple product presentation.
- ADR-026: the app transaction reserves authorized command intent; the provider
  owns its effects; explicit reconciliation bridges the two transactions.

Keep previous ADRs as historical records. No production data is silently
discarded, and old remote cleanup obligations survive code replacement.

## Reference and acceptance

The [reviewed replacement plan](../plans/2026-10-23-hindsight-memory-replacement.md)
is the implementation and qualification reference. Its nine-agent, three-round
review accepts the plan, not native runtime behavior. Acceptance requires real
native lifecycle/failure tests, actual T0 integration, scope/authority isolation,
simple visually checked UI, forward migration or verified empty state, and the
exact hardened deployment profile. Unsupported guarantees do not become no-ops.
