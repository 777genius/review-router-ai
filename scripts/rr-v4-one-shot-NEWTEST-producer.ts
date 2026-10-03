import { createHash } from "node:crypto";
import {
  canonicalizeReviewActionV2Request, parseReviewActionV2Request,
  canonicalizeReviewInvestigationContextConfinementEvidence,
  reviewActionV2PublishedProtocolVersion, reviewActionV2PublishedSchemaDigest,
  ReviewInvestigationPublishedRuntimeProfile, ReviewInvestigationRelayContextLeaseAuthorityKind,
  ReviewInvestigationRelayLeasePurpose,
  ReviewActionV2OperationId as Op, type ReviewActionV2RequestMap,
} from "../packages/protocol-review-action-v2/src/index.js";
import {
  canonicalObjectJson, canonicalReviewAssignmentManifestJson,
  canonicalReviewAssignmentManifestHashPreimage, canonicalReviewExecutionPlanHashPreimage,
  validateReviewAssignmentManifest, type ReviewAssignmentManifest, type ReviewWorkSlotPlan,
  type ReviewExecutionScope, type ReviewRevision, type ReviewExecutionSnapshot,
} from "../packages/features/review-executions/src/domain/review-execution.js";
import type { ReviewExecutionQueryPort } from "../packages/features/review-executions/src/application/ports/review-execution-ports.js";
import type { ReviewObservationQueryPort } from "../packages/features/review-evidence/src/application/ports/review-observation-ports.js";
import type { ReviewObservation } from "../packages/features/review-evidence/src/domain/review-observation.js";
import {
  normalizeProviderInvocationManifest, serializeProviderInvocationManifestCanonicalWireJson,
  type ProviderInvocationManifest,
} from "../packages/features/review-evidence/src/domain/provider-invocation-manifest.js";
import { buildProviderInvocationIdentity } from "../packages/features/review-evidence/src/application/use-cases/build-provider-invocation-identity.js";
import type { ProducerReleaseQueryPort } from "../packages/features/review-run-control/src/application/ports/producer-release-ports.js";
import type { ProducerRelease } from "../packages/features/review-run-control/src/domain/producer-release.js";
import {
  assertSupportedReviewInvestigationCoverageProfile, type ReviewInvestigationContract,
} from "../packages/features/review-investigations/src/domain/coverage-contract.js";
import { assertInvestigationPolicy, type ReviewInvestigationPolicy } from "../packages/features/review-investigations/src/domain/investigation-policy.js";
import { verifyRelayTurnBudget, type RelayTurnBudget } from "../packages/features/review-investigations/src/domain/relay-turn-budget.js";
import { parseReviewInvestigationSeedEnvelope, type ReviewInvestigationSeedEnvelope } from "../apps/api/src/review-investigation-seed-envelope.js";
import type { LiveReviewPublicationLifecyclePort, LiveReviewPublicationLifecycleDecision } from "../packages/features/review-publishing/src/v2/application/ports/review-publication-ports.js";
import { currentReviewProjectionPolicyVersion, renderCanonicalReviewPublication,
  resolveReviewPublicationRenderPolicyVersion, ReviewPublicationOccurrenceState,
} from "../packages/features/review-publishing/src/v2/domain/canonical-review-publication-renderer.js";
import { ReviewPublicationProjectionCoverage } from "../packages/features/review-publishing/src/v2/domain/review-publication-operation-planning.js";
import type { Approval } from "./rr-v4-one-shot-NEWTEST-consumer.js";
import type { TrustedNewtestProducerPreparation } from "./rr-v4-one-shot-NEWTEST-runtime.js";

