import { persistedReviewExecutionRestore } from "./review-execution-publication-restore.js";
import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
} from "@reviewrouter/shared";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  registerReviewSnapshotReadV2Routes,
  registerReviewPublicationRequestV2Routes,
} from "@reviewrouter/features-action-control-plane/v2";
import {
  ConfiguredCapabilityKeyRing,
  JoseRotatingCapabilityCodec,
} from "@reviewrouter/platform-signed-capabilities";
import {
  ReviewCoverageState,
  ReviewExecutionProviderKind,
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewTaskKind,
  type ReviewExecutionQueryPort,
  type ReviewInvocationLease,
  type FinalizedReviewProjectionArtifact,
  type ReviewExecutionSnapshot,
} from "@reviewrouter/features-review-executions";
import {
  ReviewPublicationAdjudicationEvidenceStatus,
  ReviewPublicationCapability,
  ReviewPublicationAttemptState,
  CurrentPublicationLifecycleStatus,
  LiveReviewPublicationLifecycleStatus,
  type LiveReviewPublicationLifecyclePort,
  type ReviewPublicationResolutionHistoryPort,
  CurrentReviewSafetyDecisionStatus,
  ReviewPublicationLifecycleExpectationStatus,
  ReviewPublicationLifecycleObservationVersion,
  ReviewPublicationTerminalOutcome,
  RequestReviewPublicationStatus,
  currentReviewProjectionPolicyVersion,
  renderCanonicalReviewPublication,
  resolveReviewPublicationRenderPolicyVersion,
  ReviewPublicationProjectionCoverage,
  ReviewPublicationOccurrenceState,
  reviewPublicationLifecycleExpectationFromProjection,
  type ReviewPublicationRenderingSource,
  type RequestReviewPublicationCommand,
  type ReviewPublicationDecisionPorts,
  type ReviewPublicationAttemptView,
  type ReviewPublicationAttemptQueryPort,
} from "@reviewrouter/features-review-publishing/v2";
import {
  createReviewPublicationV2Application,
  reviewLifecycleThreadStateHash,
} from "@reviewrouter/features-review-publishing/v2/composition";
import {
  InMemoryReviewPublicationRepository,
  allowingReviewPublicationDecisionPorts,
} from "@reviewrouter/features-review-publishing/v2/testing";
import {
  ProducerDistributionKind,
  ProducerReleaseState,
  ReviewCapabilityProfile,
  ReviewProtocolVersion,
  ReviewProviderKind,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  canonicalJson,
  type ReviewProtocolLimitsV2,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  type ReviewSnapshotV2Record,
  LineageHintEvictionReason,
} from "@reviewrouter/features-review-snapshots/v2";
import {
  reviewActionV2LegacySlot,
  ReviewSnapshotRestorePurpose,
  ReviewSnapshotRestoreResultStatus,
  ReviewPublicationRequestResultStatus,
  ReviewPublicationStatusResultStatus,
  ReviewActionV2ProtocolErrorCode,
  ReviewActionV2OperationId,
  canonicalizeReviewActionV2Request,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  type ReviewPublicationRequest,
  prDescriptionExtensionV1,
  providerInvocationManifestV1GoldenFixture,
} from "@reviewrouter/protocol-review-action-v2";
import {
  normalizeProviderInvocationManifest,
  ReviewTaskKind as EvidenceTaskKind,
} from "@reviewrouter/features-review-evidence";
import {
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { ReviewActionV2ExecutionEvidenceCapabilityAdapter } from "./review-action-v2-execution-evidence-capabilities.js";
import {
  createProductionPublicationLifecyclePort,
  createReviewActionV2SnapshotPublicationRoutes,
} from "./review-action-v2-production-composition-snapshot-publication.js";

const now = new Date("2026-07-23T12:00:00.000Z");
const hash = (character: string) => character.repeat(64);
const digest = {
  digestUtf8: async (value: string) =>
    createHash("sha256").update(value, "utf8").digest("hex"),
  digest: async (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex"),
};
const pairedActionRepo =
  process.env.REVIEW_ROUTER_PAIRED_ACTION_REPO?.trim() || null;
const pairedActionTest = pairedActionRepo ? it : it.skip;

describe("Review Action v2 snapshot/publication production handlers", () => {
  it("restores an exact trusted snapshot through the domain restore use case", async () => {
    const routes = createRoutes();

    await expect(
      routes.snapshot.restore!.execute({
        ...envelope("snapshot-1"),
        authorizationToken: "authorization-token",
        reviewRevisionHash: authorization.reviewRevisionHash,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewSnapshotRestoreResultStatus.Found,
        snapshotVersion: 3,
        sourceExecutionId: "execution-previous",
        sourceExecutionGeneration: "2",
      },
    });
  });

  it.each(["missing", "expired"] as const)(
    "returns fresh scoped history independently of a %s comparison baseline",
    async (state) => {
      const history = {
        threadId: "thread-1",
        version: 3,
        historyCut: {
          activatedAt: "2026-10-01T00:00:00.000Z",
          activationVersion: 1,
          writerDigest: hash("a"),
        },
        confirmed: null,
        pending: [],
      };
      const read = vi.fn(async () => [history]);
      const routes = createRoutes(undefined, undefined, undefined, undefined, {
        authorization: verifierAuthorization(),
        snapshot:
          state === "missing"
            ? null
            : { ...snapshot, expiresAt: new Date(now.getTime() - 1) },
        liveLifecycle: {
          resolve: async () => ({
            status: LiveReviewPublicationLifecycleStatus.Available,
            reviewedHeadSha: authorization.headSha,
            commandLedgerWatermark: 0n,
            targets: [liveHistoryTarget()],
          }),
        },
        resolutionHistory: { read },
      });
      const response = await routes.snapshot.restore!.execute({
        ...envelope("history"),
        authorizationToken: "authorization-token",
        reviewRevisionHash: authorization.reviewRevisionHash,
        purpose: ReviewSnapshotRestorePurpose.ComparisonBaselineV1,
      });
      expect(response.result.status).toBe(
        ReviewSnapshotRestoreResultStatus.Found,
      );
      if (
        !("payloadCanonicalJson" in response.result) ||
        typeof response.result.payloadCanonicalJson !== "string"
      )
        throw new Error("missing comparison wrapper");
      expect(JSON.parse(response.result.payloadCanonicalJson)).toEqual({
        comparisonVersion: 2,
        baseline: null,
        resolutionHistory: [
          {
            targetId: "target-1",
            threadId: "thread-1",
            parentCommentId: "parent-1",
            parentCreatedAt: now.toISOString(),
            parentBodyHash: hash("a"),
            history,
          },
        ],
      });
      expect(read).toHaveBeenCalledWith(publicationScope(), ["thread-1"]);
    },
  );

  it("returns explicit unavailable history after a null reader result, while legacy restore stays unchanged", async () => {
    const read = vi.fn(async () => null as never);
    const ports = {
      liveLifecycle: {
        resolve: async () => ({
          status: LiveReviewPublicationLifecycleStatus.Available as const,
          reviewedHeadSha: authorization.headSha,
          commandLedgerWatermark: 0n,
          targets: [liveHistoryTarget()],
        }),
      },
      resolutionHistory: { read },
    };
    const request = {
      ...envelope("null-history"),
      authorizationToken: "authorization-token",
      reviewRevisionHash: authorization.reviewRevisionHash,
      purpose: ReviewSnapshotRestorePurpose.ComparisonBaselineV1,
    };
    const routes = createRoutes(undefined, undefined, undefined, undefined, {
      ...ports,
      authorization: verifierAuthorization(),
      snapshot: null,
    });
    const result = (await routes.snapshot.restore!.execute(request)).result;
    if (
      !("payloadCanonicalJson" in result) ||
      typeof result.payloadCanonicalJson !== "string"
    )
      throw new Error("missing wrapper");
    expect(JSON.parse(result.payloadCanonicalJson)).toEqual({
      comparisonVersion: 2,
      baseline: null,
      resolutionHistory: null,
      historyUnavailableReason: "resolution_history_unavailable",
    });
    read.mockClear();
    const legacy = createRoutes(undefined, undefined, undefined, undefined, {
      ...ports,
      snapshot: null,
    });
    const legacyResult = (await legacy.snapshot.restore!.execute(request))
      .result;
    expect(legacyResult.status).toBe(ReviewSnapshotRestoreResultStatus.Missing);
    expect(read).not.toHaveBeenCalled();
  });

  it("serves an auth-scoped empty comparison baseline on the new slot and preserves the old route contract", async () => {
    const prior = {
      ...snapshot,
      sourceReviewRevisionHash: hash("b"),
      payload: {
        ...snapshot.payload,
        projectionEnvelope: {
          envelopeVersion: "review_projection.v1",
          projectionPolicyVersion: "review-projection-policy.v6-comparison",
          scope: {
            scmRepositoryIdentityId: snapshot.scmRepositoryIdentityId,
            pullRequestNumber: snapshot.pullRequestNumber,
            baseSha: snapshot.sourceBaseSha,
            reviewedHeadSha: snapshot.sourceReviewedHeadSha,
            reviewRevisionHash: hash("b"),
          },
          coverage: { state: "complete" },
          snapshot: { lineageHints: [] },
        },
      },
    };
    const routes = createRoutes(undefined, undefined, undefined, undefined, {
      snapshot: prior,
    });
    const app = Fastify({ logger: false });
    await registerReviewSnapshotReadV2Routes(app, routes.snapshot);
    const payload = {
      ...envelope("baseline"),
      authorizationToken: "authorization-token",
      reviewRevisionHash: authorization.reviewRevisionHash,
      purpose: ReviewSnapshotRestorePurpose.ComparisonBaselineV1,
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-snapshots/restore",
      payload,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json().result;
    expect(result).toMatchObject({
      status: "found",
      restoreMode: "comparison_baseline.v1",
      snapshotVersion: 3,
      sourceExecutionGeneration: "2",
    });
    expect(JSON.parse(result.payloadCanonicalJson)).toMatchObject({
      priorLineageHints: [],
      sourceReviewRevisionHash: hash("b"),
      sourceExecutionGeneration: "2",
    });
    const old = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-snapshots/restore",
      payload: {
        ...payload,
        schemaDigest:
          reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
      },
    });
    expect(old.statusCode).toBe(400);
    const { purpose, ...exact } = payload;
    expect(purpose).toBe(ReviewSnapshotRestorePurpose.ComparisonBaselineV1);
    const legacy = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-snapshots/restore",
      payload: {
        ...exact,
        schemaDigest:
          reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
      },
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().schemaDigest).toBe(
      reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
    );
    expect(legacy.json().result.status).toBe("revision_changed");
    await app.close();
  });

  it.each([
    "review-projection-policy.v6-comparison",
    "review-projection-policy.v7-lifecycle-verification",
  ])("restores receipt-bound %s resolutions", async (policy) => {
    const lineageId = `rrl_${"a".repeat(32)}`;
    const targetId = `rrt_${"d".repeat(16)}`;
    const threadId = "PRRT_thread";
    const projection = {
      envelopeVersion: "review_projection.v1",
      projectionPolicyVersion: policy,
      scope: {
        scmRepositoryIdentityId: snapshot.scmRepositoryIdentityId,
        pullRequestNumber: snapshot.pullRequestNumber,
        baseSha: snapshot.sourceBaseSha,
        reviewedHeadSha: snapshot.sourceReviewedHeadSha,
        reviewRevisionHash: snapshot.sourceReviewRevisionHash,
      },
      coverage: { state: "complete" },
      snapshot: {
        lineageHints: [
          {
            lineageId,
            category: "correctness",
            normalizedFailureModeHash: hash("c"),
            severity: "major",
            title: "Prior issue",
            message: "Full message",
            filePath: "src/a.ts",
            firstSeenHeadSha: snapshot.sourceReviewedHeadSha,
            lastSeenHeadSha: snapshot.sourceReviewedHeadSha,
            active: true,
          },
        ],
      },
      publishing: {
        lifecycle: [
          {
            lineageId,
            targetId,
            threadId,
            markerFingerprint: lineageId,
            verdict: "resolved",
            mutationEligible: true,
          },
        ],
      },
    };
    const prior = {
      ...snapshot,
      payload: { ...snapshot.payload, projectionEnvelope: projection },
    };
    const sourcePermit = {
      ...artifact.publicationPermit,
      executionId: prior.sourceExecutionId,
      generation: BigInt(prior.sourceExecutionGeneration),
      projectionHash: prior.payload.projectionHash,
    };
    const sourceArtifact = {
      ...artifact,
      executionId: prior.sourceExecutionId,
      generation: BigInt(prior.sourceExecutionGeneration),
      reviewedHeadSha: prior.sourceReviewedHeadSha,
      reviewRevisionHash: prior.sourceReviewRevisionHash,
      projectionHash: prior.payload.projectionHash,
      projectionEnvelopeJson: canonicalJson(projection),
      // Native artifact mapping spreads execution fields into the typed permit.
      publicationPermit: {
        ...sourcePermit,
        state: "completed",
        workSlots: [],
      },
    };
    const sha = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const markerHash = sha(`reviewrouter-lifecycle:${targetId}:resolved`);
    const bodyHash = sha(canonicalJson({ resolve: true, threadId }));
    const externalObjectId = `thread:${threadId}`;
    const view = {
      attempt: {
        permit: sourcePermit,
        state: "terminal",
        terminalOutcome: "succeeded",
        operations: [
          {
            publicationOperationId: "op",
            publicationKind: "thread_lifecycle",
            state: "completed",
            markerHash,
            bodyHash,
            targetCommitId: prior.sourceReviewedHeadSha,
            reviewRevisionHash: prior.sourceReviewRevisionHash,
          },
        ],
      },
      receipts: [
        {
          publicationOperationId: "op",
          status: "succeeded",
          canonicalEffectId: "effect",
          canonicalExternalObjectId: externalObjectId,
        },
      ],
      effects: [
        {
          effectId: "effect",
          publicationOperationId: "op",
          externalObjectId,
          observedObjectHash: sha(
            canonicalJson({ externalObjectId, markerHash, bodyHash }),
          ),
          effectKind: "mutation_acknowledged",
          observedAt: now,
        },
      ],
      corrections: [],
      tombstones: [],
    } as unknown as ReviewPublicationAttemptView;
    const findByPermitIdentity = vi.fn(async () => view);
    const routes = createRoutes(
      undefined,
      undefined,
      sourceArtifact,
      undefined,
      {
        snapshot: prior,
        ...(policy === "review-projection-policy.v7-lifecycle-verification"
          ? { authorization: verifierAuthorization() }
          : {}),
        publications: { findByPermitIdentity, findById: async () => null },
      },
    );
    const response = await routes.snapshot.restore!.execute({
      ...envelope("receipt-baseline"),
      authorizationToken: "authorization-token",
      reviewRevisionHash: authorization.reviewRevisionHash,
      purpose: ReviewSnapshotRestorePurpose.ComparisonBaselineV1,
    });
    expect(response.result.status).toBe("found");
    const responsePayload = JSON.parse(response.result.payloadCanonicalJson!);
    const baseline =
      policy === "review-projection-policy.v7-lifecycle-verification"
        ? responsePayload.baseline
        : responsePayload;
    expect(baseline.projectionPolicyVersion).toBe(policy);
    expect(baseline.appliedResolutions).toEqual([
      {
        lineageId,
        targetId,
        threadId,
        markerFingerprint: lineageId,
        resolvedAt: now.toISOString(),
      },
    ]);
    expect(findByPermitIdentity).toHaveBeenCalledWith(
      sourceArtifact.publicationPermit,
    );
    findByPermitIdentity.mockResolvedValue({
      ...view,
      attempt: {
        ...view.attempt,
        permit: { ...view.attempt.permit, permitEpoch: 999n },
      },
    });
    const mismatched = await routes.snapshot.restore!.execute({
      ...envelope("mismatched-receipt-baseline"),
      authorizationToken: "authorization-token",
      reviewRevisionHash: authorization.reviewRevisionHash,
      purpose: ReviewSnapshotRestorePurpose.ComparisonBaselineV1,
    });
    const mismatchedPayload = JSON.parse(
      mismatched.result.payloadCanonicalJson!,
    );
    expect(
      (policy === "review-projection-policy.v7-lifecycle-verification"
        ? mismatchedPayload.baseline
        : mismatchedPayload
      ).appliedResolutions,
    ).toEqual([]);
  });

  it("rejects malformed, unsupported and out-of-scope comparison snapshots without throwing", async () => {
    for (const changed of [
      {
        ...snapshot,
        payload: {
          ...snapshot.payload,
          projectionEnvelope: { snapshot: null },
        },
      },
      { ...snapshot, workspaceId: "other-workspace" },
    ]) {
      const routes = createRoutes(undefined, undefined, undefined, undefined, {
        snapshot: changed,
      });
      await expect(
        routes.snapshot.restore!.execute({
          ...envelope("bad-baseline"),
          authorizationToken: "authorization-token",
          reviewRevisionHash: authorization.reviewRevisionHash,
          purpose: ReviewSnapshotRestorePurpose.ComparisonBaselineV1,
        }),
      ).resolves.toMatchObject({ result: { status: "trust_rejected" } });
    }
  });

  it("validates a signed finalized permit and enqueues immutable publication operations", async () => {
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(publicationRepository);
    const capabilities = capabilityAdapter();
    const publicationPermit = await capabilities.issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );
    const request = await publicationRequest(publicationPermit);

    const accepted = await routes.publication.request!.execute(request);
    expect(accepted).toMatchObject({
      statusCode: 201,
      result: {
        status: ReviewPublicationRequestResultStatus.Accepted,
        publicationState: ReviewPublicationAttemptState.Pending,
      },
    });
    const publicationAttemptId = accepted.result.publicationAttemptId;
    expect(publicationAttemptId).toBeTruthy();

    const stored = await publicationRepository.findById(publicationAttemptId!);
    expect(stored?.attempt.operations.length).toBe(2);
    expect(stored?.attempt.state).toBe(ReviewPublicationAttemptState.Pending);

    await expect(
      routes.publication.status!.execute({
        ...envelope("publication-status-1"),
        authorizationToken: "authorization-token",
        publicationAttemptId: publicationAttemptId!,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewPublicationStatusResultStatus.Pending,
        publicationAttemptId,
      },
    });
  });

  it.each([
    "Generated prose\n<!-- review-router-summary:end -->\nInjected text",
    "Generated prose\n<!-- ai-robot-review-summary:end -->\nInjected text",
    "😀".repeat(2049),
  ])(
    "rejects marker injection or oversized generated prose before enqueue",
    async (generatedMarkdown) => {
      const source = {
        ...publishing,
        prDescription: {
          generatedMarkdown,
          generationProvenance: {
            leaseId: "description-lease",
            providerIndex: 0,
            requestedModel: "primary-model",
            actualModel: "primary-model",
            providerRequestEnvelopeHash: hash("9"),
          },
        },
      };
      const finalizedArtifact = finalizedArtifactWithPublishing(
        source,
        hash("a"),
      );
      const publicationRepository = new InMemoryReviewPublicationRepository();
      const routes = createRoutes(
        publicationRepository,
        { assertCurrentPolicy: vi.fn() },
        finalizedArtifact,
      );
      const publicationPermit =
        await capabilityAdapter().issuePublicationPermit(
          finalizedArtifact.publicationPermit,
          now,
        );
      await expect(
        routes.publication.request!.execute(
          await publicationRequest(
            publicationPermit,
            canonicalJson(source),
            finalizedArtifact.projectionHash,
          ),
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        issues: ["pr_description_markdown_invalid"],
      });
      await expect(
        publicationRepository.findByPermitIdentity(
          finalizedArtifact.publicationPermit,
        ),
      ).resolves.toBeNull();
    },
  );

  it("requires the real auxiliary lease query for a generated description before enqueue", async () => {
    const source = {
      ...publishing,
      prDescription: {
        generatedMarkdown: "## Changes\n\nGenerated narrative",
        generationProvenance: {
          leaseId: "description-lease",
          providerIndex: 0,
          requestedModel: "primary-model",
          actualModel: "primary-model",
          providerRequestEnvelopeHash: hash("9"),
        },
      },
    };
    const finalizedArtifact = finalizedArtifactWithPublishing(
      source,
      hash("a"),
    );
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(
      publicationRepository,
      { assertCurrentPolicy: vi.fn() },
      finalizedArtifact,
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      finalizedArtifact.publicationPermit,
      now,
    );
    await expect(
      routes.publication.request!.execute(
        await publicationRequest(
          publicationPermit,
          canonicalJson(source),
          finalizedArtifact.projectionHash,
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      issues: ["pr_description_lease_query_unavailable"],
    });
    await expect(
      publicationRepository.findByPermitIdentity(
        finalizedArtifact.publicationPermit,
      ),
    ).resolves.toBeNull();
  });

  it("accepts required source at its captured byte budget when bounded optional prose exceeds remaining capacity", async () => {
    const voteHash = hash("a");
    const configuration = {
      ...workspacePolicyFixture,
      providers: [
        {
          ...workspaceProviderFixture,
          authMode: "codex_account_gateway",
          gatewayBindingId: "binding-1",
          gatewayProfileRef: "profile-1",
        },
      ],
    };
    const capturedAuthorization: ReviewRunAuthorization = {
      ...authorization,
      providerVoteLanes: [
        {
          providerKind: ReviewProviderKind.Codex,
          providerVoteIdentityHash: voteHash,
        },
      ],
      runtimeSnapshotCanonicalJson: canonicalJson({
        snapshotVersion: 3,
        configurationSource: "repository",
        configurationVersion: 1,
        workspaceConfigurationVersion: 1,
        repositoryConfigurationVersion: 1,
        effectivePolicyDigest: `sha256:${hash("a")}`,
        agent: {
          profileRef: "codex-default",
          agentKind: "codex",
          binarySha256: hash("a"),
          packageVersion: "0.147.0",
          modelTransports: ["account_gateway"],
          contextGateway: true,
          cancellation: true,
        },
        agentProfileDigest: hash("b"),
        producer: {
          producerReleaseId: authorization.producerReleaseId,
          actionCommitSha: producerRelease.actionCommitSha,
          runtimeCommitSha: producerRelease.runtimeCommitSha,
        },
        configurationCanonicalJson: canonicalJson(configuration),
        deadline: authorization.expiresAt.toISOString(),
        gateway: null,
        prDescriptionCapability: prDescriptionExtensionV1,
      }),
    };
    const slot = {
      workSlotId: "description",
      taskKind: ReviewTaskKind.PrDescription,
      providerKind: ReviewExecutionProviderKind.Codex,
      providerVoteIdentityHash: voteHash,
      shardKey: "description",
      required: false,
      attemptBudget: 1,
      retryPolicyVersion: "description-v1",
    };
    const manifest = normalizeProviderInvocationManifest({
      ...providerInvocationManifestV1GoldenFixture.input,
      taskKindSet: [EvidenceTaskKind.PrDescription],
      requestedModel: workspaceProviderFixture.model,
      providerPolicyVersion: "pr-description-provider-policy.v1",
    });
    const source = {
      ...publishing,
      prDescription: {
        generatedMarkdown: "A".repeat(1000),
        generationProvenance: {
          leaseId: "description-lease",
          providerIndex: 0,
          requestedModel: workspaceProviderFixture.model,
          actualModel: workspaceProviderFixture.model,
          providerRequestEnvelopeHash: manifest.providerRequestEnvelopeHash,
        },
      },
    };
    const finalizedArtifact = finalizedArtifactWithPublishing(
      source,
      hash("a"),
    );
    const lease: ReviewInvocationLease = {
      ...publicationScope(),
      leaseId: "description-lease",
      workSlotId: slot.workSlotId,
      providerInvocationKey: "description-invocation",
      providerVoteIdentityHash: voteHash,
      preparedManifestCanonicalJson: canonicalJson(manifest),
      preparedManifestKey: "description-manifest",
      purpose: ReviewInvocationLeasePurpose.ProviderExecution,
      state: ReviewInvocationLeaseState.Released,
      authorizationId: authorization.authorizationId,
      producerReleaseId: authorization.producerReleaseId,
      reviewRevisionHash: authorization.reviewRevisionHash,
      mutationEpoch: authorization.mutationEpoch,
      leaseSafetyDecisionHash: hash("1"),
      attemptId: null,
      sourceObservationId: null,
      attemptOrdinal: 1,
      acquireRequestIdHash: hash("2"),
      acquireRequestHash: hash("3"),
      lastRenewRequestIdHash: null,
      lastRenewRequestHash: null,
      ownerIdHash: hash("4"),
      leaseCapabilityId: "description-capability",
      capabilitySigningKeyId: "test-key",
      fencingToken: 1n,
      executionId: finalizedArtifact.executionId,
      executionGeneration: finalizedArtifact.generation,
      acquiredAt: now,
      renewedAt: now,
      expiresAt: authorization.expiresAt,
      resultReportUntil: authorization.expiresAt,
      retainUntil: finalizedArtifact.retainUntil,
    };
    const lookup = vi.fn(async () => lease);
    const requiredSourceBytes = Buffer.byteLength(
      canonicalJson(publishing),
      "utf8",
    );
    expect(Buffer.byteLength(canonicalJson(source), "utf8")).toBeGreaterThan(
      requiredSourceBytes,
    );
    const repository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(
      repository,
      { assertCurrentPolicy: vi.fn() },
      finalizedArtifact,
      {},
      {
        authorization: capturedAuthorization,
        limits: {
          ...protocolLimits,
          maxPublicationBodyBytes: requiredSourceBytes,
        },
        executions: {
          async findExecution() {
            return {
              artifact: finalizedArtifact,
              execution: {
                executionId: finalizedArtifact.executionId,
                workSlots: [slot],
              },
            } as unknown as ReviewExecutionSnapshot;
          },
          findLease: lookup,
        },
      },
    );
    const permit = await capabilityAdapter().issuePublicationPermit(
      finalizedArtifact.publicationPermit,
      now,
    );
    const accepted = await routes.publication.request!.execute(
      await publicationRequest(
        permit,
        canonicalJson(source),
        finalizedArtifact.projectionHash,
      ),
    );
    expect(accepted.statusCode).toBe(201);
    expect(lookup).toHaveBeenCalledWith(lease.leaseId);
    const stored = await repository.findById(
      accepted.result.publicationAttemptId!,
    );
    expect(
      stored?.attempt.operations.map((operation) => operation.publicationKind),
    ).toEqual(["summary", "managed_check"]);
    expect(finalizedArtifact.projectionEnvelopeJson).toContain("prDescription");
    // The same valid released description lease cannot bypass the new scoped ledger.
    const verifier = verifierAuthorization();
    const runtime = JSON.parse(verifier.runtimeSnapshotCanonicalJson!);
    runtime.prDescriptionCapability = prDescriptionExtensionV1;
    const newRepository = new InMemoryReviewPublicationRepository();
    const newRoutes = createRoutes(
      newRepository,
      undefined,
      finalizedArtifact,
      {},
      {
        authorization: {
          ...capturedAuthorization,
          runtimeSnapshotCanonicalJson: canonicalJson(runtime),
        },
        executions: {
          findExecution: async () =>
            ({
              artifact: finalizedArtifact,
              execution: {
                executionId: finalizedArtifact.executionId,
                workSlots: [slot],
              },
            }) as unknown as ReviewExecutionSnapshot,
          findLease: lookup,
        },
      },
    );
    await expect(
      newRoutes.publication.request!.execute(
        await publicationRequest(
          permit,
          canonicalJson(source),
          finalizedArtifact.projectionHash,
        ),
      ),
    ).rejects.toMatchObject({
      issues: ["pr_description_dispatch_proof_unavailable"],
    });
    expect(
      await newRepository.findByPermitIdentity(
        finalizedArtifact.publicationPermit,
      ),
    ).toBeNull();
  });

  it("preserves structured preliminary finding counts in a partial publication operation", async () => {
    const partialPublishing: ReviewPublicationRenderingSource = {
      ...publishing,
      check: {
        ...publishing.check,
        conclusion: "success",
      },
      summary: {
        ...publishing.summary,
        allClear: false,
        body: "- P1: authorization is inverted",
        occurrenceCounts: {
          ...publishing.summary.occurrenceCounts,
          new: 1,
          reconfirmed: 1,
          changed: 1,
        },
      },
    };
    const projectionHash = hash("e");
    const partialArtifact = {
      ...finalizedArtifactWithProjectionEnvelope(
        {
          ...JSON.parse(projectionEnvelopeJson),
          occurrences: [
            { state: "new" },
            { state: "reconfirmed" },
            { state: "changed" },
          ],
          publishing: partialPublishing,
        },
        projectionHash,
      ),
      coverageState: ReviewCoverageState.Partial,
      projectionPolicyVersion: currentReviewProjectionPolicyVersion,
    };
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(
      publicationRepository,
      { assertCurrentPolicy: vi.fn() },
      partialArtifact,
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      partialArtifact.publicationPermit,
      now,
    );

    const accepted = await routes.publication.request!.execute(
      await publicationRequest(
        publicationPermit,
        canonicalJson(partialPublishing),
        projectionHash,
      ),
    );
    const stored = await publicationRepository.findById(
      accepted.result.publicationAttemptId!,
    );
    const expected = renderCanonicalReviewPublication(
      {
        coverage: ReviewPublicationProjectionCoverage.Partial,
        renderPolicyVersion: resolveReviewPublicationRenderPolicyVersion(
          currentReviewProjectionPolicyVersion,
        ),
        targetCommitId: partialArtifact.reviewedHeadSha,
        occurrenceStates: [
          ReviewPublicationOccurrenceState.New,
          ReviewPublicationOccurrenceState.Reconfirmed,
          ReviewPublicationOccurrenceState.Changed,
        ],
        source: partialPublishing,
      },
      {
        digestUtf8: (value) =>
          createHash("sha256").update(value, "utf8").digest("hex"),
        utf8ByteLength: (value) => Buffer.byteLength(value, "utf8"),
      },
    );

    expect(stored?.attempt.operations).toHaveLength(1);
    expect(stored?.attempt.operations[0]).toMatchObject({
      bodyHash: expected.summary.bodyHash,
      markerHash: expected.summary.markerHash,
    });
    expect(expected.summary.body).toContain(
      "Review incomplete - 3 preliminary findings preserved",
    );
  });

  it("rejects partial counts that disagree with canonical occurrences", async () => {
    const partialPublishing: ReviewPublicationRenderingSource = {
      ...publishing,
      check: { ...publishing.check, conclusion: "success" },
      summary: {
        ...publishing.summary,
        allClear: false,
        occurrenceCounts: {
          ...publishing.summary.occurrenceCounts,
          new: 1,
        },
      },
    };
    const projectionHash = hash("f");
    const partialArtifact = {
      ...finalizedArtifactWithPublishing(partialPublishing, projectionHash),
      coverageState: ReviewCoverageState.Partial,
      projectionPolicyVersion: currentReviewProjectionPolicyVersion,
    };
    const routes = createRoutes(
      new InMemoryReviewPublicationRepository(),
      { assertCurrentPolicy: vi.fn() },
      partialArtifact,
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      partialArtifact.publicationPermit,
      now,
    );

    const app = Fastify({ logger: false });
    await registerReviewPublicationRequestV2Routes(app, routes.publication);
    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-publication/request",
      payload: await publicationRequest(
        publicationPermit,
        canonicalJson(partialPublishing),
        projectionHash,
      ),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        errorCode: ReviewActionV2ProtocolErrorCode.InvariantViolation,
      },
    });
    await app.close();
  });

  it("accepts canonical producer metadata outside publication rendering", async () => {
    const publishingWithMetadata = {
      ...publishing,
      inlineReviewChunks: [
        {
          chunkIndex: 0,
          marker: "<!-- inline-chunk-marker -->",
          bodyHash: hash("b"),
          comments: [
            {
              lineageId: "lineage-1",
              marker: "<!-- inline-comment-marker -->",
              path: "src/example.ts",
              startLine: 4,
              line: 5,
              endLine: 5,
              body: "Finding body",
            },
          ],
        },
      ],
      lifecycle: [
        {
          targetId: "target-1",
          threadId: "thread-1",
          lineageId: "lineage-1",
          verdict: "resolved",
          reasonCodes: ["provider_reconfirmed"],
          mutationEligible: true,
        },
      ],
    };
    const projectionHash = hash("c");
    const envelopeWithMetadata = canonicalJson({
      ...JSON.parse(projectionEnvelopeJson),
      publishing: publishingWithMetadata,
    });
    const artifactWithMetadata: FinalizedReviewProjectionArtifact = {
      ...artifact,
      projectionEnvelopeJson: envelopeWithMetadata,
      projectionHash,
      byteCount: Buffer.byteLength(envelopeWithMetadata, "utf8"),
      publicationPermit: {
        ...artifact.publicationPermit,
        projectionHash,
      },
    };
    const routes = createRoutes(
      new InMemoryReviewPublicationRepository(),
      { assertCurrentPolicy: vi.fn() },
      artifactWithMetadata,
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifactWithMetadata.publicationPermit,
      now,
    );

    await expect(
      routes.publication.request!.execute(
        await publicationRequest(
          publicationPermit,
          canonicalJson(publishingWithMetadata),
          projectionHash,
        ),
      ),
    ).resolves.toMatchObject({
      statusCode: 201,
      result: {
        status: ReviewPublicationRequestResultStatus.Accepted,
      },
    });
  });

  it("accepts an Action v1 revision-aware lifecycle witness through the outer Fastify parser without stripping it", async () => {
    const markerFingerprint = `rrl_${"a".repeat(32)}`;
    const publishingV1 = {
      ...publishing,
      lifecycleObservationVersion:
        ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
      lifecycle: [
        {
          targetId: "target-v1",
          threadId: "thread-v1",
          verdict: "resolved",
          reasonCodes: ["provider_reconfirmed"],
          mutationEligible: true,
          markerFingerprint,
          threadStateHash: hash("b"),
        },
      ],
    };
    const artifactV1 = finalizedArtifactWithPublishing(publishingV1, hash("c"));
    const lifecycle = vi.fn(async () => {
      const expectation = reviewPublicationLifecycleExpectationFromProjection({
        reviewedHeadSha: artifactV1.reviewedHeadSha,
        lifecycleStateHash: artifactV1.lifecycleStateHash,
        commandLedgerWatermark: artifactV1.commandLedgerWatermark,
        legacyObservationBoundary: artifactV1.createdAt,
        projectionEnvelopeJson: artifactV1.projectionEnvelopeJson,
      });
      expect(expectation).toMatchObject({
        status: ReviewPublicationLifecycleExpectationStatus.Available,
        lifecycleObservationVersion:
          ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
        targets: [
          {
            targetId: "target-v1",
            observation: {
              markerFingerprint,
              threadStateHash: hash("b"),
            },
          },
        ],
      });
      return {
        status: CurrentPublicationLifecycleStatus.Current,
        lifecycleStateHash: artifactV1.lifecycleStateHash,
        commandLedgerWatermark: artifactV1.commandLedgerWatermark,
      } as const;
    });
    const repository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(
      repository,
      { assertCurrentPolicy: vi.fn() },
      artifactV1,
      { lifecycle: { resolve: lifecycle } },
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifactV1.publicationPermit,
      now,
    );
    const app = Fastify({ logger: false });
    await registerReviewPublicationRequestV2Routes(app, routes.publication);

    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-publication/request",
      payload: await publicationRequest(
        publicationPermit,
        canonicalJson(publishingV1),
        artifactV1.projectionHash,
      ),
    });

    expect(response.statusCode).toBe(201);
    expect(lifecycle).toHaveBeenCalledTimes(1);
    await expect(
      repository.findByPermitIdentity(artifactV1.publicationPermit),
    ).resolves.not.toBeNull();
    await app.close();
  });

  pairedActionTest(
    "accepts the paired Action golden projection target and reproduces its thread hash",
    async () => {
      const fixture = await readPairedActionLifecycleFixture(pairedActionRepo!);
      const actualHash = reviewLifecycleThreadStateHash(fixture.thread);
      expect(actualHash).toBe(fixture.expectedThreadStateHash);
      expect(fixture.projectionTarget).toMatchObject({
        threadId: fixture.thread.threadId,
        threadStateHash: fixture.expectedThreadStateHash,
      });
      const publishingFromAction = {
        ...publishing,
        lifecycleObservationVersion:
          ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
        lifecycle: [
          {
            ...fixture.projectionTarget,
            verdict: "resolved",
            reasonCodes: ["provider_reconfirmed"],
            mutationEligible: true,
          },
        ],
      };
      const projectionEnvelopeFromAction = {
        ...JSON.parse(projectionEnvelopeJson),
        publishing: publishingFromAction,
      } as Readonly<Record<string, unknown>>;

      const artifactFromAction = finalizedArtifactWithProjectionEnvelope(
        projectionEnvelopeFromAction,
        hash("e"),
      );
      const lifecycle = vi.fn(async () => {
        const expectation = reviewPublicationLifecycleExpectationFromProjection(
          {
            reviewedHeadSha: artifactFromAction.reviewedHeadSha,
            lifecycleStateHash: artifactFromAction.lifecycleStateHash,
            commandLedgerWatermark: artifactFromAction.commandLedgerWatermark,
            legacyObservationBoundary: artifactFromAction.createdAt,
            projectionEnvelopeJson: artifactFromAction.projectionEnvelopeJson,
          },
        );
        expect(expectation).toMatchObject({
          status: ReviewPublicationLifecycleExpectationStatus.Available,
          lifecycleObservationVersion:
            ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
        });
        if (
          expectation.status !==
          ReviewPublicationLifecycleExpectationStatus.Available
        ) {
          throw new Error("paired_action_lifecycle_expectation_unavailable");
        }
        expect(expectation.targets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              targetId: fixture.projectionTarget.targetId,
              threadId: fixture.thread.threadId,
              observation: expect.objectContaining({
                markerFingerprint: fixture.projectionTarget.markerFingerprint,
                threadStateHash: fixture.expectedThreadStateHash,
              }),
            }),
          ]),
        );
        return {
          status: CurrentPublicationLifecycleStatus.Current,
          lifecycleStateHash: artifactFromAction.lifecycleStateHash,
          commandLedgerWatermark: artifactFromAction.commandLedgerWatermark,
        } as const;
      });
      const routes = createRoutes(
        new InMemoryReviewPublicationRepository(),
        { assertCurrentPolicy: vi.fn() },
        artifactFromAction,
        { lifecycle: { resolve: lifecycle } },
      );
      const publicationPermit =
        await capabilityAdapter().issuePublicationPermit(
          artifactFromAction.publicationPermit,
          now,
        );
      const app = Fastify({ logger: false });
      await registerReviewPublicationRequestV2Routes(app, routes.publication);

      const response = await app.inject({
        method: "POST",
        url: "/api/action/v2/review-publication/request",
        payload: await publicationRequest(
          publicationPermit,
          canonicalJson(publishingFromAction),
          artifactFromAction.projectionHash,
        ),
      });

      expect(response.statusCode).toBe(201);
      expect(lifecycle).toHaveBeenCalledTimes(1);
      await app.close();
    },
  );

  it.each([
    {
      name: "unknown observation version",
      source: {
        ...publishing,
        lifecycleObservationVersion: "review_lifecycle_observation.v2",
        lifecycle: [],
      },
    },
    {
      name: "v1 target missing its witness",
      source: {
        ...publishing,
        lifecycleObservationVersion:
          ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
        lifecycle: [
          {
            targetId: "target-v1",
            threadId: "thread-v1",
            verdict: "resolved",
            reasonCodes: [],
            mutationEligible: true,
          },
        ],
      },
    },
    {
      name: "mixed v1 targets",
      source: {
        ...publishing,
        lifecycleObservationVersion:
          ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
        lifecycle: [
          {
            targetId: "target-v1",
            threadId: "thread-v1",
            verdict: "resolved",
            reasonCodes: [],
            mutationEligible: true,
            markerFingerprint: "a".repeat(24),
            threadStateHash: hash("b"),
          },
          {
            targetId: "target-legacy",
            threadId: "thread-legacy",
            verdict: "unchanged",
            reasonCodes: [],
            mutationEligible: false,
          },
        ],
      },
    },
    {
      name: "legacy target carrying a v1 witness",
      source: {
        ...publishing,
        lifecycle: [
          {
            targetId: "target-legacy",
            threadId: "thread-legacy",
            verdict: "unchanged",
            reasonCodes: [],
            mutationEligible: false,
            markerFingerprint: "a".repeat(24),
            threadStateHash: hash("b"),
          },
        ],
      },
    },
    {
      name: "v1 target with a short marker fingerprint",
      source: {
        ...publishing,
        lifecycleObservationVersion:
          ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
        lifecycle: [
          {
            targetId: "target-v1",
            threadId: "thread-v1",
            verdict: "resolved",
            reasonCodes: [],
            mutationEligible: true,
            markerFingerprint: "a".repeat(23),
            threadStateHash: hash("b"),
          },
        ],
      },
    },
    {
      name: "v1 target with a non-hexadecimal thread state hash",
      source: {
        ...publishing,
        lifecycleObservationVersion:
          ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
        lifecycle: [
          {
            targetId: "target-v1",
            threadId: "thread-v1",
            verdict: "resolved",
            reasonCodes: [],
            mutationEligible: true,
            markerFingerprint: "a".repeat(24),
            threadStateHash: "z".repeat(64),
          },
        ],
      },
    },
  ])(
    "rejects $name at the real outer publication parser",
    async ({ source }) => {
      const invalidArtifact = finalizedArtifactWithPublishing(
        source,
        hash("d"),
      );
      const publicationPermit =
        await capabilityAdapter().issuePublicationPermit(
          invalidArtifact.publicationPermit,
          now,
        );
      const routes = createRoutes(
        new InMemoryReviewPublicationRepository(),
        { assertCurrentPolicy: vi.fn() },
        invalidArtifact,
      );
      const app = Fastify({ logger: false });
      await registerReviewPublicationRequestV2Routes(app, routes.publication);

      const response = await app.inject({
        method: "POST",
        url: "/api/action/v2/review-publication/request",
        payload: await publicationRequest(
          publicationPermit,
          canonicalJson(source),
          invalidArtifact.projectionHash,
        ),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          errorCode: ReviewActionV2ProtocolErrorCode.InvariantViolation,
        },
      });
      await app.close();
    },
  );

  it("compares publication expiry using JWT NumericDate precision", async () => {
    const fractionalArtifact = {
      ...artifact,
      publicationPermit: {
        ...artifact.publicationPermit,
        publicationNotAfter: new Date("2026-07-23T12:10:00.123Z"),
      },
    };
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(
      publicationRepository,
      { assertCurrentPolicy: vi.fn() },
      fractionalArtifact,
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      fractionalArtifact.publicationPermit,
      now,
    );

    await expect(
      routes.publication.request!.execute(
        await publicationRequest(publicationPermit),
      ),
    ).resolves.toMatchObject({
      statusCode: 201,
      result: {
        status: ReviewPublicationRequestResultStatus.Accepted,
      },
    });
  });

  it("restores an exact publication request before rechecking mutable policy", async () => {
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const publicationRequestSpy = vi.spyOn(publicationRepository, "request");
    const contextPolicy = { assertCurrentPolicy: vi.fn() };
    const routes = createRoutes(publicationRepository, contextPolicy);
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );
    const request = await publicationRequest(publicationPermit);

    await expect(
      routes.publication.request!.execute(request),
    ).resolves.toMatchObject({
      statusCode: 201,
      result: {
        status: ReviewPublicationRequestResultStatus.Accepted,
      },
    });
    contextPolicy.assertCurrentPolicy.mockRejectedValue(
      new Error("context_policy_changed_after_publication"),
    );

    await expect(
      routes.publication.request!.execute(request),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewPublicationRequestResultStatus.Restored,
      },
    });
    expect(contextPolicy.assertCurrentPolicy).toHaveBeenCalledTimes(1);
    expect(publicationRequestSpy).toHaveBeenCalledTimes(1);
  });

  it("writes attempt-scoped operation identities for new publication attempts", async () => {
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(publicationRepository);
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );

    const accepted = await routes.publication.request!.execute(
      await publicationRequest(publicationPermit),
    );
    expect(accepted).toMatchObject({
      statusCode: 201,
      result: {
        status: ReviewPublicationRequestResultStatus.Accepted,
      },
    });
    const publicationAttemptId = accepted.result.publicationAttemptId;
    expect(publicationAttemptId).toBeTruthy();
    const stored = await publicationRepository.findById(publicationAttemptId!);
    const attemptScopedPrefix = `review-publication:${publicationAttemptId}:${artifact.projectionHash}:`;
    const legacyPrefix = `review-publication:${artifact.projectionHash}:`;
    expect(stored?.attempt.operations.length).toBeGreaterThan(0);
    expect(
      stored?.attempt.operations.every(
        (operation) =>
          operation.publicationOperationId.startsWith(attemptScopedPrefix) &&
          !operation.publicationOperationId.startsWith(legacyPrefix) &&
          (operation.dependsOnOperationId === null ||
            operation.dependsOnOperationId.startsWith(attemptScopedPrefix)),
      ),
    ).toBe(true);
  });

  it("restores a publication request when persistence succeeded but the response was lost", async () => {
    const publicationRepository = new LostPublicationResponseRepository();
    const routes = createRoutes(publicationRepository);
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );

    await expect(
      routes.publication.request!.execute(
        await publicationRequest(publicationPermit),
      ),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewPublicationRequestResultStatus.Restored,
      },
    });
    expect(publicationRepository.requestCalls).toBe(1);
  });

  it("returns null poll delay for terminal publication responses", async () => {
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(publicationRepository);
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );
    const request = await publicationRequest(publicationPermit);
    const accepted = await routes.publication.request!.execute(request);
    const publicationAttemptId = accepted.result.publicationAttemptId!;
    const stored = await publicationRepository.findById(publicationAttemptId);
    expect(stored).not.toBeNull();

    vi.spyOn(publicationRepository, "findById").mockResolvedValue({
      ...stored!,
      attempt: {
        ...stored!.attempt,
        state: ReviewPublicationAttemptState.Terminal,
        terminalOutcome: ReviewPublicationTerminalOutcome.Succeeded,
      },
    });

    await expect(
      routes.publication.request!.execute(request),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewPublicationRequestResultStatus.Restored,
        pollAfterMs: null,
      },
    });
    await expect(
      routes.publication.status!.execute({
        ...envelope("publication-status-terminal"),
        authorizationToken: "authorization-token",
        publicationAttemptId,
      }),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewPublicationStatusResultStatus.Terminal,
        terminalOutcome: ReviewPublicationTerminalOutcome.Succeeded,
        pollAfterMs: null,
      },
    });
  });

  it("rejects publication expiry drift across JWT NumericDate seconds", async () => {
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      {
        ...artifact.publicationPermit,
        publicationNotAfter: new Date("2026-07-23T12:10:01.000Z"),
      },
      now,
    );

    await expect(
      createRoutes().publication.request!.execute(
        await publicationRequest(publicationPermit),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      issues: ["publication_permit_authority_mismatch"],
    });
  });

  it("rejects canonical publication payload drift before enqueue", async () => {
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(publicationRepository);
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );
    const request = await publicationRequest(
      publicationPermit,
      canonicalJson({ ...publishing, lifecycle: [{ unsafe: true }] }),
    );

    await expect(
      routes.publication.request!.execute(request),
    ).rejects.toMatchObject({
      statusCode: 412,
      issues: ["publication_payload_mismatch"],
    });
    await expect(
      publicationRepository.findByPermitIdentity(artifact.publicationPermit),
    ).resolves.toBeNull();
  });

  it("maps stale context policy to stale precondition before publication is enqueued", async () => {
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const contextPolicy = {
      assertCurrentPolicy: vi
        .fn()
        .mockRejectedValue(new Error("context_policy_stale")),
    };
    const routes = createRoutes(publicationRepository, contextPolicy);
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );

    await expect(
      routes.publication.request!.execute(
        await publicationRequest(publicationPermit),
      ),
    ).rejects.toMatchObject({
      statusCode: 412,
      issues: ["publication_context_policy_stale"],
    });
    expect(contextPolicy.assertCurrentPolicy).toHaveBeenCalledTimes(1);
    await expect(
      publicationRepository.findByPermitIdentity(artifact.publicationPermit),
    ).resolves.toBeNull();
  });

  it("maps multiple transient fact gaps to deterministic same-request HTTP retry diagnostics", async () => {
    const publicationRepository = new InMemoryReviewPublicationRepository();
    const routes = createRoutes(
      publicationRepository,
      { assertCurrentPolicy: vi.fn() },
      artifact,
      {
        lifecycle: {
          async resolve() {
            return {
              status: CurrentPublicationLifecycleStatus.Unavailable,
              lifecycleStateHash: null,
              commandLedgerWatermark: null,
            } as const;
          },
        },
        safety: {
          async resolve() {
            return {
              status: CurrentReviewSafetyDecisionStatus.Unavailable,
              decisionHash: null,
            } as const;
          },
        },
      },
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );
    const app = Fastify({ logger: false });
    await registerReviewPublicationRequestV2Routes(app, routes.publication);

    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-publication/request",
      payload: await publicationRequest(publicationPermit),
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        errorCode: ReviewActionV2ProtocolErrorCode.CapacityLimited,
        retryClass: "same_request",
        details: {
          issues: [
            "publication_facts_unavailable",
            "publication_fact_unavailable:lifecycle",
            "publication_fact_unavailable:safety",
          ],
        },
      },
    });
    await expect(
      publicationRepository.findByPermitIdentity(artifact.publicationPermit),
    ).resolves.toBeNull();
    await app.close();
  });

  it("keeps a proven missing lifecycle non-retryable", async () => {
    const routes = createRoutes(
      new InMemoryReviewPublicationRepository(),
      { assertCurrentPolicy: vi.fn() },
      artifact,
      {
        lifecycle: {
          async resolve() {
            return {
              status: CurrentPublicationLifecycleStatus.Missing,
              lifecycleStateHash: null,
              commandLedgerWatermark: null,
            } as const;
          },
        },
      },
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );
    const app = Fastify({ logger: false });
    await registerReviewPublicationRequestV2Routes(app, routes.publication);

    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-publication/request",
      payload: await publicationRequest(publicationPermit),
    });

    expect(response.statusCode).toBe(412);
    expect(response.json()).toMatchObject({
      error: {
        errorCode: ReviewActionV2ProtocolErrorCode.StalePrecondition,
        retryClass: "never",
        details: { issues: ["lifecycle_status_not_current"] },
      },
    });
    await app.close();
  });

  it("keeps an invalid publication projection non-retryable", async () => {
    const routes = createRoutes(
      new InMemoryReviewPublicationRepository(),
      { assertCurrentPolicy: vi.fn() },
      artifact,
      {
        lifecycle: {
          async resolve() {
            return {
              status: CurrentPublicationLifecycleStatus.Invalid,
              lifecycleStateHash: null,
              commandLedgerWatermark: null,
            } as const;
          },
        },
        safety: {
          async resolve() {
            return {
              status: CurrentReviewSafetyDecisionStatus.Unavailable,
              decisionHash: null,
            } as const;
          },
        },
      },
    );
    const publicationPermit = await capabilityAdapter().issuePublicationPermit(
      artifact.publicationPermit,
      now,
    );
    const app = Fastify({ logger: false });
    await registerReviewPublicationRequestV2Routes(app, routes.publication);

    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-publication/request",
      payload: await publicationRequest(publicationPermit),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        errorCode: ReviewActionV2ProtocolErrorCode.InvalidRequest,
        retryClass: "never",
        details: { issues: ["publication_projection_invalid"] },
      },
    });
    await app.close();
  });

  it("binds only the exact persisted publication's own pending resolution before evaluating history", async () => {
    const sha256 = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const live = liveHistoryTarget();
    const source = {
      ...publishing,
      lifecycleObservationVersion:
        ReviewPublicationLifecycleObservationVersion.ThreadStateV1,
      lifecycle: [
        {
          targetId: live.targetId,
          threadId: live.threadId,
          verdict: "resolved",
          reasonCodes: [],
          mutationEligible: true,
          markerFingerprint: live.markerFingerprint,
          threadStateHash: live.threadStateHash,
        },
      ],
    };
    const ownArtifact = finalizedArtifactWithPublishing(source, hash("8"));
    const stored = {
      artifact: ownArtifact,
      execution: {
        ...authorization,
        executionId: ownArtifact.executionId,
        generation: ownArtifact.generation,
        revision: {
          headSha: ownArtifact.reviewedHeadSha,
          reviewRevisionHash: ownArtifact.reviewRevisionHash,
        },
        workSlots: [],
      },
    } as unknown as ReviewExecutionSnapshot;
    const identity = {
      sourceKind: "canonical_operation" as const,
      operationId: "own-operation",
      publicationAttemptId:
        persistedReviewExecutionRestore(stored).artifact!.publicationAttemptId,
      executionId: ownArtifact.executionId,
      generation: "1",
      reviewedHeadSha: ownArtifact.reviewedHeadSha,
      bodyHash: sha256(
        canonicalJson({ resolve: true, threadId: live.threadId }),
      ),
    };
    const view = {
      attempt: {
        publicationAttemptId: identity.publicationAttemptId,
        permit: ownArtifact.publicationPermit,
        operations: [
          {
            publicationOperationId: identity.operationId,
            publicationKind: "thread_lifecycle",
            targetCommitId: ownArtifact.reviewedHeadSha,
            reviewRevisionHash: ownArtifact.reviewRevisionHash,
            bodyHash: identity.bodyHash,
            markerHash: sha256(
              `reviewrouter-lifecycle:${live.targetId}:resolved`,
            ),
          },
        ],
      },
    } as unknown as ReviewPublicationAttemptView;
    const make = (
      restored: ReviewPublicationAttemptView | null,
      activated = true,
    ) =>
      createProductionPublicationLifecyclePort({
        executions: {
          findStream: async () =>
            ({ activeExecutionId: ownArtifact.executionId }) as never,
          findExecution: async () => stored,
        },
        authorizationQueries: {
          findReviewRunAuthorizationById: async () => verifierAuthorization(),
        },
        liveLifecycle: {
          resolve: async () => ({
            status: LiveReviewPublicationLifecycleStatus.Available,
            reviewedHeadSha: authorization.headSha,
            commandLedgerWatermark: 2n,
            targets: [live],
          }),
        },
        publications: { findByPermitIdentity: async () => restored } as never,
        resolutionHistory: {
          read: async () => [
            {
              threadId: live.threadId,
              version: 1,
              historyCut: activated
                ? {
                    activatedAt: "2026-01-01T00:00:00.000Z",
                    activationVersion: 1,
                    writerDigest: hash("a"),
                  }
                : null,
              confirmed: null,
              pending: activated
                ? [
                    {
                      ...identity,
                      state: "may_have_started",
                      enteredAt: now.toISOString(),
                    },
                  ]
                : [],
            },
          ],
        },
      });
    await expect(make(view).resolve(publicationScope())).resolves.toMatchObject(
      { status: CurrentPublicationLifecycleStatus.Current },
    );
    await expect(make(null).resolve(publicationScope())).resolves.toMatchObject(
      { status: CurrentPublicationLifecycleStatus.Changed },
    );
    await expect(
      make({
        ...view,
        attempt: { ...view.attempt, publicationAttemptId: "foreign-attempt" },
      }).resolve(publicationScope()),
    ).resolves.toMatchObject({
      status: CurrentPublicationLifecycleStatus.Unavailable,
    });
    await expect(
      make(view, false).resolve(publicationScope()),
    ).resolves.toMatchObject({
      status: CurrentPublicationLifecycleStatus.Unavailable,
    });
  });

  it("classifies malformed stored projection separately from transient repository failure", async () => {
    const malformedArtifact = finalizedArtifactWithProjectionEnvelope(
      {
        ...JSON.parse(projectionEnvelopeJson),
        publishing: {
          ...publishing,
          inlineReviewChunks: [
            {
              comments: [{ marker: "reviewrouter:finding:v2:rrl_malformed" }],
            },
          ],
        },
      },
      hash("9"),
    );
    const liveResolve = vi.fn();
    const malformed = createProductionPublicationLifecyclePort({
      executions: {
        async findStream() {
          return { activeExecutionId: malformedArtifact.executionId } as never;
        },
        async findExecution() {
          return { artifact: malformedArtifact } as never;
        },
      },
      authorizationQueries: {
        async findReviewRunAuthorizationById() {
          return authorization;
        },
      },
      liveLifecycle: { resolve: liveResolve },
    });

    await expect(malformed.resolve(publicationScope())).resolves.toEqual({
      status: CurrentPublicationLifecycleStatus.Invalid,
      lifecycleStateHash: null,
      commandLedgerWatermark: null,
    });
    expect(liveResolve).not.toHaveBeenCalled();

    const unavailable = createProductionPublicationLifecyclePort({
      executions: {
        async findStream() {
          throw new Error("repository_unavailable");
        },
        async findExecution() {
          throw new Error("unexpected_execution_read");
        },
      },
      authorizationQueries: {
        async findReviewRunAuthorizationById() {
          throw new Error("unexpected_authorization_read");
        },
      },
      liveLifecycle: { resolve: liveResolve },
    });

    await expect(unavailable.resolve(publicationScope())).resolves.toEqual({
      status: CurrentPublicationLifecycleStatus.Unavailable,
      lifecycleStateHash: null,
      commandLedgerWatermark: null,
    });
    expect(liveResolve).not.toHaveBeenCalled();
  });
});

