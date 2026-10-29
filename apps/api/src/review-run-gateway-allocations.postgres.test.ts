import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import {
  canonicalJson,
  reviewRunGatewayOwnedIdentity,
  ReviewTrustDomain,
  type ReviewRunGatewayExecutionBinding,
  type ReviewRunGatewayExecutionOwner,
} from "@reviewrouter/features-review-run-control";
import { reviewerPlanDescriptorDigest } from "@reviewrouter/shared";
import { PrismaReviewRunGatewayExecutionBinding } from "./prisma-review-run-gateway-execution-binding";
import {
  limits,
  sloThresholds,
} from "../../../packages/features/review-run-control/src/tests/fixtures";

const databaseUrl = process.env.REVIEW_ROUTER_MULTI_REVIEWER_TEST_DATABASE_URL;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const enabled = databaseUrl !== undefined;

describe.skipIf(!enabled)(
  "V4 write-once Gateway allocations on PostgreSQL",
  () => {
    const prefix = `multi-allocation-${randomUUID()}`;
    let prisma: PrismaClient;
    let adapter: PrismaReviewRunGatewayExecutionBinding;
    let livenessGate: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !/^reviewrouter_multi_control_test$/.test(url.pathname.slice(1)) ||
        url.password
      )
        throw new Error("isolated_multi_control_database_required");
      prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 10 });
      adapter = new PrismaReviewRunGatewayExecutionBinding(prisma, {
        lockGatewaySelection: async () => {},
        isLive: async () => {
          await livenessGate?.();
          return true;
        },
        isAllocationLive: async () => true,
      } as never);
      await prisma.workspace.create({
        data: { id: prefix, slug: prefix, name: prefix },
      });
      await prisma.$transaction(async (tx) => {
        await tx.scmRepositoryIdentity.create({
          data: {
            scmRepositoryIdentityId: prefix,
            provider: "github",
            normalizedSourceBaseUrl: "https://github.com",
            externalRepositoryId: prefix,
            currentWorkspaceId: prefix,
            currentRepositoryConnectionId: prefix,
            createdAt: new Date(),
          },
        });
        await tx.repositoryConnection.create({
          data: {
            id: prefix,
            workspaceId: prefix,
            provider: "github",
            sourceBaseUrl: "https://github.com",
            externalRepositoryId: prefix,
            scmRepositoryIdentityId: prefix,
            owner: "disposable",
            name: prefix,
            fullName: `disposable/${prefix}`,
            defaultBranch: "main",
            visibility: "private",
          },
        });
      });
      await prisma.reviewProtocolLimitsV2.create({
        data: {
          ...limits,
          protocolLimitsProfileId: prefix,
          limitsDigest: hash(`${prefix}-limits`),
          registeredAt: new Date(),
        },
      });
      await prisma.reviewOperationalSloProfileV2.create({
        data: {
          ...sloThresholds,
          operationalSloProfileId: prefix,
          sloDigest: hash(`${prefix}-slo`),
          ownerRefs: ["test"],
          runbookRefs: ["test"],
          registeredAt: new Date(),
        },
      });
      await prisma.producerRelease.create({
        data: {
          producerReleaseId: prefix,
          distributionKind: "public_reusable",
          actionCommitSha: "a".repeat(40),
          runtimeCommitSha: "b".repeat(40),
          runtimeEntrypointDigest: hash(prefix),
          schemaDigest: hash(`${prefix}-schema`),
          capabilityProfile: "exact_revision_v2",
          protocolLimitsProfileId: prefix,
          operationalSloProfileId: prefix,
          state: "registered",
          registeredAt: new Date(),
          reviewerPlanProfile: {
            planVersion: 1,
            descriptorDigest: reviewerPlanDescriptorDigest,
          },
        },
      });
    });
    afterAll(async () => {
      if (!prisma) return;
      await prisma.reviewRunGatewayAllocationExecution.updateMany({
        where: {
          authorizationId: { startsWith: prefix },
          cleanupCompletedAt: null,
        },
        data: { cleanupCompletedAt: new Date() },
      });
      await prisma.reviewRunAuthorization.deleteMany({
        where: { authorizationId: { startsWith: prefix } },
      });
      await prisma.producerRelease.deleteMany({
        where: { producerReleaseId: prefix },
      });
      await prisma.reviewProtocolLimitsV2.deleteMany({
        where: { protocolLimitsProfileId: prefix },
      });
      await prisma.reviewOperationalSloProfileV2.deleteMany({
        where: { operationalSloProfileId: prefix },
      });
      await prisma.$transaction(async (tx) => {
        await tx.scmRepositoryIdentity.updateMany({
          where: { scmRepositoryIdentityId: prefix },
          data: {
            currentWorkspaceId: null,
            currentRepositoryConnectionId: null,
          },
        });
        await tx.repositoryConnection.deleteMany({ where: { id: prefix } });
        await tx.scmRepositoryIdentity.deleteMany({
          where: { scmRepositoryIdentityId: prefix },
        });
      });
      await prisma.workspace.deleteMany({ where: { id: prefix } });
      await prisma.$disconnect();
    });
    async function seed(label: string) {
      const authorizationId = `${prefix}-${label}`;
      const deadline = new Date(
        Math.floor((Date.now() + 120000) / 1000) * 1000,
      ).toISOString();
      const agentProfile = {
        profileRef: "codex-approved",
        agentKind: "codex",
        binarySha256: "a".repeat(64),
        packageVersion: "1.2.3",
        modelTransports: ["account_gateway"],
        contextGateway: true,
        cancellation: true,
      };
      const allocations = [0, 1].map((index) => ({
        allocationId: `allocation-${index}`,
        bindingId: `binding-${index}`,
        connectionId: `connection-${index}`,
        bindingRevision: 1,
        policySubject: `binding-${index}`,
        policyRevision: 1,
        permittedAccountRef: `account-${index}`,
        profileRef: "profile",
        invocationId: `invocation-${index}`,
        attemptId: `attempt-${index}`,
        operationId: `operation-${index}`,
        expectedAuthorizationEpoch: 2,
        limits: {
          requests: 8,
          concurrency: 2,
          requestBytes: 16384,
          outputBytes: 16384,
          tokens: 500,
        },
      }));
      const reviewers = allocations.map((allocation, providerIndex) => ({
        reviewerId: `reviewer-${providerIndex}`,
        providerIndex,
        providerVoteIdentityHash: hash(`vote-${providerIndex}`),
        required: true,
        transport: {
          kind: "account_gateway",
          allocationId: allocation.allocationId,
        },
        requestedModel: `model-${providerIndex}`,
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
        agentProfile,
        agentProfileDigest: hash(canonicalJson(agentProfile)),
        concurrencyGroupId: allocation.allocationId,
        investigationGrant: null,
      }));
      const configurationCanonicalJson = canonicalJson({
        schemaVersion: 3,
        providers: reviewers.map((reviewer, index) => ({
          authMode: "codex_account_gateway",
          gatewayBindingId: allocations[index]!.bindingId,
          gatewayProfileRef: "profile",
          model: reviewer.requestedModel,
          reasoningEffort: "high",
          agenticContext: true,
          fastMode: false,
        })),
      });
      const runtimeSnapshotCanonicalJson = canonicalJson({
        snapshotVersion: 4,
        configurationSource: "workspace",
        configurationVersion: 1,
        workspaceConfigurationVersion: 1,
        repositoryConfigurationVersion: null,
        effectivePolicyDigest: `sha256:${hash(configurationCanonicalJson)}`,
        producer: {
          producerReleaseId: prefix,
          actionCommitSha: "a".repeat(40),
          runtimeCommitSha: "b".repeat(40),
        },
        configurationCanonicalJson,
        deadline,
        primaryReviewerId: "reviewer-0",
        maxParallelReviewers: 2,
        inlineMinAgreement: 1,
        reviewers,
        allocations,
      });
      const identity = {
        workspaceId: prefix,
        repositoryConnectionId: prefix,
        scmRepositoryIdentityId: prefix,
        pullRequestNumber: 1,
        sourceRunId: authorizationId,
        sourceRunAttempt: "1",
        workflowIdentityHash: hash(`${authorizationId}-workflow`),
        baseSha: "a".repeat(40),
        mergeBaseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        reviewRevisionHash: hash(`${authorizationId}-revision`),
        trustDomain: ReviewTrustDomain.TrustedManaged,
      };
      await prisma.reviewRunAuthorization.create({
        data: {
          ...identity,
          authorizationId,
          producerReleaseId: prefix,
          selectedProtocolVersion: "2",
          schemaDigest: hash("schema"),
          protocolLimitsProfileId: prefix,
          operationalSloProfileId: prefix,
          mutationEpoch: 1n,
          providerVoteLanes: reviewers.map((row) => ({
            providerKind: "codex",
            providerVoteIdentityHash: row.providerVoteIdentityHash,
          })),
          runtimeSnapshotCanonicalJson,
          authorizationSafetyDecisionHash: hash("safety"),
          protocolOfferHash: hash("offer"),
          oidcReplayKeyHash: hash(authorizationId),
          tokenSigningKeyId: "key",
          tokenIssuer: "issuer",
          tokenAudience: "audience",
          state: "active",
          expiresAt: new Date(deadline),
          maxExpiresAt: new Date(deadline),
          createdAt: new Date(),
        },
      });
      const owner: ReviewRunGatewayExecutionOwner = {
        authorizationId,
        allocationId: "allocation-0",
        identity: reviewRunGatewayOwnedIdentity(identity),
        runtimeSnapshotCanonicalJson,
      };
      const binding: ReviewRunGatewayExecutionBinding = {
        bindingVersion: 1,
        operationId: "operation-0",
        executionRef: `${label}-execution`,
        accountRef: "account-0",
        authorizationEpoch: 2,
        deadline,
      };
      return { owner, binding };
    }
    it("serializes identical first users, rejects foreign authority and reads back each exact allocation", async () => {
      const { owner, binding } = await seed("concurrent");
      expect(await adapter.read(owner)).toEqual({
        status: "live",
        binding: null,
      });
      const results = await Promise.all([
        adapter.attach(owner, binding),
        adapter.attach(owner, binding),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        "attached",
        "restored",
      ]);
      expect(
        await adapter.attach(owner, { ...binding, executionRef: "foreign" }),
      ).toEqual({ status: "conflict" });
      const { allocationId: _allocation, ...missing } = owner;
      void _allocation;
      expect(await adapter.read(missing)).toEqual({ status: "denied" });
      expect(
        await adapter.attach(
          { ...owner, allocationId: "allocation-1" },
          binding,
        ),
      ).toEqual({ status: "denied" });
      expect(await adapter.read(owner)).toEqual({ status: "live", binding });
      await expect(
        prisma.reviewRunGatewayAllocationExecution.create({
          data: {
            authorizationId: owner.authorizationId,
            allocationId: "allocation-1",
            gatewayExecutionCanonicalJson: canonicalJson({
              ...binding,
              operationId: "operation-1",
              accountRef: "foreign",
            }),
          },
        }),
      ).rejects.toThrow();
    });
    it("forbids deletion/reinsertion and parent pruning until exact cleanup completes", async () => {
      const { owner, binding } = await seed("retention");
      await adapter.attach(owner, binding);
      await expect(
        prisma.reviewRunGatewayAllocationExecution.delete({
          where: {
            authorizationId_allocationId: {
              authorizationId: owner.authorizationId,
              allocationId: owner.allocationId!,
            },
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.reviewRunGatewayAllocationExecution.update({
          where: {
            authorizationId_allocationId: {
              authorizationId: owner.authorizationId,
              allocationId: owner.allocationId!,
            },
          },
          data: {
            gatewayExecutionCanonicalJson: canonicalJson({
              ...binding,
              executionRef: "replacement",
            }),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.reviewRunAuthorization.update({
          where: { authorizationId: owner.authorizationId },
          data: { headSha: "c".repeat(40) },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.reviewRunAuthorization.delete({
          where: { authorizationId: owner.authorizationId },
        }),
      ).rejects.toThrow();
      await prisma.reviewRunAuthorization.update({
        where: { authorizationId: owner.authorizationId },
        data: { state: "revoked" },
      });
      expect(await adapter.read(owner)).toEqual({ status: "denied" });
      expect(await adapter.readForCleanup(owner)).toEqual(binding);
      await adapter.completeCleanup(owner, binding);
      await prisma.reviewRunAuthorization.delete({
        where: { authorizationId: owner.authorizationId },
      });
      expect(
        await prisma.reviewRunGatewayAllocationExecution.count({
          where: { authorizationId: owner.authorizationId },
        }),
      ).toBe(0);
    });
    it("retains an attachment that wins termination while denying all later dispatch reads", async () => {
      const { owner, binding } = await seed("termination-race");
      let entered!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      livenessGate = async () => {
        entered();
        await gate;
      };
      const attachment = adapter.attach(owner, binding);
      await locked;
      const termination = Promise.resolve(
        prisma.reviewRunAuthorization.update({
          where: { authorizationId: owner.authorizationId },
          data: { state: "revoked" },
        }),
      );
      const until = Date.now() + 3000;
      let waiting = false;
      while (!waiting && Date.now() < until) {
        const rows = await prisma.$queryRaw<
          readonly { waiting: boolean }[]
        >`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%UPDATE%' AND query LIKE '%ReviewRunAuthorization%') AS waiting`;
        waiting = rows[0]?.waiting === true;
      }
      expect(waiting).toBe(true);
      release();
      expect((await attachment).status).toBe("attached");
      await termination;
      livenessGate = undefined;
      expect(await adapter.read(owner)).toEqual({ status: "denied" });
      expect(await adapter.readForCleanup(owner)).toEqual(binding);
      const next = await seed("termination-first");
      await prisma.reviewRunAuthorization.update({
        where: { authorizationId: next.owner.authorizationId },
        data: { state: "revoked" },
      });
      expect(await adapter.attach(next.owner, next.binding)).toEqual({
        status: "denied",
      });
      expect(
        await prisma.reviewRunGatewayAllocationExecution.count({
          where: { authorizationId: next.owner.authorizationId },
        }),
      ).toBe(0);
    });
  },
);
