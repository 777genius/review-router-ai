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
Checkout policy admits SQL102 only with its pinned bytes and complete predecessor
manifest; historical96 and managed92 projections remain unchanged.