function createRoutes(
  publicationRepository = new InMemoryReviewPublicationRepository(),
  contextPolicy = { assertCurrentPolicy: vi.fn() },
  finalizedArtifact: FinalizedReviewProjectionArtifact = artifact,
  decisionOverrides: Partial<ReviewPublicationDecisionPorts> = {},
  overrides: {
    readonly snapshot?: ReviewSnapshotV2Record | null;
    readonly liveLifecycle?: LiveReviewPublicationLifecyclePort;
    readonly resolutionHistory?: ReviewPublicationResolutionHistoryPort;
    readonly publications?: ReviewPublicationAttemptQueryPort;
    readonly authorization?: ReviewRunAuthorization;
    readonly executions?: Pick<ReviewExecutionQueryPort, "findExecution"> &
      Partial<Pick<ReviewExecutionQueryPort, "findLease">>;
    readonly limits?: ReviewProtocolLimitsV2;
  } = {},
) {
  const publicationApplication = createReviewPublicationV2Application({
    clock: { now: () => now },
    decisions: allowingReviewPublicationDecisionPorts(
      finalizedArtifact.publicationPermit,
      decisionOverrides,
    ),
    attempts: publicationRepository,
    idempotency: publicationRepository,
    adjudicationEvidence: {
      async resolve() {
        return {
          status: ReviewPublicationAdjudicationEvidenceStatus.Unavailable,
          reason: "not_required_for_request",
        };
      },
    },
    commands: {
      requests: publicationRepository,
      claims: publicationRepository,
      claimRenewals: publicationRepository,
      operationBegins: publicationRepository,
      effects: publicationRepository,
      completions: publicationRepository,
      terminalizations: publicationRepository,
      adjudications: publicationRepository,
    },
    enabledCapabilities: new Set([ReviewPublicationCapability.Request]),
  });
  return createReviewActionV2SnapshotPublicationRoutes({
    runtime: {
      readServerTime: async () => now,
      createRequestId: () => "request-generated",
    },
    authorizations: {
      async resolveReviewRunAuthorizationToken() {
        return {
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization: overrides.authorization ?? authorization,
        };
      },
    },
    executions: overrides.executions ?? {
      async findExecution() {
        return {
          artifact: finalizedArtifact,
        } as unknown as ReviewExecutionSnapshot;
      },
    },
    releases: {
      async findProducerReleaseById() {
        return producerRelease;
      },
      async findProtocolLimitsProfileById() {
        return overrides.limits ?? protocolLimits;
      },
    },
    snapshots: {
      async findCurrent() {
        return Object.hasOwn(overrides, "snapshot")
          ? (overrides.snapshot ?? null)
          : snapshot;
      },
    },
    publications: overrides.publications ?? publicationRepository,
    requestPublication: publicationApplication.request,
    capabilities: capabilityAdapter(),
    digest,
    contextPolicy,
    ...(overrides.liveLifecycle
      ? { liveLifecycle: overrides.liveLifecycle }
      : {}),
    ...(overrides.resolutionHistory
      ? { resolutionHistory: overrides.resolutionHistory }
      : {}),
    now: () => now,
  });
}

