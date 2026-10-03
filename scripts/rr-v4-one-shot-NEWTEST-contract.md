# NEWTEST one-shot consumer handoff

This import-only consumer does not load env/auth, start an agent, refresh an
account, retry a provider call, or run itself. No real canary was executed.

`createNewtestActionClient` reuses generated Action-v2 request validation and
canonical request-body hashing. The Action envelope stays protocol `"2"`; the
nested relay grant must be protocol `4`. A responses POST uses exact approved
bytes, content length, ordinal `1`, one idempotency key, and no redirects/retries.
The response must be completely consumed within byte limits and carry the
truthful `owner-one-shot-uncapped-test` header. These facts alone are NOT review
acceptance.

## Inputs the authenticated caller still has to supply

- Immutable approval and its independently authenticated canonical SHA256.
  Hash comparison is integrity checking, NOT authentication/signature checking.
- Fresh TEST authorization, execution/slot, distinct invocation/relay leases,
  planned relay turn and an already opened genuine confinement gateway session.
  Use existing APIs. This script does not manufacture any of those capabilities.
- Genuine gateway transcript/replay material and a trusted ordinary projection
  builder from actual authoritative observations/current lifecycle and ledger.
  `createNewtestSemanticCompiler` reuses the supported pure Responses decoder
  and real domain parsers/encoders. It does not invent confinement evidence or
  current projection facts; a diagnostic response is not semantic acceptance.
- A legitimate conclude path. A clean discovery result can require another
  critic turn; this script stops rather than spending another provider call.
- The real exclusive publication adapter described below. An uncomposed
  consumer fails closed before grant issue/provider dispatch. Runtime composition
  supplies the actual core facade and ordinary trusted API preparation; pure
  tests do NOT qualify durable server exclusion or provider behavior.

## Existing acceptance sequence

After one issued grant and one responses POST: durable relay status `succeeded`
with exact grant/logical turn/request hash/ordinal/effect -> relay gateway seal ->
turn commit -> conclude certificate -> ordinary certificate-backed evidence
commit (`InvestigationGatewayV1`, enabled certificate acceptance) -> observation
attach (which satisfies this slot) -> content-addressed execution finalization ->
publication request -> one exact full-plan exclusive executor call.

The conclude shadow projection is non-authoritative. The script never treats it
as an attached observation or bypasses evidence/finalization acceptance. A
restored grant, uncertain provider/effect, rejected semantic result, historical
observation or unknown publication stops. No caller should auto-rerun it.

## Required exclusive publication contract

Ordinary maintenance scans pending/planned/in-flight/reconciling work and can
rearm an expired claim or defer a retry. Its reconciliation gateway also allows
cleanup mutations. Merely calling its executor once is insufficient.

The smallest supported seam must:

1. Qualify availability before the ONE provider call, without pretending a final
   model-derived content-addressed artifact already exists.
2. After finalization, derive the existing deterministic attempt/operation IDs
   from the actual artifact/projection and bind an immutable exclusive admission
   to approval hash, TEST identity, execution, artifact/hash, permit hash,
   attempt, complete canonical plan and exclusive owner BEFORE publication request is enqueued.
   Reject pre-existing/racing attempts; shared claim/begin guards must exclude
   ordinary maintenance owners, not merely an in-memory scanner filter.
3. Preserve every required operation and dependency in the ordinary full plan.
   ONE publication attempt can contain summary/check/inline siblings; it is not
   ONE GitHub HTTP mutation. Commit sticky consumed CAS per operation immediately
   before its at-most-once mutation; uncertainty stops subsequent operations.
   Restoration and lease expiry NEVER rearm. No cleanup/replacement mutations.
4. Record/complete through existing effect/receipt contracts. Unknown outcomes
   permit `findAllByMarker`/status reads only, never `markStaleOrDelete`, repost,
   another send or another publication identity. Success requires the complete
   canonical required receipt set, never a selected summary receipt or forced
   partial coverage. The script checks exact plan hash/required operation IDs.

The runtime adapter implements the split: immutable `publicationIntentId`,
pre-provider `qualify`, then post-artifact `admit` which returns measured derived
attempt/operation IDs before publication request. It uses the core's durable
exclusive store and full-plan executor, then reads actual canonical receipts.
Supplying arbitrary future IDs or a boolean proof is not a valid implementation.
Pure checks do not establish actual runtime qualification.

Semantic output has exactly outputVersion=2, findings, obligationProposals,
closureClaims, operationBackedDiscoveryClaims, unresolvableClaims, criticDecision
=null. Provenance/completion metadata come from the strict decoded response and
fresh bound turn, not model claims. Findings must reference real verified context
operation receipts. The compiler cannot force ReadyToConclude: server closure,
coverage expansion and finding-evidence policy remain authoritative.

Approval placeholders: purpose=`owner_one_shot_uncapped_test`, repositoryGitHubId
=`1252762369`; all other identity, source/head/runtime/revision, lease, request
hash/idempotency and expiry fields are newly supplied by the authenticated owner
caller. Do not put grants/tokens/credentials in the approval record.

Focused fake-only checks: `node --import tsx --test
scripts/rr-v4-one-shot-NEWTEST-consumer.test.mjs
scripts/rr-v4-one-shot-NEWTEST-semantic.test.mjs`. No database, provider, auth,
GitHub or production access. These checks do not prove server durable CAS or
exclusive publication admission.

Runtime composition uses `rr-v4-one-shot-NEWTEST-runtime.ts`. The trusted server
launcher supplies an already constructed `createProductionReviewV2WorkerRuntime`
exclusive facade and `composeTrustedExclusivePublicationPreparation` from the
ordinary API composition. The script binds the actual finalized artifact and full
normal plan before publication/request, executes once, then requires the actual
complete canonical receipt set. It never constructs credentials or parses a
publication bearer itself. Lost admission/bind ACKs cannot be locally retried.

`prepareNewtestActionWorkflow` invokes only ordinary authorization, execution
start, invocation lease, investigation open, relay turn plan, relay lease and
gateway open, each once and each fresh. `composeNewtestCanaryRuntime` crossbinds
the resulting server IDs to the authenticated approval and semantic encoder.
The V4 issuer configuration is injected AFTER those IDs exist, BEFORE the grant.

The dedicated `createNewtestProducerPreparation` implements registered-manifest
request preparation and current stream/execution/ledger/lifecycle/observation
finalization reads. The runtime calls its finalizer immediately after attach;
no synthetic E2E watermark or lifecycle value is reused.

`createPreparedNewtestGateway` queries the real OPEN session, actual execution
assignment and registered release through existing server stores. It binds the
actual lease/attempt/fence, revision, scope, event seed and expiry to API receipts,
then uses the genuine OPEN secret. `createNewtestContextGateway` reads only
content-addressed Git objects, derives actual inventory/file receipts and their
HMAC chain, and supplies normal replay material; only the server can seal or
certify it. The real Git adapter requires a configless, sealed object snapshot,
not a user's checkout/config/alternates. Its actual subprocess qualification is
`rr-v4-one-shot-NEWTEST-gateway-git.test.mjs` and must run on the test server.

Remaining concrete launcher inputs are existing trusted server repositories and
ordinary handlers, authenticated owner approval/TEST identity, a normally
registered release attesting the exact compiled gateway digest, and its sealed
Git-object snapshot. This import-only patch does not register an artifact, read
credentials, launch a runtime or claim a completed real canary.