type Result = Readonly<Record<string, unknown>>;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function assert(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
function text(value: unknown): string {
  assert(typeof value === "string" && value.length > 0, "newtest_producer_receipt_missing");
  return value;
}
function equal(actual: unknown, expected: unknown) {
  assert(canonicalObjectJson(actual) === canonicalObjectJson(expected), "newtest_producer_authority_changed");
}
function encode<T extends Op>(operation: T, value: ReviewActionV2RequestMap[T]): ReviewActionV2RequestMap[T] {
  const zero = { ...value, requestBodyHash: "0".repeat(64) };
  const result = "requestBodyHash" in value
    ? { ...zero, requestBodyHash: hash(canonicalizeReviewActionV2Request(operation, zero)) } : value;
  assert(parseReviewActionV2Request(operation, result).ok, "newtest_producer_request_invalid");
  return result as ReviewActionV2RequestMap[T];
}

/** Trusted launcher inputs, not an Action override or environment template.
 * All manifest component hashes must be measured by the ordinary owner planner
 * from this NEWTEST checkout/config/prompt/seed. This adapter never invents them,
 * registers a producer, discovers credentials, or makes a provider request. */
export type NewtestProducerPlan = Readonly<{
  repositoryGitHubId: "1252762369"; testIdentityId: string; ownerIdHash: string;
  scope: ReviewExecutionScope; revision: ReviewRevision; executionId: string;
  sourceRunId: string; sourceRunAttempt: string; sourceSha: string; runtimeHash: string;
  compatibilityKey: string; workSlot: ReviewWorkSlotPlan; assignmentManifest: ReviewAssignmentManifest;
  invocationManifest: ProviderInvocationManifest; investigationManifest: ProviderInvocationManifest;
  coverageContract: ReviewInvestigationContract; policy: ReviewInvestigationPolicy;
  seedEnvelope: ReviewInvestigationSeedEnvelope; turnBudget: RelayTurnBudget;
  leaseDurationMs: number; checkoutTreeOid: string; measuredGatewayEntrypointSha256: string;
}>;
export type NewtestProducerReaders = {
  executions: Pick<ReviewExecutionQueryPort, "findStream" | "findExecution">;
  observations: Pick<ReviewObservationQueryPort, "findById">;
  releases: ProducerReleaseQueryPort;
  liveLifecycle: LiveReviewPublicationLifecyclePort;
};

function registered(plan: NewtestProducerPlan, release: ProducerRelease | null): asserts release is ProducerRelease {
  const { producerReleaseId, ...profile } = plan.coverageContract;
  assert(release?.state === "registered" && release.producerReleaseId === producerReleaseId &&
    release.runtimeCommitSha === plan.sourceSha && release.runtimeEntrypointDigest === plan.runtimeHash &&
    release.schemaDigest === reviewActionV2PublishedSchemaDigest &&
    release.contextGatewayPolicyVersion === plan.coverageContract.gatewayPolicyVersion &&
    release.contextGatewayEntrypointDigest === plan.measuredGatewayEntrypointSha256 &&
    release.reviewInvestigationProfile?.capability === "review_investigation_v1" &&
    release.reviewInvestigationProfile.coverageProfileHash === hash(canonicalObjectJson(profile)) &&
    release.reviewInvestigationProfile.policyHash === hash(canonicalObjectJson(plan.policy)),
  "newtest_producer_registration_mismatch");
}

/** Read current server ports on each requested phase. A prepared operation is
 * never prepared twice, even after a lost ACK. Caller invokes the ordinary API
 * chain once; no restored receipt or automatic retry is authorized here. */
export async function createNewtestProducerPreparation(input: {
  plan: NewtestProducerPlan; oidcToken: string; readers: NewtestProducerReaders;
  nextRequestId(): string; nextIdempotencyKey(): string; now?: () => Date;
}): Promise<TrustedNewtestProducerPreparation> {
  const plan = structuredClone(input.plan);
  const now = input.now ?? (() => new Date());
  assert(plan.repositoryGitHubId === "1252762369" && plan.testIdentityId &&
    /^[a-f0-9]{64}$/.test(plan.ownerIdHash) && /^[a-f0-9]{40}$/.test(plan.checkoutTreeOid) &&
    /^[a-f0-9]{64}$/.test(plan.measuredGatewayEntrypointSha256) && input.oidcToken &&
    plan.workSlot.providerKind === "codex" && plan.workSlot.taskKind === "finding_discovery" &&
    plan.workSlot.required && plan.workSlot.attemptBudget === 1,
  "newtest_producer_plan_invalid");
  assertSupportedReviewInvestigationCoverageProfile(plan.coverageContract);
  assertInvestigationPolicy(plan.policy);
  const seed = parseReviewInvestigationSeedEnvelope(plan.seedEnvelope, plan.policy.maxObligations);
  const release = await input.readers.releases.findProducerReleaseById(plan.coverageContract.producerReleaseId);
  registered(plan, release);
  const assignment = validateReviewAssignmentManifest(plan.assignmentManifest, [plan.workSlot.workSlotId]);
  assert(assignment.assignments.length === 1 && assignment.assignments[0]!.paths.length > 0 &&
    assignment.assignments[0]!.paths.length <= 8 && !assignment.uncoveredPaths.length &&
    !assignment.excludedPaths.length, "newtest_producer_assignment_incomplete");
  const assignmentCanonical = canonicalReviewAssignmentManifestJson(assignment);
  const assignmentHash = hash(canonicalReviewAssignmentManifestHashPreimage(assignmentCanonical));
  const planHash = hash(canonicalReviewExecutionPlanHashPreimage({
    assignmentManifestHash: assignmentHash, compatibilityKey: plan.compatibilityKey,
    reviewRevisionHash: plan.revision.reviewRevisionHash, workSlots: [plan.workSlot],
  }));
  const digest = { digest: async (bytes: Uint8Array) => hash(bytes) };
  const invocation = await buildProviderInvocationIdentity(digest, {
    manifest: normalizeProviderInvocationManifest(plan.invocationManifest),
    providerVoteIdentityHash: plan.workSlot.providerVoteIdentityHash,
  });
  const investigation = await buildProviderInvocationIdentity(digest, {
    manifest: normalizeProviderInvocationManifest(plan.investigationManifest),
    providerVoteIdentityHash: plan.workSlot.providerVoteIdentityHash,
  });
  for (const identity of [invocation, investigation]) {
    assert(identity.manifest.scopeHash === hash(canonicalObjectJson(plan.scope)) &&
      identity.manifest.producerReleaseId === release.producerReleaseId &&
      identity.manifest.selectedProtocolVersion === "review_action_v2" &&
      identity.manifest.providerKind === "codex" && identity.manifest.requestedModel === seed.requestedModel &&
      identity.manifest.taskKindSet.length === 1 && identity.manifest.taskKindSet[0] === "finding_discovery",
    "newtest_producer_manifest_mismatch");
  }
  assert(investigation.manifest.executionProfile === "investigation_gateway_v1" &&
    investigation.manifest.providerRequestEnvelopeHash === hash(canonicalObjectJson(seed)),
  "newtest_producer_seed_manifest_mismatch");
  const used = new Set<Op>();
  let authorizationToken: string | undefined;
  let authorizationId: string | undefined;
  let finalized = false;
  const envelope = () => ({ protocolVersion: reviewActionV2PublishedProtocolVersion,
    schemaDigest: reviewActionV2PublishedSchemaDigest, requestId: input.nextRequestId() });
  const mutation = () => ({ ...envelope(), idempotencyKey: input.nextIdempotencyKey(), requestBodyHash: "0".repeat(64) });
  return {
    async prepareRequest(operation, receipts) {
      assert(!used.has(operation), "newtest_producer_no_retry");
      used.add(operation);
      registered(plan, await input.readers.releases.findProducerReleaseById(release.producerReleaseId));
      if (operation === Op.ReviewRunAuthorize) return encode(operation, {
        ...envelope(), oidcToken: input.oidcToken,
        supportedProtocols: [{ protocolVersion: reviewActionV2PublishedProtocolVersion, schemaDigest: release.schemaDigest }],
      });
      const auth = receipts[Op.ReviewRunAuthorize];
      assert(auth?.status === "authorized" && auth.producerReleaseId === release.producerReleaseId,
        "newtest_producer_fresh_authorization_required");
      const facts = JSON.parse(text(auth.authorizationFactsCanonicalJson));
      for (const [key, expected] of Object.entries({ ...plan.scope, ...plan.revision,
        sourceRunId: plan.sourceRunId, sourceRunAttempt: plan.sourceRunAttempt,
        producerReleaseId: release.producerReleaseId, schemaDigest: release.schemaDigest,
        selectedProtocolVersion: "review_action_v2" })) equal(facts[key], expected);
      assert(facts.providerVoteLanes?.some((lane: Record<string, unknown>) =>
        lane.providerKind === "codex" && lane.providerVoteIdentityHash === plan.workSlot.providerVoteIdentityHash),
      "newtest_producer_vote_lane_mismatch");
      authorizationToken = text(auth.authorizationToken); authorizationId = text(auth.authorizationId);
      if (operation === Op.ReviewExecutionStart) return encode(operation, {
        ...mutation(), authorizationToken, authorizationId, executionId: plan.executionId,
        reviewRevisionHash: plan.revision.reviewRevisionHash, compatibilityKey: plan.compatibilityKey, planHash,
        assignmentManifestCanonicalJson: assignmentCanonical, assignmentManifestHash: assignmentHash,
        workSlotsCanonicalJson: canonicalObjectJson([plan.workSlot]),
        sourceRunId: plan.sourceRunId, sourceRunAttempt: plan.sourceRunAttempt,
      });
      assert(receipts[Op.ReviewExecutionStart]?.status === "admitted" &&
        receipts[Op.ReviewExecutionStart]?.executionId === plan.executionId, "newtest_producer_execution_not_fresh");
      if (operation === Op.ReviewInvocationLeaseAcquire) return encode(operation, {
        ...mutation(), authorizationToken, executionId: plan.executionId, workSlotId: plan.workSlot.workSlotId,
        purpose: "provider_execution", manifestCanonicalJson: serializeProviderInvocationManifestCanonicalWireJson(invocation.manifest),
        manifestKey: invocation.manifestKey, providerVoteIdentityHash: plan.workSlot.providerVoteIdentityHash,
        providerInvocationKey: invocation.providerInvocationKey, acquireRequestId: input.nextRequestId(), ownerIdHash: plan.ownerIdHash,
      });
      if (operation === Op.ReviewInvestigationOpenV2) return encode(operation, {
        ...mutation(), authorizationToken, authorizationId, executionId: plan.executionId,
        workSlotId: plan.workSlot.workSlotId, reviewRevisionHash: plan.revision.reviewRevisionHash,
        stableReviewUnitKey: plan.workSlot.shardKey, providerVoteLaneId: plan.workSlot.providerVoteIdentityHash,
        providerStrategyId: investigation.providerInvocationKey, runtimeProfile: ReviewInvestigationPublishedRuntimeProfile.GatewayAttestedAgentV1,
        coverageContractCanonicalJson: canonicalObjectJson(plan.coverageContract), coverageContractHash: hash(canonicalObjectJson(plan.coverageContract)),
        investigationPolicyCanonicalJson: canonicalObjectJson(plan.policy), investigationPolicyHash: hash(canonicalObjectJson(plan.policy)),
        seedObligationsCanonicalJson: canonicalObjectJson(seed), seedObligationsHash: hash(canonicalObjectJson(seed)),
        initialReceiptsCanonicalJson: "[]", initialReceiptsHash: hash("[]"),
        investigationManifestCanonicalJson: serializeProviderInvocationManifestCanonicalWireJson(investigation.manifest),
        investigationManifestHash: investigation.manifestKey,
      });
      const opened = receipts[Op.ReviewInvestigationOpenV2];
      assert(opened?.status === "opened", "newtest_producer_investigation_not_fresh");
      const investigationId = text(opened.investigationId);
      if (operation === Op.ReviewInvestigationRelayTurnPlan) {
        const canonical = canonicalObjectJson(plan.turnBudget);
        await verifyRelayTurnBudget({ canonicalJson: canonical, hash: hash(canonical), digestUtf8: async value => hash(value),
          now: now(), turnExpiresAt: new Date(now().getTime() + plan.leaseDurationMs) });
        return encode(operation, { ...mutation(), authorizationToken, investigationId,
          expectedVersion: text(opened.investigationVersion), dossierDigest: text(opened.dossierDigest),
          leaseDurationMs: plan.leaseDurationMs, maxObligationsForTurn: seed.obligations.length,
          turnBudgetHash: hash(canonical), turnBudgetCanonicalJson: canonical });
      }
      const planned = receipts[Op.ReviewInvestigationRelayTurnPlan];
      assert(planned?.status === "applied", "newtest_producer_turn_not_fresh");
      if (operation === Op.ReviewInvestigationRelayLeaseAcquire) return encode(operation, {
        ...mutation(), authorizationToken, investigationId, expectedVersion: text(planned.investigationVersion),
        turnId: text(planned.turnId), turnCapability: text(planned.turnCapability),
        leasePurpose: ReviewInvestigationRelayLeasePurpose.RelayTurn,
        providerStrategyId: investigation.providerInvocationKey,
        investigationManifestCanonicalJson: serializeProviderInvocationManifestCanonicalWireJson(investigation.manifest),
        investigationManifestHash: investigation.manifestKey, acquireRequestId: input.nextRequestId(), ownerIdHash: plan.ownerIdHash,
      });
      assert(operation === Op.ReviewInvestigationRelayContextGatewayOpen, "newtest_producer_operation_denied");
      const lease = receipts[Op.ReviewInvestigationRelayLeaseAcquire];
      assert(lease?.status === "acquired", "newtest_producer_lease_not_fresh");
      const binding = { attemptId: text(lease.attemptId), sourceLeaseId: text(lease.leaseId),
        sourceFencingToken: text(lease.fencingToken), sourceExecutionId: plan.executionId,
        sourceWorkSlotId: plan.workSlot.workSlotId, sourceReviewRevisionHash: plan.revision.reviewRevisionHash,
        checkoutTreeOid: plan.checkoutTreeOid, providerKind: investigation.manifest.providerKind,
        requestedModel: investigation.manifest.requestedModel, executionProfile: investigation.manifest.executionProfile,
        providerInvocationKey: investigation.providerInvocationKey, toolPolicyHash: investigation.manifest.toolPolicyHash,
        gatewayPolicyVersion: plan.coverageContract.gatewayPolicyVersion, gatewayBinaryHash: plan.measuredGatewayEntrypointSha256 };
      return encode(operation, { ...mutation(), authorizationToken, leaseCapability: text(lease.leaseCapability),
        attemptId: binding.attemptId, sourceLeaseId: binding.sourceLeaseId, fencingToken: binding.sourceFencingToken,
        sourceLeaseAuthorityKind: ReviewInvestigationRelayContextLeaseAuthorityKind.InvestigationRelay, sourceExecutionId: binding.sourceExecutionId,
        sourceWorkSlotId: binding.sourceWorkSlotId, sourceReviewRevisionHash: binding.sourceReviewRevisionHash,
        checkoutTreeOid: binding.checkoutTreeOid, gatewayPolicyVersion: binding.gatewayPolicyVersion,
        gatewayBinaryHash: binding.gatewayBinaryHash,
        confinementEvidenceHash: hash(canonicalizeReviewInvestigationContextConfinementEvidence(binding)) });
    },
    async finalizeFromCurrentFacts(actual) {
      assert(!finalized && authorizationToken && authorizationId, "newtest_producer_finalize_not_fresh");
      finalized = true;
      const [stream, snapshot, observation, currentRelease, live] = await Promise.all([
        input.readers.executions.findStream(plan.scope), input.readers.executions.findExecution(plan.executionId),
        input.readers.observations.findById(text(actual.acceptedObservation.observationId)),
        input.readers.releases.findProducerReleaseById(release.producerReleaseId),
        input.readers.liveLifecycle.resolve(plan.scope),
      ]);
      registered(plan, currentRelease);
      assert(stream && snapshot && observation && stream.version === snapshot.stream.version &&
        stream.activeExecutionId === plan.executionId, "newtest_producer_current_facts_unavailable");
      return encode(Op.ReviewExecutionFinalize, { ...mutation(), authorizationToken,
        ...prepareNewtestFinalizationFromFacts({ plan, authorizationId, approval: actual.approval,
          certificate: actual.certificate, acceptedObservation: actual.acceptedObservation, attached: actual.attached,
          snapshot, observation, live, now: now() }) });
    },
  };
}

/** Bounded TEST projection: genuine new findings, summary/check only, no prior
 * threads or lifecycle mutations. Native finalization/publication policy still
 * validates authority, gates, observations, render bytes and artifact identity. */
export function prepareNewtestFinalizationFromFacts(input: {
  plan: NewtestProducerPlan; authorizationId: string; approval: Approval;
  certificate: Result; acceptedObservation: Result; attached: Result;
  snapshot: ReviewExecutionSnapshot; observation: ReviewObservation;
  live: LiveReviewPublicationLifecycleDecision; now: Date;
}) {
  const { plan, approval: a, snapshot: s, observation: o, live } = input;
  assert(a.purpose === "owner_one_shot_uncapped_test" && a.repositoryGitHubId === plan.repositoryGitHubId &&
    a.testIdentityId === plan.testIdentityId && a.ownerIdHash === plan.ownerIdHash &&
    a.executionId === plan.executionId && a.authorizationId === input.authorizationId &&
    a.workSlotId === plan.workSlot.workSlotId && a.producerReleaseId === plan.coverageContract.producerReleaseId &&
    a.sourceSha === plan.sourceSha && a.runtimeHash === plan.runtimeHash &&
    a.headSha === plan.revision.headSha && a.reviewRevisionHash === plan.revision.reviewRevisionHash &&
    Date.parse(a.expiresAt) > input.now.getTime(), "newtest_producer_approval_mismatch");
  equal(s.execution.revision, plan.revision); equal(o.sourceRevision, plan.revision);
  for (const key of Object.keys(plan.scope) as (keyof ReviewExecutionScope)[]) {
    equal(s.execution[key], plan.scope[key]); equal(s.stream[key], plan.scope[key]); equal(o.scope[key], plan.scope[key]);
  }
  assert(s.execution.state === "running" && s.execution.executionId === plan.executionId &&
    s.execution.authorizationId === a.authorizationId && s.execution.producerReleaseId === a.producerReleaseId &&
    s.stream.activeExecutionId === plan.executionId && s.stream.currentRevision?.reviewRevisionHash === a.reviewRevisionHash &&
    s.execution.workSlots.length === 1 && s.execution.workSlots[0]?.state === "satisfied" &&
    s.execution.workSlots[0]?.workSlotId === a.workSlotId && s.observationRefs.length === 1 &&
    s.observationRefs[0]?.observationId === o.observationId && s.observationRefs[0]?.payloadHash === o.payloadHash &&
    o.observationId === input.acceptedObservation.observationId && o.sourceExecutionId === a.executionId &&
    o.sourceAuthorizationId === a.authorizationId && o.sourceWorkSlotId === a.workSlotId &&
    o.sourceLeaseId === a.invocationLeaseId && o.producerReleaseId === a.producerReleaseId &&
    o.sourcePlanHash === s.execution.planHash && o.providerVoteIdentityHash === plan.workSlot.providerVoteIdentityHash &&
    o.investigationCertificateId === input.certificate.certificateId &&
    o.investigationCertificateHash === input.certificate.certificateHash &&
    input.certificate.investigationId === a.investigationId && input.certificate.investigationConclusion === "findings" &&
    input.attached.status === "applied" && input.attached.executionId === a.executionId &&
    input.attached.workSlotId === a.workSlotId && o.transportAttemptCount === 1 && o.status === "success" &&
    o.payload.normalizedFindings.length > 0 && !o.payload.normalizedLifecycleRevalidations.length,
  "newtest_producer_observation_not_authoritative");
  assert(live.status === "available" && live.reviewedHeadSha === a.headSha &&
    live.commandLedgerWatermark >= 0n && live.targets.length === 0, "newtest_producer_lifecycle_not_current_or_empty");
  const watermark = live.commandLedgerWatermark.toString(10);
  const lifecycleStateHash = hash(canonicalObjectJson({ domain: "rr.newtest.live-lifecycle.v1",
    scope: plan.scope, reviewedHeadSha: live.reviewedHeadSha, commandLedgerWatermark: watermark, targets: live.targets }));
  const findings = o.payload.normalizedFindings;
  const projection = {
    envelopeVersion: "review_projection.v1", projectionPolicyVersion: currentReviewProjectionPolicyVersion,
    authoritativeObservationIds: [o.observationId], commandLedgerWatermark: watermark, lifecycleStateHash,
    scope: { scmRepositoryIdentityId: plan.scope.scmRepositoryIdentityId, pullRequestNumber: plan.scope.pullRequestNumber,
      baseSha: plan.revision.baseSha, reviewedHeadSha: a.headSha, reviewRevisionHash: a.reviewRevisionHash },
    coverage: { state: "complete" }, mergeGate: { conclusion: "failure" },
    occurrences: findings.map(f => ({ lineageId: f.normalizedFailureModeHash, state: "new",
      observationIds: [o.observationId], providerVoteKeys: [o.providerVoteIdentityHash], placement: { kind: "summary" },
      title: f.title, message: f.message, evidence: f.evidence })),
    publishing: { check: { conclusion: "failure", marker: `<!-- ${a.executionId}:check -->`, name: "ReviewRouter",
      summary: `Accepted investigation findings: ${findings.length}`, title: "Review findings" },
      inlineReviewChunks: [], lifecycle: [], summary: { allClear: false,
        body: findings.map(f => `${f.title}: ${f.message}`).join("\n\n"), marker: `<!-- ${a.executionId}:summary -->`,
        occurrenceCounts: { new: findings.length, reconfirmed: 0, changed: 0, carried_unverified: 0,
          resolved: 0, uncertain: 0, suppressed_by_human: 0 } } }, snapshot: { lineageHints: [] },
  } as const;
  // The same native renderer used by the API publication parser. This is a
  // qualification, not a substitute for its signed permit/current-facts gates.
  renderCanonicalReviewPublication({ coverage: ReviewPublicationProjectionCoverage.Completed,
    renderPolicyVersion: resolveReviewPublicationRenderPolicyVersion(projection.projectionPolicyVersion),
    targetCommitId: a.headSha, occurrenceStates: findings.map(() => ReviewPublicationOccurrenceState.New),
    source: projection.publishing }, { digestUtf8: hash, utf8ByteLength: value => Buffer.byteLength(value, "utf8") });
  const canonical = canonicalObjectJson(projection);
  const projectionHash = hash(canonical);
  const artifactHash = hash(`rr.review-artifact.v1\0${canonicalObjectJson({
    operationsCanonicalJson: canonicalObjectJson(projection.publishing), projectionHash })}`);
  return { executionId: a.executionId, expectedStreamVersion: s.stream.version.toString(10),
    expectedExecutionVersion: s.execution.version.toString(10), artifactId: `rr:artifact:${artifactHash}`, artifactHash,
    projectionEnvelopeVersion: 1, projectionEnvelopeCanonicalJson: canonical, projectionHash, lifecycleStateHash,
    commandLedgerWatermark: watermark, allowPartial: false };
}
