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

Preserve the approved no-raw-source ingress boundary. Manual approved statements
and permitted distilled candidates are first inputs. Whole-discussion extraction
requires its separately specified source-processing profile. Derived observations
are historical unless native readiness and selected-model quality are qualified;
they cannot silently amend an approved project rule.

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
