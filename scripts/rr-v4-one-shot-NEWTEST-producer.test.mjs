import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  createNewtestProducerPreparation,
  prepareNewtestFinalizationFromFacts,
} from "./rr-v4-one-shot-NEWTEST-producer.ts";
import { canonicalObjectJson } from "../packages/features/review-executions/src/domain/review-execution.ts";
import { reviewInvestigationCoverageProfileV10 } from "../packages/features/review-investigations/src/domain/coverage-contract.ts";
import { prepareNewtestActionWorkflow } from "./rr-v4-one-shot-NEWTEST-runtime.ts";
import {
  canonicalizeReviewActionV2Request,
  parseReviewActionV2Request,
  reviewActionV2PublishedSchemaDigest,
  ReviewActionV2OperationId as Op,
} from "../packages/protocol-review-action-v2/src/index.js";
import { createTrustedExclusivePublicationPreparation } from "../apps/api/src/review-action-v2-production-composition-snapshot-publication.ts";
import { allowingReviewPublicationDecisionPorts } from "../packages/features/review-publishing/src/v2/testing/in-memory-review-publication-decisions.ts";

// Pure synthetic fixtures only. No JWT, auth store, DB, HTTP/provider, checkout
// or launcher calls. A wrong observation binding/live head/version/registration
// must turn these green paths red; constants below are not canary evidence.
const hash = (value) => createHash("sha256").update(value).digest("hex");
function facts() {
  const scope = {
    workspaceId: "NEWTEST-workspace",
    repositoryConnectionId: "NEWTEST-connection",
    scmRepositoryIdentityId: "NEWTEST-repository",
    pullRequestNumber: 4,
  };
  const revision = {
    baseSha: "a".repeat(40),
    mergeBaseSha: "b".repeat(40),
    headSha: "c".repeat(40),
    reviewRevisionHash: hash("NEWTEST-revision"),
  };
  const workSlot = {
    workSlotId: "NEWTEST-slot",
    providerVoteIdentityHash: hash("NEWTEST-vote"),
    providerKind: "codex",
    taskKind: "finding_discovery",
    required: true,
    attemptBudget: 1,
    shardKey: "NEWTEST-unit",
    retryPolicyVersion: "NEWTEST-no-retry",
  };
  const policy = {
    policyId: "NEWTEST-policy",
    maxObligations: 2,
    maxExpansionDepth: 1,
    maxSemanticTurns: 1,
    maxOperationalAttempts: 1,
    maxCriticCycles: 1,
    maxFindings: 2,
    maxProposalsPerTurn: 2,
    maxReceiptsPerTurn: 8,
  };
  const plan = {
    repositoryGitHubId: "1252762369",
    testIdentityId: "NEWTEST-identity",
    ownerIdHash: hash("NEWTEST-owner"),
    scope,
    revision,
    executionId: "NEWTEST-execution",
    workSlot,
    sourceSha: "d".repeat(40),
    runtimeHash: hash("NEWTEST-runtime"),
    coverageContract: {
      ...reviewInvestigationCoverageProfileV10,
      producerReleaseId: "NEWTEST-release",
    },
    policy,
    checkoutTreeOid: "e".repeat(40),
    measuredGatewayEntrypointSha256: hash("NEWTEST-gateway"),
    seedEnvelope: {
      contract: "review_investigation_seed_envelope.v1",
      obligations: [
        {
          kind: "inventory_witness",
          canonicalSubject: "NEWTEST-path",
          canonicalRequirement: "Read NEWTEST exact path",
          riskPriority: 1,
        },
      ],
      requestedModel: "NEWTEST-model",
      probePlanHash: hash("NEWTEST-probe"),
      reviewPromptHash: hash("NEWTEST-prompt"),
    },
  };
  const approval = {
    purpose: "owner_one_shot_uncapped_test",
    repositoryGitHubId: plan.repositoryGitHubId,
    testIdentityId: plan.testIdentityId,
    ownerIdHash: plan.ownerIdHash,
    executionId: plan.executionId,
    authorizationId: "NEWTEST-authorization",
    producerReleaseId: "NEWTEST-release",
    workSlotId: workSlot.workSlotId,
    sourceSha: plan.sourceSha,
    runtimeHash: plan.runtimeHash,
    headSha: revision.headSha,
    reviewRevisionHash: revision.reviewRevisionHash,
    invocationLeaseId: "NEWTEST-lease",
    investigationId: "NEWTEST-investigation",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const observation = {
    observationId: "NEWTEST-observation",
    scope,
    sourceRevision: revision,
    sourceExecutionId: plan.executionId,
    sourceWorkSlotId: workSlot.workSlotId,
    sourceAuthorizationId: approval.authorizationId,
    sourceLeaseId: approval.invocationLeaseId,
    producerReleaseId: approval.producerReleaseId,
    sourcePlanHash: hash("NEWTEST-plan"),
    providerVoteIdentityHash: workSlot.providerVoteIdentityHash,
    payloadHash: hash("NEWTEST-payload"),
    investigationCertificateId: "NEWTEST-certificate",
    investigationCertificateHash: hash("NEWTEST-certificate"),
    transportAttemptCount: 1,
    status: "success",
    payload: {
      normalizedLifecycleRevalidations: [],
      normalizedFindings: [
        {
          normalizedFailureModeHash: hash("NEWTEST-actual-defect"),
          title: "NEWTEST finding",
          message: "Concrete fixture defect",
          evidence: ["NEWTEST exact line"],
        },
      ],
    },
  };
  const snapshot = {
    execution: {
      ...scope,
      executionId: plan.executionId,
      revision,
      authorizationId: approval.authorizationId,
      producerReleaseId: approval.producerReleaseId,
      planHash: observation.sourcePlanHash,
      state: "running",
      version: 43n,
      workSlots: [{ ...workSlot, state: "satisfied" }],
    },
    stream: {
      ...scope,
      activeExecutionId: plan.executionId,
      currentRevision: revision,
      version: 41n,
    },
    observationRefs: [
      {
        observationId: observation.observationId,
        payloadHash: observation.payloadHash,
      },
    ],
  };
  return {
    plan,
    authorizationId: approval.authorizationId,
    approval,
    snapshot,
    observation,
    certificate: {
      investigationId: approval.investigationId,
      certificateId: observation.investigationCertificateId,
      certificateHash: observation.investigationCertificateHash,
      investigationConclusion: "findings",
    },
    acceptedObservation: { observationId: observation.observationId },
    attached: {
      status: "applied",
      executionId: plan.executionId,
      workSlotId: workSlot.workSlotId,
    },
    live: {
      status: "available",
      reviewedHeadSha: revision.headSha,
      commandLedgerWatermark: 17n,
      targets: [],
    },
    now: new Date("2026-10-03T12:00:00.000Z"),
  };
}

test("finalizer derives actual nonzero ledger/current versions and artifact bytes, never all-clear", () => {
  const actual = facts();
  const request = prepareNewtestFinalizationFromFacts(actual);
  assert.equal(request.commandLedgerWatermark, "17");
  assert.equal(request.expectedStreamVersion, "41");
  assert.equal(request.expectedExecutionVersion, "43");
  const projection = JSON.parse(request.projectionEnvelopeCanonicalJson);
  assert.deepEqual(projection.authoritativeObservationIds, [
    actual.observation.observationId,
  ]);
  assert.equal(
    projection.occurrences[0].message,
    actual.observation.payload.normalizedFindings[0].message,
  );
  assert.equal(projection.publishing.summary.allClear, false);
  assert.equal(projection.mergeGate.conclusion, "failure");
  assert.equal(
    hash(request.projectionEnvelopeCanonicalJson),
    request.projectionHash,
  );
  assert.equal(
    request.artifactHash,
    hash(
      `rr.review-artifact.v1\0${canonicalObjectJson({
        operationsCanonicalJson: canonicalObjectJson(projection.publishing),
        projectionHash: request.projectionHash,
      })}`,
    ),
  );
  assert.equal(request.artifactId, `rr:artifact:${request.artifactHash}`);
  const changed = facts();
  changed.live.commandLedgerWatermark = 18n;
  assert.notEqual(
    prepareNewtestFinalizationFromFacts(changed).lifecycleStateHash,
    request.lifecycleStateHash,
  );
});

test("current-facts finalizer rejects stale/unbound facts and existing lifecycle targets", () => {
  for (const change of [
    (x) => (x.live.reviewedHeadSha = "f".repeat(40)),
    (x) => x.live.targets.push({ targetId: "NEWTEST-existing-thread" }),
    (x) => (x.snapshot.stream.activeExecutionId = "NEWTEST-other-execution"),
    (x) => (x.snapshot.execution.workSlots[0].state = "leased"),
    (x) => (x.observation.sourceLeaseId = "NEWTEST-historical-lease"),
    (x) =>
      (x.observation.sourceAuthorizationId = "NEWTEST-other-authorization"),
    (x) =>
      (x.observation.investigationCertificateHash = hash(
        "NEWTEST-other-certificate",
      )),
    (x) => (x.observation.transportAttemptCount = 2),
    (x) => (x.acceptedObservation.observationId = "NEWTEST-other-observation"),
    (x) => (x.approval.expiresAt = "2020-01-01T00:00:00.000Z"),
    (x) =>
      (x.snapshot.observationRefs[0].payloadHash = hash(
        "NEWTEST-other-payload",
      )),
  ]) {
    const actual = facts();
    change(actual);
    assert.throws(
      () => prepareNewtestFinalizationFromFacts(actual),
      /newtest_producer_/,
    );
  }
});

test("producer rejects a revoked/unmeasured registration before any request preparation", async () => {
  const actual = facts();
  let ids = 0;
  await assert.rejects(
    createNewtestProducerPreparation({
      plan: actual.plan,
      oidcToken: "opaque-trusted-launcher-input-never-sent",
      readers: {
        releases: { findProducerReleaseById: async () => null },
      },
      nextRequestId: () => String(++ids),
      nextIdempotencyKey: () => String(++ids),
    }),
    /newtest_producer_registration_mismatch/,
  );
  assert.equal(ids, 0);
});

test("all seven native preparation requests validate before grant, using exact fresh server receipts", async () => {
  const actual = facts();
  const { plan } = actual;
  const manifest = (profile) => ({
    manifestVersion: 1,
    scopeHash: hash(canonicalObjectJson(plan.scope)),
    taskKindSet: ["finding_discovery"],
    providerKind: "codex",
    requestedModel: plan.seedEnvelope.requestedModel,
    providerPolicyVersion: "NEWTEST-provider-policy",
    producerReleaseId: plan.coverageContract.producerReleaseId,
    selectedProtocolVersion: "review_action_v2",
    executionProfile: profile,
    providerRequestEnvelopeHash: hash(canonicalObjectJson(plan.seedEnvelope)),
    ...Object.fromEntries(
      [
        "providerCapabilityHash",
        "outputSchemaHash",
        "reviewConfigHash",
        "runtimeCompatibilityKey",
        "filePatchManifestHash",
        "contextManifestHash",
        "toolPolicyHash",
        "environmentContractHash",
      ].map((key) => [key, hash(`NEWTEST-${key}`)]),
    ),
    memoryBundleHash: null,
    codeGraphProjectionHash: null,
    lifecycleTargetSetHash: null,
    liveLifecycleStateHash: null,
    baseTreeHash: hash("NEWTEST-base-tree"),
  });
  Object.assign(plan, {
    sourceRunId: "NEWTEST-run",
    sourceRunAttempt: "1",
    compatibilityKey: hash("NEWTEST-compatibility"),
    assignmentManifest: {
      manifestVersion: 1,
      assignments: [
        { workSlotId: plan.workSlot.workSlotId, paths: ["NEWTEST.ts"] },
      ],
      eligiblePaths: ["NEWTEST.ts"],
      uncoveredPaths: [],
      excludedPaths: [],
    },
    invocationManifest: manifest("context_gateway_v1"),
    investigationManifest: manifest("investigation_gateway_v1"),
    leaseDurationMs: 60_000,
    turnBudget: {
      version: 1,
      maxRequests: 1,
      maxRequestBytes: 10_000,
      maxResponseBytes: 20_000,
      maxOutputTokens: 100,
      maxGatewayOperations: 8,
      maxOutputFindings: 2,
      maxOutputProposals: 2,
      deadline: new Date(actual.now.getTime() + 30_000).toISOString(),
    },
  });
  const { producerReleaseId, ...coverage } = plan.coverageContract;
  const release = {
    state: "registered",
    producerReleaseId,
    runtimeCommitSha: plan.sourceSha,
    runtimeEntrypointDigest: plan.runtimeHash,
    schemaDigest: reviewActionV2PublishedSchemaDigest,
    contextGatewayPolicyVersion: plan.coverageContract.gatewayPolicyVersion,
    contextGatewayEntrypointDigest: plan.measuredGatewayEntrypointSha256,
    reviewInvestigationProfile: {
      capability: "review_investigation_v1",
      coverageProfileHash: hash(canonicalObjectJson(coverage)),
      policyHash: hash(canonicalObjectJson(plan.policy)),
    },
  };
  let next = 0;
  const producer = await createNewtestProducerPreparation({
    plan,
    oidcToken: "opaque-unit-test-token-not-JWT-never-sent-to-auth-service",
    readers: { releases: { findProducerReleaseById: async () => release } },
    nextRequestId: () => `NEWTEST-request-${++next}`,
    nextIdempotencyKey: () => `NEWTEST-key-${++next}`,
    now: () => actual.now,
  });
  const sequence = [
    Op.ReviewRunAuthorize,
    Op.ReviewExecutionStart,
    Op.ReviewInvocationLeaseAcquire,
    Op.ReviewInvestigationOpenV2,
    Op.ReviewInvestigationRelayTurnPlan,
    Op.ReviewInvestigationRelayLeaseAcquire,
    Op.ReviewInvestigationRelayContextGatewayOpen,
  ];
  const requests = [];
  const token = "NEWTEST-genuine-receipt-shaped-opaque-capability";
  const replies = {
    [Op.ReviewRunAuthorize]: {
      status: "authorized",
      producerReleaseId,
      authorizationId: actual.authorizationId,
      authorizationToken: token,
      authorizationFactsCanonicalJson: canonicalObjectJson({
        ...plan.scope,
        ...plan.revision,
        sourceRunId: plan.sourceRunId,
        sourceRunAttempt: plan.sourceRunAttempt,
        producerReleaseId,
        schemaDigest: release.schemaDigest,
        selectedProtocolVersion: "review_action_v2",
        providerVoteLanes: [
          {
            providerKind: "codex",
            providerVoteIdentityHash: plan.workSlot.providerVoteIdentityHash,
          },
        ],
      }),
    },
    [Op.ReviewExecutionStart]: {
      status: "admitted",
      executionId: plan.executionId,
    },
    [Op.ReviewInvocationLeaseAcquire]: {
      status: "acquired",
      leaseId: "NEWTEST-invocation-lease",
      leaseCapability: "NEWTEST-invocation-capability",
    },
    [Op.ReviewInvestigationOpenV2]: {
      status: "opened",
      investigationId: "NEWTEST-investigation",
      investigationVersion: "1",
      dossierDigest: hash("NEWTEST-dossier"),
    },
    [Op.ReviewInvestigationRelayTurnPlan]: {
      status: "applied",
      investigationVersion: "2",
      turnId: "NEWTEST-turn",
      turnCapability: "NEWTEST-turn-capability",
    },
    [Op.ReviewInvestigationRelayLeaseAcquire]: {
      status: "acquired",
      leaseId: "NEWTEST-relay-lease",
      attemptId: "NEWTEST-relay-attempt",
      leaseCapability: "NEWTEST-relay-capability",
      fencingToken: "13",
    },
    [Op.ReviewInvestigationRelayContextGatewayOpen]: {
      status: "opened",
      sessionId: "NEWTEST-session",
    },
  };
  await prepareNewtestActionWorkflow({
    producer,
    client: {
      async action(operation, request) {
        assert.equal(operation, sequence[requests.length]);
        assert.equal(parseReviewActionV2Request(operation, request).ok, true);
        if ("requestBodyHash" in request)
          assert.equal(
            request.requestBodyHash,
            hash(canonicalizeReviewActionV2Request(operation, request)),
          );
        if (operation !== Op.ReviewRunAuthorize)
          assert.equal(request.authorizationToken, token);
        requests.push({ operation, request });
        return replies[operation];
      },
    },
  });
  assert.deepEqual(
    requests.map((r) => r.operation),
    sequence,
  );
  const lease = requests.find(
    (r) => r.operation === Op.ReviewInvestigationRelayLeaseAcquire,
  ).request;
  assert.equal(lease.leasePurpose, "relay_turn");
  assert.equal(
    lease.turnId,
    replies[Op.ReviewInvestigationRelayTurnPlan].turnId,
  );
  const { leasePurpose, ...missingPurpose } = lease;
  assert.equal(
    parseReviewActionV2Request(
      Op.ReviewInvestigationRelayLeaseAcquire,
      missingPurpose,
    ).ok,
    false,
  );
  const opened = requests.at(-1).request;
  assert.equal(
    opened.sourceLeaseId,
    replies[Op.ReviewInvestigationRelayLeaseAcquire].leaseId,
  );
  assert.equal(opened.fencingToken, "13");
  assert.equal(opened.sourceLeaseAuthorityKind, "investigation_relay");
  await assert.rejects(
    producer.prepareRequest(Op.ReviewRunAuthorize, {}),
    /newtest_producer_no_retry/,
  );
  assert.equal(requests.length, 7); // No grant/provider/publication operation was invoked.
});

test("current-fact projection passes the real API published-envelope parser and native operation renderer", async () => {
  const actual = facts();
  const finalized = prepareNewtestFinalizationFromFacts(actual);
  const projection = JSON.parse(finalized.projectionEnvelopeCanonicalJson);
  /** @type {import('../packages/features/review-publishing/src/v2/domain/review-publication-attempt.ts').ReviewPublicationPermitIdentity} */
  const permit = {
    ...actual.plan.scope,
    executionId: actual.plan.executionId,
    generation: 1n,
    authorizationId: actual.authorizationId,
    producerReleaseId: actual.approval.producerReleaseId,
    reviewedHeadSha: actual.approval.headSha,
    reviewRevisionHash: actual.approval.reviewRevisionHash,
    projectionHash: finalized.projectionHash,
    lifecycleStateHash: finalized.lifecycleStateHash,
    commandLedgerWatermark: 17n,
    permitEpoch: 1n,
    publicationSafetyDecisionHash: hash("NEWTEST-publication-safety"),
    publicationNotAfter: new Date(actual.now.getTime() + 60_000),
  };
  const artifact = {
    artifactId: finalized.artifactId,
    executionId: permit.executionId,
    generation: 1n,
    reviewedHeadSha: permit.reviewedHeadSha,
    reviewRevisionHash: permit.reviewRevisionHash,
    coverageState: "completed",
    projectionEnvelopeVersion: 1,
    projectionEnvelopeJson: finalized.projectionEnvelopeCanonicalJson,
    projectionHash: finalized.projectionHash,
    byteCount: Buffer.byteLength(finalized.projectionEnvelopeCanonicalJson),
    findingCount: actual.observation.payload.normalizedFindings.length,
    lifecycleStateHash: finalized.lifecycleStateHash,
    commandLedgerWatermark: 17n,
    projectionPolicyVersion: projection.projectionPolicyVersion,
    publicationPermit: permit,
    createdAt: actual.now,
    retainUntil: new Date(actual.now.getTime() + 86_400_000),
  };
  let preparedReads = 0;
  const facade = createTrustedExclusivePublicationPreparation({
    authorizations: {
      async resolveReviewRunAuthorizationToken() {
        return {
          status: "valid",
          authorization: {
            ...actual.plan.scope,
            authorizationId: actual.authorizationId,
            protocolLimitsProfileId: "NEWTEST-limits",
          },
        };
      },
    },
    executions: {
      async findExecution() {
        preparedReads++;
        return { ...actual.snapshot, artifact };
      },
    },
    releases: {
      async findProducerReleaseById() {
        return {
          state: "registered",
          protocolLimitsProfileId: "NEWTEST-limits",
        };
      },
      async findProtocolLimitsProfileById() {
        return {
          protocolLimitsProfileId: "NEWTEST-limits",
          limitsDigest: hash("NEWTEST-limits"),
          maxPublicationOperations: 4,
          maxPublicationChunks: 2,
          maxPublicationBodyBytes: 100_000,
          maxReconciliationDurationMs: 60_000,
        };
      },
    },
    publications: {
      async findById() {
        return null;
      },
    },
    capabilities: {
      async verifyPublicationPermit() {
        return permit;
      },
    },
    digest: { digestUtf8: async (value) => hash(value) },
    now: () => actual.now,
    contextPolicy: {
      async assertCurrentPolicy({ snapshot }) {
        assert.equal(
          snapshot.observationRefs[0].observationId,
          actual.observation.observationId,
        );
        assert.equal(
          snapshot.artifact.commandLedgerWatermark,
          actual.live.commandLedgerWatermark,
        );
      },
    },
    decisions: allowingReviewPublicationDecisionPorts(permit),
  });
  function request(publishing, projectionHash) {
    const value = {
      protocolVersion: "2",
      schemaDigest: reviewActionV2PublishedSchemaDigest,
      requestId: "NEWTEST-publication-request",
      authorizationToken: "opaque-unit-test-not-JWT",
      idempotencyKey: "NEWTEST-publication-key",
      requestBodyHash: "0".repeat(64),
      publicationPermit: "opaque-unit-test-permit-not-JWT",
      projectionHash,
      operationsCanonicalJson: canonicalObjectJson(publishing),
    };
    return {
      ...value,
      requestBodyHash: hash(
        canonicalizeReviewActionV2Request(Op.ReviewPublicationRequest, value),
      ),
    };
  }
  const measured = {
    artifactId: finalized.artifactId,
    artifactHash: finalized.artifactHash,
  };
  const prepared = await facade.prepareExclusivePublication(
    request(projection.publishing, finalized.projectionHash),
    measured,
  );
  assert.equal(prepared.artifactId, finalized.artifactId);
  assert.equal(prepared.command.operations.length, 2);
  assert.deepEqual(
    prepared.command.operations.map((op) => op.publicationKind).sort(),
    ["managed_check", "summary"],
  );
  assert.equal(prepared.verifiedPermit.commandLedgerWatermark, 17n);
  assert.equal(
    prepared.verifiedPermit.lifecycleStateHash,
    finalized.lifecycleStateHash,
  );
  assert.equal(
    prepared.verifiedPermit.publicationNotAfter.getTime(),
    actual.now.getTime() + 60_000,
  );
  assert.equal(prepared.command.createdAt.getTime(), actual.now.getTime());
  assert.equal(
    prepared.command.retainUntil.getTime(),
    artifact.retainUntil.getTime(),
  );
  assert.equal(
    actual.observation.investigationCertificateHash,
    actual.certificate.certificateHash,
  );
  assert.equal(preparedReads, 1); // No request/enqueue/provider port exists in this trusted preparer.
  // Independently contradict the publication grammar/counts while preserving
  // measured identities; the actual API parser/renderer must reject it.
  projection.publishing.summary.occurrenceCounts.new = 0;
  const changedCanonical = canonicalObjectJson(projection);
  const changedHash = hash(changedCanonical);
  Object.assign(artifact, {
    projectionEnvelopeJson: changedCanonical,
    projectionHash: changedHash,
    byteCount: Buffer.byteLength(changedCanonical),
  });
  permit.projectionHash = changedHash;
  const changedArtifactHash = hash(
    `rr.review-artifact.v1\0${canonicalObjectJson({
      operationsCanonicalJson: canonicalObjectJson(projection.publishing),
      projectionHash: changedHash,
    })}`,
  );
  artifact.artifactId = `rr:artifact:${changedArtifactHash}`;
  await assert.rejects(
    facade.prepareExclusivePublication(
      request(projection.publishing, changedHash),
      {
        artifactId: artifact.artifactId,
        artifactHash: changedArtifactHash,
      },
    ),
    (error) =>
      error.issues?.includes("publication_occurrence_counts_mismatch") ||
      error.details?.issues?.includes(
        "publication_occurrence_counts_mismatch",
      ) ||
      error.message.includes("publication_occurrence_counts_mismatch"),
  );
});
