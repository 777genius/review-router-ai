import { expect, it, vi } from "vitest";
import { PrismaActionControlPlaneRepository } from "@reviewrouter/features-action-control-plane";
import {
  conversationDigest,
  type ConversationRecord,
} from "@reviewrouter/features-conversations";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { createConversationPublicationAuthority } from "./action-conversation-policy.js";

it.each(["unchanged", "binding", "model"] as const)(
  "checks the actual current selected configuration at publication claim: %s",
  async (change) => {
    const boundAt = new Date("2026-10-28T01:00:00.000Z");
    const provider = {
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding_old",
      gatewayProfileRef: "gateway-responses-v1",
      model: "old-selected-model",
      agenticContext: false,
      fastMode: false,
    };
    const configuration = (selected: typeof provider) => ({
      config: parseReviewConfigurationStrict({
        schemaVersion: 3,
        providers: [selected],
        execution: {
          providerLimit: 1,
          providerMaxParallel: 1,
          inlineMinAgreement: 1,
        },
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
        reviewLanguage: null,
        investigationRollout: {
          recordingEnabled: false,
          shadowEnabled: false,
          contextCriticEnabled: false,
          verifiedCleanEnabled: false,
          crossRevisionReplayEnabled: false,
          productionEffectsEnabled: false,
        },
      }),
    });
    const captured = configuration(provider);
    const current = configuration({
      ...provider,
      ...(change === "binding"
        ? { gatewayBindingId: "binding_new" }
        : change === "model"
          ? { model: "new-selected-model" }
          : {}),
    });
    const read = vi
      .spyOn(
        PrismaActionControlPlaneRepository.prototype,
        "findRuntimeReviewConfiguration",
      )
      .mockResolvedValue(current as never);
    const binding = {
      id: "binding_old",
      workspaceId: "workspace_probe",
      connectionId: "connection_old",
      state: "active",
      revision: 2,
      policyRevision: 2,
      pendingFenceOperationId: null,
      fenceAckOperationId: null,
      workspace: { personalOwnerUserId: null, deletionState: "active" },
      connection: {
        id: "connection_old",
        ownerWorkspaceId: "workspace_probe",
        ownerUserId: null,
        gatewayAccountRef: "account_old",
        profileRef: provider.gatewayProfileRef,
        displayName: "Old account",
        state: "active",
        metadataRevision: 2,
        authorizationEpochMirror: null,
        pendingSourceOperationId: null,
        ownerWorkspace: { personalOwnerUserId: null },
        ownerUser: null,
      },
    };
    const transaction = {
      repositoryConnection: {
        findFirst: async () => ({ id: "repository_probe" }),
      },
      workspaceAccountBinding: {
        findMany: async () => [
          {
            connectionId: binding.connectionId,
            connection: { ownerUserId: null },
          },
        ],
        findUnique: async () => binding,
      },
      $queryRaw: async (query: { strings?: unknown }) =>
        String(query.strings ?? query).includes("ScmRepositoryIdentity")
          ? [{ version: 1, boundAt }]
          : [],
    };
    const authorize = createConversationPublicationAuthority({
      prisma: {} as never,
      runtime: {
        policy: {
          getPolicy: async () => ({ policyVersion: 1, safetyPolicyVersion: 1 }),
        },
      } as never,
      env: {},
      qualification: {
        proofId: "qualified",
        repositories: [
          { workspaceId: "workspace_probe", repositoryId: "repository_probe" },
        ],
      } as never,
      identityBindingEpoch: `1:${boundAt.toISOString()}`,
    });
    try {
      const record = {
        identity: {
          workspaceId: "workspace_probe",
          repositoryId: "repository_probe",
          repositoryStableId: "1234",
        },
        boundManifest: JSON.stringify({
          publication: { enabled: true },
          policyRevision: "1:1:qualified",
          account: {
            workspaceId: "workspace_probe",
            bindingId: "binding_old",
            bindingRevision: 2,
            policySubject: "binding_old",
            policyRevision: 2,
            connectionId: "connection_old",
            gatewayAccountRef: "account_old",
            profileRef: provider.gatewayProfileRef,
            model: provider.model,
            configurationDigest: conversationDigest(captured),
          },
        }),
      } as ConversationRecord;
      expect(await authorize(transaction as never, record)).toBe(
        change === "unchanged",
      );
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
  },
);
