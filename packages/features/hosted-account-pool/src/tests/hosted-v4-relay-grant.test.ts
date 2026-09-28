import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  reviewHostedRelayExtensionV1,
  reviewInvestigationExtensionV1,
} from "../../../../protocol-review-action-v2/src/generated/review-action-v2.js";
import {
  assertHostedV4RelayScopeCurrent,
  defineHostedV4RelayGrant,
  hostedV4RelayCanaryPolicyFingerprint,
  type HostedV4RelayScope,
} from "../domain/hosted-v4-relay-grant";
import {
  lockCurrentProducerRelease,
  PrismaHostedV4RelayTurn,
} from "../infrastructure/prisma/prisma-hosted-v4-relay-turn";
import { PrismaProducerReleaseRepository } from "../../../review-run-control/src/infrastructure/prisma/prisma-producer-release-repository";
import {
  hostedV4DescriptorExtensionIdentities,
  parseInvestigationAuthorizationDescriptorJson,
} from "../domain/hosted-v4-relay-descriptor";
import {
  PlanNextInvestigationTurn,
  InvestigationStoreTransitionKind,
  canonicalJson,
  investigationDossierCanonicalValue,
} from "../../../review-investigations/src/index";
import { PrismaInvestigationStore } from "../../../review-investigations/src/infrastructure/prisma/prisma-investigation-store";
import { NodeSha256InvestigationDigest } from "../../../review-investigations/src/infrastructure/node/node-sha256-digest";
import { createInvestigationStoreContractSeed } from "../../../review-investigations/src/testing/investigation-store-contract";
import { cleanup, seedExecution } from "../../../review-investigations/src/testing/prisma-investigation-store-harness";
import {
  CurrentInvestigationExecutionAuthority,
  FixedInvestigationClock,
} from "../../../review-investigations/src/testing/investigation-test-kit";

const now = new Date();
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const digest = "a".repeat(64);
const gitSha = "b".repeat(40);

afterEach(() => vi.unstubAllEnvs());

function scope(): HostedV4RelayScope {
  const turnBudgetCanonicalJson = JSON.stringify({
    deadline: later(4).toISOString(),
    maxGatewayOperations: 16,
    maxOutputFindings: 8,
    maxOutputProposals: 8,
    maxOutputTokens: 100,
    maxRequestBytes: 1_000,
    maxRequests: 1,
    maxResponseBytes: 2_000,
    version: 1,
  });
  return {
    version: 4,
    authorizationId: randomUUID(),
    authorizationState: "active",
    mutationEpoch: 1n,
    trustDomain: "trusted_managed",
    investigationCodexRecordingAllowed: true,
    workspaceId: randomUUID(),
    repositoryConnectionId: randomUUID(),
    scmRepositoryIdentityId: randomUUID(),
    githubRepositoryId: "100",
    githubInstallationId: "200",
    pullRequestNumber: 7,
    baseSha: gitSha,
    mergeBaseSha: gitSha,
    headSha: gitSha,
    reviewRevisionHash: digest,
    producerReleaseId: "release",
    producerReleaseRegistered: true,
    actionIdentityHash: digest,
    runtimeIdentityHash: digest,
    gatewayIdentityHash: digest,
    protocolVersion: "2",
    schemaDigest: digest,
    protocolLimitsProfileId: "profile",
    providerInstanceId: "hosted-pool:repository:100",
    repositoryBindingId: "binding",
    bindingRevision: 1,
    bindingActive: true,
    repositorySelected: true,
    poolId: "pool",
    poolActive: true,
    poolAuthzEpoch: 1n,
    runtimeGateActive: true,
    runtimeAuthzEpoch: 1n,
    model: "codex",
    policyFingerprint: hostedV4RelayCanaryPolicyFingerprint({
      accountId: "account", runtimeConfigVersion: 7, model: "codex",
      maxRequests: 1, maxRequestBytes: 1_000,
      maxResponseBytes: 2_000, maxOutputTokens: 100,
    }),
    investigationId: randomUUID(),
    investigationVersion: 1n,
    turnId: randomUUID(),
    turnBudgetCanonicalJson,
    turnBudgetHash: createHash("sha256").update(turnBudgetCanonicalJson).digest("hex"),
    turnPurpose: "discovery",
    planningInputDossierDigest: "c".repeat(64),
    dossierDigest: digest,
    investigationManifestHash: digest,
    executionId: "execution",
    workSlotId: "slot",
    providerVoteLaneId: "codex",
    providerStrategyId: "strategy",
    attemptId: "attempt",
    investigationLease: {
      leaseId: "investigation-lease",
      capabilityId: "investigation-capability",
      ownerIdHash: digest,
      fencingToken: 11n,
      purpose: "relay_turn",
      expiresAt: later(5),
    },
    invocationLease: {
      leaseId: "invocation-lease",
      capabilityId: "invocation-capability",
      ownerIdHash: digest,
      fencingToken: 12n,
      purpose: "provider_execution",
      attemptId: "invocation-attempt",
      providerInvocationKey: "provider-invocation-1",
      expiresAt: later(6),
    },
    authorizationExpiresAt: later(10),
    turnExpiresAt: later(8),
    policyExpiresAt: later(9),
  };
}

function contract(current: HostedV4RelayScope) {
  return defineHostedV4RelayGrant({
    scope: current,
    now,
    maxRequests: 1,
    maxRequestBytes: 1_000,
    maxResponseBytes: 2_000,
    maxOutputTokens: 100,
  });
}