class LostPublicationResponseRepository extends InMemoryReviewPublicationRepository {
  requestCalls = 0;

  override async request(command: RequestReviewPublicationCommand) {
    this.requestCalls += 1;
    if (this.requestCalls === 1) {
      const applied = await super.request(command);
      if (applied.status !== RequestReviewPublicationStatus.Applied) {
        throw new Error("test_publication_not_applied");
      }
      throw new Error("test_publication_response_lost");
    }
    return super.request(command);
  }
}

async function publicationRequest(
  publicationPermit: string,
  operationsCanonicalJson = canonicalJson(publishing),
  projectionHash = artifact.projectionHash,
): Promise<ReviewPublicationRequest> {
  const request: ReviewPublicationRequest = {
    ...envelope("publication-1"),
    authorizationToken: "authorization-token",
    idempotencyKey: "publication-idempotency-1",
    requestBodyHash: hash("0"),
    publicationPermit,
    projectionHash,
    operationsCanonicalJson,
  };
  return {
    ...request,
    requestBodyHash: await digest.digestUtf8(
      canonicalizeReviewActionV2Request(
        ReviewActionV2OperationId.ReviewPublicationRequest,
        request,
      ),
    ),
  };
}

function capabilityAdapter() {
  const keyRing = new ConfiguredCapabilityKeyRing({
    activeKeyId: "test-key",
    keys: [
      {
        keyId: "test-key",
        secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
        verifyUntil: null,
      },
    ],
  });
  return new ReviewActionV2ExecutionEvidenceCapabilityAdapter(
    new JoseRotatingCapabilityCodec(keyRing, 0),
    keyRing,
    "reviewrouter-execution-evidence",
    () => "publication-capability-1",
  );
}

