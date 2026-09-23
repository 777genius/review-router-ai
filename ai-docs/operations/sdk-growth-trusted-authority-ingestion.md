# SDK growth trusted authority and verifier custody

This lane owns two internal boundaries. Neither boundary is an HTTP endpoint and
neither accepts a candidate request as authority.

## Authority provisioning

`composeSdkGrowthCurrentAuthority` requires:

- `TrustedAuthorityAuthenticatorPort`, which authenticates an opaque protected
  owner/operator credential and returns the tenant, internal repository,
  numeric GitHub repository, installation and owner identity bound to it; and
- `TrustedAuthoritySourcePort`, which loads the current approval, its immutable
  original provenance and the complete binding from server-side custody after
  authentication.

`ServerSideTrustedAuthorityIngestion` checks those independent results against
the requested tenant/repository/pull-request scope. Its binding contains the
source, base, merge-base, scopes, verifier, policy, tool, artifact, lock,
history and scope identities. It constructs `OwnerEvidence` and provenance;
there is no material/body parameter through which candidate JSON can supply
them. The authenticated principal authorizes the current lifecycle operation;
it is distinct from the original approval provenance. A fresh login can revoke
the owner, invalidate the installation or withdraw the verifier without
rewriting the approval's issuer/session provenance.

The caller passes the result to `PrismaAuthorityProvisioning.advance` with the
expected epoch and one exact transition reason. That existing transaction owns
the epoch comparison and the provision, binding replacement, owner
replacement/revocation, installation invalidation and verifier-withdrawal
state changes.

No concrete operator credential verifier or owner-approval repository exists in
this checkout. Production integration must implement the two ports above using
the control plane's protected workload/operator identity and canonical approval
store. A candidate GitHub Actions OIDC token, route body, test fixture or static
environment JSON is not a valid implementation.

## Verifier producer custody

`composeSdkGrowthVerifierProducerCustody` requires a
`SdkGrowthVerifierProducerAuthenticatorPort`. Authentication must return the
exact execution identity (tenant, internal and GitHub repository,
pull-request, installation, subject, run and attempt, verifier revision, source
commit and source tree) for a dedicated `reviewrouter-verifier` workload.

`PrismaSdkGrowthVerifierEvidenceCustody.retainEvidence` then:

1. locks and reads the expected current authority epoch;
2. applies the shared application authority policy, including approval
   issue/expiry time and authorized-subject membership;
3. rejects inactive installations, verifier withdrawal, rejected/revoked
   approval, a changed owner, changed binding or changed source commit;
4. derives the authority binding and owner identity from that server-side row;
5. hashes the independently produced archives/distribution bytes; and
6. inserts immutable evidence idempotently, rejecting different bytes for the
   same execution/authority identity.

`retainFinalizedReport` reauthenticates the producer, rechecks the expected
authority epoch, requires the exact verifier evidence row, and loads the exact
retained admission by request and grant digest. It decodes and byte-reencodes
the grant with `PinnedEfAuthorityCodecV1`, then verifies execution, authority
epoch, owner evidence and binding before retaining the finalized report.
Finalization is unique by verifier execution/authority evidence and logical
grant. An identical retry is idempotent; different report bytes or a different
decision for that grant conflict, including under competing PostgreSQL
writers. The normal completion transaction still creates the exact receipt relationship;
historical receipt readback reads immutable authority custody and therefore
does not require current authority to remain active.

No dedicated verifier workload credential implementation exists in this
checkout. The remaining producer integration point is the implementation of
`SdkGrowthVerifierProducerAuthenticatorPort` in the isolated verifier runtime.
It must not accept the candidate route's GitHub Actions OIDC credential or give
the candidate process database write access. Database roles should give the
authority API read-only access to verifier evidence and the isolated verifier
producer insert-only access through this adapter.

This serialization requires application migration
`000106_sdk_growth_finalized_report_logical_identity`, which removes the
digest-based uniqueness constraint. The existing primary key becomes the
SHA-256 identity of `(evidenceId, grantId)`, so PostgreSQL serializes competing
writers without indexing the bounded-but-long grant text. The sibling
deployment checkpoint must include and verify that migration before enabling
any producer. A read-before-write check without that primary-key conflict is
not an acceptable substitute.

The codec remains the explicitly pinned bridge-v1 codec. This boundary makes no
claim of compatibility with an unfrozen EF successor schema.

## Merge-enforcement lane contract

The sibling merge-enforcement lane can rely on these persisted facts:

- an admitted grant includes `authorityEpoch` and exact owner evidence;
- verifier evidence is bound to that same epoch, owner evidence ID/source
  digest, binding and authenticated execution;
- a finalized report is bound to the exact retained request/grant and trusted
  producer bytes before completion;
- a receipt is immutable historical evidence, while `status.authorityState`
  separately reports whether its grant is current; and
- replacement, revocation, installation invalidation and verifier withdrawal
  advance the canonical epoch and prevent new evidence/admission under the old
  owner.

Merge eligibility must still recheck current authority and provider policy at
the merge boundary. Historical receipt validity alone is not current merge
permission.
