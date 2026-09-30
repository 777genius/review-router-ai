# Current authority custody

`PrismaCurrentAuthoritySnapshot` implements the read-only application port.
`PrismaAuthorityProvisioning` is an internal command capability composed in
`apps/api/src/sdk-growth-authority-composition.ts`. It is not registered as an
HTTP route, candidate SDK endpoint, plugin, publication adapter, or GitHub writer.

The composition owner must provide `TrustedAuthorityIngestion`. Its
`authenticateAndLoad` operation authenticates the operator credential, verifies
owner authentication and installation authority, and loads binding, owner approval,
and provenance from trusted custody for the exact requested scope. A candidate
request body is never a source of those values. The credential is opaque and is
never stored. The persisted provenance records the authenticated owner, issuer,
authentication event, installation, source digest, and authorized runtime subjects.
The reader checks scope, subject authorization, matching owner/binding and scopes,
approval, revocation, validity, installation status, and verifier status.

All binding fields, including verifier, policy, tool, artifact, lock, history and
scope custody digests, are parsed using the existing strict domain contracts.
Only bounded metadata is retained. Binding and owner rows are separate immutable
versions with a shared `(scopeKey, epoch)`. The scope key is the canonical JSON tuple
of tenant, repository, and pull request. A single retained pointer selects the pair.
The initial zero pointer authorizes nothing. Provisioning inserts both rows and
advances the pointer in one READ COMMITTED transaction under its row lock.
PostgreSQL rejects updates/deletes/truncation of history, pointer deletion,
nonmonotonic movement, and movement to an incomplete pair.

Every command requires an expected epoch. Loading occurs before acquiring the
pointer lock; a stale authenticated load fails with `conflict` instead of restoring
a revoked or replaced epoch. Binding replacement, owner replacement/revocation,
installation invalidation, and verifier withdrawal use the same writer and epoch.
The application-owned transition policy compares the complete preceding material
under that lock: replacement reasons require a real replacement without changing
invalidation or revocation state, while revocation and both invalidations may change
only their named field. The PostgreSQL pointer trigger independently enforces the
same reason/delta contract for direct writers. It resolves both history tables from
the trigger table's schema with an inert `search_path`, never the caller's schema.
There are no implicit retries. Upstream integrations must deliver changes through
this command boundary; this slice does not install webhook handlers. Database
credentials capable of writing these tables belong exclusively to trusted server
custody, never candidates. Database administrators remain a trusted boundary.

Resolution first joins both versions through the current pointer in one SQL
statement. After validation it locks and rechecks the pointer under READ COMMITTED.
If a replacement commits during the read it returns null; if resolution gets the
lock first, a writer waits until resolution commits. This final lock is the
linearization point. A detached snapshot proves authority at resolution; it is
not a lease for a later side effect. Missing or unauthorized authority returns
null; malformed metadata, unavailable storage, and invalid owner approval fail
closed by rejection.

The focused PostgreSQL tests use an explicitly configured disposable
`SDK_GROWTH_TEST_DATABASE_URL` and isolate each suite in a random schema. The race
suite pauses after a real joined database read, commits each kind of replacement
through an independent client, then releases the reader to verify its final fence.

The reader accepts the application-owned `AuthorityIoBudget` and checks it before
and after database waits, including transaction completion. Abort remains
`AuthorityError("io-timeout", "none")`; cancellation does not authorize a later
write or promise cancellation of PostgreSQL work. The application enforces the
wall-clock deadline while these checks prevent late successful resolution.

Ingestion inspects the entire source graph through property descriptors before
reading material fields, rejecting accessors, symbols, hidden properties, sparse
arrays, custom prototypes and non-cloneable proxies. It detaches the graph before
validating provenance and domain contracts or awaiting any database operation.
Checkout policy admits SQL112 only with its pinned bytes and complete predecessor
manifest; historical96 and managed92 projections remain unchanged.

## Dormant G1 approval ledger

SQL113 adds immutable approval and revocation facts. The protected
`PrismaG1ApprovalLedgerCommand` is not composed into a route or startup path.
Approve accepts only scope, expected epoch and an opaque reference resolved by a
trusted server proposal port. The proposal builder must retain and show the exact
source/base/merge-base, scopes, decisions, package set and expiry; this slice does
not create that builder. The command rejects candidate material and expired,
rejected or revoked proposals. Existing approved authority must have a matching
current ledger fact; approval after revocation is rejected until a separately
accepted reactivation transition exists.