function envelope(requestId: string) {
  return {
    protocolVersion: reviewActionV2PublishedProtocolVersion,
    schemaDigest: reviewActionV2PublishedSchemaDigest,
    requestId,
  };
}

const authorization = {
  authorizationId: "authorization-1",
  workspaceId: "workspace-1",
  repositoryConnectionId: "repository-1",
  scmRepositoryIdentityId: "identity-1",
  pullRequestNumber: 42,
  sourceRunId: "run-1",
  sourceRunAttempt: "1",
  producerReleaseId: "release-1",
  selectedProtocolVersion: ReviewProtocolVersion.V2,
  protocolLimitsProfileId: "limits-1",
  operationalSloProfileId: "slo-1",
  mutationEpoch: 3n,
  providerVoteLanes: [],
  trustDomain: ReviewTrustDomain.TrustedManaged,
  state: ReviewRunAuthorizationState.Active,
  baseSha: "b".repeat(40),
  mergeBaseSha: "c".repeat(40),
  headSha: "a".repeat(40),
  reviewRevisionHash: hash("2"),
  expiresAt: new Date("2026-07-23T12:30:00.000Z"),
} as unknown as ReviewRunAuthorization;

const publishing = {
  check: {
    conclusion: "success",
    marker: "<!-- check-marker -->",
    name: "ReviewRouter",
    summary: "All checks passed",
    title: "Review complete",
  },
  inlineReviewChunks: [],
  lifecycle: [],
  summary: {
    allClear: true,
    body: "No findings",
    marker: "<!-- summary-marker -->",
    occurrenceCounts: {
      new: 0,
      reconfirmed: 0,
      changed: 0,
      carried_unverified: 0,
      resolved: 0,
      uncertain: 0,
      suppressed_by_human: 0,
    },
  },
};

