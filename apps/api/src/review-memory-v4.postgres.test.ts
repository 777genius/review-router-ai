import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { PrismaProviderAccountRepository } from "@reviewrouter/features-provider-accounts";
import {
  PrismaReviewConfigurationRepository,
  parseReviewConfigurationStrict,
  saveReviewConfiguration,
} from "@reviewrouter/features-review-config";
import { parseReviewRunRuntimeSnapshot } from "@reviewrouter/features-review-run-control";
import { reviewerPlanDescriptorDigest } from "@reviewrouter/shared";
import {
  createMemoryPolicyConfig,
  createMemoryBodyHash,
  type MemoryKnowledgeBundle,
  type MemoryKnowledgeEntryMetadata,
} from "@reviewrouter/features-memory";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
} from "../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";
import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { createApiApp } from "./app";
import {
  ReviewMemoryRuntimeGateway,
  registerReviewMemoryRuntimeRoutes,
} from "./review-memory-runtime";
import { reviewMemoryBinding } from "./review-memory-wire";

const databaseUrl = process.env.REVIEW_ROUTER_MEMORY_V4_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)(
  "V4 review-wide memory with actual PostgreSQL production authorization",
  () => {
    it("keeps tools reviewer-scoped while review and description receive the same rule; revocation of any allocation denies memory", async () => {
      const url = new URL(databaseUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/reviewrouter_memory_runtime_test" ||
        (url.password && url.password !== "memory_ci_fixture_only")
      )
        throw new Error("isolated_memory_runtime_database_required");
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      const limits = {
        requests: 16,
        concurrency: 2,
        requestBytes: 131072,
        outputBytes: 262144,
        tokens: 2048,
      };
      const profileRef = "memory-fixture-responses-v1";
      let scmReads = 0;
      let scmGate: Promise<void> | undefined;
      let releaseScm: (() => void) | undefined;
      let enterScm: (() => void) | undefined;
      let blockedTools: Promise<unknown> | undefined;
      const harness = await createReviewActionV2E2EHarness(databaseUrl!, {
        beforeFakeGitHubRead: async () => {
          scmReads++;
          const gate = scmGate;
          if (gate) {
            enterScm?.();
            await gate;
            throw new Error("synthetic_scm_unavailable_after_admission");
          }
        },
        modelTransport: "account_gateway",
        repositoryProviderSelection: "none",
        agentProfiles: [
          {
            profileRef: "codex-memory-v4",
            agentKind: "codex",
            binarySha256: "a".repeat(64),
            packageVersion: "1.2.3",
            modelTransports: ["account_gateway"],
            contextGateway: true,
            cancellation: true,
          },
        ],
        reviewerPlanProfile: {
          planVersion: 1,
          descriptorDigest: reviewerPlanDescriptorDigest,
        },
        environmentOverrides: {
          REVIEW_ROUTER_AGENT_PROFILE: "codex-memory-v4",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: JSON.stringify({
            profiles: [{ profileRef, limits }],
          }),
        },
      });
      const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];
      const memoryApps: ReturnType<typeof Fastify>[] = [];
      try {
        const { prisma, workspaceId, repositoryConnectionId } = harness;
        const accounts = new PrismaProviderAccountRepository(prisma);
        const bindings = [];
        for (const index of [0, 1]) {
          const connection = await prisma.providerAccountConnection.create({
            data: {
              ownerWorkspaceId: workspaceId,
              gatewayAccountRef: `${harness.prefix}-account-${index}`,
              profileRef,
              displayName: "Synthetic memory account",
              state: "active",
            },
          });
          bindings.push(
            await accounts.compareAndSetBinding({
              workspaceId,
              connectionId: connection.id,
              expectedRevision: 0,
              state: "active",
            }),
          );
        }
        const target = {
          scope: "repository" as const,
          workspaceId,
          repositoryId: repositoryConnectionId,
        };
        const config = parseReviewConfigurationStrict({
          ...workspacePolicyFixture,
          providers: bindings.map((binding, index) => ({
            kind: "codex",
            authMode: "codex_account_gateway",
            gatewayBindingId: binding.id,
            gatewayProfileRef: profileRef,
            model: `memory-model-${index}`,
            reasoningEffort: "low",
            agenticContext: true,
            fastMode: false,
          })),
          execution: {
            providerLimit: 2,
            providerMaxParallel: 2,
            inlineMinAgreement: 1,
          },
        });
        await saveReviewConfiguration(
          {
            target,
            expectedVersion: null,
            ...systemPolicyWriteFixture(config, target),
          },
          {
            configurations: new PrismaReviewConfigurationRepository(
              prisma,
              undefined,
              false,
              undefined,
            ),
          },
        );
        const admitted = await harness.authorize();
        const row = await prisma.reviewRunAuthorization.findUniqueOrThrow({
          where: { authorizationId: admitted.authorizationId },
        });
        const snapshot = parseReviewRunRuntimeSnapshot(
          row.runtimeSnapshotCanonicalJson,
        );
        expect(snapshot?.snapshotVersion).toBe(4);
        if (snapshot?.snapshotVersion !== 4)
          throw new Error("v4_snapshot_required");
        expect(snapshot.reviewers).toHaveLength(2);
        expect(snapshot.allocations).toHaveLength(2);
        // This is the exact old memory authorization call. It must remain denied for tools.
        expect(
          await harness.routes.contextTools!.authorize(
            admitted.authorizationToken,
          ),
        ).toBeNull();
        const beforeReviewer = scmReads;
        expect(
          await harness.routes.contextTools!.authorize(
            admitted.authorizationToken,
            snapshot.reviewers[0]!.reviewerId,
          ),
        ).not.toBeNull();
        const reviewerScmReads = scmReads - beforeReviewer;
        const beforeMemory = scmReads;
        const access = harness.routes.memoryRunAccess!;
        const authorization = await access.authorize(
          admitted.authorizationToken,
        );
        expect(authorization?.authorizationId).toBe(admitted.authorizationId);
        expect(reviewerScmReads).toBeGreaterThan(0);
        expect(scmReads - beforeMemory).toBe(0);
        if (!authorization) throw new Error("memory_authorization_missing");
        const binding = reviewMemoryBinding(authorization);
        const headers = {
          authorization: `Bearer ${admitted.authorizationToken}`,
        };
        // Exercise app.ts production wiring too: a disabled backend still returns its valid empty wire.
        const api = await createApiApp({
          prisma,
          actionControlPlaneEnabled: false,
          memoryServiceEnabled: false,
          reviewRunControlV2Enabled: true,
          reviewActionV2Env: harness.env,
        });
        apps.push(api);
        // Hold SCM unavailable after real admission. Tools must keep their live
        // remote check; memory bundle/admit must finish before that read is released.
        const entered = new Promise<void>((resolve) => {
          enterScm = resolve;
        });
        scmGate = new Promise<void>((resolve) => {
          releaseScm = resolve;
        });
        blockedTools = harness.routes.contextTools!.authorize(
          admitted.authorizationToken,
          snapshot.reviewers[0]!.reviewerId,
        );
        await entered;
        const beforeMemoryRoutes = scmReads;
        const empty = await api.inject({
          method: "POST",
          url: "/api/action/v2/memory/bundle",
          headers,
          payload: { protocolVersion: 2, ...binding, task: "review" },
        });
        expect(empty.statusCode, empty.body).toBe(200);
        expect(empty.json().reason).toBe("memory_disabled");

        // Only provider content is controlled. Token, source identity, bindings, guards and receipt SQL are real.
        const now = new Date().toISOString();
        const scope = {
          kind: "repository" as const,
          workspaceId,
          repositoryId: repositoryConnectionId,
        };
        const body =
          "Parcel tracking identifiers are opaque strings. Preserve leading zeroes and original case.";
        const metadata: MemoryKnowledgeEntryMetadata = {
          ref: { type: "entry", scope, entryId: "memory_tracking_rule" },
          generation: "test-memory",
          revision: "1",
          contentApprovalRevision: "1",
          bodyDigest: createMemoryBodyHash(body),
          topicsDigest: "f".repeat(64),
          kind: "rule",
          lifecycle: "active",
          approval: {
            actor: {
              kind: "workspace_user",
              id: "maintainer",
              githubUserId: null,
              login: null,
            },
            approvedAt: now,
            authorityRevision: "manual:1",
          },
          source: {
            type: "manual",
            sourceId: "manual:tracking",
            revision: "1",
            updatedAt: now,
            statementAt: now,
            repositoryId: repositoryConnectionId,
            pullRequestNumber: null,
            url: null,
            visibility: "private",
            claimedBodyDigest: null,
            observedCommitSha: null,
          },
          applicability: {
            validUntil: null,
            observedCommitSha: null,
            exceptionRule: null,
          },
          originalStatementAt: now,
          lastVerifiedAt: now,
          pendingCommandId: null,
          revocationCommandId: null,
          createdAt: now,
          updatedAt: now,
        };
        const bundle: MemoryKnowledgeBundle = {
          generation: "test-memory",
          hash: "d".repeat(64),
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          degraded: false,
          scopes: [
            {
              scope,
              epoch: "1",
              items: [
                {
                  type: "entry",
                  metadata,
                  entry: {
                    ref: metadata.ref,
                    body,
                    bodyDigest: createMemoryBodyHash(body),
                    statementAt: now,
                    sourceFactIds: ["fact-1"],
                    topicIds: [],
                    contentApprovalRevision: "1",
                    kind: "rule",
                  },
                },
              ],
            },
          ],
        };
        const receipt = {
          generation: bundle.generation,
          bundleHash: bundle.hash,
          expiresAt: bundle.expiresAt,
          scopes: [
            {
              scope,
              epoch: "1",
              entries: [
                {
                  ref: metadata.ref,
                  revision: "1",
                  contentApprovalRevision: "1",
                },
              ],
            },
          ],
        };
        const runtime = {
          enabled: true,
          generation: bundle.generation,
          policy: {
            getPolicy: async () =>
              createMemoryPolicyConfig({ memoryEnabled: true }),
          },
          forAccess: () => ({
            bundle: async () => bundle,
            createBundleReceipt: () => receipt,
            admitReceipt: async () => true,
          }),
        } as unknown as MemoryKnowledgeRuntime;
        const memoryApp = Fastify();
        memoryApps.push(memoryApp);
        await registerReviewMemoryRuntimeRoutes(
          memoryApp,
          new ReviewMemoryRuntimeGateway({ prisma, runtime, access }),
        );
        for (const task of ["review", "pr_description"] as const) {
          const response = await memoryApp.inject({
            method: "POST",
            url: "/api/action/v2/memory/bundle",
            headers,
            payload: { protocolVersion: 2, ...binding, task },
          });
          expect(response.statusCode, response.body).toBe(200);
          expect(response.json().items).toMatchObject([
            { id: metadata.ref.entryId, kind: "rule", body },
          ]);
          const saved =
            await prisma.memoryKnowledgeBundleReceipt.findUniqueOrThrow({
              where: { id: response.json().bundleId },
            });
          expect(saved.authorizationId).toBe(admitted.authorizationId);
          expect(JSON.stringify(saved.receipt)).toContain(metadata.ref.entryId);
          const admission = await memoryApp.inject({
            method: "POST",
            url: "/api/action/v2/memory/admit",
            headers,
            payload: {
              protocolVersion: 2,
              ...binding,
              bundleId: response.json().bundleId,
              policyVersion: response.json().policyVersion,
              eligibilityEpoch: response.json().eligibilityEpoch,
              providerGeneration: response.json().providerGeneration,
            },
          });
          expect(admission.statusCode, admission.body).toBe(200);
          expect(admission.json().eligible).toBe(true);
        }
        expect(scmReads).toBe(beforeMemoryRoutes);
        releaseScm!();
        expect(await blockedTools).toBeNull();
        scmGate = undefined;
        const wrongBinding = await memoryApp.inject({
          method: "POST",
          url: "/api/action/v2/memory/bundle",
          headers,
          payload: {
            protocolVersion: 2,
            ...binding,
            headSha: "9".repeat(40),
            task: "review",
          },
        });
        expect(wrongBinding.statusCode).toBe(403);
        // A secondary reviewer is as authoritative as the primary for a shared run-wide input.
        await accounts.compareAndSetBinding({
          workspaceId,
          connectionId: bindings[1]!.connectionId,
          expectedRevision: bindings[1]!.revision,
          state: "revoked",
        });
        expect(await access.authorize(admitted.authorizationToken)).toBeNull();
        const denied = await memoryApp.inject({
          method: "POST",
          url: "/api/action/v2/memory/bundle",
          headers,
          payload: { protocolVersion: 2, ...binding, task: "review" },
        });
        expect(denied.statusCode).toBe(403);
        expect(
          await harness.routes.contextTools!.authorize(
            admitted.authorizationToken,
          ),
        ).toBeNull();
      } finally {
        releaseScm?.();
        await blockedTools;
        await Promise.all([...apps, ...memoryApps].map((app) => app.close()));
        await harness.close();
      }
    }, 60000);
  },
);
