import {
  systemPolicyWriteFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture.js";
import { PrismaReviewConfigurationRepository } from "../../../packages/features/review-config/src/index.js";
import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  OutboxHandlerError,
  PrismaOutboxEventRepository,
  processOutboxBatch,
  retryDeadLetterOutboxEvent,
  type OutboxHandler,
} from "../../../packages/features/outbox/src/index.js";
import {
  ProviderExecutionProfile,
  ProviderResultCompletionStatus,
  ReviewProviderKind,
  ReviewTaskKind as EvidenceTaskKind,
  buildProviderInvocationIdentity,
  prepareReviewObservationPayload,
  reviewEvidencePayloadVersion,
  reviewReuseEligibilityPolicyVersion,
  serializeProviderInvocationManifestCanonicalWireJson,
  type ProviderInvocationManifest,
  type ReviewObservationPayload,
} from "../../../packages/features/review-evidence/src/index.js";
import {
  ReviewRequestIngressCommandKind,
  ReviewRequestedTriggerKind,
  reviewRequestIngressEventType,
  type EnqueueReviewRequestIngressCommand,
  ReviewExecutionProviderKind,
  ReviewInvocationLeasePurpose,
  ReviewTaskKind as ExecutionTaskKind,
  ReviewWorkSlotState,
  ReviewWorkSlotTerminalReason as ExecutionWorkSlotTerminalReason,
  canonicalReviewAssignmentManifestHashPreimage,
  canonicalReviewExecutionPlanHashPreimage,
} from "../../../packages/features/review-executions/src/index.js";
import { PrismaReviewExecutionStore } from "../../../packages/features/review-executions/src/composition/index.js";
import { createPrismaReviewProgressCapture } from "../../../packages/features/review-progress/src/composition/index.js";
import {
  createReviewStatisticsFeature,
  type ReviewStatisticsFeature,
} from "../../../packages/features/review-statistics/src/composition/index.js";
import {
  createReviewHistoryFeature,
  type ReviewHistoryFeature,
} from "../../../packages/features/review-history/src/composition/index.js";
import { historyChangedEventType } from "../../../packages/features/review-history/src/index.js";
import { createReviewHistoryChangedHandler } from "../../../apps/worker/src/review-history-worker-runtime.js";
import { ReviewV2RequestIngressOutbox } from "../../../apps/api/src/review-v2-request-ingress-outbox.js";
import { ClaimReviewPublicationStatus } from "../../../packages/features/review-publishing/src/v2/index.js";
import { PrismaReviewPublicationRepository } from "../../../packages/features/review-publishing/src/v2/composition/index.js";
import {
  canonicalJson,
  canonicalReviewOperationalSloProfile,
  canonicalReviewProtocolLimits,
  ImmutableRegistryWriteStatus,
  producerReleaseImmutableKey,
  reviewInvestigationCapabilityV1,
  type ProducerReleaseCandidate,
  type ReviewOperationalSloThresholds,
  type ReviewProtocolLimits,
  type ReviewAgentProfile,
} from "../../../packages/features/review-run-control/src/index.js";
import { PrismaProducerReleaseRepository } from "../../../packages/features/review-run-control/src/composition/index.js";
import { composeReviewActionV2ReleaseRegistry } from "../../../apps/api/src/review-action-v2-release-registry-composition.js";
import {
  createPrismaClient,
  type PrismaClient,
} from "../../../packages/platform/db/src/index.js";
import {
  SystemClock,
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
  type ProviderApiAuthMode,
  type ReviewModelDispatchProfileV2,
} from "../../../packages/shared/src/index.js";
import {
  ReviewActionV2OperationId,
  ReviewEvidenceCommitResultStatus,
  ReviewExecutionMutationResultStatus,
  ReviewExecutionStartResultStatus,
  ReviewInvocationLeaseResultStatus,
  canonicalizeReviewActionV2Request,
  prDescriptionExtensionV1,
  reviewActionV2CanonicalizerDigest,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  type ReviewActionV2RequestMap,
  type ReviewEvidenceCommitRequest,
  type ReviewExecutionFinalizeRequest,
  type ReviewExecutionObservationAdoptRequest,
  type ReviewExecutionObservationAttachRequest,
  type ReviewExecutionStartRequest,
  type ReviewInvocationLeaseAcquireRequest,
  type ReviewInvocationLeaseReleaseRequest,
  type ReviewRunAuthorizeRequest,
  type ReviewRunAuthorizeResult,
  type ReviewRunRenewRequest,
} from "../../../packages/protocol-review-action-v2/src/index.js";
import type { GeneratedPrDescription } from "../../../packages/protocol-review-action-v2/src/generated/companion-contracts.js";
import { exportJWK, SignJWT } from "jose";
import {
  reviewActionV2ContextReplayActiveKeyIdEnv,
  reviewActionV2ContextReplayKeysEnv,
  reviewActionV2ContextSessionSecretEnv,
} from "../../../apps/api/src/review-action-v2-context-attestation-composition.js";
import {
  composeReviewActionV2ProductionRoutes,
  reviewActionV2CapabilityActiveKeyIdEnv,
  reviewActionV2CapabilityKeysEnv,
  reviewActionV2ProjectionPolicyVersionEnv,
  reviewActionV2ProviderVoteLanesEnv,
  reviewInvestigationContextCriticEnabledEnv,
  reviewInvestigationLeaseCapabilityActiveKeyIdEnv,
  reviewInvestigationLeaseCapabilityKeysEnv,
  reviewInvestigationMaintenanceEnabledEnv,
  reviewInvestigationRecordingEnabledEnv,
  reviewInvestigationShadowEnabledEnv,
} from "../../../apps/api/src/review-action-v2-production-composition.js";
import { reviewActionV2ProjectionPolicyVersion } from "../../../apps/api/src/review-action-v2-projection-policy.js";
import { createProductionReviewV2WorkerRuntime } from "../../../apps/worker/src/review-v2-production-runtime.js";
import { createReviewStatisticsSettlementCapture } from "../../../apps/worker/src/review-statistics-settlement-capture.js";
import { createReviewStatisticsSettledHandler } from "../../../apps/worker/src/review-statistics-worker-runtime.js";
import { PrismaReviewProgressPublicationStore } from "../../../apps/worker/src/review-progress-store.js";
import {
  createReviewV2WorkerFeature,
  reviewExecutionFinalizedEventType,
  reviewExecutionFinalizedEventVersion,
  reviewV2WorkerEnabledEnv,
} from "../../../apps/worker/src/review-v2-worker-runtime.js";
import { FakeGitHubTransport, type FakeGitHubRevision } from "./fake-github.js";

const lifecycleVerificationExtensionV1 = {
  extensionId: lifecycleVerificationContract.extensionId,
  descriptorDigest: lifecycleVerificationDescriptorDigest,
};
const owner = "reviewrouter-e2e";
const repo = "disposable-review-v2";
const pullRequestNumber = 42;
const githubRepositoryId = "987654321";
const githubInstallationId = "123456";
const sourceRunId = "700001";
const actionCommitSha = "a".repeat(40);
const runtimeCommitSha = actionCommitSha;
const baseSha = "c".repeat(40);
const mergeBaseSha = "d".repeat(40);
const headSha = "e".repeat(40);
const providerVoteIdentityHash = sha256("provider-vote");
const capabilityKeyId = "review-v2-e2e-key";
const investigationLeaseKeyId = "review-v2-e2e-investigation-lease-key";

export type ReviewActionV2E2EFlow = Readonly<{
  authorizationId: string;
  authorizationToken: string;
  executionId: string;
  workSlotId: string;
  ownerIdHash: string;
  planHash: string;
  reviewRevisionHash: string;
  manifest: ProviderInvocationManifest;
  manifestCanonicalJson: string;
  manifestKey: string;
  providerInvocationKey: string;
  leaseId: string;
  attemptId: string;
  leaseCapability: string;
  fencingToken: string;
  observationId: string;
  payloadHash: string;
  byteCount: number;
  findingCount: number;
  streamVersion: string;
  executionVersion: string;
}>;

export type ReviewActionV2E2EAuthorization = Readonly<{
  result: ReviewRunAuthorizeResult;
  providerApiAuthMode?: ProviderApiAuthMode;
  sourceRunAttempt?: string;
  sourceRunId?: string;
  oidcExpiresAt?: string;
  authorizationId: string;
  authorizationToken: string;
  reviewRevisionHash: string;
  selectedProtocolVersion: string;
}>;

export type ReviewActionV2E2EInvestigationProfile = Readonly<{
  coverageProfileHash: string;
  policyHash: string;
  gatewayPolicyVersion: string;
}>;

export type ReviewActionV2E2EHarnessOptions = Readonly<{
  /** Exact checked Action policy; registered through the production use case. */
  releaseCandidate?: ProducerReleaseCandidate;
  /** Join real source owners, registered outbox projection and public reads. */
  historyProfile?: boolean;
  /** Reuse the browser fixture's workspace without resetting its database. */
  fixtureScope?: Readonly<{ prefix: string; workspaceId: string }>;
  /** Registered test producer definitions, shared by DB row and attestation. */
  agentProfiles?: readonly ReviewAgentProfile[];
  reviewerPlanProfile?: Readonly<{ planVersion: 1; descriptorDigest: string }>;
  /** The controlled local Gateway remains real HTTP while GitHub stays synthetic. */
  gatewayFixtureOrigin?: string;
  /** Signed workflow identity; independent of the configured policy. */
  modelTransport?: "account_gateway" | "provider_api";
  /** Use the actual canonical native Claude caller identity and source proof. */
  subscriptionAuthMode?: "claude-oauth";
  /** Shorten only the synthetic mint, without changing server run authority. */
  oidcLifetimeSeconds?: number;
  investigationProfile?: ReviewActionV2E2EInvestigationProfile;
  environmentOverrides?: Readonly<Record<string, string>>;
  investigationEmergencyValue?: () => string;
  investigationProductionEffects?: boolean;
  beforeFakeGitHubRead?: (request: Request) => Promise<void>;
  protocolMaxAttemptsPerSlot?: number;
  prDescriptionProfile?: boolean;
  lifecycleVerificationProfile?: boolean;
  /** Explicit producer approval for the all-role durable model dispatch path. */
  modelDispatchProfile?: ReviewModelDispatchProfileV2;
  /**
   * The repository's stored provider selection. The workspace has no default
   * provider, so "rotating" (the default) stores a repository selection of
   * its rotating Codex profile; "none" leaves the repository document unset
   * for tests that store their own.
   */
  repositoryProviderSelection?: "rotating" | "none";
}>;

export type ReviewActionV2E2EHistoryReview = Readonly<{
  requestId: string;
  rootRequestId: string;
  pullRequestId: string;
  sourceRunId: string;
  pullRequestNumber: number;
  repositoryFullName: string;
  pullRequestTitle: string;
  headSha: string;
  ingressCommand: EnqueueReviewRequestIngressCommand;
}>;
type EmergencyControlSnapshot = {
  version: number;
  stopped: boolean;
  reason: string;
  updatedBy: string;
  updatedAt: Date;
};

export class ReviewActionV2E2EHarness {
  readonly prisma: PrismaClient;
  readonly fakeGitHub: FakeGitHubTransport;
  readonly prefix: string;
  readonly workspaceId: string;
  readonly repositoryConnectionId: string;
  readonly scmRepositoryIdentityId: string;
  readonly producerReleaseId: string;
  readonly actionCommitSha: string;
  readonly protocolLimitsProfileId: string;
  readonly operationalSloProfileId: string;
  readonly env: Readonly<Record<string, string>>;
  readonly routes: ReturnType<typeof composeReviewActionV2ProductionRoutes>;
  private readonly worker: ReturnType<typeof createReviewV2WorkerFeature>;
  private readonly statistics: ReviewStatisticsFeature;
  private readonly knownOutboxHandlers: readonly OutboxHandler[];
  private readonly originalFetch: typeof globalThis.fetch;
  private oidcOrdinal = 0;
  private readonly oidcLifetimeSeconds: number;
  private readonly modelTransport: "account_gateway" | "provider_api";
  private readonly subscriptionAuthMode: "claude-oauth" | undefined;
  readonly history: ReviewHistoryFeature | undefined;
  private readonly fixtureFetch: typeof globalThis.fetch;
  private readonly originalHistoryCoverage: Date | null;
  private readonly originalStatisticsCoverage: Date | null;
  private readonly borrowedWorkspace: boolean;
  private readonly originalEmergencyControl: EmergencyControlSnapshot | null;