const projectionEnvelopeJson = canonicalJson({
  commandLedgerWatermark: "2",
  coverage: { state: "complete" },
  envelopeVersion: "review_projection.v1",
  lifecycleStateHash: hash("4"),
  occurrences: [],
  publishing,
  snapshot: { lineageHints: [] },
});

const artifact: FinalizedReviewProjectionArtifact = {
  artifactId: "artifact-1",
  executionId: "execution-1",
  generation: 1n,
  reviewedHeadSha: authorization.headSha,
  reviewRevisionHash: authorization.reviewRevisionHash,
  coverageState: ReviewCoverageState.Completed,
  projectionEnvelopeVersion: 1,
  projectionEnvelopeJson,
  projectionHash: hash("3"),
  byteCount: Buffer.byteLength(projectionEnvelopeJson, "utf8"),
  findingCount: 0,
  lifecycleStateHash: hash("4"),
  commandLedgerWatermark: 2n,
  projectionPolicyVersion: "review-projection-policy.v3-t0",
  publicationPermit: {
    workspaceId: authorization.workspaceId,
    repositoryConnectionId: authorization.repositoryConnectionId,
    scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
    pullRequestNumber: authorization.pullRequestNumber,
    executionId: "execution-1",
    generation: 1n,
    authorizationId: authorization.authorizationId,
    producerReleaseId: authorization.producerReleaseId,
    reviewedHeadSha: authorization.headSha,
    reviewRevisionHash: authorization.reviewRevisionHash,
    projectionHash: hash("3"),
    lifecycleStateHash: hash("4"),
    commandLedgerWatermark: 2n,
    permitEpoch: authorization.mutationEpoch,
    publicationSafetyDecisionHash: hash("5"),
    publicationNotAfter: new Date("2026-07-23T12:10:00.000Z"),
  },
  createdAt: now,
  retainUntil: new Date("2026-08-23T12:00:00.000Z"),
};

