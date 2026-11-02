import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PrismaReviewRequestedIntentStore } from "@reviewrouter/features-review-executions/composition";
import { PrismaReviewExecutionStore } from "@reviewrouter/features-review-executions/composition";
import {
  ReviewRequestAdmissionState,
  ReviewRequestedTriggerKind,
  type ReviewRequestedIntentCandidate,
} from "@reviewrouter/features-review-executions";
import { ReviewExecutionAdmissionVerdict } from "@reviewrouter/features-review-executions";
import {
  ReviewTaskKind,
  ReviewExecutionProviderKind,
} from "@reviewrouter/features-review-executions";
import { PrismaHistoryWriter } from "../adapters/outbound/prisma-history-writer";
export const hash = (value = "a") => value.repeat(64);
export const revision = {
  baseSha: "a".repeat(40),
  mergeBaseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  reviewRevisionHash: hash(),
};
export const limits = {
  profileId: "history-limits",
  maxWorkSlots: 16,
  maxAttemptBudget: 4,
  maxProjectionBytes: 1000000,
  maxFindingCount: 1000,
  maxLeaseDurationMs: 120000,
  maxResultReportDurationMs: 180000,
};
export async function createHistorySourceFixture(prisma: PrismaClient) {
  const suffix = randomUUID(),
    workspaceId = `history-work-${suffix}`,
    repositoryConnectionId = `history-repo-${suffix}`,
    scmRepositoryIdentityId = `history-scm-${suffix}`,
    authorizationId = `history-auth-${suffix}`,
    producerReleaseId = `history-release-${suffix}`,
    sourceRunId = `run-${suffix}`,
    now = new Date();
  await prisma.workspace.create({
    data: { id: workspaceId, slug: workspaceId, name: "History source test" },
  });
  await prisma.user.create({ data: { id: `member-${suffix}` } });
  await prisma.workspaceMember.create({
    data: { workspaceId, userId: `member-${suffix}`, role: "member" },
  });
  await prisma.scmRepositoryIdentity.create({
    data: {
      scmRepositoryIdentityId,
      provider: "github",
      normalizedSourceBaseUrl: "https://github.com",
      externalRepositoryId: suffix,
      createdAt: now,
    },
  });
  await prisma.repositoryConnection.create({
    data: {
      id: repositoryConnectionId,
      workspaceId,
      provider: "github",
      externalRepositoryId: suffix,
      scmRepositoryIdentityId,
      owner: "history-test",
      name: suffix,
      fullName: `history-test/${suffix}`,
      defaultBranch: "main",
      visibility: "private",
    },
  });
  await prisma.scmRepositoryIdentity.update({
    where: { scmRepositoryIdentityId },
    data: {
      currentWorkspaceId: workspaceId,
      currentRepositoryConnectionId: repositoryConnectionId,
      boundAt: now,
    },
  });
  await prisma.reviewProtocolLimitsV2.upsert({
    where: { protocolLimitsProfileId: limits.profileId },
    update: {},
    create: {
      protocolLimitsProfileId: limits.profileId,
      limitsDigest: hash("1"),
      maxWorkSlots: 16,
      maxAttemptsPerSlot: 4,
      maxObservationBytes: 1000000,
      maxObservationFindings: 1000,
      maxProjectionBytes: 1000000,
      maxProjectionFindings: 1000,
      maxPublicationOperations: 100,
      maxPublicationChunks: 100,
      maxPublicationBodyBytes: 1000000,
      maxRequestBatchSize: 100,
      maxLeaseDurationMs: 120000,
      maxResultReportDurationMs: 180000,
      maxReconciliationDurationMs: 3600000,
      registeredAt: now,
    },
  });
  await prisma.reviewOperationalSloProfileV2.upsert({
    where: { operationalSloProfileId: "history-slo" },
    update: {},
    create: {
      operationalSloProfileId: "history-slo",
      sloDigest: hash("2"),
      integrationEventDeliveryMs: 1000,
      outboxClaimAgeMs: 1000,
      missingCompletionProcessMs: 1000,
      dueCompletionProcessMs: 1000,
      publicationReconciliationMs: 1000,
      v1DrainMs: 1000,
      admissionMs: 1000,
      pruningBacklogAgeMs: 1000,
      ownerRefs: ["test"],
      runbookRefs: ["test"],
      registeredAt: now,
    },
  });
  await prisma.producerRelease.create({
    data: {
      producerReleaseId,
      distributionKind: "hosted_composite",
      actionCommitSha: "a".repeat(40),
      runtimeCommitSha: "b".repeat(40),
      wrapperEntrypointDigest: hash("c"),
      runtimeEntrypointDigest: hash("3"),
      schemaDigest: hash("4"),
      capabilityProfile: suffix,
      protocolLimitsProfileId: limits.profileId,
      operationalSloProfileId: "history-slo",
      registeredAt: now,
    },
  });
  await prisma.reviewRunAuthorization.create({
    data: {
      authorizationId,
      workspaceId,
      repositoryConnectionId,
      scmRepositoryIdentityId,
      pullRequestNumber: 42,
      sourceRunId,
      sourceRunAttempt: "1",
      workflowIdentityHash: hash("5"),
      ...revision,
      trustDomain: "trusted_managed",
      producerReleaseId,
      selectedProtocolVersion: "review-action-v2",
      schemaDigest: hash("4"),
      protocolLimitsProfileId: limits.profileId,
      operationalSloProfileId: "history-slo",
      mutationEpoch: 1n,
      providerVoteLanes: [],
      authorizationSafetyDecisionHash: hash("6"),
      protocolOfferHash: hash("7"),
      oidcReplayKeyHash: suffix.replaceAll("-", "").repeat(2),
      tokenSigningKeyId: "test",
      tokenIssuer: "test",
      tokenAudience: "review-run",
      expiresAt: new Date(now.getTime() + 3600000),
      maxExpiresAt: new Date(now.getTime() + 7200000),
      createdAt: now,
    },
  });
  const scope = {
    workspaceId,
    repositoryConnectionId,
    scmRepositoryIdentityId,
    pullRequestNumber: 42,
  };
  const writer = new PrismaHistoryWriter();
  const intents = new PrismaReviewRequestedIntentStore(prisma, {
    historyCapture: {
      register: (tx, i, m) => writer.register(tx, i, m),
      changed: (tx, i, p) => writer.captureIntent(tx, i, p),
    },
  });
  const executions = new PrismaReviewExecutionStore(prisma, {
    historyCapture: (tx, e) => writer.captureExecution(tx, e),
  });
  function candidate(
    id = `request-${randomUUID()}`,
    pr = 42,
  ): ReviewRequestedIntentCandidate {
    return {
      ...scope,
      pullRequestNumber: pr,
      requestId: id,
      revision,
      triggerKind: ReviewRequestedTriggerKind.ManualCommand,
      deliveryIdentityHash: randomUUID().replaceAll("-", "").repeat(2),
      canonicalRequestHash: hash("8"),
      notBefore: now,
      createdAt: now,
      retainUntil: new Date(now.getTime() + 86400000),
      historyMetadata: { pullRequestTitle: "A captured title" },
    };
  }
  async function dispatch(c: ReviewRequestedIntentCandidate) {
    await intents.registerIntent({ candidate: c });
    const claimed = await intents.claimIntent({
      requestId: c.requestId,
      claimId: `claim-${randomUUID()}`,
      ownerIdHash: "test-owner",
      now: new Date(),
      claimUntil: new Date(Date.now() + 60000),
    });
    if (!("intent" in claimed) || !claimed.intent?.claim)
      throw new Error("fixture_claim_missing");
    const claim = claimed.intent.claim;
    await intents.beginSubmission({
      requestId: c.requestId,
      claimId: claim.claimId,
      ownerIdHash: claim.ownerIdHash,
      fencingToken: claim.fencingToken,
      now: new Date(),
      nextResolutionAt: new Date(Date.now() + 1000),
      resolutionDeadlineAt: new Date(Date.now() + 60000),
    });
    const dispatched = await intents.recordDispatch({
      requestId: c.requestId,
      claimId: claim.claimId,
      ownerIdHash: claim.ownerIdHash,
      fencingToken: claim.fencingToken,
      sourceRunId,
      sourceRunAttempt: "1",
      now: new Date(),
      nextResolutionAt: new Date(Date.now() + 1000),
      resolutionDeadlineAt: new Date(Date.now() + 60000),
    });
    if (!("intent" in dispatched) || !dispatched.intent)
      throw new Error("fixture_dispatch_missing");
    await intents.recordAdmissionDecision({
      requestId: c.requestId,
      expectedVersion: dispatched.intent.version,
      changedLines: 10,
      maxChangedLines: 100,
      policySnapshotId: "history-policy",
      decisionHash: hash("9"),
      verdict: ReviewRequestAdmissionState.Admitted,
      now: new Date(),
    });
  }
  async function prepare(id: string, seed: string, requestId: string) {
    const current = await executions.findStream(scope);
    const requested = await intents.findByRequestId(requestId);
    const p = await executions.prepareExecution({
      scope,
      historyRootRequestId: requested?.historyRootRequestId ?? null,
      historyDispatchAttempt: requested?.dispatchAttempt ?? null,
      expectedStreamVersion: current?.version ?? 0n,
      executionId: id,
      authorizationId,
      producerReleaseId,
      mutationEpoch: 1n,
      revision,
      startIdentityHash: hash(seed),
      canonicalStartHash: hash(seed),
      admissionSafetyDecisionHash: hash("6"),
      compatibilityKey: "history",
      planHash: hash("a"),
      workSlots: [
        {
          workSlotId: `slot-${id}`,
          taskKind: ReviewTaskKind.FindingDiscovery,
          providerKind: ReviewExecutionProviderKind.Codex,
          providerVoteIdentityHash: hash("b"),
          shardKey: "one",
          required: false,
          attemptBudget: 1,
          retryPolicyVersion: "one",
        },
      ],
      limits,
      sourceRunId,
      sourceRunAttempt: "1",
      now: new Date(),
      admissionDeadlineAt: new Date(Date.now() + 60000),
      executionDeadlineAt: new Date(Date.now() + 600000),
      retainUntil: new Date(Date.now() + 86400000),
    });
    if (!p.snapshot) throw new Error("fixture_prepare_missing");
    return p.snapshot;
  }
  async function admit(id: string) {
    const snapshot = await executions.findExecution(id);
    if (!snapshot) throw new Error("fixture_execution_missing");
    return executions.confirmAdmission({
      scope,
      expectedStreamVersion: snapshot.stream.version,
      executionId: id,
      authorizationId,
      mutationEpoch: 1n,
      requestedRevision: revision,
      observedRevision: revision,
      verdict: ReviewExecutionAdmissionVerdict.Current,
      checkedAt: new Date(),
    });
  }
  async function link(c: ReviewRequestedIntentCandidate, id: string) {
    return intents.linkAdmission({
      requestId: c.requestId,
      sourceRunId,
      sourceRunAttempt: "1",
      authorizationId,
      executionId: id,
      revision,
      now: new Date(),
    });
  }
  return {
    scope,
    actorId: `member-${suffix}`,
    writer,
    intents,
    executions,
    candidate,
    dispatch,
    prepare,
    admit,
    link,
    authorizationId,
    producerReleaseId,
    sourceRunId,
  };
}

export async function finalizeHistoryExecution(
  f: Awaited<ReturnType<typeof createHistorySourceFixture>>,
  id: string,
): Promise<string> {
  const running = await f.executions.findExecution(id),
    artifactId = `artifact-${id}`;
  if (!running) throw new Error("fixture_execution_missing");
  await f.executions.finalizeExecution({
    scope: f.scope,
    executionId: id,
    expectedStreamVersion: running.stream.version,
    expectedExecutionVersion: running.execution.version,
    artifactId,
    artifactHash: hash("f"),
    projectionEnvelopeVersion: 1,
    projectionEnvelopeJson: '{"findings":[]}',
    projectionHash: hash("d"),
    byteCount: 15,
    findingCount: 0,
    lifecycleStateHash: hash("e"),
    commandLedgerWatermark: 0n,
    projectionPolicyVersion: "history",
    publicationSafetyDecisionHash: hash("6"),
    publicationNotAfter: new Date(Date.now() + 60000),
    permitEpoch: 1n,
    allowPartial: false,
    limits,
    now: new Date(),
    retainUntil: new Date(Date.now() + 86400000),
  });
  return artifactId;
}