  private constructor(input: {
    readonly prisma: PrismaClient;
    readonly fakeGitHub: FakeGitHubTransport;
    readonly prefix: string;
    readonly workspaceId: string;
    readonly repositoryConnectionId: string;
    readonly scmRepositoryIdentityId: string;
    readonly producerReleaseId: string;
    readonly actionCommitSha: string;
    readonly protocolLimitsProfileId: string;
    readonly operationalSloProfileId: string;
    readonly env: Readonly<Record<string, string>>;
    readonly routes: ReturnType<typeof composeReviewActionV2ProductionRoutes>;
    readonly worker: ReturnType<typeof createReviewV2WorkerFeature>;
    readonly statistics: ReviewStatisticsFeature;
    readonly originalFetch: typeof globalThis.fetch;
    readonly oidcLifetimeSeconds: number;
    readonly modelTransport: "account_gateway" | "provider_api";
    readonly subscriptionAuthMode?: "claude-oauth";
    readonly history?: ReviewHistoryFeature;
    readonly fixtureFetch: typeof globalThis.fetch;
    readonly originalHistoryCoverage: Date | null;
    readonly originalStatisticsCoverage: Date | null;
    readonly borrowedWorkspace: boolean;
    readonly originalEmergencyControl: EmergencyControlSnapshot | null;
  }) {
    this.prisma = input.prisma;
    this.fakeGitHub = input.fakeGitHub;
    this.prefix = input.prefix;
    this.workspaceId = input.workspaceId;
    this.repositoryConnectionId = input.repositoryConnectionId;
    this.scmRepositoryIdentityId = input.scmRepositoryIdentityId;
    this.producerReleaseId = input.producerReleaseId;
    this.actionCommitSha = input.actionCommitSha;
    this.protocolLimitsProfileId = input.protocolLimitsProfileId;
    this.operationalSloProfileId = input.operationalSloProfileId;
    this.env = input.env;
    this.routes = input.routes;
    this.worker = input.worker;
    this.statistics = input.statistics;
    this.knownOutboxHandlers = [
      ...input.worker.handlers,
      createReviewStatisticsSettledHandler(input.statistics.projector),
      ...(input.history
        ? [createReviewHistoryChangedHandler(input.history.projector)]
        : []),
    ];
    this.originalFetch = input.originalFetch;
    this.oidcLifetimeSeconds = input.oidcLifetimeSeconds;
    this.modelTransport = input.modelTransport;
    this.subscriptionAuthMode = input.subscriptionAuthMode;
    this.history = input.history;
    this.fixtureFetch = input.fixtureFetch;
    this.originalHistoryCoverage = input.originalHistoryCoverage;
    this.originalStatisticsCoverage = input.originalStatisticsCoverage;
    this.borrowedWorkspace = input.borrowedWorkspace;
    this.originalEmergencyControl = input.originalEmergencyControl;
  }

  static async create(
    databaseUrl: string,
    options: ReviewActionV2E2EHarnessOptions = {},
  ): Promise<ReviewActionV2E2EHarness> {
    assertDisposableDatabaseUrl(databaseUrl);
    if (
      options.releaseCandidate &&
      [
        options.agentProfiles,
        options.reviewerPlanProfile,
        options.prDescriptionProfile,
        options.lifecycleVerificationProfile,
        options.modelDispatchProfile,
        options.investigationProfile,
        options.environmentOverrides
          ?.REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON,
      ].some((value) => value !== undefined)
    )
      throw new Error("review_v2_e2e_committed_release_cannot_be_overridden");
    const oidcLifetimeSeconds = options.oidcLifetimeSeconds ?? 600;
    if (
      !Number.isSafeInteger(oidcLifetimeSeconds) ||
      oidcLifetimeSeconds < 1 ||
      oidcLifetimeSeconds > 600
    )
      throw new Error("review_v2_e2e_oidc_lifetime_invalid");
    const prisma = createPrismaClient({ databaseUrl, poolMax: 12 });
    if (options.fixtureScope && !options.historyProfile)
      throw new Error("review_v2_e2e_borrowed_scope_requires_history_profile");
    const prefix =
      options.fixtureScope?.prefix ?? `review-v2-e2e-${randomUUID()}`;
    const workspaceId =
      options.fixtureScope?.workspaceId ?? `${prefix}-workspace`;
    const repositoryConnectionId = `${prefix}-repository`;
    const scmRepositoryIdentityId = `${prefix}-scm`;
    const producerReleaseId =
      options.releaseCandidate?.producerReleaseId ?? `${prefix}-release`;
    const protocolLimitsProfileId =
      options.releaseCandidate?.protocolLimitsProfileId ?? `${prefix}-limits`;
    const operationalSloProfileId =
      options.releaseCandidate?.operationalSloProfileId ?? `${prefix}-slo`;
    const appKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const oidcKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const oidcJwk = await exportJWK(oidcKeys.publicKey);
    const oidcKeyId = `${prefix}-oidc`;
    oidcJwk.alg = "RS256";
    oidcJwk.kid = oidcKeyId;
    oidcJwk.use = "sig";
    oidcSigningKeys.set(oidcKeyId, oidcKeys);
    const fakeGitHub = new FakeGitHubTransport({
      owner,
      repo,
      pullRequestNumber,
      sourceRunId,
      repositoryId: githubRepositoryId,
      installationId: githubInstallationId,
      appSlug: "reviewrouter-e2e",
      oidcKeyId,
      oidcJwk,
      revision: { baseSha, mergeBaseSha, headSha },
    });
    if (options.historyProfile)
      fakeGitHub.workflowPath = ".github/workflows/reviewrouter-codex.yml";
    const originalFetch = globalThis.fetch;
    if (options.gatewayFixtureOrigin) {
      const gatewayUrl = new URL(options.gatewayFixtureOrigin);
      if (
        gatewayUrl.protocol !== "http:" ||
        gatewayUrl.hostname !== "127.0.0.1"
      )
        throw new Error("review_v2_e2e_gateway_must_be_loopback");
    }
    const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      if (options.gatewayFixtureOrigin === new URL(request.url).origin)
        return originalFetch(input, init);
      if (request.method === "GET")
        await options.beforeFakeGitHubRead?.(request);
      return fakeGitHub.fetch(input, init);
    };
    globalThis.fetch = fixtureFetch;
    const env: Readonly<Record<string, string>> = Object.freeze({
      ...productionEnv({
        ...(options.releaseCandidate
          ? { releaseCandidate: options.releaseCandidate }
          : {}),
        ...(options.reviewerPlanProfile
          ? { reviewerPlanProfile: options.reviewerPlanProfile }
          : {}),
        ...(options.agentProfiles
          ? { agentProfiles: options.agentProfiles }
          : {}),
        appPrivateKey: appKeys.privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
        producerReleaseId,
        protocolLimitsProfileId,
        operationalSloProfileId,
        ...(options.prDescriptionProfile ? { prDescriptionProfile: true } : {}),
        ...(options.lifecycleVerificationProfile
          ? { lifecycleVerificationProfile: true }
          : {}),
        ...(options.modelDispatchProfile
          ? { modelDispatchProfile: options.modelDispatchProfile }
          : {}),
        ...(options.investigationProfile
          ? { investigationProfile: options.investigationProfile }
          : {}),
      }),
      ...(options.investigationProductionEffects
        ? {
            REVIEW_ROUTER_REVIEW_INVESTIGATION_PRODUCTION_EFFECTS_ENABLED: "1",
            REVIEW_ROUTER_REVIEW_INVESTIGATION_VERIFIED_CLEAN_ENABLED: "1",
            REVIEW_ROUTER_REVIEW_INVESTIGATION_SELECTORS_JSON: JSON.stringify(
              Object.fromEntries(
                ["production_effects", "verified_clean"].map((capability) => [
                  capability,
                  [
                    {
                      workspaceIds: [workspaceId],
                      repositoryConnectionIds: [repositoryConnectionId],
                      providers: ["codex"],
                      trustDomains: ["trusted_managed"],
                      producerReleaseIds: [producerReleaseId],
                    },
                  ],
                ]),
              ),
            ),
          }
        : {}),
      ...(options.historyProfile
        ? {
            REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE: "1",
            REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "1",
            REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED: "1",
            REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY: "1",
            REVIEW_ROUTER_REVIEW_V2_WORKFLOW_PATH: fakeGitHub.workflowPath,
            REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
          }
        : {}),
      ...(options.environmentOverrides ?? {}),
      // Keep the object frozen while letting both compositions reread fixture state.
      get REVIEW_ROUTER_REVIEW_INVESTIGATION_EMERGENCY_DISABLED() {
        return (
          options.investigationEmergencyValue?.() ??
          options.environmentOverrides
            ?.REVIEW_ROUTER_REVIEW_INVESTIGATION_EMERGENCY_DISABLED ??
          "0"
        );
      },
    });