function publicationScope() {
  return {
    workspaceId: artifact.publicationPermit.workspaceId,
    repositoryConnectionId: artifact.publicationPermit.repositoryConnectionId,
    scmRepositoryIdentityId: artifact.publicationPermit.scmRepositoryIdentityId,
    pullRequestNumber: artifact.publicationPermit.pullRequestNumber,
  };
}

function finalizedArtifactWithPublishing(
  source: unknown,
  projectionHash: string,
): FinalizedReviewProjectionArtifact {
  const envelopeJson = canonicalJson({
    ...JSON.parse(projectionEnvelopeJson),
    publishing: source,
  });
  return {
    ...artifact,
    projectionEnvelopeJson: envelopeJson,
    projectionHash,
    byteCount: Buffer.byteLength(envelopeJson, "utf8"),
    publicationPermit: {
      ...artifact.publicationPermit,
      projectionHash,
    },
  };
}

function finalizedArtifactWithProjectionEnvelope(
  projectionEnvelope: Readonly<Record<string, unknown>>,
  projectionHash: string,
): FinalizedReviewProjectionArtifact {
  const envelopeJson = canonicalJson(projectionEnvelope);
  return {
    ...artifact,
    projectionEnvelopeJson: envelopeJson,
    projectionHash,
    byteCount: Buffer.byteLength(envelopeJson, "utf8"),
    publicationPermit: {
      ...artifact.publicationPermit,
      projectionHash,
    },
  };
}

