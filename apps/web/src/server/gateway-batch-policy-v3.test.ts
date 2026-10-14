import { describe, expect, it, vi } from "vitest";
import {
  parseReviewConfiguration,
  resolveReviewPolicy,
} from "@reviewrouter/features-review-config";
import { createGatewayRepositoryBatchAdapter } from "./gateway-repository-batch-configuration";

describe("gateway batch sparse policy", () => {
  it.each([false, true])(
    "preserves sparse intent when outcome is unknown=%s and workspace changes",
    async (unknownOutcome) => {
      const selection = {
        kind: "codex" as const,
        authMode: "codex_account_gateway" as const,
        model: "mimo-v2.6-pro",
        reasoningEffort: "high" as const,
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
        gatewayBindingId: "fixture-binding",
        gatewayProfileRef: "fixture-responses",
      };
      const workspace = parseReviewConfiguration({
        schemaVersion: 3,
        providers: [selection],
        execution: {
          providerLimit: 1,
          providerMaxParallel: 1,
          inlineMinAgreement: 1,
        },
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 17, targetTokensPerBatch: 16000 },
        reviewLanguage: "French",
        investigationRollout: {
          recordingEnabled: false,
          shadowEnabled: false,
          contextCriticEnabled: false,
          verifiedCleanEnabled: false,
          crossRevisionReplayEnabled: false,
          productionEffectsEnabled: false,
        },
      });
      const policy = {
        schemaVersion: 3 as const,
        limits: { inlineMaxComments: 0 },
      };
      const unused = async (): Promise<never> => {
        throw new Error("unexpected write");
      };
      let receipt: Awaited<
        ReturnType<
          Parameters<
            typeof createGatewayRepositoryBatchAdapter
          >[0]["configurations"]["findOperation"]
        >
      > = null;
      const write = vi.fn<
        Parameters<
          typeof createGatewayRepositoryBatchAdapter
        >[0]["configurations"]["saveNextVersionWithOperation"]
      >(async (input) => {
        const currentWorkspace = unknownOutcome
          ? { ...workspace, reviewLanguage: "German" }
          : workspace;
        receipt = {
          version: 2,
          policy: input.policy,
          config: resolveReviewPolicy(currentWorkspace, input.policy),
        };
        if (unknownOutcome) throw new Error("write_outcome_unknown_fixture");
        return receipt;
      });
      const adapter = createGatewayRepositoryBatchAdapter({
        configurations: {
          findLatest: async () => ({
            version: 1,
            policy,
            config: resolveReviewPolicy(workspace, policy),
          }),
          findOperation: async () => receipt,
          saveNextVersionWithOperation: write,
          saveNextVersion: unused,
          deleteTarget: unused,
        },
        authorize: async () => ({
          userId: "fixture-user",
          githubUserId: "123",
          githubLogin: "fixture",
        }),
        profiles: async () => [
          {
            id: "fixture-responses",
            label: "Fixture",
            protocol: "openai-responses",
            models: ["mimo-v2.6-pro"],
          },
        ],
        bindings: {
          workspaceAccess: {
            findWorkspaceRoleByUserId: async () => "owner",
            findWorkspaceRoleByGitHubUserId: async () => "owner",
            listWorkspaceRolesByUserId: async () => [],
            listWorkspaceRolesByGitHubUserId: async () => [],
          },
          accounts: {
            findOwnedConnection: async () => null,
            compareAndSetBinding: unused,
            findBinding: async () => ({
              binding: {
                id: "fixture-binding",
                workspaceId: "fixture-workspace",
                connectionId: "fixture-connection",
                state: "active",
                revision: 1,
                policyRevision: 1,
                pendingFence: null,
                fenceAck: null,
              },
              connection: {
                id: "fixture-connection",
                owner: { kind: "workspace", workspaceId: "fixture-workspace" },
                gatewayAccountRef: "fixture-account",
                gatewayOperationRef: null,
                profileRef: "fixture-responses",
                displayName: "Fixture",
                state: "active",
                metadataRevision: 1,
              },
            }),
          },
        },
      });
      const result = await adapter.save({
        workspaceId: "fixture-workspace",
        operationId: "10000000-0000-4000-8000-000000000001",
        targets: [{ repositoryId: "fixture-repository", expectedVersion: 1 }],
        selection,
      });
      expect(result.results).toEqual([
        { repositoryId: "fixture-repository", status: "applied", version: 2 },
      ]);
      expect(write).toHaveBeenCalledOnce();
      const saved = write.mock.calls[0]![0].policy;
      expect(saved).toEqual({
        schemaVersion: 3,
        limits: { inlineMaxComments: 0 },
        providers: [selection],
        execution: {
          providerLimit: 1,
          providerMaxParallel: 1,
          inlineMinAgreement: 1,
        },
      });
      expect(saved).not.toHaveProperty("reviewLanguage");
      expect(saved).not.toHaveProperty("blockingPolicy");
      expect(
        resolveReviewPolicy(
          {
            ...workspace,
            reviewLanguage: "German",
            limits: { ...workspace.limits, targetTokensPerBatch: 20000 },
          },
          saved,
        ),
      ).toMatchObject({
        reviewLanguage: "German",
        limits: { inlineMaxComments: 0, targetTokensPerBatch: 20000 },
      });
    },
  );
});
