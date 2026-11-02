import { createHash, randomInt, randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  FetchHostedCodexStreamingRelay,
  PrismaHostedCodexRelayAuthorization,
  PrismaInvocationGrantRepository,
  type HostedCodexSessionRuntime,
} from "@reviewrouter/features-hosted-account-pool";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import {
  canonicalJson,
  ClaimReviewRunCompanionDispatch,
  ReviewRunAuthorizationTokenResolutionStatus,
  type ReviewRunCompanionDispatchClaim,
  type ReviewRunHostedSelection,
} from "@reviewrouter/features-review-run-control";
import { PrismaReviewRunAuthorizationRepository } from "@reviewrouter/features-review-run-control/composition";
import {
  lifecycleVerificationContract,
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
  reviewModelDispatchHeaders,
  reviewModelDispatchIdPreimage,
  type ReviewModelDispatchCapabilityV2,
  type ReviewModelDispatchClaimV2,
  type ReviewModelDispatchProfileV2,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";
import { hostedGrantAuthorityIdentity } from "../prisma-hosted-codex-grant-admission";
import {
  registerReviewModelDispatchRoutes,
  type ReviewModelDispatchApi,
} from "../review-model-dispatch";
import { createHostedModelDispatchProofReconciler } from "../review-model-dispatch-hosted-proof";
import { captureOriginalHostedReviewBinding } from "../review-run-hosted-binding";
import {
  createReviewRunHostedModelRoute,
  registerReviewRunHostedModelRoute,
  hostedModelRoutePath,
  hostedModelGrantHeader,
} from "../review-run-hosted-model-route";
import { createReviewDispatchDatabaseFixture } from "./review-dispatch-database-fixture";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export type HostedProviderOutcome =
  | "completed"
  | "disconnect"
  | "semantic_incomplete"
  | 401
  | 429;

/** Real PostgreSQL, native Hosted authorization/effect ledger, V2 claim ledger,
 * and loopback HTTP. Only the credential session and provider are synthetic. */
export async function createHostedModelDatabaseFixture(
  databaseUrl: string,
  outcome: HostedProviderOutcome = "completed",
  nativeMaxRequests = 1,
) {
  if (new URL(databaseUrl).pathname !== "/reviewrouter_hosted_model_test")
    throw new Error("hosted_model_dedicated_disposable_database_required");
  const prefix = `hosted-model-${randomUUID()}`;
  const now = new Date();
  const deadline = new Date(now.getTime() + 300_000).toISOString();
  const grantExpiry = new Date(now.getTime() + 600_000);
  const repositoryNumericId =
    BigInt(Date.now()) * 1000n + BigInt(randomInt(1000));
  const sourceRunId = repositoryNumericId.toString();
  const identity = {
    workspaceId: `${prefix}-workspace`,
    repositoryConnectionId: `${prefix}-repository`,
    scmRepositoryIdentityId: `${prefix}-scm`,
    pullRequestNumber: 1,
    baseSha: "b".repeat(40),
    mergeBaseSha: "b".repeat(40),
    headSha: "a".repeat(40),
  };
  const reviewRevisionHash = hash(canonicalJson(identity));
  const configuration = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        ...workspacePolicyFixture.providers[0],
        authMode: "codex_subscription_oauth_hosted_pool",
      },
    ],
  });
  const provider = configuration.providers[0]!;
  const limits = {
    maxRequests: 4,
    maxConcurrentRequests: 1 as const,
    maxRequestBytes: 65_536,
    maxResponseBytes: 32_768,
    maxOutputTokens: 1024,
  };
  const budget: ReviewModelDispatchCapabilityV2 = {
    ...limits,
    extensionId: reviewModelDispatchContract.extensionId,
    version: 2,
    transport: "hosted_pool",
    wireProtocol: "codex-responses",
    outputTokenLimit: "terminal_acceptance",
    routeIdentityHash: hash(`${prefix}-original-hosted-route`),
    providerIndex: 0,
    model: provider.model,
    deadline,
  };
  const profile: ReviewModelDispatchProfileV2 = {
    extensionId: reviewModelDispatchContract.extensionId,
    descriptorDigest: reviewModelDispatchDescriptorDigest,
    policyVersion: reviewModelDispatchContract.policyVersion,
    transports: ["hosted_pool"],
    wireProtocols: ["codex-responses"],
    defaultAgentProfileRefs: { hosted_pool: "fixture-ocr" },
    limits,
  };
  const authorityIdentity = hostedGrantAuthorityIdentity({
    workspaceId: identity.workspaceId,
    repositoryId: identity.repositoryConnectionId,
    reviewRequestId: `${prefix}-review-request`,
    pullRequestNumber: 1,
    reviewHeadSha: identity.headSha,
    reviewRevisionHash,
    runtimeConfigVersion: 1,
    provider,
    bindingId: `${prefix}-binding`,
    bindingRevision: 1,
    authzEpoch: "1",
    runtimeAuthzEpoch: "2",
    workflowSourceSha256: hash(`${prefix}-workflow`),
  });
  const hosted: ReviewRunHostedSelection = {
    grantId: `${prefix}-grant`,
    invocationId: `${prefix}-invocation`,
    poolId: `${prefix}-pool`,
    repositoryBindingId: `${prefix}-binding`,
    activeAccountId: `${prefix}-primary`,
    reviewRequestId: `${prefix}-review-request`,
    ...authorityIdentity,
    model: provider.model,
    expiresAt: grantExpiry.toISOString(),
    bindingRevision: 1,
    runtimeConfigVersion: 1,
    authzEpoch: "1",
    runtimeAuthzEpoch: "2",
  };
  const agent = {
    profileRef: "fixture-ocr",
    agentKind: "ocr",
    binarySha256: hash("fixture-binary"),
    packageVersion: "1.0.0",
    modelTransports: ["provider_api"],
    contextGateway: false,
    cancellation: true,
    reviewSkillsVersion: 1,
  };
  const snapshot = canonicalJson({
    snapshotVersion: 3,
    configurationSource: "repository",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: 1,
    effectivePolicyDigest: `sha256:${hash(canonicalJson(configuration))}`,
    agent,
    agentProfileDigest: hash(canonicalJson(agent)),
    producer: {
      producerReleaseId: `${prefix}-release`,
      actionCommitSha: "a".repeat(40),
      runtimeCommitSha: "b".repeat(40),
    },
    configurationCanonicalJson: canonicalJson(configuration),
    deadline,
    modelDispatchCapability: budget,
    gateway: null,
    hosted,
  });
  const base = await createReviewDispatchDatabaseFixture(databaseUrl, prefix, {
    runtimeSnapshotCanonicalJson: snapshot,
    modelDispatchProfile: profile,
    skipInitialLease: true,
    sourceRunId,
    reviewRevisionHash,
    githubRepositoryId: repositoryNumericId,
  });
  const prisma = base.prisma;
  // The dedicated fully migrated database is exclusively owned by this fixture
  // suite. Native immutable audit rows remain until that disposable DB is dropped.
  const gate = await prisma.hostedCodexRuntimeGate.findUniqueOrThrow({
    where: { id: "global" },
  });
  if (gate.status === "closed") {
    // Same empty-native bootstrap as hosted-pool-canary-phase-recovery.postgres:
    // no issuer/account/grant/token has existed in this isolated test database.
    // The historical 61-minute closure is synthetic seed data, not live proof.
    // All SQL guards are restored before any actual test admission/effect.
    if (
      gate.authzEpoch !== 1n ||
      (await prisma.hostedCodexInvocationGrant.count()) ||
      (await prisma.hostedCodexCommentTokenMint.count()) ||
      (await prisma.hostedCodexAccount.count())
    )
      throw new Error("hosted_fixture_requires_unused_native_runtime");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`;
      await tx.hostedCodexRuntimeClosure.upsert({
        where: { gateRevision: gate.revision },
        create: {
          id: `${prefix}-cold-start`,
          gateRevision: gate.revision,
          closedAuthzEpoch: gate.authzEpoch,
          actorHash: hash("synthetic-cold-start"),
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
    throw new Error("hosted_fixture_runtime_epoch_changed");
  await prisma.gitHubInstallation.create({
    data: {
      id: `${prefix}-installation`,
      workspaceId: identity.workspaceId,
      githubInstallationId: repositoryNumericId,
      accountLogin: "disposable",
      accountType: "Organization",
      repositorySelection: "selected",
    },
  });
  await prisma.repositoryConnection.update({
    where: { id: identity.repositoryConnectionId },
    data: { installationId: `${prefix}-installation`, selected: true },
  });
  await prisma.hostedCodexPool.create({
    data: {
      id: hosted.poolId,
      workspaceId: identity.workspaceId,
      name: prefix,
    },
  });
  for (const accountId of [hosted.activeAccountId, `${prefix}-backup`]) {
    await prisma.hostedCodexAccount.create({
      data: {
        id: accountId,
        workspaceId: identity.workspaceId,
        poolId: hosted.poolId,
        label: accountId,
        accountFingerprint: hash(accountId),
      },
    });
    await prisma.hostedCodexCredentialVersion.create({
      data: {
        id: `${accountId}-credential`,
        workspaceId: identity.workspaceId,
        poolId: hosted.poolId,
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
  }
  await prisma.hostedCodexRepositoryBinding.create({
    data: {
      id: hosted.repositoryBindingId,
      workspaceId: identity.workspaceId,
      poolId: hosted.poolId,
      repositoryConnectionId: identity.repositoryConnectionId,
      status: "active",
      workflowPath: ".github/workflows/reviewrouter-codex.yml",
      workflowActionRef: `777genius/review-router@${"a".repeat(40)}`,
      workflowSourceCommitSha: "c".repeat(40),
      workflowSourceBlobSha: "d".repeat(40),
      workflowSourceSha256: hash(`${prefix}-workflow`),
      workflowSemanticSha256: hash(`${prefix}-semantic`),
      workflowSourceTrust: "trusted_default_branch_revision",
      attestedGithubRepositoryId: repositoryNumericId,
      attestedBindingRevision: 1n,
      activatedAt: now,
    },
  });
  await prisma.reviewRequestedIntent.create({
    data: {
      ...identity,
      requestId: hosted.reviewRequestId,
      reviewRevisionHash,
      sourceRunId,
      sourceRunAttempt: "1",
      triggerKind: "pull_request_synchronized",
      deliveryIdentityHash: hash(`${prefix}-delivery`),
      canonicalRequestHash: hash(`${prefix}-request`),
      state: "awaiting_authorization",
      admissionState: "admitted",
      admissionChangedLines: 5,
      admissionMaxChangedLines: 100,
      admissionPolicySnapshotId: `${prefix}-admission-policy`,
      admissionDecisionHash: hash(`${prefix}-admission-decision`),
      admissionCheckedAt: now,
      notBefore: now,
      submissionStartedAt: now,
      nextResolutionAt: now,
      resolutionDeadlineAt: grantExpiry,
      createdAt: now,
      updatedAt: now,
      retainUntil: grantExpiry,
    },
  });
  const opaqueGrant = `synthetic-hosted-grant-${randomUUID()}`;
  await prisma.hostedCodexInvocationGrant.create({
    data: {
      id: hosted.grantId,
      invocationId: hosted.invocationId,
      workspaceId: identity.workspaceId,
      poolId: hosted.poolId,
      repositoryConnectionId: identity.repositoryConnectionId,
      repositoryBindingId: hosted.repositoryBindingId,
      activeAccountId: hosted.activeAccountId,
      primaryAccountId: hosted.activeAccountId,
      backupAccountId: `${prefix}-backup`,
      reviewRequestId: hosted.reviewRequestId,
      ...authorityIdentity,
      runId: sourceRunId,
      runAttempt: 1,
      model: provider.model,
      policyVersion: "hosted-codex-v1",
      runtimeConfigVersion: 1,
      bindingRevision: 1n,
      authzEpoch: 1n,
      runtimeAuthzEpoch: 2n,
      capabilityTokenHash: hash(opaqueGrant),
      expiresAt: grantExpiry,
      maxRequests: nativeMaxRequests,
      maxConcurrentRequests: 1,
      maxRequestBytes: limits.maxRequestBytes,
      maxResponseBytes: limits.maxResponseBytes,
      maxOutputTokens: limits.maxOutputTokens,
    },
  });
  await prisma.hostedCodexCommentRefreshCapability.create({
    data: {
      id: `${prefix}-comment-capability`,
      grantId: hosted.grantId,
      invocationId: hosted.invocationId,
      repositoryBindingId: hosted.repositoryBindingId,
      workspaceId: identity.workspaceId,
      poolId: hosted.poolId,
      repositoryConnectionId: identity.repositoryConnectionId,
      capabilityTokenHash: hash(`${prefix}-synthetic-comment-capability`),
      expiresAt: grantExpiry,
      maxUses: 1,
    },
  });
  const authorization = (await new PrismaReviewRunAuthorizationRepository(
    prisma,
  ).findReviewRunAuthorizationById(`${prefix}-auth`))!;
  const bindingInput = {
    reader: prisma,
    identity: authorization,
    configuration,
    configurationVersion: 1,
    now,
  };
  const captured = await captureOriginalHostedReviewBinding(bindingInput);
  if (canonicalJson(captured) !== canonicalJson(hosted))
    throw new Error("hosted_fixture_original_binding_invalid");
  const currentLease = await base.acquireClaim(0);
  const body = canonicalJson({
    model: budget.model,
    input: "synthetic review input",
    stream: true,
    store: false,
  });
  const context = (ordinal = 1): ReviewModelDispatchClaimV2 => ({
    dispatchVersion: 2,
    dispatchId: `rr-model-${hash(reviewModelDispatchIdPreimage({ ...currentLease, requestOrdinal: ordinal }))}`,
    executionId: currentLease.executionId,
    workSlotId: currentLease.workSlotId,
    attemptOrdinal: 1,
    requestOrdinal: ordinal,
    leaseId: currentLease.leaseId,
    leaseCapability: "synthetic-lease-capability",
    fencingToken: currentLease.fencingToken.toString(),
    preparedManifestKey: currentLease.preparedManifestKey,
    routeIdentityHash: budget.routeIdentityHash,
    providerRequestEnvelopeHash: hash(body),
    requestBytes: Buffer.byteLength(body),
    maxOutputTokens: limits.maxOutputTokens,
  });
  let authorizationActive = true;
  const admission = new ClaimReviewRunCompanionDispatch(
    base.repository,
    async (token) => {
      if (token !== "synthetic-lease-capability")
        throw new Error("invalid_fixture_capability");
      return leaseAuthority(currentLease);
    },
  );
  const api: ReviewModelDispatchApi = {
    admission,
    checkAuthority: async () => authorizationActive,
    authorizations: {
      resolveReviewRunAuthorizationToken: async ({ token }) =>
        authorizationActive && token === "synthetic-run-authorization"
          ? {
              status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
              authorization,
            }
          : { status: ReviewRunAuthorizationTokenResolutionStatus.Expired },
    },
    reconcileNativeProof: createHostedModelDispatchProofReconciler({
      prisma,
      admission,
    }),
  };
  const seen: { account: string | null; body: unknown }[] = [];
  const diagnostics: string[] = [];
  const observeFailure = async <T>(
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
  const providerHttp = Fastify({ logger: false });
  providerHttp.post("/responses", async (request, reply) => {
    seen.push({
      account:
        typeof request.headers["chatgpt-account-id"] === "string"
          ? request.headers["chatgpt-account-id"]
          : null,
      body: request.body,
    });
    if (outcome === "disconnect") {
      request.raw.socket.destroy();
      return reply;
    }
    if (typeof outcome === "number")
      return reply.code(outcome).send({ error: "synthetic_provider_error" });
    const sse =
      outcome === "semantic_incomplete"
        ? 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
        : `data: ${JSON.stringify({ type: "response.completed", response: { id: "synthetic-response", status: "completed", model: budget.model, output: [], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } })}\n\ndata: [DONE]\n\n`;
    return reply.header("content-type", "text/event-stream").send(sse);
  });
  await providerHttp.listen({ host: "127.0.0.1", port: 0 });
  const providerAddress = providerHttp.server.address();
  if (!providerAddress || typeof providerAddress === "string")
    throw new Error("fixture_provider_bind_failed");
  const sessions: string[] = [];
  const runtime = {
    ensureFreshSession: async ({ accountId }: { accountId: string }) => {
      sessions.push(accountId);
      return {
        accessToken: "synthetic-session-token",
        chatgptAccountId: accountId,
        credentialGeneration: 1,
      };
    },
    classifyFailure: () => ({ code: "unknown" }),
  } as unknown as HostedCodexSessionRuntime;
  const relay = new FetchHostedCodexStreamingRelay(
    runtime,
    new PrismaInvocationGrantRepository(prisma),
    async (_url, init) =>
      fetch(`http://127.0.0.1:${providerAddress.port}/responses`, init),
    { failoverEnabled: true },
  );
  const app = Fastify({ logger: false });
  await registerReviewModelDispatchRoutes(app, api);
  await registerReviewRunHostedModelRoute(
    app,
    createReviewRunHostedModelRoute({
      prisma,
      api,
      native: {
        authorization: {
          authorize: (request) =>
            observeFailure("native_authorization", () =>
              new PrismaHostedCodexRelayAuthorization(prisma, true).authorize(
                request,
              ),
            ),
        },
        relay: {
          open: (request) =>
            observeFailure("native_relay", () => relay.open(request)),
        },
      },
    }),
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_api_bind_failed");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = {
    authorization: "Bearer synthetic-run-authorization",
    "content-type": "application/json",
  };
  return {
    ...base,
    authorization,
    bindingInput,
    hosted,
    budget,
    body,
    context,
    seen,
    diagnostics,
    sessions,
    api,
    async claim(ordinal = 1) {
      return fetch(`${origin}${reviewModelDispatchContract.claimPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify(context(ordinal)),
      });
    },
    async request(ordinal = 1) {
      const claim = context(ordinal);
      return fetch(`${origin}${hostedModelRoutePath}`, {
        method: "POST",
        headers: {
          ...headers,
          [hostedModelGrantHeader]: opaqueGrant,
          ...Object.fromEntries(
            Object.entries(lifecycleVerificationContract.dispatchHeaders).map(
              ([key, name]) => [name, String(Reflect.get(claim, key))],
            ),
          ),
          [reviewModelDispatchHeaders.dispatchVersion]: "2",
          [reviewModelDispatchHeaders.requestOrdinal]: String(ordinal),
          [reviewModelDispatchHeaders.routeIdentityHash]:
            budget.routeIdentityHash,
        },
        body,
      });
    },
    async settle(receiptToken: string, settlement: unknown, ordinal = 1) {
      return fetch(
        `${origin}${reviewModelDispatchContract.basePath}/${context(ordinal).dispatchId}/settle`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [reviewModelDispatchContract.receiptHeader]: receiptToken,
          },
          body: JSON.stringify(settlement),
        },
      );
    },
    expireRunBearer() {
      authorizationActive = false;
    },
    async close() {
      await app.close();
      await providerHttp.close();
      await prisma.$disconnect();
    },
  };
}

function leaseAuthority(lease: ReviewRunCompanionDispatchClaim) {
  return {
    capabilityId: lease.leaseCapabilityId,
    authorizationId: lease.authorizationId,
    mutationEpoch: lease.capabilityMutationEpoch,
    scopeHash: lease.capabilityScopeHash,
    executionId: lease.executionId,
    workSlotId: lease.workSlotId,
    leaseId: lease.leaseId,
    ownerIdHash: lease.ownerIdHash,
    providerInvocationKey: lease.providerInvocationKey,
    purpose: "provider_execution",
    reviewRevisionHash: lease.capabilityReviewRevisionHash,
    ownershipExpiresAt: lease.ownershipExpiresAt,
  };
}