async function readPairedActionLifecycleFixture(actionRepo: string) {
  const fixturePath = resolve(
    actionRepo,
    "src/review-projection/fixtures/review-lifecycle-thread-state.v1.golden.json",
  );
  const fixture = requiredRecordForTest(
    JSON.parse(await readFile(fixturePath, "utf8")),
    "paired_action_fixture_invalid",
  );
  if (fixture.schemaVersion !== "review_lifecycle_thread_state.v1") {
    throw new Error("paired_action_fixture_version_invalid");
  }
  const projectionTarget = requiredRecordForTest(
    fixture.expectedProjectionTarget,
    "paired_action_projection_target_invalid",
  );
  return {
    expectedThreadStateHash: requiredStringForTest(
      fixture.expectedThreadStateHash,
      "paired_action_thread_hash_invalid",
    ),
    projectionTarget: {
      targetId: requiredStringForTest(
        projectionTarget.targetId,
        "paired_action_projection_target_id_invalid",
      ),
      threadId: requiredStringForTest(
        projectionTarget.threadId,
        "paired_action_projection_thread_id_invalid",
      ),
      markerFingerprint: requiredStringForTest(
        projectionTarget.markerFingerprint,
        "paired_action_projection_marker_invalid",
      ),
      threadStateHash: requiredStringForTest(
        projectionTarget.threadStateHash,
        "paired_action_projection_thread_hash_invalid",
      ),
    },
    thread: {
      threadId: requiredStringForTest(
        fixture.threadId,
        "paired_action_thread_id_invalid",
      ),
      comments: requiredArrayForTest(
        fixture.comments,
        "paired_action_comments_invalid",
      ).map((candidate) => {
        const comment = requiredRecordForTest(
          candidate,
          "paired_action_comment_invalid",
        );
        return {
          id: requiredStringForTest(
            comment.id,
            "paired_action_comment_id_invalid",
          ),
          authorLogin:
            comment.authorLogin === null
              ? null
              : requiredStringForTest(
                  comment.authorLogin,
                  "paired_action_comment_author_invalid",
                ),
          body: requiredStringForTest(
            comment.body,
            "paired_action_comment_body_invalid",
          ),
          createdAt: requiredStringForTest(
            comment.createdAt,
            "paired_action_comment_created_at_invalid",
          ),
          updatedAt: requiredStringForTest(
            comment.updatedAt,
            "paired_action_comment_updated_at_invalid",
          ),
        };
      }),
    },
  };
}