    let cleanupInput: HistoryFixtureCleanupInput | undefined;
    try {
      if (options.fixtureScope) {
        await prisma.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
        });
        if (await prisma.reviewConfiguration.count({ where: { workspaceId } }))
          throw new Error(
            "review_v2_e2e_borrowed_workspace_must_be_unconfigured",
          );
      }
      const originalEmergencyControl = options.historyProfile
        ? await prisma.reviewSafetyEmergencyControl.findUniqueOrThrow({
            where: { emergencyControlId: "global-review-v2" },
            select: {
              version: true,
              stopped: true,
              reason: true,
              updatedBy: true,
              updatedAt: true,
            },
          })
        : null;
      const originalHistoryCoverage = options.historyProfile
        ? ((
            await prisma.reviewHistoryCoverage.findUnique({
              where: { id: "capture_v1" },
            })
          )?.coverageSince ?? null)
        : null;
      const originalStatisticsCoverage = options.historyProfile
        ? ((
            await prisma.reviewStatisticsCoverage.findUnique({
              where: { id: "capture_v1" },
            })
          )?.activatedAt ?? null)
        : null;
      if (options.historyProfile) {
        const collisions = await Promise.all([
          prisma.repositoryConnection.count({
            where: { id: repositoryConnectionId },
          }),
          prisma.scmRepositoryIdentity.count({
            where: { scmRepositoryIdentityId },
          }),
          prisma.producerRelease.count({ where: { producerReleaseId } }),
          prisma.reviewProtocolLimitsV2.count({
            where: { protocolLimitsProfileId },
          }),
          prisma.reviewOperationalSloProfileV2.count({
            where: { operationalSloProfileId },
          }),
          prisma.gitHubInstallation.count({
            where: { id: `${prefix}-installation` },
          }),
          prisma.reviewSafetyPolicy.count({
            where: { policyId: { startsWith: `${prefix}-policy-` } },
          }),
        ]);
        if (collisions.some(Boolean))
          throw new Error("review_v2_e2e_history_scope_already_exists");
        cleanupInput = {
          prisma,
          prefix,
          workspaceId,
          repositoryConnectionId,
          scmRepositoryIdentityId,
          producerReleaseId,
          protocolLimitsProfileId,
          operationalSloProfileId,
          borrowedWorkspace: options.fixtureScope !== undefined,
          originalEmergencyControl,
          originalHistoryCoverage,
          originalStatisticsCoverage,
        };
      }
      await seedProductionControlPlane(prisma, {
        ...(options.releaseCandidate
          ? { releaseCandidate: options.releaseCandidate }
          : {}),
        ...(options.reviewerPlanProfile
          ? { reviewerPlanProfile: options.reviewerPlanProfile }
          : {}),
        ...(options.agentProfiles
          ? { agentProfiles: options.agentProfiles }
          : {}),
        prefix,
        borrowedWorkspace: options.fixtureScope !== undefined,
        repositoryProviderSelection:
          options.repositoryProviderSelection ?? "rotating",
        workspaceId,
        repositoryConnectionId,
        scmRepositoryIdentityId,
        producerReleaseId,
        protocolLimitsProfileId,
        operationalSloProfileId,
        ...(options.prDescriptionProfile ? { prDescriptionProfile: true } : {}),
        ...(options.lifecycleVerificationProfile
          ? { lifecycleVerificationProfile: true }
          : {}),
        ...(options.modelDispatchProfile
          ? { modelDispatchProfile: options.modelDispatchProfile }
          : {}),
        ...(options.investigationProfile
          ? { investigationProfile: options.investigationProfile }
          : {}),
        ...(options.protocolMaxAttemptsPerSlot === undefined
          ? {}
          : {
              protocolMaxAttemptsPerSlot: options.protocolMaxAttemptsPerSlot,
            }),
      });
      const history = options.historyProfile
        ? await createReviewHistoryFeature({ prisma })
        : undefined;
      const routes = composeReviewActionV2ProductionRoutes({
        enabled: true,
        env,
        runtime: {
          readServerTime: async () => new Date(),
          createRequestId: () => `${prefix}-request-${randomUUID()}`,
        },
        prisma,
        ...(history ? { historyWriter: history.writer } : {}),
      });
      const statistics = await createReviewStatisticsFeature({ prisma });
      const productionWorker = createProductionReviewV2WorkerRuntime({
        prisma,
        clock: new SystemClock(),
        env,
        githubAppId: requiredString(env.GITHUB_APP_ID),
        githubPrivateKey: requiredString(env.GITHUB_APP_PRIVATE_KEY),
        ...(history ? { historyWriter: history.writer } : {}),
        settlementHook: createReviewStatisticsSettlementCapture(
          statistics.outboxWriter,
        ),
      });
      const worker = createReviewV2WorkerFeature({
        env,
        createEnabledRuntime: () => productionWorker,
      });
      if (worker.enabled) await statistics.activateCapture();
      if (history) await history.activateCapture();
      const harness = new ReviewActionV2E2EHarness({
        prisma,
        fakeGitHub,
        prefix,
        workspaceId,
        repositoryConnectionId,
        scmRepositoryIdentityId,
        producerReleaseId,
        actionCommitSha:
          options.releaseCandidate?.actionCommitSha ?? actionCommitSha,
        protocolLimitsProfileId,
        operationalSloProfileId,
        env,
        routes,
        worker,
        statistics,
        originalFetch,
        fixtureFetch,
        ...(history ? { history } : {}),
        originalHistoryCoverage,
        originalStatisticsCoverage,
        borrowedWorkspace: options.fixtureScope !== undefined,
        originalEmergencyControl,
        oidcLifetimeSeconds,
        modelTransport: options.modelTransport ?? "provider_api",
        ...(options.subscriptionAuthMode
          ? { subscriptionAuthMode: options.subscriptionAuthMode }
          : {}),
      });
      if (history) globalThis.fetch = originalFetch;
      return harness;
    } catch (error) {
      const failures: unknown[] = [error];
      try {
        if (cleanupInput) await cleanupHistoryFixtureRows(cleanupInput);
      } catch (cleanupError) {
        failures.push(cleanupError);
      } finally {
        globalThis.fetch = originalFetch;
        try {
          await prisma.$disconnect();
        } catch (disconnectError) {
          failures.push(disconnectError);
        }
      }
      if (failures.length > 1)
        throw new AggregateError(
          failures,
          "review_v2_e2e_creation_cleanup_failed",
          { cause: error },
        );
      throw error;
    }
  }

  async close(): Promise<void> {
    globalThis.fetch = this.originalFetch;
    await this.prisma.$disconnect();
  }

  /** Only these joined lifecycle calls install the external GitHub/OIDC fixture. */
  private async withHistoryAdapters<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.history)
      throw new Error("review_v2_e2e_history_profile_required");
    const previousFetch = globalThis.fetch;
    if (previousFetch !== this.originalFetch)
      throw new Error("review_v2_e2e_history_fetch_not_restored");
    globalThis.fetch = this.fixtureFetch;
    try {
      return await operation();
    } finally {
      globalThis.fetch = previousFetch;
    }
  }

  private async drainHistoryQueue(): Promise<void> {
    for (let pass = 0; pass < 12; pass += 1) {
      const result = await this.processFinalizedOutbox({
        handlers: this.knownOutboxHandlers,
      });
      if (result.retried || result.deadLettered || result.staleClaims)
        throw new Error(
          `review_v2_e2e_history_outbox_failed:${JSON.stringify(result)}`,
        );
      if (result.claimed === 0) {
        if (
          await this.prisma.outboxEvent.count({
            where: {
              repositoryId: this.repositoryConnectionId,
              type: historyChangedEventType,
              status: { not: "processed" },
            },
          })
        )
          throw new Error("review_v2_e2e_history_events_not_processed");
        return;
      }
    }
    throw new Error("review_v2_e2e_history_outbox_did_not_drain");
  }

  async createHistoryReview(
    label: string,
  ): Promise<ReviewActionV2E2EHistoryReview> {
    return this.withHistoryAdapters(async () => {
      const ingressCommand: EnqueueReviewRequestIngressCommand = {
        workspaceId: this.workspaceId,
        repositoryConnectionId: this.repositoryConnectionId,
        scmRepositoryIdentityId: this.scmRepositoryIdentityId,
        pullRequestNumber,
        githubInstallationId,
        repositoryFullName: `${owner}/${repo}`,
        commandKind: ReviewRequestIngressCommandKind.Request,
        triggerKind: ReviewRequestedTriggerKind.ManualCommand,
        sourceIdentity: `${this.prefix}-history-manual-${label}`,
        occurredAt: new Date(),
        expectedBaseSha: this.fakeGitHub.revision.baseSha,
        expectedHeadSha: this.fakeGitHub.revision.headSha,
        quietPeriodMs: 0,
        retentionMs: 86_400_000,
      };
      const accepted = await new ReviewV2RequestIngressOutbox(
        new PrismaOutboxEventRepository(this.prisma),
        digestPort,
      ).enqueue(ingressCommand);
      const requestId = requiredString(accepted.requestId);
      await this.drainHistoryQueue();
      const dispatched = await this.worker.runMaintenance();
      if (
        dispatched.intentDispatchFailures ||
        dispatched.intentsDispatched !== 1
      )
        throw new Error(
          `review_v2_e2e_history_dispatch_failed:${JSON.stringify(dispatched)}`,
        );
      await this.drainHistoryQueue();
      const intent = await this.prisma.reviewRequestedIntent.findUniqueOrThrow({
        where: { requestId },
      });
      const run = await this.prisma.reviewHistoryRun.findUniqueOrThrow({
        where: { rootRequestId: requestId },
      });
      if (intent.state !== "awaiting_authorization" || run.status !== "queued")
        throw new Error("review_v2_e2e_history_request_not_queued");
      return {
        requestId,
        rootRequestId: requestId,
        pullRequestId: run.pullRequestId,
        sourceRunId: requiredString(intent.sourceRunId),
        pullRequestNumber,
        repositoryFullName: `${owner}/${repo}`,
        pullRequestTitle: this.fakeGitHub.pullRequestTitle,
        headSha: this.fakeGitHub.revision.headSha,
        ingressCommand,
      };
    });
  }

  async startHistoryReview(
    run: ReviewActionV2E2EHistoryReview,
  ): Promise<ReviewActionV2E2EFlow> {
    return this.withHistoryAdapters(async () => {
      this.fakeGitHub.sourceRunId = run.sourceRunId;
      const flow = await this.createCommittedFlow();
      await this.releaseProviderLease(flow);
      await this.drainHistoryQueue();
      return flow;
    });
  }

  async publishHistoryReview(flow: ReviewActionV2E2EFlow): Promise<void> {
    await this.withHistoryAdapters(async () => {
      const finalized = await this.finalize(flow);
      if (
        finalized.result.status !== ReviewExecutionMutationResultStatus.Applied
      )
        throw new Error("review_v2_e2e_history_finalize_failed");
      await this.drainHistoryQueue();
    });
  }

  async completeHistoryReview(flow: ReviewActionV2E2EFlow): Promise<void> {
    await this.withHistoryAdapters(async () => {
      await this.runWorkerUntilSettled();
      await this.drainHistoryQueue();
      const completion =
        await this.prisma.reviewCompletionProcess.findUniqueOrThrow({
          where: { executionId: flow.executionId },
        });
      if (completion.state !== "completed")
        throw new Error("review_v2_e2e_history_completion_not_confirmed");
    });
  }

  async replayHistoryReview(
    run: ReviewActionV2E2EHistoryReview,
  ): Promise<void> {
    await this.withHistoryAdapters(async () => {
      const outbox = new PrismaOutboxEventRepository(this.prisma);
      const duplicate = await new ReviewV2RequestIngressOutbox(
        outbox,
        digestPort,
      ).enqueue(run.ingressCommand);
      if (duplicate.created || duplicate.requestId !== run.requestId)
        throw new Error("review_v2_e2e_history_ingress_not_idempotent");
      // A distinct queue envelope delivers the same immutable source facts again.
      const original = await this.prisma.outboxEvent.findFirstOrThrow({
        where: {
          repositoryId: this.repositoryConnectionId,
          type: reviewRequestIngressEventType,
          payload: { path: ["requestId"], equals: run.requestId },
        },
      });
      await outbox.enqueue({
        type: original.type,
        version: original.version,
        idempotencyKey: `${this.prefix}-history-replay-${randomUUID()}`,
        workspaceId: original.workspaceId,
        repositoryId: original.repositoryId,
        aggregateId: original.aggregateId,
        payload: original.payload,
        occurredAt: original.occurredAt,
      });
      const fact = await this.prisma.outboxEvent.findFirstOrThrow({
        where: {
          repositoryId: this.repositoryConnectionId,
          type: historyChangedEventType,
          aggregateId: run.rootRequestId,
        },
        orderBy: { occurredAt: "asc" },
      });
      await outbox.enqueue({
        type: fact.type,
        version: fact.version,
        idempotencyKey: `${this.prefix}-history-fact-replay-${randomUUID()}`,
        workspaceId: fact.workspaceId,
        repositoryId: fact.repositoryId,
        aggregateId: fact.aggregateId,
        payload: fact.payload,
        occurredAt: fact.occurredAt,
      });
      await this.drainHistoryQueue();
    });
  }

  /** Remove this profile's source rows before the browser removes its workspace. */
  async cleanupHistoryFixtures(): Promise<void> {
    if (!this.history)
      throw new Error("review_v2_e2e_history_profile_required");
    await cleanupHistoryFixtureRows({
      prisma: this.prisma,
      prefix: this.prefix,
      workspaceId: this.workspaceId,
      repositoryConnectionId: this.repositoryConnectionId,
      scmRepositoryIdentityId: this.scmRepositoryIdentityId,
      producerReleaseId: this.producerReleaseId,
      protocolLimitsProfileId: this.protocolLimitsProfileId,
      operationalSloProfileId: this.operationalSloProfileId,
      borrowedWorkspace: this.borrowedWorkspace,
      originalEmergencyControl: this.originalEmergencyControl,
      originalHistoryCoverage: this.originalHistoryCoverage,
      originalStatisticsCoverage: this.originalStatisticsCoverage,
    });
  }

  async authorize(
    input: {
      readonly sourceRunAttempt?: string;
      readonly providerApiAuthMode?: ProviderApiAuthMode;
    } = {},
  ): Promise<ReviewActionV2E2EAuthorization> {
    const runAttempt = input.sourceRunAttempt ?? "1";
    this.fakeGitHub.sourceRunAttempt = runAttempt;
    const oidcExpiresAt =
      Math.floor(Date.now() / 1000) + this.oidcLifetimeSeconds;
    const oidcToken = await this.signOidcToken(
      runAttempt,
      oidcExpiresAt,
      input.providerApiAuthMode,
    );
    const request: ReviewRunAuthorizeRequest = {
      ...envelope(`${this.prefix}-authorize-${runAttempt}`),
      oidcToken,
      supportedProtocols: [
        {
          protocolVersion: reviewActionV2PublishedProtocolVersion,
          schemaDigest: reviewActionV2PublishedSchemaDigest,
        },
      ],
    };
    const response = await requiredHandler(
      this.routes.runControl.authorize,
      "authorize",
    ).execute(request);
    const authorizationId = requiredString(response.result.authorizationId);
    const authorizationToken = requiredString(
      response.result.authorizationToken,
    );
    const facts = record(
      JSON.parse(
        requiredString(response.result.authorizationFactsCanonicalJson),
      ),
    );
    return {
      result: response.result,
      ...(input.providerApiAuthMode
        ? { providerApiAuthMode: input.providerApiAuthMode }
        : {}),
      sourceRunAttempt: runAttempt,
      sourceRunId: this.fakeGitHub.sourceRunId,
      oidcExpiresAt: new Date(oidcExpiresAt * 1000).toISOString(),
      authorizationId,
      authorizationToken,
      reviewRevisionHash: requiredString(facts.reviewRevisionHash),
      selectedProtocolVersion: requiredString(facts.selectedProtocolVersion),
    };
  }

  async createRenewRequest(
    authorization: ReviewActionV2E2EAuthorization,
  ): Promise<ReviewRunRenewRequest> {
    const renewalRequestId = `${this.prefix}-renew-${randomUUID()}`;
    return withBodyHash(ReviewActionV2OperationId.ReviewRunRenew, {
      ...envelope(renewalRequestId),
      authorizationId: authorization.authorizationId,
      authorizationToken: authorization.authorizationToken,
      renewalRequestId,
      idempotencyKey: renewalRequestId,
      requestBodyHash: "0".repeat(64),
      oidcToken: await this.signOidcToken(
        authorization.sourceRunAttempt ?? "1",
        Math.floor(Date.now() / 1000) + this.oidcLifetimeSeconds,
        authorization.providerApiAuthMode,
      ),
      requestedTtlMs: 900_000,
    });
  }

  async createCommittedFlow(
    input: {
      readonly slotCount?: number;
      readonly eligibleFileCount?: number;
      readonly pathSlotIndex?: (pathIndex: number, slotCount: number) => number;
      readonly workSlotId?: (executionId: string, slotIndex: number) => string;
      readonly attachSlotCount?: number;
      readonly attemptBudget?: number;
      readonly authorization?: ReviewActionV2E2EAuthorization;
      readonly prDescription?: boolean;
    } = {},
  ): Promise<ReviewActionV2E2EFlow> {
    const authorized = input.authorization ?? (await this.authorize());
    const executionId = `${this.prefix}-execution-${randomUUID()}`;
    const workSlotId =
      input.workSlotId?.(executionId, 0) ?? progressSlotId(executionId, 0);
    const ownerIdHash = sha256(`${executionId}-owner`);
    const slotCount = input.slotCount ?? 1;
    const attachSlotCount = input.attachSlotCount ?? 1;
    const workSlots = Array.from({ length: slotCount }, (_, index) => ({
      attemptBudget: input.attemptBudget ?? 2,
      providerKind: ReviewExecutionProviderKind.Codex,
      providerVoteIdentityHash,
      required: true,
      retryPolicyVersion: "retry-v1",
      shardKey: `shard-${index}`,
      taskKind: ExecutionTaskKind.FindingDiscovery,
      workSlotId:
        input.workSlotId?.(executionId, index) ??
        progressSlotId(executionId, index),
    }));
    if (input.prDescription)
      workSlots.push({
        attemptBudget: 1,
        providerKind: ReviewExecutionProviderKind.Codex,
        providerVoteIdentityHash,
        required: false,
        retryPolicyVersion: "pr-description-no-replay.v1",
        shardKey: "description",
        taskKind: ExecutionTaskKind.PrDescription,
        workSlotId: `${executionId}-slot-description`,
      });
    const compatibilityKey = sha256(`${executionId}-compatibility`);
    const eligiblePaths = Array.from(
      { length: input.eligibleFileCount ?? slotCount },
      (_, index) => `src/review-file-${String(index).padStart(3, "0")}.ts`,
    );
    const assignmentManifestCanonicalJson = canonicalJson({
      assignments: workSlots.map((slot, index) => ({
        paths: eligiblePaths.filter(
          (_, pathIndex) =>
            (input.pathSlotIndex?.(pathIndex, slotCount) ??
              pathIndex % slotCount) === index,
        ),
        workSlotId: slot.workSlotId,
      })),
      eligiblePaths,
      excludedPaths: [],
      manifestVersion: 1,
      uncoveredPaths: [],
    });
    const assignmentManifestHash = sha256(
      canonicalReviewAssignmentManifestHashPreimage(
        assignmentManifestCanonicalJson,
      ),
    );
    const planHash = sha256(
      canonicalReviewExecutionPlanHashPreimage({
        assignmentManifestHash,
        compatibilityKey,
        reviewRevisionHash: authorized.reviewRevisionHash,
        workSlots,
      }),
    );
    const startRequest = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionStart,
      {
        ...envelope(`${executionId}-start`),
        authorizationToken: authorized.authorizationToken,
        idempotencyKey: `${executionId}-start-idempotency`,
        requestBodyHash: zeroHash,
        authorizationId: authorized.authorizationId,
        executionId,
        reviewRevisionHash: authorized.reviewRevisionHash,
        compatibilityKey,
        planHash,
        assignmentManifestCanonicalJson,
        assignmentManifestHash,
        workSlotsCanonicalJson: canonicalJson(workSlots),
        sourceRunId: authorized.sourceRunId ?? sourceRunId,
        sourceRunAttempt: authorized.sourceRunAttempt ?? "1",
      },
    );
    const started = await requiredHandler(
      this.routes.execution.start,
      "execution_start",
    ).execute(startRequest as ReviewExecutionStartRequest);
    if (
      started.result.status !== ReviewExecutionStartResultStatus.Admitted &&
      started.result.status !== ReviewExecutionStartResultStatus.Restored
    ) {
      throw new Error(`review_v2_e2e_start_failed:${started.result.status}`);
    }

    const scopeHash = sha256(
      canonicalJson({
        pullRequestNumber,
        repositoryConnectionId: this.repositoryConnectionId,
        scmRepositoryIdentityId: this.scmRepositoryIdentityId,
        workspaceId: this.workspaceId,
      }),
    );
    const manifest = providerManifest({
      executionId,
      producerReleaseId: this.producerReleaseId,
      scopeHash,
      selectedProtocolVersion: authorized.selectedProtocolVersion,
    });
    const identity = await buildProviderInvocationIdentity(digestPort, {
      manifest,
      providerVoteIdentityHash,
    });
    const manifestCanonicalJson =
      serializeProviderInvocationManifestCanonicalWireJson(manifest);
    const leaseRequest = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
      {
        ...envelope(`${executionId}-lease`),
        authorizationToken: authorized.authorizationToken,
        idempotencyKey: `${executionId}-lease-idempotency`,
        requestBodyHash: zeroHash,
        executionId,
        workSlotId,
        purpose: ReviewInvocationLeasePurpose.ProviderExecution,
        manifestCanonicalJson,
        manifestKey: identity.manifestKey,
        providerVoteIdentityHash,
        providerInvocationKey: identity.providerInvocationKey,
        acquireRequestId: `${executionId}-acquire`,
        ownerIdHash,
      },
    );
    const leased = await requiredHandler(
      this.routes.execution.acquireLease,
      "lease_acquire",
    ).execute(leaseRequest as ReviewInvocationLeaseAcquireRequest);
    if (leased.result.status !== ReviewInvocationLeaseResultStatus.Acquired) {
      throw new Error(`review_v2_e2e_lease_failed:${leased.result.status}`);
    }
    const leaseId = requiredString(leased.result.leaseId);
    const attemptId = requiredString(leased.result.attemptId);
    const leaseCapability = requiredString(leased.result.leaseCapability);
    const fencingToken = requiredString(leased.result.fencingToken);
    const payload: ReviewObservationPayload = {
      payloadVersion: reviewEvidencePayloadVersion,
      normalizedFindings: [],
      normalizedLifecycleRevalidations: [],
      safeUsage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    };
    const preparedPayload = prepareReviewObservationPayload(payload);
    const payloadCanonicalJson = canonicalJson(preparedPayload.payload);
    const payloadHash = await digestPort.digest(preparedPayload.canonicalBytes);
    const commitRequest = await withBodyHash(
      ReviewActionV2OperationId.ReviewEvidenceCommit,
      {
        ...envelope(`${executionId}-commit`),
        authorizationToken: authorized.authorizationToken,
        leaseCapability,
        idempotencyKey: `${executionId}-commit-idempotency`,
        requestBodyHash: zeroHash,
        attemptId,
        sourceLeaseId: leaseId,
        ownerIdHash,
        fencingToken,
        completionStatus: ProviderResultCompletionStatus.Success,
        schemaValidated: true,
        fullyConsumed: true,
        actualModel: "gpt-5-codex",
        contextDependencyAttestationId: null,
        contextDependencyAttestationHash: null,
        investigationCertificateId: null,
        investigationCertificateHash: null,
        payloadCanonicalJson,
        payloadHash,
        qualityFlags: [],
        transportAttemptCount: 1,
      },
    );
    const committed = await requiredHandler(
      this.routes.evidence.commit,
      "evidence_commit",
    ).execute(commitRequest as ReviewEvidenceCommitRequest);
    if (committed.result.status !== ReviewEvidenceCommitResultStatus.Accepted) {
      throw new Error(`review_v2_e2e_commit_failed:${committed.result.status}`);
    }
    const observationId = requiredString(committed.result.observationId);

    let streamVersion = requiredString(started.result.streamVersion);
    let executionVersion = requiredString(started.result.executionVersion);
    if (attachSlotCount > 0) {
      const attachRequest = await withBodyHash(
        ReviewActionV2OperationId.ReviewExecutionObservationAttach,
        {
          ...envelope(`${executionId}-attach`),
          authorizationToken: authorized.authorizationToken,
          leaseCapability,
          idempotencyKey: `${executionId}-attach-idempotency`,
          requestBodyHash: zeroHash,
          executionId,
          workSlotId,
          observationId,
          providerInvocationKey: identity.providerInvocationKey,
          providerVoteIdentityHash,
          payloadHash,
          byteCount: preparedPayload.byteCount,
          findingCount: preparedPayload.findingCount,
          eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
        },
      );
      const attached = await requiredHandler(
        this.routes.execution.attachObservation,
        "observation_attach",
      ).execute(attachRequest as ReviewExecutionObservationAttachRequest);
      if (
        attached.result.status !== ReviewExecutionMutationResultStatus.Applied
      ) {
        throw new Error(
          `review_v2_e2e_attach_failed:${attached.result.status}`,
        );
      }
      streamVersion = requiredString(attached.result.streamVersion);
      const persisted = await this.prisma.reviewExecutionV2.findUniqueOrThrow({
        where: { executionId },
        select: { version: true },
      });
      executionVersion = persisted.version.toString(10);
    }
    return {
      ...authorized,
      executionId,
      workSlotId,
      ownerIdHash,
      planHash,
      manifest,
      manifestCanonicalJson,
      manifestKey: identity.manifestKey,
      providerInvocationKey: identity.providerInvocationKey,
      leaseId,
      attemptId,
      leaseCapability,
      fencingToken,
      observationId,
      payloadHash,
      byteCount: preparedPayload.byteCount,
      findingCount: preparedPayload.findingCount,
      streamVersion,
      executionVersion,
    };
  }

  async lookup(flow: ReviewActionV2E2EFlow) {
    return requiredHandler(
      this.routes.evidence.lookup,
      "evidence_lookup",
    ).execute({
      ...envelope(`${flow.executionId}-lookup-${randomUUID()}`),
      authorizationToken: flow.authorizationToken,
      executionId: flow.executionId,
      workSlotId: flow.workSlotId,
      planHash: flow.planHash,
      manifestCanonicalJson: flow.manifestCanonicalJson,
      manifestKey: flow.manifestKey,
      providerInvocationKey: flow.providerInvocationKey,
      providerVoteIdentityHash,
    });
  }

  async attachCommittedObservation(flow: ReviewActionV2E2EFlow) {
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionObservationAttach,
      {
        ...envelope(`${flow.executionId}-attach`),
        authorizationToken: flow.authorizationToken,
        leaseCapability: flow.leaseCapability,
        idempotencyKey: `${flow.executionId}-attach-idempotency`,
        requestBodyHash: zeroHash,
        executionId: flow.executionId,
        workSlotId: flow.workSlotId,
        observationId: flow.observationId,
        providerInvocationKey: flow.providerInvocationKey,
        providerVoteIdentityHash,
        payloadHash: flow.payloadHash,
        byteCount: flow.byteCount,
        findingCount: flow.findingCount,
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      },
    );
    return requiredHandler(
      this.routes.execution.attachObservation,
      "observation_attach",
    ).execute(request as ReviewExecutionObservationAttachRequest);
  }

  async releaseProviderLease(flow: ReviewActionV2E2EFlow) {
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseRelease,
      {
        ...envelope(`${flow.executionId}-release-after-commit`),
        leaseCapability: flow.leaseCapability,
        idempotencyKey: `${flow.executionId}-release-after-commit-idempotency`,
        requestBodyHash: zeroHash,
        leaseId: flow.leaseId,
        ownerIdHash: flow.ownerIdHash,
        fencingToken: flow.fencingToken,
        releaseRequestId: `${flow.executionId}-release-after-commit`,
      },
    );
    return requiredHandler(
      this.routes.execution.releaseLease,
      "lease_release",
    ).execute(request as ReviewInvocationLeaseReleaseRequest);
  }

  async adoptCommittedObservation(flow: ReviewActionV2E2EFlow) {
    const execution = await this.prisma.reviewExecutionV2.findUniqueOrThrow({
      where: { executionId: flow.executionId },
      select: { generation: true, version: true },
    });
    const stream = await this.prisma.reviewExecutionStreamV2.findUniqueOrThrow({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          {
            workspaceId: this.workspaceId,
            repositoryConnectionId: this.repositoryConnectionId,
            scmRepositoryIdentityId: this.scmRepositoryIdentityId,
            pullRequestNumber,
          },
      },
      select: { version: true },
    });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionObservationAdopt,
      {
        ...envelope(`${flow.executionId}-adopt-after-restart`),
        authorizationToken: flow.authorizationToken,
        idempotencyKey: `${flow.executionId}-adopt-after-restart-idempotency`,
        requestBodyHash: zeroHash,
        executionId: flow.executionId,
        executionGeneration: execution.generation.toString(10),
        expectedStreamVersion: stream.version.toString(10),
        expectedExecutionVersion: execution.version.toString(10),
        workSlotId: flow.workSlotId,
        observationId: flow.observationId,
        providerInvocationKey: flow.providerInvocationKey,
        providerVoteIdentityHash,
        payloadHash: flow.payloadHash,
        byteCount: flow.byteCount,
        findingCount: flow.findingCount,
        sourceLeaseId: flow.leaseId,
        sourceFencingToken: flow.fencingToken,
        manifestCanonicalJson: flow.manifestCanonicalJson,
        manifestKey: flow.manifestKey,
        planHash: flow.planHash,
        reviewRevisionHash: flow.reviewRevisionHash,
        ownerIdHash: flow.ownerIdHash,
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      },
    );
    const response = await this.executeObservationAdoption(
      request as ReviewExecutionObservationAdoptRequest,
    );
    return { request, response } as const;
  }

  async replayObservationAdoption(
    request: ReviewExecutionObservationAdoptRequest,
  ) {
    return this.executeObservationAdoption(request);
  }

  async replayCommit(flow: ReviewActionV2E2EFlow) {
    const observation =
      await this.prisma.reviewEvidenceObservation.findUniqueOrThrow({
        where: { observationId: flow.observationId },
      });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewEvidenceCommit,
      {
        ...envelope(`${flow.executionId}-commit`),
        authorizationToken: flow.authorizationToken,
        leaseCapability: flow.leaseCapability,
        idempotencyKey: `${flow.executionId}-commit-idempotency`,
        requestBodyHash: zeroHash,
        attemptId: flow.attemptId,
        sourceLeaseId: flow.leaseId,
        ownerIdHash: flow.ownerIdHash,
        fencingToken: flow.fencingToken,
        completionStatus: ProviderResultCompletionStatus.Success,
        schemaValidated: true,
        fullyConsumed: true,
        actualModel: observation.actualModel,
        contextDependencyAttestationId:
          observation.contextDependencyAttestationId,
        contextDependencyAttestationHash:
          observation.contextDependencyAttestationHash,
        investigationCertificateId: observation.investigationCertificateId,
        investigationCertificateHash: observation.investigationCertificateHash,
        payloadCanonicalJson: canonicalJson(observation.payloadJson),
        payloadHash: observation.payloadHash,
        qualityFlags: [],
        transportAttemptCount: observation.transportAttemptCount,
      },
    );
    return requiredHandler(
      this.routes.evidence.commit,
      "evidence_commit",
    ).execute(request as ReviewEvidenceCommitRequest);
  }

  async finalize(
    flow: ReviewActionV2E2EFlow,
    options: {
      readonly allowPartial?: boolean;
      readonly prDescription?: GeneratedPrDescription;
      readonly investigation?: {
        readonly observationId: string;
        readonly findings: ReviewObservationPayload["normalizedFindings"];
      };
    } = {},
  ) {
    const allowPartial = options.allowPartial ?? false;
    const findings = options.investigation?.findings ?? [];
    const hasFindings = findings.length > 0;
    const lifecycleStateHash = sha256(`${flow.executionId}-lifecycle`);
    const commandLedgerWatermark = "0";
    const projection = {
      ...(options.investigation
        ? {
            authoritativeObservationIds: [options.investigation.observationId],
          }
        : {}),
      commandLedgerWatermark,
      coverage: { state: allowPartial ? "partial" : "complete" },
      envelopeVersion: "review_projection.v1",
      lifecycleStateHash,
      mergeGate: {
        conclusion: hasFindings
          ? "failure"
          : allowPartial
            ? "neutral"
            : "success",
      },
      occurrences: findings.map((finding) => ({
        lineageId: finding.normalizedFailureModeHash,
        state: "new",
        observationIds: [options.investigation!.observationId],
        providerVoteKeys: [providerVoteIdentityHash],
        placement: { kind: "summary" },
        title: finding.title,
        message: finding.message,
        evidence: finding.evidence,
      })),
      projectionPolicyVersion: reviewActionV2ProjectionPolicyVersion,
      publishing: {
        ...(options.prDescription
          ? { prDescription: options.prDescription }
          : {}),
        check: {
          conclusion: hasFindings ? "failure" : "success",
          marker: `<!-- ${flow.executionId}:check -->`,
          name: "ReviewRouter",
          summary: "Review complete",
          title: "Review complete",
        },
        inlineReviewChunks: [],
        lifecycle: [],
        summary: {
          allClear: !allowPartial && !hasFindings,
          body: hasFindings
            ? `Investigation Findings\n${findings.map((finding) => `${finding.title}: ${finding.message}`).join("\n")}`
            : allowPartial
              ? "Partial review"
              : "Review complete",
          marker: `<!-- ${flow.executionId}:summary -->`,
          occurrenceCounts: {
            new: findings.length,
            reconfirmed: 0,
            changed: 0,
            carried_unverified: 0,
            resolved: 0,
            uncertain: 0,
            suppressed_by_human: 0,
          },
        },
      },
      scope: {
        baseSha,
        pullRequestNumber,
        reviewRevisionHash: flow.reviewRevisionHash,
        reviewedHeadSha: headSha,
        scmRepositoryIdentityId: this.scmRepositoryIdentityId,
      },
      snapshot: { lineageHints: [] },
    };
    const projectionEnvelopeCanonicalJson = canonicalJson(projection);
    const projectionHash = sha256(projectionEnvelopeCanonicalJson);
    const operationsCanonicalJson = canonicalJson(projection.publishing);
    const artifactHash = sha256(
      `rr.review-artifact.v1\0${canonicalJson({ operationsCanonicalJson, projectionHash })}`,
    );
    const artifactId = `rr:artifact:${artifactHash}`;
    const versions = await this.prisma.reviewExecutionV2.findUniqueOrThrow({
      where: { executionId: flow.executionId },
      select: { version: true },
    });
    const stream = await this.prisma.reviewExecutionStreamV2.findUniqueOrThrow({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          {
            workspaceId: this.workspaceId,
            repositoryConnectionId: this.repositoryConnectionId,
            scmRepositoryIdentityId: this.scmRepositoryIdentityId,
            pullRequestNumber,
          },
      },
      select: { version: true },
    });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionFinalize,
      {
        ...envelope(`${flow.executionId}-finalize`),
        authorizationToken: flow.authorizationToken,
        idempotencyKey: `${flow.executionId}-finalize-idempotency`,
        requestBodyHash: zeroHash,
        executionId: flow.executionId,
        expectedStreamVersion: stream.version.toString(10),
        expectedExecutionVersion: versions.version.toString(10),
        artifactId,
        artifactHash,
        projectionEnvelopeVersion: 1,
        projectionEnvelopeCanonicalJson,
        projectionHash,
        lifecycleStateHash,
        commandLedgerWatermark,
        allowPartial,
      },
    );
    return requiredHandler(
      this.routes.execution.finalize,
      "execution_finalize",
    ).execute(request as ReviewExecutionFinalizeRequest);
  }

  async processFinalizedOutbox(
    input: {
      readonly handlers?: readonly OutboxHandler[];
      readonly takeoverEnabled?: boolean;
    } = {},
  ) {
    return processOutboxBatch(
      {
        limit: 20,
        handlers: input.handlers ?? this.worker.handlers,
        knownHandlers: this.knownOutboxHandlers,
        claimOwnerHash: sha256(`${this.prefix}-outbox-owner`),
        processingLeaseMs: 100,
        heartbeatIntervalMs: 50,
        takeoverEnabled: input.takeoverEnabled ?? true,
      },
      {
        outbox: new PrismaOutboxEventRepository(this.prisma),
        clock: new SystemClock(),
      },
    );
  }

  async runWorkerUntilSettled(maxPasses = 12): Promise<void> {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      await this.worker.runMaintenance();
      const active = await this.prisma.reviewCompletionProcess.count({
        where: {
          state: {
            in: [
              "pending_publication",
              "awaiting_publication",
              "pending_snapshot",
            ],
          },
        },
      });
      if (active === 0) return;
    }
    throw new Error("review_v2_e2e_worker_did_not_settle");
  }

  async captureProgress(executionId: string): Promise<void> {
    const snapshot = await new PrismaReviewExecutionStore(
      this.prisma,
    ).findExecution(executionId);
    if (!snapshot) throw new Error("review_v2_e2e_execution_missing");
    const capture = createPrismaReviewProgressCapture({
      fileCoverageEnabled: true,
    });
    await this.prisma.$transaction((transaction) =>
      capture(transaction, snapshot.execution),
    );
  }

  async publishProgress(): Promise<unknown> {
    const runtime = createProductionReviewV2WorkerRuntime({
      prisma: this.prisma,
      clock: new SystemClock(),
      env: {
        ...this.env,
        REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE: "1",
        REVIEW_ROUTER_PROGRESS_FILE_COVERAGE: "1",
        REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES: "1",
        REVIEW_ROUTER_PROGRESS_REPOSITORIES: `${owner}/${repo}`,
        REVIEW_ROUTER_PROGRESS_MIN_MUTATION_INTERVAL_MS: "1",
      },
      githubAppId: requiredString(this.env.GITHUB_APP_ID),
      githubPrivateKey: requiredString(this.env.GITHUB_APP_PRIVATE_KEY),
      settlementHook: createReviewStatisticsSettlementCapture(
        this.statistics.outboxWriter,
      ),
    });
    return runtime.progress?.runMaintenance();
  }

  async readProgressPublication(): Promise<unknown> {
    return this.prisma.reviewProgressPublicationV1.findUnique({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          {
            workspaceId: this.workspaceId,
            repositoryConnectionId: this.repositoryConnectionId,
            scmRepositoryIdentityId: this.scmRepositoryIdentityId,
            pullRequestNumber,
          },
      },
      select: {
        desiredVersion: true,
        publishedVersion: true,
        failureCount: true,
        lastErrorCode: true,
      },
    });
  }

  async setProgressFixture(input: {
    readonly executionId: string;
    readonly completed: number;
    readonly retrying?: number;
    readonly recovered?: number;
    readonly exhausted?: number;
    readonly retriedSlotIndexes?: readonly number[];
  }): Promise<void> {
    const execution = await this.prisma.reviewExecutionV2.findUniqueOrThrow({
      where: { executionId: input.executionId },
      select: { generation: true, version: true },
    });
    const slots = await this.prisma.reviewExecutionWorkSlotV2.findMany({
      where: { executionId: input.executionId },
      orderBy: { planOrdinal: "asc" },
    });
    const retrying = input.retrying ?? 0;
    const recovered = input.recovered ?? 0;
    const exhausted = input.exhausted ?? 0;
    const retriedSlotIndexes = new Set(
      input.retriedSlotIndexes ?? [
        ...Array.from({ length: recovered }, (_, index) =>
          Math.max(0, input.completed - recovered + index),
        ),
        ...Array.from(
          { length: retrying },
          (_, index) => input.completed + index,
        ),
      ],
    );
    const exhaustedSlotIndexes = new Set(
      slots
        .map((_, index) => index)
        .filter(
          (index) => index >= input.completed && !retriedSlotIndexes.has(index),
        )
        .slice(0, exhausted),
    );
    if (
      input.completed < recovered ||
      retriedSlotIndexes.size < recovered ||
      input.completed + retrying + exhausted > slots.length
    ) {
      throw new Error("review_v2_e2e_progress_fixture_invalid");
    }
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.reviewInvocationLeaseV2.deleteMany({
        where: { executionId: input.executionId },
      });
      for (const [index, slot] of slots.entries()) {
        const retried = retriedSlotIndexes.has(index);
        const state =
          index < input.completed
            ? "satisfied"
            : retried
              ? "leased"
              : exhaustedSlotIndexes.has(index)
                ? "exhausted"
                : "pending";
        await transaction.reviewExecutionWorkSlotV2.update({
          where: {
            executionId_workSlotId: {
              executionId: input.executionId,
              workSlotId: slot.workSlotId,
            },
          },
          data: {
            state,
            nextAttemptOrdinal: state === "pending" ? 1 : 3,
            activeLeaseId: null,
            acceptedObservationRefId:
              state === "satisfied" ? `${slot.workSlotId}-accepted` : null,
          },
        });
        if ((state === "satisfied" && retried) || state === "leased") {
          await transaction.reviewInvocationLeaseV2.create({
            data: progressLeaseFixture({
              executionId: input.executionId,
              executionGeneration: execution.generation,
              index,
              slot,
              workspaceId: this.workspaceId,
              repositoryConnectionId: this.repositoryConnectionId,
              scmRepositoryIdentityId: this.scmRepositoryIdentityId,
              now,
              active: false,
            }),
          });
        }
      }
      await transaction.reviewExecutionV2.update({
        where: { executionId: input.executionId },
        data: { version: execution.version + 1n, updatedAt: now },
      });
    });
    await this.captureProgress(input.executionId);
  }

  async terminalizeProgressSlot(
    executionId: string,
    workSlotIndex: number,
  ): Promise<void> {
    const snapshot = await new PrismaReviewExecutionStore(
      this.prisma,
    ).findExecution(executionId);
    const slot = snapshot?.execution.workSlots[workSlotIndex];
    if (!snapshot || !slot) throw new Error("review_v2_e2e_slot_missing");
    const store = new PrismaReviewExecutionStore(this.prisma, {
      progressCapture: createPrismaReviewProgressCapture({
        fileCoverageEnabled: true,
      }),
    });
    const result = await store.terminalizeWorkSlot({
      scope: {
        workspaceId: this.workspaceId,
        repositoryConnectionId: this.repositoryConnectionId,
        scmRepositoryIdentityId: this.scmRepositoryIdentityId,
        pullRequestNumber,
      },
      executionId,
      generation: snapshot.execution.generation,
      reviewRevisionHash: snapshot.execution.revision.reviewRevisionHash,
      workSlotId: slot.workSlotId,
      terminalState: ReviewWorkSlotState.Exhausted,
      reasonCode: ExecutionWorkSlotTerminalReason.AttemptBudgetExhausted,
      now: new Date(),
    });
    if (result.status !== "applied") {
      throw new Error(`review_v2_e2e_terminalize_failed:${result.status}`);
    }
  }

  async setExecutionProgressState(
    executionId: string,
    state: "completed" | "partial" | "failed",
  ): Promise<void> {
    const execution = await this.prisma.reviewExecutionV2.findUniqueOrThrow({
      where: { executionId },
      select: { version: true },
    });
    await this.prisma.reviewExecutionV2.update({
      where: { executionId },
      data: {
        state,
        version: execution.version + 1n,
        updatedAt: new Date(),
      },
    });
    await this.captureProgress(executionId);
  }

  async makeProgressDue(): Promise<void> {
    const now = new Date(Date.now() - 1_000);
    await this.prisma.reviewProgressPublicationV1.updateMany({
      where: {
        workspaceId: this.workspaceId,
        repositoryConnectionId: this.repositoryConnectionId,
        scmRepositoryIdentityId: this.scmRepositoryIdentityId,
        pullRequestNumber,
      },
      data: {
        nextPublishAt: now,
        claimId: null,
        claimOwnerIdHash: null,
        claimUntil: null,
      },
    });
    await this.prisma.reviewProgressInstallationBudgetV1.updateMany({
      where: { githubInstallationId: BigInt(githubInstallationId) },
      data: { nextMutationAt: now, cooldownUntil: null, updatedAt: now },
    });
  }

  async promoteProgress(
    executionId: string,
    outcome: "succeeded" | "failed" | "superseded",
  ): Promise<number> {
    return new PrismaReviewProgressPublicationStore(
      this.prisma,
    ).promoteSettledExecutions({
      settlements: [{ executionId, outcome }],
      now: new Date(),
    });
  }

  async deadLetterAndRecoverFinalizedEvent(): Promise<void> {
    const permanentFailure: OutboxHandler = {
      type: reviewExecutionFinalizedEventType,
      version: reviewExecutionFinalizedEventVersion,
      async handle() {
        throw new OutboxHandlerError(
          "Injected permanent failure",
          "e2e_injected_permanent_failure",
          false,
        );
      },
    };
    const result = await this.processFinalizedOutbox({
      handlers: [permanentFailure],
    });
    if (result.deadLettered !== 1) {
      throw new Error("review_v2_e2e_dead_letter_not_created");
    }
    const event = await this.prisma.outboxEvent.findFirstOrThrow({
      where: {
        workspaceId: this.workspaceId,
        type: reviewExecutionFinalizedEventType,
        status: "dead_letter",
      },
      orderBy: { occurredAt: "desc" },
    });
    const recovered = await retryDeadLetterOutboxEvent(
      {
        workspaceId: this.workspaceId,
        eventId: event.id,
      },
      {
        outbox: new PrismaOutboxEventRepository(this.prisma),
        clock: new SystemClock(),
      },
    );
    if (recovered.status !== "queued") {
      throw new Error(`review_v2_e2e_dead_letter_recovery:${recovered.status}`);
    }
    const processed = await this.processFinalizedOutbox();
    if (processed.processed !== 1) {
      throw new Error("review_v2_e2e_recovered_event_not_processed");
    }
  }

  async forceStaleOutboxClaim(): Promise<void> {
    const outbox = new PrismaOutboxEventRepository(this.prisma);
    const claimed = await outbox.claimDue({
      limit: 1,
      now: new Date(),
      claimOwnerHash: sha256(`${this.prefix}-abandoned-owner`),
      claimForMs: 1,
      availableHandlers: this.worker.handlers,
      knownHandlers: this.knownOutboxHandlers,
    });
    if (claimed.length !== 1) {
      throw new Error("review_v2_e2e_stale_claim_not_acquired");
    }
    await this.prisma.outboxEvent.update({
      where: { id: claimed[0]!.id },
      data: { claimUntil: new Date(Date.now() - 1_000) },
    });
  }

  async forceStalePublicationClaim(): Promise<{
    readonly publicationAttemptId: string;
    readonly claimId: string;
    readonly fencingToken: bigint;
  }> {
    const attempt =
      await this.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
        where: { workspaceId: this.workspaceId },
        orderBy: { createdAt: "desc" },
      });
    const now = new Date();
    const claimId = `${this.prefix}-abandoned-publication-claim`;
    const requestIdentity = sha256(`${claimId}-request`);
    const repository = new PrismaReviewPublicationRepository(this.prisma);
    const claimed = await repository.claim({
      publicationAttemptId: attempt.publicationAttemptId,
      expectedAttemptVersion: attempt.version,
      claimId,
      ownerIdHash: sha256(`${claimId}-owner`),
      acquireRequestIdHash: requestIdentity,
      requestHash: sha256(`${claimId}-body`),
      claimCapabilityId: `${claimId}-capability`,
      capabilitySigningKeyId: capabilityKeyId,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + 1_000),
      reportUntil: new Date(now.getTime() + 2_000),
      retainUntil: attempt.retainUntil,
    });
    if (claimed.status !== ClaimReviewPublicationStatus.Acquired) {
      throw new Error(
        `review_v2_e2e_publication_claim_not_acquired:${claimed.status}`,
      );
    }
    await this.prisma.reviewPublicationClaimTermV2.update({
      where: { claimId },
      data: {
        acquiredAt: new Date(Date.now() - 2_000),
        renewedAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    return {
      publicationAttemptId: attempt.publicationAttemptId,
      claimId,
      fencingToken: claimed.claim.fencingToken,
    };
  }

  setRevision(revision: FakeGitHubRevision): void {
    this.fakeGitHub.revision = revision;
  }

  async readPersistedCurrentRevision(): Promise<
    FakeGitHubRevision & { readonly reviewRevisionHash: string }
  > {
    const stream = await this.prisma.reviewExecutionStreamV2.findUniqueOrThrow({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          {
            workspaceId: this.workspaceId,
            repositoryConnectionId: this.repositoryConnectionId,
            scmRepositoryIdentityId: this.scmRepositoryIdentityId,
            pullRequestNumber,
          },
      },
      select: {
        currentBaseSha: true,
        currentMergeBaseSha: true,
        currentHeadSha: true,
        currentReviewRevisionHash: true,
      },
    });
    return {
      baseSha: requiredString(stream.currentBaseSha),
      mergeBaseSha: requiredString(stream.currentMergeBaseSha),
      headSha: requiredString(stream.currentHeadSha),
      reviewRevisionHash: requiredString(stream.currentReviewRevisionHash),
    };
  }

  async movePersistedCurrentRevision(input: {
    readonly headSha: string;
    readonly reviewRevisionHash: string;
  }): Promise<void> {
    await this.prisma.reviewExecutionStreamV2.update({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          {
            workspaceId: this.workspaceId,
            repositoryConnectionId: this.repositoryConnectionId,
            scmRepositoryIdentityId: this.scmRepositoryIdentityId,
            pullRequestNumber,
          },
      },
      data: {
        currentHeadSha: input.headSha,
        currentReviewRevisionHash: input.reviewRevisionHash,
        updatedAt: new Date(),
      },
    });
  }

  get generatedOidcTokenCount(): number {
    return this.oidcOrdinal;
  }

  /** A real signed fixture token for the compiled Action's normal authorize call. */
  async createOidcToken(): Promise<string> {
    return this.signOidcToken(
      this.fakeGitHub.sourceRunAttempt,
      Math.floor(Date.now() / 1000) + this.oidcLifetimeSeconds,
    );
  }

  private async signOidcToken(
    runAttempt: string,
    expiresAt: number,
    providerApiAuthMode?: ProviderApiAuthMode,
  ): Promise<string> {
    this.oidcOrdinal += 1;
    const keyPair = oidcSigningKeys.get(this.fakeGitHub.options.oidcKeyId);
    if (!keyPair) throw new Error("review_v2_e2e_oidc_signing_key_missing");
    return new SignJWT({
      sub: `repo:${owner}/${repo}:pull_request`,
      repository: `${owner}/${repo}`,
      repository_id: githubRepositoryId,
      repository_owner: owner,
      event_name: "workflow_dispatch",
      ref: "refs/heads/main",
      run_id: this.fakeGitHub.sourceRunId,
      run_attempt: runAttempt,
      workflow_ref: `${owner}/${repo}/.github/workflows/${this.modelTransport === "account_gateway" || providerApiAuthMode || this.subscriptionAuthMode ? "reviewrouter-review.yml" : "reviewrouter-codex.yml"}@refs/heads/main`,
      workflow_sha: this.fakeGitHub.revision.headSha,
      job_workflow_ref:
        this.modelTransport === "account_gateway"
          ? "777genius/review-router/.github/workflows/reviewrouter-runtime.yml@refs/tags/workflow-v1"
          : `777genius/review-router/.github/workflows/reviewrouter-execution-reusable.yml@${this.actionCommitSha}`,
      job_workflow_sha: this.actionCommitSha,
      actor: "reviewrouter-e2e",
      jti: `${this.prefix}-oidc-${this.oidcOrdinal}`,
    })
      .setProtectedHeader({
        alg: "RS256",
        kid: this.fakeGitHub.options.oidcKeyId,
      })
      .setIssuer("https://token.actions.githubusercontent.com")
      .setAudience(requiredString(this.env.REVIEW_ROUTER_ACTION_OIDC_AUDIENCE))
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(keyPair.privateKey);
  }

  private async executeObservationAdoption(
    request: ReviewExecutionObservationAdoptRequest,
  ) {
    return requiredHandler(
      this.routes.execution.adoptObservation,
      "observation_adopt",
    ).execute(request);
  }
}