describe("hosted v4 relay turn contract", () => {
  it("pins the reservation identities to the generated protocol extensions", () => {
    expect(hostedV4DescriptorExtensionIdentities.shadow).toEqual({
      extensionId: reviewInvestigationExtensionV1.extensionId,
      schemaDigest: reviewInvestigationExtensionV1.schemaDigest,
      canonicalizerDigest: reviewInvestigationExtensionV1.canonicalizerDigest,
    });
    expect(hostedV4DescriptorExtensionIdentities.relay).toEqual({
      extensionId: reviewHostedRelayExtensionV1.extensionId,
      schemaDigest: reviewHostedRelayExtensionV1.schemaDigest,
      canonicalizerDigest: reviewHostedRelayExtensionV1.canonicalizerDigest,
    });
  });
  it("rejects a noncanonical saved descriptor that authorization restoration rejects", () => {
    const descriptor = {
      authorizationDescriptorVersion: 3,
      capability: "review_investigation_v1",
      coverageProfileHash: digest,
      extensionCanonicalizerDigest: reviewInvestigationExtensionV1.canonicalizerDigest,
      extensionId: reviewInvestigationExtensionV1.extensionId,
      extensionSchemaDigest: reviewInvestigationExtensionV1.schemaDigest,
      policyHash: digest,
      providerCapabilities: [{ providerKind: "codex", capabilities: ["recording"] }],
      hostedRelayExtension: {
        capability: "hosted_relay_turn_v1",
        extensionCanonicalizerDigest: reviewHostedRelayExtensionV1.canonicalizerDigest,
        extensionId: reviewHostedRelayExtensionV1.extensionId,
        extensionSchemaDigest: reviewHostedRelayExtensionV1.schemaDigest,
      },
    };
    expect(parseInvestigationAuthorizationDescriptorJson(canonicalJson(descriptor)))
      .not.toBeNull();
    expect(parseInvestigationAuthorizationDescriptorJson(JSON.stringify(descriptor)))
      .toBeNull();
  });
  it("creates no turn without both exact disposable admission flags", async () => {
    const tx = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) =>
        query.strings.join("").includes('"ProducerRelease"')
          ? [{ producerReleaseId: saved.scope.producerReleaseId, state: "registered" }]
          : [{ now }]),
      hostedCodexV4RelayTurn: { findUnique: vi.fn().mockResolvedValue(null) },
      $executeRaw: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx));
    const store = new PrismaHostedV4RelayTurn({
      $transaction: transaction,
    } as unknown as PrismaClient);
    const saved = contract(scope());
    const input = {
      contract: saved, capabilityTokenHash: digest,
      accountId: "account", credentialGeneration: 1n,
      runtimeConfigVersion: 7,
    };
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "true");
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID", saved.scope.githubRepositoryId);
    await expect(store.reserveGrant(input)).rejects.toThrow(
      "hosted_v4_relay_admission_disabled",
    );
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "1");
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID", "999");
    await expect(store.reserveGrant(input)).rejects.toThrow(
      "hosted_v4_relay_admission_disabled",
    );
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    const forged = contract({ ...saved.scope, policyFingerprint: digest });
    await expect(store.reserveGrant({ ...input, contract: forged })).rejects.toThrow(
      "hosted_v4_relay_grant_facts_invalid",
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("retries a stale release-row snapshot and denies the fresh revoked view", async () => {
    const saved = contract(scope());
    for (const serializationFailure of [
      new Prisma.PrismaClientKnownRequestError(
        "could not serialize access due to concurrent update",
        { code: "P2010", clientVersion: "7.8.0", meta: { code: "40001" } },
      ),
      Object.assign(new Error("raw query failed"), {
        code: "P2010", meta: { code: "40001" },
      }),
      new Prisma.PrismaClientKnownRequestError(
        "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `40001`. Message: `ERROR: could not serialize access due to concurrent update`",
        { code: "P2010", clientVersion: "7.8.0" },
      ),
      new Prisma.PrismaClientKnownRequestError(
        "Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`",
        { code: "P2010", clientVersion: "7.8.0", meta: { message: "could not serialize access due to concurrent update" } },
      ),
      new Prisma.PrismaClientKnownRequestError(
        "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `40001`. Message: `could not serialize access due to read/write dependencies among transactions`",
        { code: "P2010", clientVersion: "7.8.0" },
      ),
    ]) {
      const tx = {
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ now }])
          .mockResolvedValueOnce([{
            producerReleaseId: saved.scope.producerReleaseId, state: "revoked",
          }]),
        hostedCodexV4RelayTurn: { findUnique: vi.fn().mockResolvedValue(null) },
        $executeRaw: vi.fn(),
        hostedCodexInvocationGrant: { create: vi.fn() },
      };
      const transaction = vi.fn()
        .mockRejectedValueOnce(serializationFailure)
        .mockImplementationOnce((callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
      const store = new PrismaHostedV4RelayTurn({
        $transaction: transaction,
      } as unknown as PrismaClient);
      await expect(store.reserveGrant({
        contract: saved, capabilityTokenHash: digest, accountId: "account",
        credentialGeneration: 1n, runtimeConfigVersion: 7,
      })).rejects.toThrow("hosted_v4_relay_reservation_authority_stale");
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.hostedCodexInvocationGrant.create).not.toHaveBeenCalled();
    }
  });

  it("does not retry a differently coded raw-query failure", async () => {
    const saved = contract(scope());
    for (const failure of [
      Object.assign(new Error("raw query failed"), {
        code: "P2010", meta: { code: "23505" },
      }),
      new Prisma.PrismaClientKnownRequestError(
        "Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`",
        { code: "P2010", clientVersion: "7.8.0", meta: { code: "23505" } },
      ),
      new Prisma.PrismaClientKnownRequestError(
        "Raw query failed. Code: `23505`. Message: `could not serialize access due to concurrent update`",
        { code: "P2010", clientVersion: "7.8.0", meta: { message: "could not serialize access due to concurrent update" } },
      ),
      new Prisma.PrismaClientKnownRequestError(
        "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `23505`. Message: `ERROR: duplicate key value violates unique constraint; could not serialize access due to concurrent update`",
        { code: "P2010", clientVersion: "7.8.0" },
      ),
      new Prisma.PrismaClientKnownRequestError(
        "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `40001`. Message: `ERROR: unrelated raw-query failure`",
        { code: "P2010", clientVersion: "7.8.0" },
      ),
    ]) {
      const transaction = vi.fn().mockRejectedValue(failure);
      const store = new PrismaHostedV4RelayTurn({
        $transaction: transaction,
      } as unknown as PrismaClient);
      await expect(store.reserveGrant({
        contract: saved, capabilityTokenHash: digest, accountId: "account",
        credentialGeneration: 1n, runtimeConfigVersion: 7,
      })).rejects.toBe(failure);
      expect(transaction).toHaveBeenCalledTimes(1);
    }
  });

  it("bounds repeated adapter serialization failures before any grant or request write", async () => {
    const saved = contract(scope());
    const failure = new Prisma.PrismaClientKnownRequestError(
      "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `40001`. Message: `ERROR: could not serialize access due to concurrent update`",
      { code: "P2010", clientVersion: "7.8.0", meta: { message: "could not serialize access due to concurrent update" } },
    );
    for (const operation of ["grant", "request"] as const) {
      const transaction = vi.fn().mockRejectedValue(failure);
      const store = new PrismaHostedV4RelayTurn({
        $transaction: transaction,
      } as unknown as PrismaClient);
      const result = operation === "grant"
        ? store.reserveGrant({
          contract: saved, capabilityTokenHash: digest, accountId: "account",
          credentialGeneration: 1n, runtimeConfigVersion: 7,
        })
        : store.reservePreparedRequest({
          contract: saved, grantId: "grant", idempotencyKey: "one", ordinal: 1,
          body: new TextEncoder().encode('{"model":"codex","max_output_tokens":100}'),
          accountId: "account", credentialGeneration: 1n, ownerIdHash: digest,
        });
      await expect(result).rejects.toBe(failure);
      expect(transaction).toHaveBeenCalledTimes(3);
    }
  });

  it("reserves the turn and finite-account grant in one transaction", async () => {
    const saved = contract(scope());
    const s = saved.scope;
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "1");
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID", s.githubRepositoryId);
    const authorization = {
      authorizationId: s.authorizationId, state: "active", expiresAt: later(10),
      mutationEpoch: s.mutationEpoch, workspaceId: s.workspaceId,
      repositoryConnectionId: s.repositoryConnectionId,
      scmRepositoryIdentityId: s.scmRepositoryIdentityId,
      pullRequestNumber: s.pullRequestNumber, baseSha: s.baseSha,
      mergeBaseSha: s.mergeBaseSha, headSha: s.headSha,
      reviewRevisionHash: s.reviewRevisionHash, producerReleaseId: s.producerReleaseId,
      trustDomain: s.trustDomain, selectedProtocolVersion: s.protocolVersion,
      schemaDigest: s.schemaDigest, protocolLimitsProfileId: s.protocolLimitsProfileId,
      sourceRunId: "run-1", sourceRunAttempt: "1",
      reviewInvestigationAuthorizationDescriptorCanonicalJson: canonicalJson({
        authorizationDescriptorVersion: 3,
        capability: "review_investigation_v1",
        coverageProfileHash: digest,
        extensionCanonicalizerDigest: reviewInvestigationExtensionV1.canonicalizerDigest,
        extensionId: "review-investigation-shadow.v1",
        extensionSchemaDigest: reviewInvestigationExtensionV1.schemaDigest,
        hostedRelayExtension: {
          capability: "hosted_relay_turn_v1",
          extensionCanonicalizerDigest: reviewHostedRelayExtensionV1.canonicalizerDigest,
          extensionId: "review-investigation-hosted-relay.v1",
          extensionSchemaDigest: reviewHostedRelayExtensionV1.schemaDigest,
        },
        policyHash: digest,
        providerCapabilities: [{ providerKind: "codex", capabilities: ["recording"] }],
      }),
    };
    const execution = {
      executionId: s.executionId, state: "running", authorizationId: s.authorizationId,
      mutationEpoch: s.mutationEpoch, reviewRevisionHash: s.reviewRevisionHash,
      producerReleaseId: s.producerReleaseId, workspaceId: s.workspaceId,
      repositoryConnectionId: s.repositoryConnectionId,
      scmRepositoryIdentityId: s.scmRepositoryIdentityId,
      pullRequestNumber: s.pullRequestNumber, baseSha: s.baseSha,
      mergeBaseSha: s.mergeBaseSha, headSha: s.headSha,
      sourceRunId: "run-1", sourceRunAttempt: "1", generation: 1n,
      protocolLimitsProfileId: s.protocolLimitsProfileId,
    };
    const investigation = {
      investigationId: s.investigationId, state: "turn_leased",
      runtimeProfile: "gateway_attested_agent_v1",
      workspaceId: s.workspaceId, repositoryConnectionId: s.repositoryConnectionId,
      scmRepositoryIdentityId: s.scmRepositoryIdentityId,
      pullRequestNumber: s.pullRequestNumber, baseSha: s.baseSha,
      mergeBaseSha: s.mergeBaseSha, headSha: s.headSha,
      reviewRevisionHash: s.reviewRevisionHash, producerReleaseId: s.producerReleaseId,
      providerVoteLaneId: s.providerVoteLaneId, providerStrategyId: s.providerStrategyId,
      investigationManifestHash: s.investigationManifestHash,
      activeTurnId: s.turnId, version: s.investigationVersion,
      dossierDigest: s.dossierDigest, executionId: s.executionId, workSlotId: s.workSlotId,
    };
    const leaseBase = {
      authorizationId: s.authorizationId, workspaceId: s.workspaceId,
      repositoryConnectionId: s.repositoryConnectionId,
      scmRepositoryIdentityId: s.scmRepositoryIdentityId,
      pullRequestNumber: s.pullRequestNumber, mutationEpoch: s.mutationEpoch,
      executionId: s.executionId, workSlotId: s.workSlotId,
      baseSha: s.baseSha, mergeBaseSha: s.mergeBaseSha, headSha: s.headSha,
      reviewRevisionHash: s.reviewRevisionHash, state: "active", expiresAt: later(5),
    };
    const investigationLease = {
      ...leaseBase, leaseId: s.investigationLease.leaseId, purpose: "relay_turn",
      investigationVersion: s.investigationVersion, turnPurpose: s.turnPurpose,
      providerVoteLaneId: s.providerVoteLaneId, providerStrategyId: s.providerStrategyId,
      investigationManifestHash: s.investigationManifestHash, attemptId: s.attemptId,
      investigationId: s.investigationId, turnId: s.turnId,
      leaseCapabilityId: s.investigationLease.capabilityId,
      ownerIdHash: s.investigationLease.ownerIdHash,
      fencingToken: s.investigationLease.fencingToken,
    };
    const invocationLease = {
      ...leaseBase, leaseId: s.invocationLease.leaseId,
      purpose: "provider_execution", executionGeneration: 1n,
      producerReleaseId: s.producerReleaseId,
      expiresAt: s.invocationLease.expiresAt,
      leaseCapabilityId: s.invocationLease.capabilityId,
      ownerIdHash: s.invocationLease.ownerIdHash,
      fencingToken: s.invocationLease.fencingToken,
      attemptId: s.invocationLease.attemptId,
      providerInvocationKey: s.invocationLease.providerInvocationKey,
    };
    const scopeRow = {
      scopeHash: saved.scopeHash, scopeCanonical: JSON.stringify(s, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value),
      state: "open", expiresAt: saved.expiresAt,
      maxRequests: saved.maxRequests, maxRequestBytes: saved.maxRequestBytes,
      maxResponseBytes: saved.maxResponseBytes, maxOutputTokens: saved.maxOutputTokens,
    };
    const createGrant = vi.fn().mockResolvedValue({});
    const createRequest = vi.fn().mockImplementation(async ({ data }: { data: { id: string } }) => data);
    const createEffect = vi.fn().mockImplementation(async ({ data }: { data: { id: string } }) => data);
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ now }])
        .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
        .mockResolvedValueOnce([scopeRow])
        .mockResolvedValueOnce([scopeRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "account" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
        .mockResolvedValueOnce([{
          activeExecutionId: s.executionId, preparedExecutionId: null,
          lastAllocatedGeneration: execution.generation,
          currentReviewRevisionHash: s.reviewRevisionHash,
        }])
        .mockResolvedValueOnce([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedCodexV4RelayTurn: { findUnique: vi.fn().mockResolvedValue(null) },
      hostedCodexInvocationGrant: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { maxRequests: 0 } }),
        create: createGrant,
      },
      hostedCodexRelayRequest: {
        findFirst: vi.fn().mockResolvedValue(null), create: createRequest,
      },
      hostedCodexUpstreamEffectAttempt: {
        findFirst: vi.fn().mockResolvedValue(null), create: createEffect,
      },
      reviewRunAuthorization: { findUnique: vi.fn().mockResolvedValue(authorization) },
      producerRelease: { findUnique: vi.fn().mockResolvedValue({
        state: "registered", schemaDigest: s.schemaDigest,
        protocolLimitsProfileId: s.protocolLimitsProfileId,
        wrapperEntrypointDigest: s.actionIdentityHash,
        runtimeEntrypointDigest: s.runtimeIdentityHash,
        contextGatewayEntrypointDigest: s.gatewayIdentityHash,
      }) },
      reviewExecutionV2: { findUnique: vi.fn().mockResolvedValue(execution) },
      reviewExecutionWorkSlotV2: { findUnique: vi.fn().mockResolvedValue({
        state: "leased", activeLeaseId: s.invocationLease.leaseId,
      }) },
      reviewInvestigation: { findUnique: vi.fn().mockResolvedValue(investigation) },
      reviewInvestigationTurn: { findUnique: vi.fn().mockResolvedValue({
        investigationId: s.investigationId, state: "leased", purpose: s.turnPurpose,
        leasedAtVersion: s.investigationVersion, dossierDigest: s.planningInputDossierDigest,
        expiresAt: later(8), turnBudgetCanonicalJson: s.turnBudgetCanonicalJson,
        turnBudgetHash: s.turnBudgetHash,
      }) },
      reviewInvestigationLease: { findUnique: vi.fn().mockResolvedValue(investigationLease) },
      reviewInvocationLeaseV2: { findUnique: vi.fn().mockResolvedValue(invocationLease) },
      reviewRequestedIntent: { findMany: vi.fn().mockResolvedValue([{
        requestId: "requested-intent-1", admissionState: "admitted", state: "dispatched",
        workspaceId: s.workspaceId, repositoryConnectionId: s.repositoryConnectionId,
        scmRepositoryIdentityId: s.scmRepositoryIdentityId,
        pullRequestNumber: s.pullRequestNumber, reviewRevisionHash: s.reviewRevisionHash,
        headSha: s.headSha, sourceRunId: "run-1", sourceRunAttempt: "1",
      }]) },
      hostedCodexAccount: {
        findMany: vi.fn().mockResolvedValue([{
          id: "account", activeGeneration: 1n,
          credentialVersions: [{ generation: 1n, credentialExpiresAt: null }],
        }]),
        findUnique: vi.fn().mockResolvedValue({
          id: "account", state: "healthy", workspaceId: s.workspaceId,
          poolId: s.poolId, activeGeneration: 1n,
        }),
      },
      hostedCodexCredentialVersion: { findUnique: vi.fn().mockResolvedValue({
        workspaceId: s.workspaceId, poolId: s.poolId, credentialExpiresAt: null,
      }) },
      hostedCodexRepositoryBinding: { findUnique: vi.fn().mockResolvedValue({
        status: "active", revision: BigInt(s.bindingRevision), poolId: s.poolId,
        workspaceId: s.workspaceId, repositoryConnectionId: s.repositoryConnectionId,
        pool: { status: "active", authzEpoch: s.poolAuthzEpoch },
      }) },
      repositoryConnection: { findUnique: vi.fn().mockResolvedValue({
        id: s.repositoryConnectionId, workspaceId: s.workspaceId,
        scmRepositoryIdentityId: s.scmRepositoryIdentityId,
        provider: "github", selected: true, archived: false,
        githubRepositoryId: BigInt(s.githubRepositoryId),
        installation: { status: "active", workspaceId: s.workspaceId,
          githubInstallationId: BigInt(s.githubInstallationId) },
      }) },
      scmRepositoryIdentity: { findUnique: vi.fn().mockResolvedValue({
        provider: "github", currentWorkspaceId: s.workspaceId,
        currentRepositoryConnectionId: s.repositoryConnectionId,
        externalRepositoryId: s.githubRepositoryId,
      }) },
      reviewConfiguration: { findUnique: vi.fn().mockImplementation(async (query: {
        where: { workspaceId_targetKey: { targetKey: string } };
      }) => query.where.workspaceId_targetKey.targetKey.startsWith("repo:")
        ? { versions: [{ version: 7, providerKind: "codex",
            providerAuthMode: "codex_subscription_oauth_hosted_pool",
            model: s.model, providerLimit: 1, providerMaxParallel: 1,
            investigationRecordingEnabled: true, providers: [] }] }
        : null) },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx));
    const store = new PrismaHostedV4RelayTurn({ $transaction: transaction } as unknown as PrismaClient);
    const grantInput = {
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    };
    await expect(store.reserveGrant(grantInput)).rejects.toThrow(
      "hosted_v4_relay_reservation_authority_stale",
    );
    expect(createGrant).not.toHaveBeenCalled();
    transaction.mockClear();
    tx.$executeRaw.mockClear();
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "issued", grantId: `v4-grant-${saved.logicalTurnKey}` });
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    const fundedTurnQuery = tx.$queryRaw.mock.calls[6]?.[0] as Prisma.Sql;
    expect(fundedTurnQuery.strings.join("")).toContain('i."executionId"');
    expect(fundedTurnQuery.strings.join("")).toContain('g."providerInvocationKey"');
    const grantReleaseFence = tx.$queryRaw.mock.calls[1]?.[0] as Prisma.Sql;
    expect(grantReleaseFence.strings.join("")).toContain('"ProducerRelease"');
    expect(grantReleaseFence.strings.join("")).toContain("FOR SHARE");
    expect(createGrant).toHaveBeenCalledWith({ data: expect.objectContaining({
      authorityKind: "v4_relay_turn", v4TurnKey: saved.logicalTurnKey,
      v4ScopeHash: saved.scopeHash, backupAccountId: null,
      policyVersion: "hosted-v4-disposable-eight-v1",
      reviewRequestId: "requested-intent-1", providerInvocationKey: "provider-invocation-1",
      maxRequests: 1,
    }) });
    const grantData = createGrant.mock.calls[0]![0].data;
    const issuedGrant = {
      ...grantData, status: "issued", requestCount: 0, inFlight: 0,
    };
    tx.hostedCodexInvocationGrant.findUnique.mockResolvedValue(issuedGrant);
    const boundedBody = new TextEncoder().encode(
      JSON.stringify({ model: s.model, max_output_tokens: 100 }),
    );
    const bodyHash = createHash("sha256").update(boundedBody).digest("hex");
    const requestInput = {
      contract: saved, grantId: grantData.id, idempotencyKey: "one",
      ordinal: 1 as const, body: boundedBody, accountId: "account",
      credentialGeneration: 1n, ownerIdHash: digest,
    };
    // A stale plain release read must never be enough to debit a request.
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([]);
    await expect(store.reservePreparedRequest(requestInput)).rejects.toThrow(
      "hosted_v4_relay_reservation_authority_stale",
    );
    expect(createRequest).not.toHaveBeenCalled();
    expect(createEffect).not.toHaveBeenCalled();
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    const prepared = await store.reservePreparedRequest(requestInput);
    expect(prepared).toMatchObject({
      status: "prepared", grantId: grantData.id, ordinal: 1, requestHash: bodyHash,
    });
    const requestReleaseFence = tx.$queryRaw.mock.calls[1]?.[0] as Prisma.Sql;
    expect(requestReleaseFence.strings.join("")).toContain('"ProducerRelease"');
    expect(requestReleaseFence.strings.join("")).toContain("FOR SHARE");
    expect(createRequest).toHaveBeenCalledWith({ data: expect.objectContaining({
      grantId: grantData.id, requestHash: bodyHash,
      requestBytes: boundedBody.byteLength, status: "received",
    }) });
    expect(createEffect).toHaveBeenCalledWith({ data: expect.objectContaining({
      grantId: grantData.id, relayRequestId: prepared.requestId,
      requestHash: bodyHash, state: "prepared", accountId: "account",
      credentialGeneration: 1n,
    }) });
    const savedRequest = createRequest.mock.results[0]!.value;
    const savedEffect = createEffect.mock.results[0]!.value;
    tx.hostedCodexInvocationGrant.findUnique.mockResolvedValue({
      ...issuedGrant, status: "exhausted", requestCount: 1, inFlight: 1,
    });
    tx.hostedCodexRelayRequest.findFirst.mockResolvedValue({
      ...await savedRequest, status: "received",
    });
    tx.hostedCodexUpstreamEffectAttempt.findFirst.mockResolvedValue(await savedEffect);
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reservePreparedRequest(requestInput)).resolves.toMatchObject({
      status: "restored", requestId: prepared.requestId,
      effectId: prepared.effectId, requestHash: bodyHash,
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow]);
    await expect(store.reservePreparedRequest({
      ...requestInput,
      body: new TextEncoder().encode(JSON.stringify({
        model: s.model, max_output_tokens: 99,
      })),
    })).rejects.toThrow("hosted_v4_relay_request_conflict");
    expect(createRequest).toHaveBeenCalledOnce();
    expect(createEffect).toHaveBeenCalledOnce();
    const driftedRequestDescriptor = JSON.parse(
      authorization.reviewInvestigationAuthorizationDescriptorCanonicalJson,
    ) as Record<string, unknown>;
    (driftedRequestDescriptor.hostedRelayExtension as Record<string, unknown>)
      .extensionSchemaDigest = "0".repeat(64);
    tx.reviewRunAuthorization.findUnique.mockResolvedValue({
      ...authorization,
      reviewInvestigationAuthorizationDescriptorCanonicalJson:
        canonicalJson(driftedRequestDescriptor),
    });
    tx.hostedCodexInvocationGrant.findUnique.mockResolvedValue(issuedGrant);
    tx.hostedCodexRelayRequest.findFirst.mockResolvedValue(null);
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reservePreparedRequest(requestInput)).rejects.toThrow(
      "hosted_v4_relay_reservation_authority_stale",
    );
    expect(createRequest).toHaveBeenCalledOnce();
    expect(createEffect).toHaveBeenCalledOnce();
    tx.reviewRunAuthorization.findUnique.mockResolvedValue({
      ...authorization,
      reviewInvestigationAuthorizationDescriptorCanonicalJson:
        ` ${authorization.reviewInvestigationAuthorizationDescriptorCanonicalJson}`,
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reservePreparedRequest(requestInput)).rejects.toThrow(
      "hosted_v4_relay_reservation_authority_stale",
    );
    expect(createRequest).toHaveBeenCalledOnce();
    expect(createEffect).toHaveBeenCalledOnce();
    tx.reviewRunAuthorization.findUnique.mockResolvedValue(authorization);
    tx.hostedCodexV4RelayTurn.findUnique.mockResolvedValue({ state: "open" });
    tx.hostedCodexInvocationGrant.findUnique.mockResolvedValue({
      ...issuedGrant,
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    tx.$executeRaw.mockClear();
    createGrant.mockClear();
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "restored", grantId: grantData.id });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(createGrant).not.toHaveBeenCalled();
    // A committed grant ACK can be lost before the run is revoked. The same
    // saved identity remains discoverable, but no bearer is reissued.
    tx.reviewRunAuthorization.findUnique.mockResolvedValue({
      ...authorization, state: "revoked",
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    tx.reviewRunAuthorization.findUnique.mockResolvedValue(authorization);
    // The saved descriptor is an independent admission fence. A shape-valid
    // digest from another extension contract must not restore or debit work.
    const validDescriptor = JSON.parse(
      authorization.reviewInvestigationAuthorizationDescriptorCanonicalJson,
    ) as Record<string, unknown>;
    for (const [extension, field] of [
      ["shadow", "extensionSchemaDigest"],
      ["shadow", "extensionCanonicalizerDigest"],
      ["relay", "extensionSchemaDigest"],
      ["relay", "extensionCanonicalizerDigest"],
    ] as const) {
      const drifted = structuredClone(validDescriptor);
      const target = extension === "relay"
        ? drifted.hostedRelayExtension as Record<string, unknown>
        : drifted;
      target[field] = "0".repeat(64);
      tx.reviewRunAuthorization.findUnique.mockResolvedValue({
        ...authorization,
        reviewInvestigationAuthorizationDescriptorCanonicalJson: canonicalJson(drifted),
      });
      tx.$queryRaw.mockReset()
        .mockResolvedValueOnce([{ now }])
        .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
        .mockResolvedValueOnce([scopeRow])
        .mockResolvedValueOnce([{ id: grantData.id }])
        .mockResolvedValueOnce([{ id: "account" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
        .mockResolvedValueOnce([{
          activeExecutionId: s.executionId, preparedExecutionId: null,
          lastAllocatedGeneration: execution.generation,
          currentReviewRevisionHash: s.reviewRevisionHash,
        }])
        .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
      await expect(store.reserveGrant({
        contract: saved, capabilityTokenHash: digest, accountId: "account",
        credentialGeneration: 1n, runtimeConfigVersion: 7,
      })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
      expect(createGrant).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    }
    const invalidDependencies = structuredClone(validDescriptor);
    invalidDependencies.providerCapabilities = [{
      providerKind: "codex", capabilities: ["context_critic", "recording"],
    }];
    tx.reviewRunAuthorization.findUnique.mockResolvedValue({
      ...authorization,
      reviewInvestigationAuthorizationDescriptorCanonicalJson: canonicalJson(invalidDependencies),
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    tx.reviewRunAuthorization.findUnique.mockResolvedValue(authorization);
    // Saved authorization, leases and execution still agree; current
    // repository authority alone has closed. No replacement grant is issued.
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "paused", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: "superseding-execution", preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation + 1n,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.reviewRunAuthorization.findUnique.mockResolvedValue({
      ...authorization,
      reviewInvestigationAuthorizationDescriptorCanonicalJson: canonicalJson({
        authorizationDescriptorVersion: 3, capability: "review_investigation_v1",
        coverageProfileHash: digest,
        extensionCanonicalizerDigest: reviewInvestigationExtensionV1.canonicalizerDigest,
        extensionId: reviewInvestigationExtensionV1.extensionId,
        extensionSchemaDigest: reviewInvestigationExtensionV1.schemaDigest,
        policyHash: digest,
        providerCapabilities: [{ providerKind: "codex", capabilities: ["recording"] }],
      }),
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.reviewRunAuthorization.findUnique.mockResolvedValue(authorization);
    tx.reviewInvestigationTurn.findUnique.mockResolvedValue({
      investigationId: s.investigationId, state: "leased", purpose: s.turnPurpose,
      leasedAtVersion: s.investigationVersion,
      dossierDigest: s.planningInputDossierDigest,
      expiresAt: later(9),
      turnBudgetCanonicalJson: s.turnBudgetCanonicalJson,
      turnBudgetHash: s.turnBudgetHash,
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.reviewInvestigationTurn.findUnique.mockResolvedValue({
      investigationId: s.investigationId, state: "leased", purpose: s.turnPurpose,
      leasedAtVersion: s.investigationVersion,
      dossierDigest: s.planningInputDossierDigest,
      expiresAt: later(8),
      turnBudgetCanonicalJson: s.turnBudgetCanonicalJson,
      turnBudgetHash: s.turnBudgetHash,
    });
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "0");
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "1");
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: "b".repeat(64), accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).rejects.toThrow("hosted_v4_relay_grant_conflict");
    expect(createGrant).not.toHaveBeenCalled();
    // Restoring a bearer after a moved lease revision must recheck the saved
    // turn, even when the grant ID and token hash still match.
    tx.reviewInvestigationLease.findUnique.mockResolvedValue({
      ...investigationLease, headSha: "c".repeat(40),
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.reviewInvestigationLease.findUnique.mockResolvedValue(investigationLease);
    tx.repositoryConnection.findUnique.mockResolvedValue({
      id: s.repositoryConnectionId, workspaceId: s.workspaceId,
      scmRepositoryIdentityId: s.scmRepositoryIdentityId,
      provider: "github", selected: false, archived: false,
      githubRepositoryId: BigInt(s.githubRepositoryId),
      installation: { status: "active", workspaceId: s.workspaceId,
        githubInstallationId: BigInt(s.githubInstallationId) },
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.repositoryConnection.findUnique.mockResolvedValue({
      id: s.repositoryConnectionId, workspaceId: s.workspaceId,
      scmRepositoryIdentityId: s.scmRepositoryIdentityId,
      provider: "github", selected: true, archived: false,
      githubRepositoryId: BigInt(s.githubRepositoryId),
      installation: { status: "active", workspaceId: s.workspaceId,
        githubInstallationId: BigInt(s.githubInstallationId) },
    });
    tx.reviewInvocationLeaseV2.findUnique.mockResolvedValue({
      ...invocationLease, attemptId: "different-invocation-attempt",
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.reviewInvocationLeaseV2.findUnique.mockResolvedValue(invocationLease);
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([{ id: "other-funded-grant" }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.reviewConfiguration.findUnique.mockResolvedValue({ versions: [{
      version: 8, providerKind: "codex",
      providerAuthMode: "codex_subscription_oauth_hosted_pool",
      model: s.model, providerLimit: 1, providerMaxParallel: 1,
      investigationRecordingEnabled: true, providers: [],
    }] });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
    tx.reviewConfiguration.findUnique.mockResolvedValue({ versions: [{
      version: 7, providerKind: "codex",
      providerAuthMode: "codex_subscription_oauth_hosted_pool",
      model: s.model, providerLimit: 1, providerMaxParallel: 1,
      investigationRecordingEnabled: true, providers: [],
    }] });
    tx.producerRelease.findUnique.mockResolvedValue({
      state: "registered", schemaDigest: s.schemaDigest,
      protocolLimitsProfileId: s.protocolLimitsProfileId,
      wrapperEntrypointDigest: s.actionIdentityHash,
      runtimeEntrypointDigest: "c".repeat(64),
      contextGatewayEntrypointDigest: s.gatewayIdentityHash,
    });
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([scopeRow])
      .mockResolvedValueOnce([{ id: grantData.id }])
      .mockResolvedValueOnce([{ id: "account" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ mode: "v2_active", epoch: s.mutationEpoch }])
      .mockResolvedValueOnce([{
        activeExecutionId: s.executionId, preparedExecutionId: null,
        lastAllocatedGeneration: execution.generation,
        currentReviewRevisionHash: s.reviewRevisionHash,
      }])
      .mockResolvedValueOnce([{ producerReleaseId: s.producerReleaseId, state: "registered" }])
      .mockResolvedValueOnce([{ status: "active", authzEpoch: s.runtimeAuthzEpoch }]);
    await expect(store.reserveGrant({
      contract: saved, capabilityTokenHash: digest, accountId: "account",
      credentialGeneration: 1n, runtimeConfigVersion: 7,
    })).resolves.toEqual({ status: "recovery_required", grantId: grantData.id });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("rejects an unbounded body before opening a reservation transaction", async () => {
    const transaction = vi.fn();
    const store = new PrismaHostedV4RelayTurn({
      $transaction: transaction,
    } as unknown as PrismaClient);
    const saved = contract(scope());
    const base = {
      contract: saved,
      grantId: "grant",
      idempotencyKey: "request",
      ordinal: 1 as const,
      accountId: "account",
      credentialGeneration: 1n,
      ownerIdHash: digest,
    };
    for (const [body, error] of [
      [{ model: saved.scope.model }, "hosted_v4_relay_request_output_limit_invalid"],
      [{ model: saved.scope.model, max_output_tokens: saved.maxOutputTokens + 1 },
        "hosted_v4_relay_request_output_limit_invalid"],
      [{ model: "other", max_output_tokens: saved.maxOutputTokens },
        "hosted_v4_relay_request_model_invalid"],
    ] as const) {
      await expect(store.reservePreparedRequest({
        ...base,
        body: new TextEncoder().encode(JSON.stringify(body)),
      })).rejects.toThrow(error);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it("stops a new request debit after the disposable admission flag closes", async () => {
    const saved = contract(scope());
    const scopeRow = {
      scopeHash: saved.scopeHash,
      scopeCanonical: JSON.stringify(saved.scope, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value),
      state: "open", expiresAt: saved.expiresAt,
      maxRequests: saved.maxRequests, maxRequestBytes: saved.maxRequestBytes,
      maxResponseBytes: saved.maxResponseBytes, maxOutputTokens: saved.maxOutputTokens,
    };
    const createRequest = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{ now }])
        .mockResolvedValueOnce([{ producerReleaseId: saved.scope.producerReleaseId, state: "registered" }])
        .mockResolvedValueOnce([scopeRow]).mockResolvedValueOnce([scopeRow]),
      hostedCodexInvocationGrant: { findUnique: vi.fn().mockResolvedValue({
        id: "grant", authorityKind: "v4_relay_turn",
        v4TurnKey: saved.logicalTurnKey, v4ScopeHash: saved.scopeHash,
        backupAccountId: null, activeAccountId: "account", primaryAccountId: "account",
        maxRequests: saved.maxRequests, maxRequestBytes: saved.maxRequestBytes,
        maxResponseBytes: saved.maxResponseBytes, maxOutputTokens: saved.maxOutputTokens,
      }) },
      hostedCodexRelayRequest: { findFirst: vi.fn().mockResolvedValue(null),
        create: createRequest },
    };
    const store = new PrismaHostedV4RelayTurn({
      $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as PrismaClient);
    vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "0");
    await expect(store.reservePreparedRequest({
      contract: saved, grantId: "grant", idempotencyKey: "request", ordinal: 1,
      body: new TextEncoder().encode('{"model":"codex","max_output_tokens":100}'),
      accountId: "account", credentialGeneration: 1n, ownerIdHash: digest,
    })).rejects.toThrow("hosted_v4_relay_admission_disabled");
    expect(createRequest).not.toHaveBeenCalled();
  });

  // Regression: treating a shadow lease as dispatch authority would admit it.
  it("rejects the existing shadow_turn lease purpose", () => {
    const current = scope();
    expect(() =>
      contract({
        ...current,
        investigationLease: {
          ...current.investigationLease,
          purpose: "shadow_turn",
        },
      } as unknown as HostedV4RelayScope),
    ).toThrow();
  });

  // Regression: replacement lease fences or moved head would retain old authority.
  it("rejects a stale scope or fence and caps expiry at the first deadline", () => {
    const current = scope();
    const saved = contract(current);
    expect(saved.expiresAt).toEqual(later(4));
    expect(saved.maxConcurrentRequests).toBe(1);
    expect(() =>
      assertHostedV4RelayScopeCurrent(
        saved,
        {
          ...current,
          headSha: "c".repeat(40),
        },
        now,
      ),
    ).toThrow("hosted_v4_relay_scope_stale");
    expect(() =>
      assertHostedV4RelayScopeCurrent(
        saved,
        {
          ...current,
          authorizationExpiresAt: later(12),
          investigationLease: {
            ...current.investigationLease,
            expiresAt: later(7),
          },
          invocationLease: {
            ...current.invocationLease,
            expiresAt: later(8),
          },
        },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      assertHostedV4RelayScopeCurrent(
        saved,
        {
          ...current,
          invocationLease: { ...current.invocationLease, fencingToken: 13n },
        },
        now,
      ),
    ).toThrow("hosted_v4_relay_scope_stale");
  });

  // Regression: an unrelated grant identity could reset one logical turn.
  it("keeps the logical turn key across replacement lease attempts", () => {
    const current = scope();
    const original = contract(current);
    const replacement = contract({
      ...current,
      attemptId: "replacement",
      investigationLease: {
        ...current.investigationLease,
        leaseId: "replacement-lease",
        fencingToken: 13n,
      },
    });
    expect(replacement.logicalTurnKey).toBe(original.logicalTurnKey);
    expect(replacement.scopeHash).not.toBe(original.scopeHash);
  });

  it("requires the saved canonical turn budget to match every grant limit", () => {
    const current = scope();
    expect(() =>
      defineHostedV4RelayGrant({
        scope: current,
        now,
        maxRequests: 2,
        maxRequestBytes: 1_000,
        maxResponseBytes: 2_000,
        maxOutputTokens: 100,
      }),
    ).toThrow("hosted_v4_relay_turn_budget_mismatch");
    expect(() => contract({ ...current, turnBudgetHash: digest })).toThrow(
      "hosted_v4_relay_turn_budget_mismatch",
    );
  });

  it("rejects a saved relay deadline beyond the leased turn", () => {
    const current = scope();
    const turnBudgetCanonicalJson = JSON.stringify({
      ...JSON.parse(current.turnBudgetCanonicalJson),
      deadline: new Date(current.turnExpiresAt.getTime() + 60_000).toISOString(),
    });
    expect(() => contract({
      ...current,
      turnBudgetCanonicalJson,
      turnBudgetHash: createHash("sha256").update(turnBudgetCanonicalJson).digest("hex"),
    })).toThrow("hosted_v4_relay_turn_budget_mismatch");
  });

  it("rejects a forged turn purpose before a relay turn can be reserved", () => {
    expect(() => contract({ ...scope(), turnPurpose: "investigate" } as unknown as HostedV4RelayScope))
      .toThrow();
  });

  it("retries a serialization race to restore the same reserved request", async () => {
    const saved = contract(scope());
    const restored = {
      status: "restored", grantId: "grant", requestId: "request",
      effectId: "effect", ordinal: 1, requestHash: digest,
    } as const;
    for (const serializationFailure of [
      new Prisma.PrismaClientKnownRequestError(
        "serialization failure", { code: "P2034", clientVersion: "7.8.0" },
      ),
      Object.assign(new Error("raw query failed"), {
        code: "P2010", meta: { code: "40001" },
      }),
      new Prisma.PrismaClientKnownRequestError(
        "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `40001`. Message: `ERROR: could not serialize access due to concurrent update`",
        { code: "P2010", clientVersion: "7.8.0" },
      ),
      new Prisma.PrismaClientKnownRequestError(
        "Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`",
        { code: "P2010", clientVersion: "7.8.0", meta: { message: "could not serialize access due to concurrent update" } },
      ),
      new Prisma.PrismaClientKnownRequestError(
        "Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `40001`. Message: `could not serialize access due to read/write dependencies among transactions`",
        { code: "P2010", clientVersion: "7.8.0" },
      ),
    ]) {
      const transaction = vi.fn()
        .mockRejectedValueOnce(serializationFailure)
        .mockResolvedValueOnce(restored);
      const store = new PrismaHostedV4RelayTurn({
        $transaction: transaction,
      } as unknown as PrismaClient);
      await expect(store.reservePreparedRequest({
        contract: saved, grantId: "grant", idempotencyKey: "one", ordinal: 1,
        body: new TextEncoder().encode('{"model":"codex","max_output_tokens":100}'),
        accountId: "account", credentialGeneration: 1n,
        ownerIdHash: digest,
      })).resolves.toEqual(restored);
      expect(transaction).toHaveBeenCalledTimes(2);
    }
  });

  it("never classifies a committed dispatch as an expired prepared no-effect", async () => {
    const effectUpdate = vi.fn();
    const requestUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{ state: "open" }])
        .mockResolvedValueOnce([{ now: new Date() }]),
      hostedCodexInvocationGrant: { findUnique: vi.fn().mockResolvedValue({
        id: "grant", authorityKind: "v4_relay_turn", status: "exhausted",
        requestCount: 1, inFlight: 1,
      }) },
      hostedCodexRelayRequest: { findFirst: vi.fn().mockResolvedValue({
        id: "request", ordinal: 1, status: "received",
      }), updateMany: requestUpdate },
      hostedCodexUpstreamEffectAttempt: { findFirst: vi.fn().mockResolvedValue({
        id: "effect", attemptOrdinal: 1, state: "dispatching",
        dispatchStartedAt: new Date(), responseStartedAt: null,
        completedAt: null, leaseExpiresAt: new Date(0),
      }), updateMany: effectUpdate },
    };
    const store = new PrismaHostedV4RelayTurn({
      $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as PrismaClient);
    await expect(store.reconcileExpiredPrepared(digest)).resolves.toBe("recovery_required");
    expect(effectUpdate).not.toHaveBeenCalled();
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it("classifies an expired unsent reservation after grant revocation", async () => {
    const expiredAt = new Date(Date.now() - 60_000);
    let effectState = "prepared";
    let requestState = "received";
    const effectUpdate = vi.fn().mockImplementation(async () => {
      effectState = "failed_no_effect";
      return { count: 1 };
    });
    const requestUpdate = vi.fn().mockImplementation(async () => {
      requestState = "failed";
      return { count: 1 };
    });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{ state: "open" }])
        .mockResolvedValueOnce([{ now: new Date() }]),
      hostedCodexInvocationGrant: { findUnique: vi.fn().mockResolvedValue({
        id: "grant", authorityKind: "v4_relay_turn", status: "revoked",
        requestCount: 1, inFlight: 1,
      }) },
      hostedCodexRelayRequest: { findFirst: vi.fn().mockImplementation(async () => ({
        id: "request", ordinal: 1, status: requestState,
      })), updateMany: requestUpdate },
      hostedCodexUpstreamEffectAttempt: { findFirst: vi.fn().mockImplementation(async () => ({
        id: "effect", attemptOrdinal: 1, state: effectState, fenceEpoch: 1n,
        dispatchStartedAt: null, responseStartedAt: null, completedAt: null,
        leaseExpiresAt: expiredAt,
      })), updateMany: effectUpdate },
    };
    const store = new PrismaHostedV4RelayTurn({
      $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as PrismaClient);
    await expect(store.reconcileExpiredPrepared(digest)).resolves.toBe("failed_no_effect");
    expect(effectUpdate).toHaveBeenCalledWith({
      where: { id: "effect", state: "prepared", fenceEpoch: 1n,
        dispatchStartedAt: null },
      data: expect.objectContaining({
        state: "failed_no_effect", errorCode: "prepared_effect_expired_no_dispatch",
      }),
    });
    expect(requestUpdate).toHaveBeenCalledWith({
      where: { id: "request", status: "received" },
      data: expect.objectContaining({
        status: "failed", errorCode: "prepared_effect_expired_no_dispatch",
      }),
    });
    tx.$queryRaw.mockReset().mockResolvedValueOnce([{ state: "open" }]);
    await expect(store.reconcileExpiredPrepared(digest)).resolves.toBe("recovery_required");
    expect(effectUpdate).toHaveBeenCalledOnce();
    expect(requestUpdate).toHaveBeenCalledOnce();
  });
});

const disposableUrl =
  process.env.REVIEW_ROUTER_V4_RELAY_DISPOSABLE_DATABASE_URL;
const safeDisposableUrl = disposableUrl?.includes("rr_v4_444_disposable")
  ? disposableUrl
  : undefined;

describe("hosted v4 relay turn persistence", () => {
  beforeAll(() => {
    if (!safeDisposableUrl) {
      throw new Error("REVIEW_ROUTER_V4_RELAY_DISPOSABLE_DATABASE_URL with rr_v4_444_disposable is required for v4 PG qualification");
    }
  });
  let client: Awaited<ReturnType<typeof openDisposableClient>> | undefined;
  const keys: string[] = [];
  async function openDisposableClient() {
    const { createPrismaClient } =
      await import("../../../../platform/db/src/index");
    return createPrismaClient({ databaseUrl: safeDisposableUrl! });
  }
  afterAll(async () => {
    if (client) {
      await client.hostedCodexV4RelayTurn.deleteMany({
        where: { logicalTurnKey: { in: keys } },
      });
      await client.$disconnect();
    }
  });

  it("fences both reservations after the real release revoker commits", async () => {
    client ??= await openDisposableClient();
    const revokerClient = await openDisposableClient();
    try {
      for (const stage of ["grant", "prepared"] as const) {
        const producerReleaseId = `v4-release-race-${randomUUID()}`;
        const saved = contract({ ...scope(), producerReleaseId });
        const grantId = `v4-grant-${saved.logicalTurnKey}`;
        const registeredAt = new Date();
        const protocolLimitsProfileId = `limits-${producerReleaseId}`;
        const operationalSloProfileId = `slo-${producerReleaseId}`;
        try {
          // Stock release FKs require the registered profile rows. Seed all
          // three real tables so the revoker exercises its production path.
          await client.reviewProtocolLimitsV2.create({ data: {
            protocolLimitsProfileId,
            limitsDigest: createHash("sha256").update(protocolLimitsProfileId).digest("hex"),
            maxWorkSlots: 1, maxAttemptsPerSlot: 1,
            maxObservationBytes: 1, maxObservationFindings: 1,
            maxProjectionBytes: 1, maxProjectionFindings: 1,
            maxPublicationOperations: 1, maxPublicationChunks: 1,
            maxPublicationBodyBytes: 1, maxRequestBatchSize: 1,
            maxLeaseDurationMs: 1, maxResultReportDurationMs: 1,
            maxReconciliationDurationMs: 1, registeredAt,
          } });
          await client.reviewOperationalSloProfileV2.create({ data: {
            operationalSloProfileId,
            sloDigest: createHash("sha256").update(operationalSloProfileId).digest("hex"),
            integrationEventDeliveryMs: 1, outboxClaimAgeMs: 1,
            missingCompletionProcessMs: 1, dueCompletionProcessMs: 1,
            publicationReconciliationMs: 1, v1DrainMs: 1,
            admissionMs: 1, pruningBacklogAgeMs: 1,
            ownerRefs: ["disposable-v4-release-race"],
            runbookRefs: ["disposable-v4-release-race"], registeredAt,
          } });
          await client.producerRelease.create({ data: {
            producerReleaseId, distributionKind: "hosted_composite",
            actionCommitSha: gitSha, runtimeCommitSha: gitSha,
            wrapperEntrypointDigest: digest, runtimeEntrypointDigest: digest,
            contextGatewayPolicyVersion: "v4-test",
            contextGatewayEntrypointDigest: digest,
            schemaDigest: digest, capabilityProfile: "exact_revision_v2",
            protocolLimitsProfileId, operationalSloProfileId, registeredAt,
          } });
          if (stage === "prepared") {
            await new PrismaHostedV4RelayTurn(client).reserve(saved);
          }
          await client.$transaction(async (tx) => {
            expect(await lockCurrentProducerRelease(tx, producerReleaseId)).toBe(true);
          }, { isolationLevel: "Serializable" });
          vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "1");
          vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID",
            saved.scope.githubRepositoryId);

          let signalSnapshot!: () => void;
          const snapshotTaken = new Promise<void>((resolve) => { signalSnapshot = resolve; });
          let resume!: () => void;
          const revocationCommitted = new Promise<void>((resolve) => { resume = resolve; });
          let paused = false;
          let transactionAttempts = 0;
          const pausingClient = {
            $transaction: (
              callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
              options: { isolationLevel?: Prisma.TransactionIsolationLevel },
            ) => client!.$transaction(async (tx) => {
              transactionAttempts += 1;
              const wrapped = new Proxy(tx, {
                get(target, property) {
                  if (property !== "$queryRaw") return Reflect.get(target, property);
                  return async (query: Prisma.Sql) => {
                    const result = await tx.$queryRaw(query);
                    if (!paused && query.strings.join("").includes("clock_timestamp()")) {
                      expect((await tx.producerRelease.findUniqueOrThrow({
                        where: { producerReleaseId },
                      })).state).toBe("registered");
                      paused = true;
                      signalSnapshot();
                      await revocationCommitted;
                    }
                    return result;
                  };
                },
              });
              return callback(wrapped);
            }, options),
          } as unknown as PrismaClient;
          const store = new PrismaHostedV4RelayTurn(pausingClient);
          const reservation = stage === "grant"
            ? store.reserveGrant({
                contract: saved, capabilityTokenHash: digest,
                accountId: "account", credentialGeneration: 1n,
                runtimeConfigVersion: 7,
              })
            : store.reservePreparedRequest({
                contract: saved, grantId, ordinal: 1,
                idempotencyKey: "release-race",
                body: new TextEncoder().encode(
                  '{"model":"codex","max_output_tokens":100}',
                ),
                accountId: "account", credentialGeneration: 1n,
                ownerIdHash: digest,
              });
          await snapshotTaken;
          try {
            const result = await new PrismaProducerReleaseRepository(revokerClient)
              .revokeProducerRelease({ producerReleaseId, revokedAt: new Date() });
            expect(result.status).toBe("revoked");
          } finally {
            resume();
          }
          await expect(reservation).rejects.toThrow(
            "hosted_v4_relay_reservation_authority_stale",
          );
          expect(paused).toBe(true);
          expect(transactionAttempts).toBe(2);
          expect((await client.producerRelease.findUniqueOrThrow({
            where: { producerReleaseId },
          })).state).toBe("revoked");
          expect(await client.hostedCodexInvocationGrant.count({
            where: { v4TurnKey: saved.logicalTurnKey },
          })).toBe(0);
          expect(await client.hostedCodexRelayRequest.count({
            where: { grantId },
          })).toBe(0);
          expect(await client.hostedCodexUpstreamEffectAttempt.count({
            where: { grantId },
          })).toBe(0);
          expect(await client.hostedCodexV4RelayTurn.count({
            where: { logicalTurnKey: saved.logicalTurnKey },
          })).toBe(stage === "prepared" ? 1 : 0);
        } finally {
          await client.hostedCodexV4RelayTurn.deleteMany({
            where: { logicalTurnKey: saved.logicalTurnKey },
          });
          await client.producerRelease.deleteMany({ where: { producerReleaseId } });
          await client.reviewOperationalSloProfileV2.deleteMany({
            where: { operationalSloProfileId },
          });
          await client.reviewProtocolLimitsV2.deleteMany({
            where: { protocolLimitsProfileId },
          });
        }
      }
    } finally {
      await revokerClient.$disconnect();
    }
  }, 30_000);

  it("persists the real planner's input and current dossiers with the immutable turn budget", async () => {
    client ??= await openDisposableClient();
    const suffix = `v4-plan-${randomUUID()}`;
    const raw = createInvestigationStoreContractSeed(suffix);
    const hasher = new NodeSha256InvestigationDigest();
    const seed = {
      ...raw,
      dossierDigest: await hasher.digestUtf8(
        canonicalJson(investigationDossierCanonicalValue(raw)),
      ),
    };
    const store = new PrismaInvestigationStore(client);
    const plannedAt = new Date("2026-08-02T10:00:30.000Z");
    const budgetCanonicalJson = canonicalJson({
      deadline: "2026-08-02T10:01:00.000Z",
      maxGatewayOperations: 1,
      maxOutputFindings: 1,
      maxOutputProposals: 1,
      maxOutputTokens: 100,
      maxRequestBytes: 1_000,
      maxRequests: 1,
      maxResponseBytes: 2_000,
      version: 1,
    });
    const budgetHash = await hasher.digestUtf8(budgetCanonicalJson);
    await seedExecution(client, seed);
    try {
      await store.commit({
        investigation: seed,
        expectedVersion: null,
        commandId: `${suffix}-open`,
        commandHash: createHash("sha256").update(`${suffix}-open`).digest("hex"),
        transition: { kind: InvestigationStoreTransitionKind.Opened },
      });
      await new PlanNextInvestigationTurn(
        store,
        new CurrentInvestigationExecutionAuthority(),
        hasher,
        new FixedInvestigationClock(plannedAt),
      ).execute({
        commandId: `${suffix}-plan`,
        investigationId: seed.investigationId,
        expectedVersion: seed.version,
        leaseDurationMs: 60_000,
        maxObligationsForTurn: 1,
        turnBudgetCanonicalJson: budgetCanonicalJson,
        turnBudgetHash: budgetHash,
      });
      const investigation = await client.reviewInvestigation.findUniqueOrThrow({
        where: { investigationId: seed.investigationId },
      });
      const turn = await client.reviewInvestigationTurn.findUniqueOrThrow({
        where: { turnId: investigation.activeTurnId! },
      });
      expect(turn.dossierDigest).toBe(seed.dossierDigest);
      expect(investigation.dossierDigest).not.toBe(seed.dossierDigest);
      expect(turn.leasedAtVersion).toBe(investigation.version);
      expect(turn.turnBudgetCanonicalJson).toBe(budgetCanonicalJson);
      expect(turn.turnBudgetHash).toBe(budgetHash);
      await expect(client.reviewInvestigationTurn.update({
        where: { turnId: turn.turnId },
        data: { turnBudgetHash: "c".repeat(64) },
      })).rejects.toThrow();
    } finally {
      await cleanup(client, seed);
    }
  });

  // The historical received-state constraint required a null hash. A v4
  // reservation must save the actual body hash in the debit insert itself.
  it("admits a hashed v4 received request while retaining the v1 rule", async () => {
    client ??= await openDisposableClient();
    await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE rr_v4_received_hash_probe
          (LIKE public."HostedCodexRelayRequest" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
          ON COMMIT DROP
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO rr_v4_received_hash_probe
          ("id", "grantId", "authorityKind", "ordinal", "idempotencyKeyHash",
           "requestHash", "requestBytes", "status", "updatedAt")
        VALUES
          ('v4', 'grant', 'v4_relay_turn', 1, '${digest}', '${digest}', 2, 'received', CURRENT_TIMESTAMP),
          ('v1', 'grant', 'v1_comment', 1, '${digest}', NULL, 2, 'received', CURRENT_TIMESTAMP)
      `);
    });
    await expect(client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE rr_v4_received_hash_probe
          (LIKE public."HostedCodexRelayRequest" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
          ON COMMIT DROP
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO rr_v4_received_hash_probe
          ("id", "grantId", "authorityKind", "ordinal", "idempotencyKeyHash",
           "requestHash", "requestBytes", "status", "updatedAt")
        VALUES ('v1', 'grant', 'v1_comment', 1, '${digest}', '${digest}', 2, 'received', CURRENT_TIMESTAMP)
      `);
    })).rejects.toThrow();
  });

  // Regression: terminal_unknown on one grant could be escaped by reissue.
  it("persists terminal_unknown and rejects a replacement lease after restart", async () => {
    client = await openDisposableClient();
    const original = contract(scope());
    keys.push(original.logicalTurnKey);
    const first = new PrismaHostedV4RelayTurn(client);
    await first.reserve(original);
    await first.markTerminalUnknown(original.logicalTurnKey, now);
    await client.$disconnect();
    client = await openDisposableClient();
    const restarted = new PrismaHostedV4RelayTurn(client);
    await expect(restarted.reserve(original)).rejects.toThrow(
      "hosted_v4_relay_turn_terminal_unknown",
    );
    const replacement = contract({
      ...original.scope,
      attemptId: "replacement",
      invocationLease: {
        ...original.scope.invocationLease,
        leaseId: "replacement-lease",
        fencingToken: 99n,
      },
    });
    await expect(restarted.reserve(replacement)).rejects.toThrow(
      "hosted_v4_relay_turn_terminal_unknown",
    );
  });

  // Regression: an idempotent grant recovery could silently replenish its budget.
  it("rejects budget changes for a reserved logical turn", async () => {
    client ??= await openDisposableClient();
    const original = contract(scope());
    keys.push(original.logicalTurnKey);
    const turns = new PrismaHostedV4RelayTurn(client);
    await turns.reserve(original);
    await expect(
      turns.reserve({
        ...original,
        maxRequests: original.maxRequests + 1,
      }),
    ).rejects.toThrow("hosted_v4_relay_turn_scope_conflict");
  });
});