The command authenticates with P1a, then locks scope advisory key, current epoch
row `FOR UPDATE`, and credential row `FOR SHARE` in that order. It rechecks exact
credential ID/generation, disabled state, expiry, scope and operation after those
locks. Only then can it insert immutable authority versions, append the ledger
fact and advance the epoch in one transaction. SQL113 stamps each pointer write
with the full PostgreSQL `xid8` transaction identity; the deferred fact guard
requires that stamp to equal its own transaction. Historical pointer rows keep
a null stamp until their next transition and cannot receive a late standalone
fact. Failed CAS or rotation rolls back all
rows. The ledger retains the original proposal's approval provenance and
source digest; revoke appends a reference and changes only `revoked` in the new
authority version. `PrismaG1ApprovalLedgerSource` returns only an exact current
ledger epoch through the existing trusted-source port. It is a readback, never
a later publication permission.

The G1 writer/source are private feature-local adapters under the existing SDK
Growth authority owner. RR has no accepted Consumer Module Standard adoption
profile or pin for this dormant seam; this change does not claim one. A future
production composition is a separate acceptance step. SQL113 is checkout-only
and leaves historical96 and managed92 manifests unchanged.

## Dormant EF v3 approval manifest

SQL114 retains a source-built EF tool artifact for TEST fixtures. SQL115 adds
immutable exact manifest, request and validation-evidence bytes, each with a
length and SHA-256, and links the manifest to one authority epoch and approval
fact. PostgreSQL checks each digest against its bytes and checks the
domain-separated manifest ID. The deferred database guards reject a standalone manifest, late
attachment to an earlier approval, a mismatched authority version, and a fact
without an epoch advance in the same transaction. The v1 reader returns no
authority for v3 facts; v1 approvals retain their original shape.

`PrismaG1V3ApprovedManifestCommand` is a private protected command. Its proposal
port supplies exact owner-approved bytes. Its separate validation port must call
EF `decodeRequest()` on the **same** request bytes and return the decoded value
plus bound evidence. A fixture test builds the pinned EF 1.6.1 source archive
from commit `243b99abbd89216fca55a1ffe4a1b83a1b7efc2e`, installs it, and
exercises the public decoder through the protected command and a disposable
PostgreSQL commit. It checks exact stored bytes and rejects an EF-invalid
request before another fact can be written. The focused database tests also
cover atomic custody, concurrent approve/revoke, expiry after a scope lock wait,
credential rotation, same-transaction version facts and v1 isolation.
`promote-release` is rejected until an exact existing admission receipt can be
checked. No production startup, route, candidate writer, verifier assignment,
or publication path composes this command. G1 remains `hold`.

## Dormant v3 request evidence ingress

SQL116 adds one immutable `check/request-validation` slot per protected verifier
assignment. `PrismaG1V3RequestEvidenceCommand` accepts only a verifier credential,
approved manifest ID and exact request bytes. It first verifies the credential,
then asks a trusted adapter to run the pinned EF `decodeRequest` on a copy of the
wire. The adapter must encode EF's canonical `wire` as UTF-8 and return its
`wireDigest` and distinct `protocolDigest`. The command reauthenticates inside a
READ COMMITTED transaction, holds the assignment and current authority locks,
matches the current v3 approval, exact manifest, source/base/merge-base, verifier
revision, authorized subject and tool pin, then retains the bytes and closed
validation evidence. SQL checks bytes/digests, slot identity, current approval,
assignment and deadlines again at INSERT and deferred commit using PostgreSQL
`clock_timestamp()`. A same-slot replay needs a still-valid credential and
current approval; its first JTI remains unchanged. Different bytes conflict.
Replacement makes old manifest IDs ineligible, while a still-valid assignment
may target the new manifest only if its exact execution and tool pin match.
This first TEST slice inherits the protected assignment's same-repository
head/base policy; fork PR support requires a separate source-binding contract.

Deployment must grant the narrow lock function and evidence table access only
to the isolated verifier producer role; the migration grants neither to PUBLIC.
The command has no production composition, HTTP route, grant, completion or
publication effect. This evidence proves request admission and custody only,
not candidate archive contents or release eligibility. G1 remains `hold`.