const oidcSigningKeys = new Map<
  string,
  ReturnType<typeof generateKeyPairSync>
>();

type HistoryFixtureCleanupInput = {
  prisma: PrismaClient;
  prefix: string;
  workspaceId: string;
  repositoryConnectionId: string;
  scmRepositoryIdentityId: string;
  producerReleaseId: string;
  protocolLimitsProfileId: string;
  operationalSloProfileId: string;
  borrowedWorkspace: boolean;
  originalEmergencyControl: EmergencyControlSnapshot | null;
  originalHistoryCoverage: Date | null;
  originalStatisticsCoverage: Date | null;
};

/** One child-first cleanup serves successful and partially constructed fixtures. */
async function cleanupHistoryFixtureRows(
  input: HistoryFixtureCleanupInput,
): Promise<void> {
  await input.prisma.$transaction(
    async (tx) => {
      const executions = (
        await tx.reviewExecutionV2.findMany({
          where: { repositoryConnectionId: input.repositoryConnectionId },
          select: { executionId: true },
        })
      ).map((row) => row.executionId);
      const authorizations = (
        await tx.reviewRunAuthorization.findMany({
          where: { repositoryConnectionId: input.repositoryConnectionId },
          select: { authorizationId: true },
        })
      ).map((row) => row.authorizationId);
      const publications = (
        await tx.reviewPublicationAttemptV2.findMany({
          where: { repositoryConnectionId: input.repositoryConnectionId },
          select: { publicationAttemptId: true },
        })
      ).map((row) => row.publicationAttemptId);
      await tx.outboxEvent.deleteMany({
        where: { repositoryId: input.repositoryConnectionId },
      });
      await tx.reviewCompletionProcess.deleteMany({
        where: { executionId: { in: executions } },
      });
      // These fixed fixture tables have RESTRICT relationships; child-first
      // deletion uses the exact owned publication IDs, never a database reset.
      for (const table of [
        "ReviewPublicationOutcomeCorrectionV2",
        "ReviewPublicationAuditTombstoneV2",
        "ReviewPublicationReceiptV2",
        "ReviewPublicationExternalEffectV2",
        "ReviewPublicationOperationAttemptV2",
        "ReviewPublicationOperationV2",
        "ReviewPublicationClaimTermV2",
        "ReviewPublicationRequestReceiptV2",
      ])
        await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "publicationAttemptId" = ANY($1::text[])`,
          publications,
        );
      await tx.reviewPublicationAttemptV2.deleteMany({
        where: { publicationAttemptId: { in: publications } },
      });
      await tx.reviewSnapshotCommitReceiptV2.deleteMany({
        where: { sourceExecutionId: { in: executions } },
      });
      await tx.reviewSnapshot.deleteMany({
        where: { repositoryId: input.repositoryConnectionId },
      });
      await tx.finalizedReviewProjectionArtifactV2.deleteMany({
        where: { executionId: { in: executions } },
      });
      await tx.reviewExecutionObservationRefV2.deleteMany({
        where: { executionId: { in: executions } },
      });
      await tx.reviewRunCompanionDispatchV1.deleteMany({
        where: { authorizationId: { in: authorizations } },
      });
      await tx.reviewInvocationLeaseTombstoneV2.deleteMany({
        where: { authorizationId: { in: authorizations } },
      });
      await tx.reviewInvocationLeaseV2.deleteMany({
        where: { executionId: { in: executions } },
      });
      await tx.reviewExecutionWorkSlotV2.deleteMany({
        where: { executionId: { in: executions } },
      });
      await tx.reviewRequestedIntent.deleteMany({
        where: { repositoryConnectionId: input.repositoryConnectionId },
      });
      await tx.reviewExecutionProgressV1.deleteMany({
        where: { executionId: { in: executions } },
      });
      await tx.reviewProgressPublicationV1.deleteMany({
        where: { repositoryConnectionId: input.repositoryConnectionId },
      });
      await tx.reviewExecutionV2.deleteMany({
        where: { executionId: { in: executions } },
      });
      await tx.reviewExecutionStreamV2.deleteMany({
        where: { repositoryConnectionId: input.repositoryConnectionId },
      });
      await tx.reviewEvidenceObservation.deleteMany({
        where: { repositoryConnectionId: input.repositoryConnectionId },
      });
      await tx.reviewRunAuthorizationRenewalReceipt.deleteMany({
        where: { authorizationId: { in: authorizations } },
      });
      await tx.reviewRunAuthorization.deleteMany({
        where: { authorizationId: { in: authorizations } },
      });
      await tx.reviewHistoryRun.deleteMany({
        where: {
          originalRepositoryConnectionId: input.repositoryConnectionId,
        },
      });
      await tx.reviewHistoryPullRequest.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          scmRepositoryIdentityId: input.scmRepositoryIdentityId,
        },
      });
      await tx.reviewThreadResolutionGuardV1.deleteMany({
        where: { repositoryConnectionId: input.repositoryConnectionId },
      });
      await tx.reviewSafetyPolicy.deleteMany({
        where: { policyId: { startsWith: `${input.prefix}-policy-` } },
      });
      await tx.reviewMutationAuthority.deleteMany({
        where: { scmRepositoryIdentityId: input.scmRepositoryIdentityId },
      });
      await tx.scmRepositoryIdentity.updateMany({
        where: { scmRepositoryIdentityId: input.scmRepositoryIdentityId },
        data: {
          currentRepositoryConnectionId: null,
          currentWorkspaceId: null,
        },
      });
      await tx.repositoryConnection.deleteMany({
        where: { id: input.repositoryConnectionId },
      });
      await tx.scmRepositoryIdentity.deleteMany({
        where: { scmRepositoryIdentityId: input.scmRepositoryIdentityId },
      });
      await tx.gitHubInstallation.deleteMany({
        where: { id: `${input.prefix}-installation` },
      });
      // Borrowing requires a new, unconfigured test workspace. The fixture owns
      // exactly the workspace policy it installed, as well as its repository.
      await tx.reviewConfiguration.deleteMany({
        where: { workspaceId: input.workspaceId },
      });
      await tx.producerRelease.deleteMany({
        where: { producerReleaseId: input.producerReleaseId },
      });
      await tx.reviewProtocolLimitsV2.deleteMany({
        where: { protocolLimitsProfileId: input.protocolLimitsProfileId },
      });
      await tx.reviewOperationalSloProfileV2.deleteMany({
        where: { operationalSloProfileId: input.operationalSloProfileId },
      });
      if (!input.borrowedWorkspace)
        await tx.workspace.deleteMany({ where: { id: input.workspaceId } });
      if (input.originalEmergencyControl)
        await tx.reviewSafetyEmergencyControl.update({
          where: { emergencyControlId: "global-review-v2" },
          data: input.originalEmergencyControl,
        });
      if (input.originalHistoryCoverage === null)
        await tx.reviewHistoryCoverage.deleteMany({
          where: { id: "capture_v1" },
        });
      if (input.originalStatisticsCoverage === null)
        await tx.reviewStatisticsCoverage.deleteMany({
          where: { id: "capture_v1" },
        });
    },
    { timeout: 30_000 },
  );
}

export async function createReviewActionV2E2EHarness(
  databaseUrl: string,
  options: ReviewActionV2E2EHarnessOptions = {},
): Promise<ReviewActionV2E2EHarness> {
  return ReviewActionV2E2EHarness.create(databaseUrl, options);
}

export async function resetReviewActionV2E2EDatabase(
  databaseUrl: string,
): Promise<void> {
  assertDisposableDatabaseUrl(databaseUrl);
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "OutboxEvent",
        "ReviewCompletionProcess",
        "ReviewPublicationOutcomeCorrectionV2",
        "ReviewPublicationAuditTombstoneV2",
        "ReviewPublicationReceiptV2",
        "ReviewPublicationExternalEffectV2",
        "ReviewPublicationOperationAttemptV2",
        "ReviewPublicationOperationV2",
        "ReviewPublicationClaimTermV2",
        "ReviewPublicationRequestReceiptV2",
        "ReviewPublicationAttemptV2",
        "ReviewSnapshotCommitReceiptV2",
        "FinalizedReviewProjectionArtifactV2",
        "ReviewExecutionObservationRefV2",
        "ReviewInvocationLeaseTombstoneV2",
        "ReviewInvocationLeaseV2",
        "ReviewExecutionWorkSlotV2",
        "ReviewExecutionV2",
        "ReviewExecutionStreamV2",
        "ReviewRequestedIntent",
        "ReviewEvidenceObservation",
        "ReviewRunCompanionDispatchV1",
        "ReviewThreadResolutionGuardV1",
        "ReviewRunAuthorizationRenewalReceipt",
        "ReviewRunAuthorization",
        "ReviewSafetyPolicySelector",
        "ReviewSafetyPolicy",
        "ReviewSafetyEmergencyControl",
        "ReviewMutationAuthority",
        "ScmRepositoryIdentity",
        "ProducerRelease",
        "ReviewOperationalSloProfileV2",
        "ReviewProtocolLimitsV2",
        "ReviewSnapshot",
        "RepositoryConnection",
        "GitHubInstallation",
        "Workspace"
      RESTART IDENTITY CASCADE
    `);
    await prisma.reviewSafetyEmergencyControl.create({
      data: {
        emergencyControlId: "global-review-v2",
        policyScope: "global",
        workspaceId: null,
        repositoryConnectionId: null,
        scmRepositoryIdentityId: null,
        version: 1,
        stopped: true,
        reason: "review_v2_not_promoted",
        updatedBy: "migration:000029",
        updatedAt: new Date(),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

export function permanentOutboxFailureHandler(): OutboxHandler {
  return {
    type: reviewExecutionFinalizedEventType,
    version: reviewExecutionFinalizedEventVersion,
    async handle() {
      throw new OutboxHandlerError(
        "Injected permanent failure",
        "e2e_injected_permanent_failure",
        false,
      );
    },
  };
}

async function seedProductionControlPlane(
  prisma: PrismaClient,
  ids: Readonly<{
    releaseCandidate?: ProducerReleaseCandidate;
    prefix: string;
    workspaceId: string;
    borrowedWorkspace: boolean;
    repositoryConnectionId: string;
    scmRepositoryIdentityId: string;
    producerReleaseId: string;
    protocolLimitsProfileId: string;
    operationalSloProfileId: string;
    investigationProfile?: ReviewActionV2E2EInvestigationProfile;
    protocolMaxAttemptsPerSlot?: number;
    agentProfiles?: readonly ReviewAgentProfile[];
    reviewerPlanProfile?: Readonly<{
      planVersion: 1;
      descriptorDigest: string;
    }>;
    prDescriptionProfile?: boolean;
    lifecycleVerificationProfile?: boolean;
    modelDispatchProfile?: ReviewModelDispatchProfileV2;
    repositoryProviderSelection: "rotating" | "none";
  }>,
): Promise<void> {
  const now = new Date();
  const limits: ReviewProtocolLimits = {
    maxWorkSlots: 200,
    maxAttemptsPerSlot: ids.protocolMaxAttemptsPerSlot ?? 4,
    maxObservationBytes: 1_000_000,
    maxObservationFindings: 1_000,
    maxProjectionBytes: 1_000_000,
    maxProjectionFindings: 1_000,
    maxPublicationOperations: 100,
    maxPublicationChunks: 100,
    maxPublicationBodyBytes: 1_000_000,
    maxRequestBatchSize: 100,
    maxLeaseDurationMs: 300_000,
    maxResultReportDurationMs: 600_000,
    maxReconciliationDurationMs: 600_000,
  };
  const slos: ReviewOperationalSloThresholds = {
    integrationEventDeliveryMs: 1_000,
    outboxClaimAgeMs: 1_000,
    missingCompletionProcessMs: 1_000,
    dueCompletionProcessMs: 1_000,
    publicationReconciliationMs: 1_000,
    v1DrainMs: 1_000,
    admissionMs: 1_000,
    pruningBacklogAgeMs: 1_000,
  };
  const ownerRefs = ["reviewrouter-e2e"];
  const runbookRefs = ["reviewrouter-e2e-runbook"];
  await prisma.reviewProtocolLimitsV2.create({
    data: {
      protocolLimitsProfileId: ids.protocolLimitsProfileId,
      limitsDigest: sha256(canonicalReviewProtocolLimits(limits)),
      ...limits,
      registeredAt: now,
    },
  });
  await prisma.reviewOperationalSloProfileV2.create({
    data: {
      operationalSloProfileId: ids.operationalSloProfileId,
      sloDigest: sha256(
        canonicalReviewOperationalSloProfile({
          thresholds: slos,
          ownerRefs,
          runbookRefs,
        }),
      ),
      ...slos,
      ownerRefs,
      runbookRefs,
      registeredAt: now,
    },
  });
  if (ids.releaseCandidate) {
    const registry = composeReviewActionV2ReleaseRegistry(prisma);
    const registered =
      await registry.runControl.producerReleases.registerProducerRelease({
        candidate: ids.releaseCandidate,
        expectedProtocolLimitsDigest: sha256(
          canonicalReviewProtocolLimits(limits),
        ),
        expectedOperationalSloDigest: sha256(
          canonicalReviewOperationalSloProfile({
            thresholds: slos,
            ownerRefs,
            runbookRefs,
          }),
        ),
      });
    const stored = await new PrismaProducerReleaseRepository(
      prisma,
    ).findProducerReleaseById(ids.producerReleaseId);
    if (
      registered.status !== ImmutableRegistryWriteStatus.Created ||
      !stored ||
      producerReleaseImmutableKey(stored) !==
        producerReleaseImmutableKey(ids.releaseCandidate)
    )
      throw new Error("review_v2_e2e_committed_release_registration_mismatch");
  } else
    await prisma.producerRelease.create({
      data: {
        producerReleaseId: ids.producerReleaseId,
        distributionKind: "public_reusable",
        actionCommitSha,
        runtimeCommitSha,
        wrapperEntrypointDigest: null,
        runtimeEntrypointDigest: sha256("runtime-entrypoint"),
        agentProfilesJson: JSON.stringify(
          ids.agentProfiles ?? approvedAgentProfilesFixture,
        ),
        ...(ids.reviewerPlanProfile
          ? { reviewerPlanProfile: { ...ids.reviewerPlanProfile } }
          : {}),
        ...(ids.prDescriptionProfile
          ? { prDescriptionProfile: { ...prDescriptionExtensionV1 } }
          : {}),
        ...(ids.lifecycleVerificationProfile
          ? {
              lifecycleVerificationProfile: {
                ...lifecycleVerificationExtensionV1,
              },
            }
          : {}),
        ...(ids.modelDispatchProfile
          ? { modelDispatchProfile: { ...ids.modelDispatchProfile } }
          : {}),
        contextGatewayPolicyVersion:
          ids.investigationProfile?.gatewayPolicyVersion ??
          "e2e-gateway-policy-v1",
        contextGatewayEntrypointDigest: "f".repeat(64),
        schemaDigest: reviewActionV2PublishedSchemaDigest,
        capabilityProfile: "exact_revision_v2",
        protocolLimitsProfileId: ids.protocolLimitsProfileId,
        operationalSloProfileId: ids.operationalSloProfileId,
        ...(ids.investigationProfile
          ? {
              reviewInvestigationCapability: reviewInvestigationCapabilityV1,
              reviewInvestigationCoverageProfileHash:
                ids.investigationProfile.coverageProfileHash,
              reviewInvestigationPolicyHash:
                ids.investigationProfile.policyHash,
            }
          : {}),
        registeredAt: now,
      },
    });
  const installationId = `${ids.prefix}-installation`;
  if (ids.borrowedWorkspace) {
    await prisma.workspace.findUniqueOrThrow({
      where: { id: ids.workspaceId },
    });
    if (
      await prisma.reviewConfiguration.count({
        where: { workspaceId: ids.workspaceId },
      })
    )
      throw new Error("review_v2_e2e_borrowed_workspace_must_be_unconfigured");
  } else {
    await prisma.workspace.create({
      data: {
        id: ids.workspaceId,
        slug: `${ids.prefix}-workspace`,
        name: "Disposable Review Action v2 E2E",
      },
    });
  }
  const configurations = new PrismaReviewConfigurationRepository(
    prisma,
    undefined,
    false,
    undefined,
  );
  await configurations.saveNextVersions({
    workspaceId: ids.workspaceId,
    writes: [
      {
        target: { scope: "workspace", workspaceId: ids.workspaceId },
        policy: workspacePolicyDocumentFixture(workspacePolicyFixture),
        expectedVersion: null,
      },
    ],
  });
  await prisma.gitHubInstallation.create({
    data: {
      id: installationId,
      workspaceId: ids.workspaceId,
      githubInstallationId: BigInt(githubInstallationId),
      accountLogin: owner,
      accountType: "Organization",
      repositorySelection: "selected",
      status: "active",
    },
  });
  await prisma.scmRepositoryIdentity.create({
    data: {
      scmRepositoryIdentityId: ids.scmRepositoryIdentityId,
      provider: "github",
      normalizedSourceBaseUrl: "https://github.com",
      externalRepositoryId: githubRepositoryId,
      createdAt: now,
    },
  });
  await prisma.repositoryConnection.create({
    data: {
      id: ids.repositoryConnectionId,
      workspaceId: ids.workspaceId,
      provider: "github",
      sourceBaseUrl: "https://github.com",
      externalRepositoryId: githubRepositoryId,
      scmRepositoryIdentityId: ids.scmRepositoryIdentityId,
      installationId,
      githubRepositoryId: BigInt(githubRepositoryId),
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      defaultBranch: "main",
      visibility: "private",
      selected: true,
    },
  });
  await prisma.scmRepositoryIdentity.update({
    where: { scmRepositoryIdentityId: ids.scmRepositoryIdentityId },
    data: {
      currentWorkspaceId: ids.workspaceId,
      currentRepositoryConnectionId: ids.repositoryConnectionId,
      boundAt: now,
    },
  });
  if (ids.repositoryProviderSelection === "rotating") {
    const target = {
      scope: "repository" as const,
      workspaceId: ids.workspaceId,
      repositoryId: ids.repositoryConnectionId,
    };
    await configurations.saveNextVersion({
      target,
      expectedVersion: null,
      ...systemPolicyWriteFixture(workspacePolicyFixture, target),
    });
  }
  await prisma.reviewMutationAuthority.create({
    data: {
      scmRepositoryIdentityId: ids.scmRepositoryIdentityId,
      laneKind: "hosted_reviewrouter_app",
      version: 1,
      epoch: 1n,
      mode: "v2_active",
      managedWorkflowInventoryHash: sha256(`${ids.prefix}-inventory`),
      activationSafetyDecisionHash: sha256(`${ids.prefix}-activation`),
      initializedAt: now,
      activatedAt: now,
    },
  });
  await prisma.reviewSafetyEmergencyControl.update({
    where: { emergencyControlId: "global-review-v2" },
    data: {
      version: 2,
      stopped: false,
      reason: "e2e_enabled",
      updatedBy: "reviewrouter-e2e",
      updatedAt: now,
    },
  });
  for (const capability of [
    "run_authorization_v2",
    "evidence_writes_v2",
    "evidence_reuse_v2",
    "prompt_only_reuse",
    "context_gateway_reuse",
    "publication_operations_v2",
    "mutation_epoch_v2",
  ] as const) {
    await prisma.reviewSafetyPolicy.create({
      data: {
        policyId: `${ids.prefix}-policy-${capability}`,
        policyScope: "global",
        capability,
        workspaceId: null,
        repositoryConnectionId: null,
        scmRepositoryIdentityId: null,
        version: 1,
        rolloutMode: "enabled",
        updatedBy: "reviewrouter-e2e",
        updatedAt: now,
      },
    });
  }
}

function productionEnv(input: {
  readonly releaseCandidate?: ProducerReleaseCandidate;
  readonly agentProfiles?: readonly ReviewAgentProfile[];
  readonly reviewerPlanProfile?: Readonly<{
    planVersion: 1;
    descriptorDigest: string;
  }>;
  readonly appPrivateKey: string;
  readonly producerReleaseId: string;
  readonly protocolLimitsProfileId: string;
  readonly operationalSloProfileId: string;
  readonly investigationProfile?: ReviewActionV2E2EInvestigationProfile;
  readonly prDescriptionProfile?: boolean;
  readonly lifecycleVerificationProfile?: boolean;
  readonly modelDispatchProfile?: ReviewModelDispatchProfileV2;
}): Readonly<Record<string, string>> {
  const release = input.releaseCandidate;
  const reviewerPlanProfile =
    release?.reviewerPlanProfile ?? input.reviewerPlanProfile;
  const prDescriptionProfile =
    release?.prDescriptionProfile ??
    (input.prDescriptionProfile ? prDescriptionExtensionV1 : undefined);
  const lifecycleProfile =
    release?.lifecycleVerificationProfile ??
    (input.lifecycleVerificationProfile
      ? lifecycleVerificationExtensionV1
      : undefined);
  const dispatchProfile =
    release?.modelDispatchProfile ?? input.modelDispatchProfile;
  const contextReplayKeyId = "review-v2-e2e-context-key";
  const signingKeys = JSON.stringify([
    {
      keyId: capabilityKeyId,
      secretBase64: Buffer.from(
        "review-v2-e2e-signing-secret-key-32b",
      ).toString("base64"),
      verifyUntil: null,
    },
  ]);
  return {
    NODE_ENV: "production",
    REVIEW_ROUTER_AGENT_PROFILE: "codex-default",
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: input.appPrivateKey,
    REVIEW_ROUTER_PUBLIC_API_URL: "https://api.reviewrouter.e2e",
    REVIEW_ROUTER_ACTION_OIDC_AUDIENCE: "reviewrouter-e2e",
    REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_ACTIVE_KEY_ID: capabilityKeyId,
    REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_KEYS_JSON: signingKeys,
    REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON: JSON.stringify([
      {
        producerReleaseId: input.producerReleaseId,
        distributionKind: release?.distributionKind ?? "public_reusable",
        actionCommitSha: release?.actionCommitSha ?? actionCommitSha,
        runtimeCommitSha: release?.runtimeCommitSha ?? runtimeCommitSha,
        wrapperEntrypointDigest: release?.wrapperEntrypointDigest ?? null,
        runtimeEntrypointDigest:
          release?.runtimeEntrypointDigest ?? sha256("runtime-entrypoint"),
        agentProfiles: release
          ? release.agentProfiles
          : (input.agentProfiles ?? approvedAgentProfilesFixture),
        ...(release?.contextToolsProfile
          ? { contextToolsProfile: release.contextToolsProfile }
          : {}),
        ...(reviewerPlanProfile ? { reviewerPlanProfile } : {}),
        ...(prDescriptionProfile ? { prDescriptionProfile } : {}),
        ...(lifecycleProfile
          ? { lifecycleVerificationProfile: lifecycleProfile }
          : {}),
        ...(dispatchProfile ? { modelDispatchProfile: dispatchProfile } : {}),
        reviewInvestigationCapability:
          release?.reviewInvestigationProfile?.capability ??
          (input.investigationProfile ? reviewInvestigationCapabilityV1 : null),
        reviewInvestigationCoverageProfileHash:
          release?.reviewInvestigationProfile?.coverageProfileHash ??
          input.investigationProfile?.coverageProfileHash ??
          null,
        reviewInvestigationPolicyHash:
          release?.reviewInvestigationProfile?.policyHash ??
          input.investigationProfile?.policyHash ??
          null,
        contextGatewayPolicyVersion:
          release?.contextGatewayPolicyVersion ??
          input.investigationProfile?.gatewayPolicyVersion ??
          "e2e-gateway-policy-v1",
        contextGatewayEntrypointDigest:
          release?.contextGatewayEntrypointDigest ?? "f".repeat(64),
        schemaDigest:
          release?.schemaDigest ?? reviewActionV2PublishedSchemaDigest,
        canonicalizerDigest: reviewActionV2CanonicalizerDigest,
        capabilityProfile: release?.capabilityProfile ?? "exact_revision_v2",
        protocolLimitsProfileId: input.protocolLimitsProfileId,
        operationalSloProfileId: input.operationalSloProfileId,
      },
    ]),
    [reviewActionV2ProviderVoteLanesEnv]: JSON.stringify([
      { providerKind: "codex", providerVoteIdentityHash },
    ]),
    [reviewActionV2ProjectionPolicyVersionEnv]:
      reviewActionV2ProjectionPolicyVersion,
    [reviewActionV2CapabilityActiveKeyIdEnv]: capabilityKeyId,
    [reviewActionV2CapabilityKeysEnv]: signingKeys,
    [reviewActionV2ContextSessionSecretEnv]: Buffer.from(
      "s".repeat(32),
    ).toString("base64"),
    [reviewActionV2ContextReplayActiveKeyIdEnv]: contextReplayKeyId,
    [reviewActionV2ContextReplayKeysEnv]: JSON.stringify([
      {
        keyId: contextReplayKeyId,
        secretBase64: Buffer.from("r".repeat(32)).toString("base64"),
      },
    ]),
    ...(input.investigationProfile
      ? {
          [reviewInvestigationRecordingEnabledEnv]: "1",
          [reviewInvestigationShadowEnabledEnv]: "1",
          [reviewInvestigationContextCriticEnabledEnv]: "1",
          [reviewInvestigationMaintenanceEnabledEnv]: "1",
          [reviewInvestigationLeaseCapabilityActiveKeyIdEnv]:
            investigationLeaseKeyId,
          [reviewInvestigationLeaseCapabilityKeysEnv]: JSON.stringify([
            {
              keyId: investigationLeaseKeyId,
              secretBase64: Buffer.from("l".repeat(32)).toString("base64"),
              verifyUntil: null,
            },
          ]),
        }
      : {}),
    [reviewV2WorkerEnabledEnv]: "1",
    REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE: "1",
    REVIEW_ROUTER_PROGRESS_FILE_COVERAGE: "1",
    REVIEW_ROUTER_REVIEW_V2_COMPLETION_CLAIM_MS: "1000",
    REVIEW_ROUTER_REVIEW_V2_PUBLICATION_CLAIM_MS: "1000",
    REVIEW_ROUTER_REVIEW_V2_MIN_MUTATION_LEASE_MS: "500",
    REVIEW_ROUTER_REVIEW_V2_PUBLICATION_BATCH_SIZE: "20",
    REVIEW_ROUTER_REVIEW_V2_RECOVERY_PAGE_SIZE: "2",
    REVIEW_ROUTER_REVIEW_V2_DUE_LIMIT: "20",
    REVIEW_ROUTER_REVIEW_V2_MAX_MARKER_PAGES: "4",
  };
}

function providerManifest(input: {
  readonly executionId: string;
  readonly producerReleaseId: string;
  readonly scopeHash: string;
  readonly selectedProtocolVersion: string;
}): ProviderInvocationManifest {
  return {
    manifestVersion: 1,
    scopeHash: input.scopeHash,
    taskKindSet: [EvidenceTaskKind.FindingDiscovery],
    providerKind: ReviewProviderKind.Codex,
    providerCapabilityHash: sha256(`${input.executionId}-provider-capability`),
    requestedModel: "gpt-5-codex",
    providerPolicyVersion: "provider-policy-v1",
    producerReleaseId: input.producerReleaseId,
    selectedProtocolVersion: input.selectedProtocolVersion,
    providerRequestEnvelopeHash: sha256(`${input.executionId}-request`),
    outputSchemaHash: sha256(`${input.executionId}-output-schema`),
    reviewConfigHash: sha256(`${input.executionId}-config`),
    runtimeCompatibilityKey: sha256(`${input.executionId}-runtime`),
    filePatchManifestHash: sha256(`${input.executionId}-patch`),
    contextManifestHash: sha256(`${input.executionId}-context`),
    memoryBundleHash: null,
    codeGraphProjectionHash: null,
    lifecycleTargetSetHash: null,
    liveLifecycleStateHash: null,
    toolPolicyHash: sha256(`${input.executionId}-tools`),
    executionProfile: ProviderExecutionProfile.PromptOnlyEnvelopeV1,
    baseTreeHash: sha256(`${input.executionId}-base-tree`),
    environmentContractHash: sha256(`${input.executionId}-environment`),
  };
}

function progressSlotId(executionId: string, index: number): string {
  return `${executionId}-slot-${index}`;
}

function progressLeaseFixture(input: {
  readonly executionId: string;
  readonly executionGeneration: bigint;
  readonly index: number;
  readonly slot: Readonly<{
    workSlotId: string;
    providerVoteIdentityHash: string;
  }>;
  readonly workspaceId: string;
  readonly repositoryConnectionId: string;
  readonly scmRepositoryIdentityId: string;
  readonly now: Date;
  readonly active: boolean;
}) {
  const suffix = `${input.executionId}-${input.index}`;
  return {
    leaseId: `${suffix}-progress-lease`,
    workspaceId: input.workspaceId,
    repositoryConnectionId: input.repositoryConnectionId,
    scmRepositoryIdentityId: input.scmRepositoryIdentityId,
    pullRequestNumber,
    executionId: input.executionId,
    executionGeneration: input.executionGeneration,
    providerInvocationKey: sha256(`${suffix}-provider-invocation`),
    preparedManifestCanonicalJson: canonicalJson({
      fixture: suffix,
      manifestVersion: 1,
    }),
    preparedManifestKey: sha256(`${suffix}-manifest`),
    providerVoteIdentityHash: input.slot.providerVoteIdentityHash,
    workSlotId: input.slot.workSlotId,
    purpose: "provider_execution" as const,
    authorizationId: `${suffix}-authorization`,
    producerReleaseId: `${suffix}-release`,
    reviewRevisionHash: sha256(`${suffix}-revision`),
    mutationEpoch: 1n,
    leaseSafetyDecisionHash: sha256(`${suffix}-safety`),
    attemptId: `${suffix}-attempt`,
    sourceObservationId: null,
    attemptOrdinal: 2,
    acquireRequestIdHash: sha256(`${suffix}-acquire-request-id`),
    acquireRequestHash: sha256(`${suffix}-acquire-request`),
    lastRenewRequestIdHash: null,
    lastRenewRequestHash: null,
    ownerIdHash: sha256(`${suffix}-owner`),
    leaseCapabilityId: `${suffix}-capability`,
    capabilitySigningKeyId: capabilityKeyId,
    state: input.active ? ("active" as const) : ("released" as const),
    acquiredAt: input.now,
    renewedAt: input.now,
    expiresAt: new Date(input.now.getTime() + 60_000),
    resultReportUntil: new Date(input.now.getTime() + 120_000),
    retainUntil: new Date(input.now.getTime() + 86_400_000),
  };
}

const digestPort = {
  async digest(value: Uint8Array): Promise<string> {
    return createHash("sha256").update(value).digest("hex");
  },
  async digestUtf8(value: string): Promise<string> {
    return sha256(value);
  },
};

async function withBodyHash<Operation extends ReviewActionV2OperationId>(
  operation: Operation,
  request: ReviewActionV2RequestMap[Operation],
): Promise<ReviewActionV2RequestMap[Operation]> {
  return {
    ...request,
    requestBodyHash: sha256(
      canonicalizeReviewActionV2Request(operation, request),
    ),
  };
}

function envelope(requestId: string) {
  return {
    protocolVersion: reviewActionV2PublishedProtocolVersion,
    schemaDigest: reviewActionV2PublishedSchemaDigest,
    requestId,
  } as const;
}

function requiredHandler<T>(
  value: T | undefined,
  name: string,
): NonNullable<T> {
  if (!value) throw new Error(`review_v2_e2e_handler_missing:${name}`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("review_v2_e2e_record_expected");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("review_v2_e2e_string_expected");
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertDisposableDatabaseUrl(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//u, "").toLowerCase();
  const local =
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
    (parsed.hostname === "postgres" &&
      process.env.REVIEW_ROUTER_REVIEW_V2_E2E_ALLOW_DOCKER_DATABASE === "1");
  if (!local || (!database.includes("test") && !database.includes("ci"))) {
    throw new Error("review_v2_e2e_requires_disposable_database");
  }
}

const zeroHash = "0".repeat(64);

const approvedAgentProfilesFixture = [
  {
    profileRef: "codex-default",
    agentKind: "codex",
    packageVersion: "0.147.0",
    binarySha256: "c".repeat(64),
    modelTransports: ["account_gateway", "provider_api"],
    contextGateway: true,
    cancellation: true,
  },
];
