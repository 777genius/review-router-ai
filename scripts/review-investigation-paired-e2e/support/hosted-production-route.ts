import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  FetchHostedCodexStreamingRelay,
  PrismaHostedCodexRelayAuthorization,
  PrismaInvocationGrantRepository,
  type HostedCodexSessionRuntime,
} from "../../../packages/features/hosted-account-pool/src/index.js";
import { parseReviewConfigurationStrict } from "../../../packages/features/review-config/src/index.js";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture.js";
import { canonicalJson } from "../../../packages/features/review-run-control/src/index.js";
import { hostedGrantAuthorityIdentity } from "../../../apps/api/src/prisma-hosted-codex-grant-admission.js";
import {
  createReviewRunHostedModelRoute,
  registerReviewRunHostedModelRoute,
} from "../../../apps/api/src/review-run-hosted-model-route.js";
import type { ReviewActionV2E2EHarness } from "../../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Seed the external Hosted credential/grant boundary only. Capture, current
 * authority, native request/effect accounting and V2 settlement stay production
 * implementations against real PG; no admitted snapshot is injected. */
export async function prepareHostedProductionRoute(
  fixture: ReviewActionV2E2EHarness,
  app: FastifyInstance,
  providerFetch: typeof fetch,
  providerOrigin: string,
  provider: { model: string; authMode: string; kind: string },
) {
  const capturedProvider = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [provider],
  }).providers[0]!;
  const prisma = fixture.prisma;
  const prefix = fixture.prefix;
  const now = new Date();
  const gate = await prisma.hostedCodexRuntimeGate.findUniqueOrThrow({
    where: { id: "global" },
  });
  if (gate.status === "closed") {
    if (
      gate.authzEpoch !== 1n ||
      (await prisma.hostedCodexInvocationGrant.count()) ||
      (await prisma.hostedCodexCommentTokenMint.count()) ||
      (await prisma.hostedCodexAccount.count())
    )
      throw new Error("paired_hosted_requires_unused_native_runtime");
    // Existing cold-start fixture: historical empty closure only, before any
    // account/grant exists. SQL guards are active for every admission/effect.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`;
      await tx.hostedCodexRuntimeClosure.upsert({
        where: { gateRevision: gate.revision },
        create: {
          id: `${prefix}-cold-start`,
          gateRevision: gate.revision,
          closedAuthzEpoch: gate.authzEpoch,
          actorHash: hash(prefix),
          reasonHash: hash("no-prior-hosted-issuer"),
          state: "complete",
          completedAt: now,
          legacyBarrier: false,
          legacyUnsafeUntil: new Date(0),
        },
        update: {
          state: "complete",
          completedAt: now,
          legacyBarrier: false,
          legacyUnsafeUntil: new Date(0),
          revision: { increment: 1 },
        },
      });
    });
    await prisma.hostedCodexRuntimeGate.update({
      where: { id: "global" },
      data: {
        status: "active",
        authzEpoch: { increment: 1 },
        revision: { increment: 1 },
        reasonCode: "isolated_synthetic_fixture",
        changedAt: now,
        changedByHash: hash(prefix),
      },
    });
  } else if (gate.authzEpoch !== 2n)
    throw new Error("paired_hosted_runtime_epoch_changed");
  const poolId = `${prefix}-pool`;
  const accountId = "paired-original-account";
  const bindingId = `${prefix}-binding`;
  const sourceHash = hash(`${prefix}-workflow`);
  await prisma.hostedCodexPool.create({
    data: { id: poolId, workspaceId: fixture.workspaceId, name: prefix },
  });
  await prisma.hostedCodexAccount.create({
    data: {
      id: accountId,
      workspaceId: fixture.workspaceId,
      poolId,
      label: "Synthetic original account",
      accountFingerprint: hash(accountId),
    },
  });
  await prisma.hostedCodexCredentialVersion.create({
    data: {
      id: `${prefix}-credential`,
      workspaceId: fixture.workspaceId,
      poolId,
      accountId,
      generation: 1n,
      databaseIncarnation: "isolated-synthetic-incarnation",
      envelopeVersion: 1,
      encryptionAlgorithm: "synthetic-test-envelope",
      keyId: "synthetic-key",
      aadHash: hash("synthetic-aad"),
      generationHash: hash(accountId),
      ciphertextHash: hash("synthetic-ciphertext"),
      encryptedCiphertext: "synthetic-not-credentials",
      envelopeMetadata: {},
    },
  });
  await prisma.hostedCodexAccount.update({
    where: { id: accountId },
    data: {
      state: "healthy",
      activeGeneration: 1n,
      healthVersion: { increment: 1 },
      lastHealthyAt: now,
    },
  });
  await prisma.hostedCodexRepositoryBinding.create({
    data: {
      id: bindingId,
      workspaceId: fixture.workspaceId,
      poolId,
      repositoryConnectionId: fixture.repositoryConnectionId,
      status: "active",
      workflowPath: ".github/workflows/reviewrouter-codex.yml",
      workflowActionRef: `777genius/review-router@${"a".repeat(40)}`,
      workflowSourceCommitSha: "c".repeat(40),
      workflowSourceBlobSha: "d".repeat(40),
      workflowSourceSha256: sourceHash,
      workflowSemanticSha256: hash(`${prefix}-semantic`),
      workflowSourceTrust: "trusted_default_branch_revision",
      attestedGithubRepositoryId: BigInt(
        fixture.fakeGitHub.options.repositoryId,
      ),
      attestedBindingRevision: 1n,
      activatedAt: now,
    },
  });
  const sessions: string[] = [];
  const diagnostics: string[] = [];
  const observe = async <T>(
    name: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      diagnostics.push(
        `${name}:${error instanceof Error ? error.message : "unknown"}`,
      );
      throw error;
    }
  };
  const runtime = {
    ensureFreshSession: async ({
      accountId: selected,
    }: {
      accountId: string;
    }) => {
      sessions.push(selected);
      if (selected !== accountId)
        throw new Error("paired_hosted_account_reselected");
      return {
        accessToken: "paired-native-credential",
        chatgptAccountId: selected,
        credentialGeneration: 1,
      };
    },
    classifyFailure: () => ({ code: "unknown" }),
  } as unknown as HostedCodexSessionRuntime;
  const relay = new FetchHostedCodexStreamingRelay(
    runtime,
    new PrismaInvocationGrantRepository(prisma),
    async (_url, init) => providerFetch(`${providerOrigin}/native`, init),
    { failoverEnabled: false },
  );
  if (!fixture.routes.modelDispatch)
    throw new Error("paired_hosted_dispatch_required");
  await registerReviewRunHostedModelRoute(
    app,
    createReviewRunHostedModelRoute({
      prisma,
      api: fixture.routes.modelDispatch,
      native: {
        authorization: {
          authorize: (request) =>
            observe("native_authorization", () =>
              new PrismaHostedCodexRelayAuthorization(prisma, false).authorize(
                request,
              ),
            ),
        },
        relay: {
          open: (request) => observe("native_relay", () => relay.open(request)),
        },
      },
    }),
  );
  const grants = new Map<string, { id: string; opaque: string }>();
  return {
    sessions,
    diagnostics,
    inspect(attempt: string) {
      const grant = grants.get(attempt);
      if (!grant) throw new Error("paired_hosted_original_grant_missing");
      return prisma.hostedCodexInvocationGrant.findUniqueOrThrow({
        where: { id: grant.id },
        include: { relayRequests: { include: { upstreamAttempts: true } } },
      });
    },
    async prepareHead(attempt: string) {
      const existing = grants.get(attempt);
      if (existing) return existing;
      const revision = fixture.fakeGitHub.revision;
      const identity = {
        workspaceId: fixture.workspaceId,
        repositoryConnectionId: fixture.repositoryConnectionId,
        scmRepositoryIdentityId: fixture.scmRepositoryIdentityId,
        pullRequestNumber: 42,
        baseSha: revision.baseSha,
        mergeBaseSha: revision.mergeBaseSha,
        headSha: revision.headSha,
      };
      const reviewRevisionHash = hash(canonicalJson(identity));
      const requestId = `${prefix}-request-${attempt}`;
      const expiresAt = new Date(Date.now() + 900_000);
      const configurationVersion = (
        await prisma.reviewConfigurationVersion.findFirstOrThrow({
          where: {
            configuration: { repositoryId: fixture.repositoryConnectionId },
          },
          orderBy: { version: "desc" },
          select: { version: true },
        })
      ).version;
      const authority = hostedGrantAuthorityIdentity({
        workspaceId: fixture.workspaceId,
        repositoryId: fixture.repositoryConnectionId,
        reviewRequestId: requestId,
        pullRequestNumber: 42,
        reviewHeadSha: revision.headSha,
        reviewRevisionHash,
        runtimeConfigVersion: configurationVersion,
        provider: capturedProvider,
        bindingId,
        bindingRevision: 1,
        authzEpoch: "1",
        runtimeAuthzEpoch: "2",
        workflowSourceSha256: sourceHash,
      });
      await prisma.reviewRequestedIntent.create({
        data: {
          ...identity,
          requestId,
          reviewRevisionHash,
          sourceRunId: fixture.fakeGitHub.sourceRunId,
          sourceRunAttempt: attempt,
          triggerKind: "pull_request_synchronized",
          deliveryIdentityHash: hash(requestId),
          canonicalRequestHash: hash(`${requestId}-canonical`),
          state: "awaiting_authorization",
          admissionState: "admitted",
          admissionChangedLines: 9,
          admissionMaxChangedLines: 100,
          admissionPolicySnapshotId: `${prefix}-admission-policy`,
          admissionDecisionHash: hash(`${requestId}-admission`),
          admissionCheckedAt: now,
          notBefore: now,
          submissionStartedAt: now,
          nextResolutionAt: now,
          resolutionDeadlineAt: expiresAt,
          createdAt: now,
          updatedAt: now,
          retainUntil: expiresAt,
        },
      });
      const value = {
        id: `${prefix}-grant-${attempt}`,
        opaque: `synthetic-hosted-grant-${randomUUID()}`,
      };
      await prisma.hostedCodexInvocationGrant.create({
        data: {
          id: value.id,
          invocationId: `${prefix}-invocation-${attempt}`,
          workspaceId: fixture.workspaceId,
          poolId,
          repositoryConnectionId: fixture.repositoryConnectionId,
          repositoryBindingId: bindingId,
          activeAccountId: accountId,
          primaryAccountId: accountId,
          reviewRequestId: requestId,
          ...authority,
          runId: fixture.fakeGitHub.sourceRunId,
          runAttempt: Number(attempt),
          model: provider.model,
          policyVersion: "hosted-codex-v1",
          runtimeConfigVersion: configurationVersion,
          bindingRevision: 1n,
          authzEpoch: 1n,
          runtimeAuthzEpoch: 2n,
          capabilityTokenHash: hash(value.opaque),
          expiresAt,
          maxRequests: 32,
          maxConcurrentRequests: 1,
          maxRequestBytes: 98_304,
          maxResponseBytes: 32_768,
          maxOutputTokens: 4096,
        },
      });
      await prisma.hostedCodexCommentRefreshCapability.create({
        data: {
          id: `${prefix}-comment-capability-${attempt}`,
          grantId: value.id,
          invocationId: `${prefix}-invocation-${attempt}`,
          repositoryBindingId: bindingId,
          workspaceId: fixture.workspaceId,
          poolId,
          repositoryConnectionId: fixture.repositoryConnectionId,
          capabilityTokenHash: hash(
            `${prefix}-synthetic-comment-capability-${attempt}`,
          ),
          expiresAt,
          maxUses: 1,
        },
      });
      grants.set(attempt, value);
      return value;
    },
  };
}