function requiredRecordForTest(
  value: unknown,
  error: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(error);
  }
  return value as Record<string, unknown>;
}

function requiredArrayForTest(value: unknown, error: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(error);
  return value;
}

function requiredStringForTest(value: unknown, error: string): string {
  if (typeof value !== "string") throw new Error(error);
  return value;
}

const protocolLimits: ReviewProtocolLimitsV2 = {
  protocolLimitsProfileId: authorization.protocolLimitsProfileId,
  limitsDigest: hash("6"),
  maxWorkSlots: 100,
  maxAttemptsPerSlot: 4,
  maxObservationBytes: 1_000_000,
  maxObservationFindings: 1_000,
  maxProjectionBytes: 2_000_000,
  maxProjectionFindings: 2_000,
  maxPublicationOperations: 100,
  maxPublicationChunks: 100,
  maxPublicationBodyBytes: 2_000_000,
  maxRequestBatchSize: 100,
  maxLeaseDurationMs: 600_000,
  maxResultReportDurationMs: 1_200_000,
  maxReconciliationDurationMs: 3_600_000,
  registeredAt: now,
};

const producerRelease = {
  producerReleaseId: authorization.producerReleaseId,
  distributionKind: ProducerDistributionKind.PublicReusable,
  actionCommitSha: "d".repeat(40),
  runtimeCommitSha: "e".repeat(40),
  wrapperEntrypointDigest: null,
  runtimeEntrypointDigest: hash("7"),
  contextGatewayPolicyVersion: null,
  contextGatewayEntrypointDigest: null,
  reviewInvestigationProfile: null,
  agentProfiles: null,
  schemaDigest: reviewActionV2PublishedSchemaDigest,
  capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
  protocolLimitsProfileId: authorization.protocolLimitsProfileId,
  operationalSloProfileId: authorization.operationalSloProfileId,
  state: ProducerReleaseState.Registered,
  registeredAt: now,
  revokedAt: null,
};

const snapshot = {
  workspaceId: authorization.workspaceId,
  repositoryConnectionId: authorization.repositoryConnectionId,
  scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
  pullRequestNumber: authorization.pullRequestNumber,
  version: 3,
  schemaVersion: 2 as const,
  sourceExecutionId: "execution-previous",
  sourceExecutionGeneration: 2,
  sourceArtifactHash: hash("8"),
  sourceReviewRevisionHash: authorization.reviewRevisionHash,
  sourceBaseSha: authorization.baseSha,
  sourceReviewedHeadSha: authorization.headSha,
  sourceCompatibilityKey: hash("9"),
  sourceRunId: "previous-run",
  sourceRunAttempt: "1",
  payload: {
    projectionEnvelopeVersion: 1,
    projectionEnvelope: { findings: [] },
    projectionHash: hash("a"),
    occurrences: [],
    lineageHints: {
      hints: [],
      eviction: {
        [LineageHintEvictionReason.Age]: 0,
        [LineageHintEvictionReason.Count]: 0,
        [LineageHintEvictionReason.Bytes]: 0,
        evictionWatermark: null,
      },
    },
  },
  createdAt: new Date("2026-07-23T11:00:00.000Z"),
  expiresAt: new Date("2026-07-30T12:00:00.000Z"),
};

function verifierAuthorization(): ReviewRunAuthorization {
  const configuration = {
    ...workspacePolicyFixture,
    providers: [
      {
        ...workspaceProviderFixture,
        authMode: "codex_account_gateway",
        gatewayBindingId: "binding-1",
        gatewayProfileRef: "profile-1",
      },
    ],
  };
  return {
    ...authorization,
    createdAt: now,
    providerVoteLanes: [
      {
        providerKind: ReviewProviderKind.Codex,
        providerVoteIdentityHash: hash("a"),
      },
    ],
    runtimeSnapshotCanonicalJson: canonicalJson({
      snapshotVersion: 3,
      configurationSource: "repository",
      configurationVersion: 1,
      workspaceConfigurationVersion: 1,
      repositoryConfigurationVersion: 1,
      effectivePolicyDigest: `sha256:${hash("a")}`,
      agent: {
        profileRef: "codex-default",
        agentKind: "codex",
        binarySha256: hash("a"),
        packageVersion: "1.0.0",
        modelTransports: ["account_gateway"],
        contextGateway: true,
        cancellation: true,
      },
      agentProfileDigest: hash("b"),
      producer: {
        producerReleaseId: authorization.producerReleaseId,
        actionCommitSha: producerRelease.actionCommitSha,
        runtimeCommitSha: producerRelease.runtimeCommitSha,
      },
      configurationCanonicalJson: canonicalJson(configuration),
      deadline: authorization.expiresAt.toISOString(),
      gateway: {
        providerIndex: 0,
        bindingId: "binding-1",
        connectionId: "connection-1",
        bindingRevision: 1,
        policySubject: "binding-1",
        policyRevision: 1,
        permittedAccountRef: "account-1",
        profileRef: "profile-1",
        invocationId: "invocation-1",
        attemptId: "attempt-1",
        operationId: "operation-1",
        limits: {
          requests: 9,
          concurrency: 1,
          requestBytes: 98304,
          outputBytes: 32768,
          tokens: 4096,
        },
      },
      lifecycleVerificationCapability: {
        extensionId: lifecycleVerificationContract.extensionId,
        descriptorDigest: lifecycleVerificationDescriptorDigest,
        executor: lifecycleVerificationContract.executor,
        modelTransport: "account_gateway",
        providerIndex: 0,
        providerKind: "codex",
        model: workspaceProviderFixture.model,
        maxDispatches: 2,
        maxPromptBytes: 98304,
        maxResponseBytes: 32768,
        maxOutputTokens: 4096,
        deadlineMs: 60000,
        attemptBudget: 1,
      },
    }),
  };
}
function liveHistoryTarget() {
  return {
    targetId: "target-1",
    threadId: "thread-1",
    markerFingerprint: `rrl_${"a".repeat(32)}`,
    threadStateHash: hash("a"),
    isResolved: false,
    parentOwnedByIntegration: true,
    hasRelevantInteractionAfterParent: false,
    parentCreatedAt: now,
    parentCommentId: "parent-1",
    parentBodyHash: hash("a"),
    lastRelevantChangeAt: now,
  };
}
