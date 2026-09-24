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

`PrismaSdkGrowthVerifierAssignmentStore` and
`JoseSdkGrowthVerifierProducerAuthenticator` provide the bounded protected
producer identity checkpoint. A protected scheduler persists the exact
execution in `SdkGrowthVerifierAssignment`; the internal issuer signs a
five-minute Ed25519 token containing only the assignment ID and execution
digest. The protected scheduler holds the private key; the isolated verifier
producer receives only its public key. The authenticator uses a dedicated
verifier issuer, audience, subject and token type. It locks and reloads the assignment in the same custody
transaction, rejects revocation and assignment/token expiry, and returns only
the persisted execution. A token can be replayed for the same assignment until
expiry so identical evidence/report retries remain idempotent; revocation or
expiry stops subsequent writes. Creating another assignment for the same
tenant/repository/PR revokes the old one atomically, including when the run,
attempt, verifier revision or head tree changes. A partial unique index permits
only one active assignment for that PR. The migration
prevents execution edits after creation. Candidate Actions OIDC and action
session credentials cannot satisfy this verifier credential boundary.

`composeProtectedSdkGrowthVerifierProducer` and
`composeProtectedSdkGrowthVerifierScheduler` are separate internal composition
gates requiring explicit `enabled: true` and their respective public/private
keys. No production
startup path calls it; production activation remains 0. The issuer and
assignment create/revoke capability must be exposed only to the isolated
protected scheduler, never to candidate routes or processes. Key bytes must
come from the protected runtime secret store and must not be logged. The
separate scheduler/runtime deployment and key distribution remain integration
work before activation.

The code assumes the deployment gives the candidate role no assignment or
verifier custody table access, the verifier producer role assignment SELECT,
current authority/admission SELECT and verifier custody INSERT/SELECT through
this adapter, and the protected scheduler role assignment INSERT and
`revokedAt` UPDATE. The authority API should have only SELECT
on verifier evidence and finalized reports. The current migration creates
tables and an immutability trigger; it does **not** create or verify deployed
database roles or grants. Those grants and process isolation must be checked
in the target environment before enabling the producer. A shared DB owner or
shared verifier key with the candidate process would invalidate this boundary.

The assignment checkpoint requires application migration
`000107_sdk_growth_verifier_assignment` before any protected job is issued.
This serialization also requires application migration
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
