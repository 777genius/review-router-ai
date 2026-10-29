import { createHash } from "node:crypto";
import {
  conversationScopeQualified,
  type ConversationQualification,
} from "@reviewrouter/platform-config";
export {
  readConversationQualification,
  conversationScopeQualified,
  type ConversationQualification,
} from "@reviewrouter/platform-config";
import * as c from "@agent-teams/account-gateway/contracts";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import type { Prisma, PrismaClient } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import { PrismaActionControlPlaneRepository } from "@reviewrouter/features-action-control-plane";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import {
  PrismaProviderAccountRepository,
  selectBinding,
  lockProviderAccountBindingUses,
} from "@reviewrouter/features-provider-accounts";
import {
  accountModelCatalogResponseBytes,
  readAccountModelCatalogEnabled,
  readPersonalAccountSharingEnabled,
} from "@reviewrouter/features-provider-accounts/composition";
import {
  ConversationError,
  conversationDigest,
  type ConversationPolicyPort,
  type RequestControls,
} from "@reviewrouter/features-conversations";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import { readReviewRunGatewayRelayPolicy } from "./review-run-gateway-relay.js";
import { readServerApprovedReviewRunGatewayPolicy } from "./review-run-runtime-snapshot.js";
import { createConversationGatewayInference } from "./action-conversation-inference.js";

/** Companion conversations follow the first/primary reviewer, as other V4 companions do.
 * Never silently select a later account or reinterpret a mixed-auth roster.
 */
function primaryConversationProvider(
  configuration: ReturnType<typeof parseReviewConfigurationStrict>,
) {
  const primary = configuration.providers[0];
  if (
    primary?.authMode !== "codex_account_gateway" ||
    configuration.providers.some(
      (provider) => provider.authMode !== "codex_account_gateway",
    )
  )
    throw new ConversationError("unavailable");
  return primary;
}

/** Completion of the original admitted model request; no recall, model capture or paid grant. */
export function createConversationPublicationAuthority(input: {
  readonly prisma: PrismaClient;
  readonly runtime: MemoryKnowledgeRuntime;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly qualification: ConversationQualification;
  readonly identityBindingEpoch: string;
}) {
  const personalAccountsEnabled = readPersonalAccountSharingEnabled(input.env);
  const repositories = new PrismaActionControlPlaneRepository(input.prisma);
  const accounts = new PrismaProviderAccountRepository(
    input.prisma,
    input.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
    personalAccountsEnabled,
  );
  return async (
    transaction: Prisma.TransactionClient,
    record: import("@reviewrouter/features-conversations").ConversationRecord,
  ) => {
    try {
      if (
        !record.boundManifest ||
        !conversationScopeQualified(input.qualification, record.identity)
      )
        return false;
      const manifest = JSON.parse(record.boundManifest) as {
        policyRevision?: string;
        publication?: { enabled?: boolean };
        account?: Record<string, unknown>;
      };
      const captured = manifest.account;
      if (
        manifest.publication?.enabled !== true ||
        !captured ||
        typeof captured.bindingId !== "string"
      )
        return false;
      const policy = await input.runtime.policy.getPolicy(record.identity);
      if (
        manifest.policyRevision !==
        `${policy.policyVersion}:${policy.safetyPolicyVersion}:${input.qualification.proofId}`
      )
        return false;
      const scope = record.identity;
      await acquireCurrentScopeGuards(transaction, [
        { scope: "workspace", workspaceId: scope.workspaceId, mode: "shared" },
        {
          scope: "repository",
          workspaceId: scope.workspaceId,
          repositoryId: scope.repositoryId,
          mode: "shared",
        },
      ]);
      const repository = await transaction.repositoryConnection.findFirst({
        where: {
          id: scope.repositoryId,
          workspaceId: scope.workspaceId,
          selected: true,
          archived: false,
          githubRepositoryId: BigInt(scope.repositoryStableId),
          installation: { status: "active" },
        },
        select: { id: true },
      });
      if (!repository) return false;
      const identities = await transaction.$queryRaw<
        { version: number; boundAt: Date }[]
      >`SELECT "version", "boundAt" FROM "ScmRepositoryIdentity" WHERE "currentRepositoryConnectionId"=${scope.repositoryId} AND "currentWorkspaceId"=${scope.workspaceId} AND "externalRepositoryId"=${scope.repositoryStableId} AND "boundAt" IS NOT NULL AND "unboundAt" IS NULL`;
      if (
        identities.length !== 1 ||
        `${identities[0]!.version}:${identities[0]!.boundAt.toISOString()}` !==
          input.identityBindingEpoch
      )
        return false;
      await lockProviderAccountBindingUses(
        transaction,
        scope.workspaceId,
        [captured.bindingId],
        personalAccountsEnabled,
      );
      const current = await repositories.findRuntimeReviewConfiguration(
        scope,
        transaction,
      );
      if (
        !current ||
        conversationDigest(current) !== captured.configurationDigest
      )
        return false;
      const configuration = parseReviewConfigurationStrict(current.config);
      const provider = primaryConversationProvider(configuration);
      if (
        provider.gatewayBindingId !== captured.bindingId ||
        provider.gatewayProfileRef !== captured.profileRef ||
        provider.model !== captured.model
      )
        return false;
      const binding = selectBinding(
        scope.workspaceId,
        captured.bindingId,
        await accounts.findBinding(
          { workspaceId: scope.workspaceId, bindingId: captured.bindingId },
          transaction,
        ),
        input.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
      );
      return (
        [
          "workspaceId",
          "bindingId",
          "bindingRevision",
          "policySubject",
          "policyRevision",
          "connectionId",
          "gatewayAccountRef",
          "profileRef",
          "expectedAuthorizationEpoch",
        ] as const
      ).every((key) => binding[key] === captured[key]);
    } catch {
      return false;
    }
  };
}

/** Metadata linearization point; callers complete GitHub/Gateway reads before entering. */
export async function admitConversationDispatch(
  transaction: Prisma.TransactionClient,
  input: {
    readonly processingId: string;
    readonly workspaceId: string;
    readonly repositoryId: string;
    readonly bindingManifest: Readonly<Record<string, unknown>>;
    readonly checkSelection: (
      transaction: Prisma.TransactionClient,
    ) => Promise<boolean>;
    readonly admitMemory: (
      transaction: Prisma.TransactionClient,
      now: Date,
    ) => Promise<boolean>;
  },
) {
  if (
    !(await input.checkSelection(transaction)) ||
    !(await input.admitMemory(transaction, new Date()))
  )
    return false;
  await transaction.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id" = ${input.processingId} AND "workspaceId" = ${input.workspaceId} AND "repositoryId" = ${input.repositoryId} FOR UPDATE`;
  const accepted = await transaction.conversationProcessing.findFirst({
    where: {
      id: input.processingId,
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      status: "processing",
      modelDispatched: true,
      requestEffect: null,
      deadlineAt: { gt: new Date() },
    },
  });
  if (
    !accepted?.boundManifest ||
    conversationDigest(
      (JSON.parse(accepted.boundManifest) as { account?: unknown }).account,
    ) !== conversationDigest(input.bindingManifest)
  )
    return false;
  await transaction.conversationProcessing.update({
    where: { id: input.processingId },
    data: { requestEffect: "dispatch_allowed" },
  });
  return true;
}
export function createConversationPolicy(input: {
  readonly prisma: PrismaClient;
  readonly runtime: MemoryKnowledgeRuntime;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly qualification: ConversationQualification;
  readonly admitMemory: (
    transaction: Prisma.TransactionClient,
    now: Date,
  ) => Promise<boolean>;
}): ConversationPolicyPort {
  const env = input.env,
    q = input.qualification;
  const repositories = new PrismaActionControlPlaneRepository(input.prisma);
  const personalAccountsEnabled = readPersonalAccountSharingEnabled(env);
  const accounts = new PrismaProviderAccountRepository(
    input.prisma,
    env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
    personalAccountsEnabled,
  );
  const approved = readServerApprovedReviewRunGatewayPolicy(
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY,
  );
  const relay = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY
    ? readReviewRunGatewayRelayPolicy(
        env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY,
      )
    : undefined;
  const origin = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN,
    bearer = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER;
  return {
    async capture(identity, processingId, controls) {
      if (
        !conversationScopeQualified(q, identity) ||
        !origin ||
        !bearer ||
        !relay ||
        !approved
      )
        throw new ConversationError("unavailable");
      const captureWithin = async (tx: Prisma.TransactionClient) => {
        await acquireCurrentScopeGuards(tx, [
          {
            scope: "workspace",
            workspaceId: identity.workspaceId,
            mode: "shared",
          },
          {
            scope: "repository",
            workspaceId: identity.workspaceId,
            repositoryId: identity.repositoryId,
            mode: "shared",
          },
        ]);
        const before = await repositories.findRuntimeReviewConfiguration(
          identity,
          tx,
        );
        if (!before) throw new ConversationError("unavailable");
        const configuration = parseReviewConfigurationStrict(before.config);
        const provider = primaryConversationProvider(configuration);
        await lockProviderAccountBindingUses(
          tx,
          identity.workspaceId,
          [provider.gatewayBindingId],
          personalAccountsEnabled,
        );
        const current = await repositories.findRuntimeReviewConfiguration(
          identity,
          tx,
        );
        if (conversationDigest(current) !== conversationDigest(before))
          throw new ConversationError("stale");
        const selection = await accounts.findBinding(
          {
            workspaceId: identity.workspaceId,
            bindingId: provider.gatewayBindingId,
          },
          tx,
        );
        const binding = selectBinding(
          identity.workspaceId,
          provider.gatewayBindingId,
          selection,
          env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
        );
        const policy = await input.runtime.policy.getPolicy(identity);
        if (
          !binding.profileRef ||
          binding.profileRef !== provider.gatewayProfileRef
        )
          throw new ConversationError("unavailable");
        return {
          provider,
          binding: { ...binding, profileRef: provider.gatewayProfileRef },
          selection,
          policy,
          configurationDigest: conversationDigest(current),
        };
      };
      const capture = () => input.prisma.$transaction(captureWithin);
      const selected = await capture();
      const modelQualification = q.models.filter(
        (model) =>
          model.profileId === selected.binding.profileRef &&
          model.model === selected.provider.model,
      );
      const profile = relay.profiles.filter(
        (entry) => entry.profile.profileId === selected.binding.profileRef,
      );
      const configuredLimits = approved.profiles.filter(
        (entry) => entry.profileRef === selected.binding.profileRef,
      );
      if (
        modelQualification.length !== 1 ||
        profile.length !== 1 ||
        configuredLimits.length !== 1 ||
        profile[0]!.profile.protocol !== "openai-responses"
      )
        throw new ConversationError("unavailable");
      const control = createConsumerControlClient({
        role: "consumer-control",
        origin: env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN ?? origin,
        token: bearer,
        timeoutMs: Math.min(10_000, relay.requestTimeoutMs),
        responseBytes: accountModelCatalogResponseBytes,
      });
      const remoteCurrent = async (budget: RequestControls) => {
        try {
          if (
            budget.signal?.aborted ||
            Date.now() >= budget.deadlineAt.getTime() ||
            conversationDigest(await capture()) !== conversationDigest(selected)
          )
            return false;
          const owner = selected.selection!.connection.owner;
          const ownerRef = `${owner.kind === "user" ? "rru" : "rrw"}_${createHash(
            "sha256",
          )
            .update(
              owner.kind === "user"
                ? `rr-user-owner-v1\0${owner.userId}`
                : `rr-workspace-owner-v1\0${owner.workspaceId}`,
            )
            .digest("hex")}`;
          const account = await control.get(
            selected.binding.gatewayAccountRef,
            budget.signal ? { signal: budget.signal } : {},
          );
          if (
            account.accountRef !== selected.binding.gatewayAccountRef ||
            account.profileId !== selected.binding.profileRef ||
            account.ownerRef !== ownerRef ||
            account.state !== "active" ||
            (selected.binding.expectedAuthorizationEpoch !== undefined &&
              account.authorizationEpoch !==
                selected.binding.expectedAuthorizationEpoch)
          )
            return false;
          if (!profile[0]!.profile.modelIds.includes(selected.provider.model)) {
            const discoverySource = profile[0]!.profile.authKinds
              .map((authKind) =>
                c.accountModelDiscoverySource({
                  profileId: profile[0]!.profile.profileId,
                  protocol: profile[0]!.profile.protocol,
                  authKind,
                }),
              )
              .find((source) => source !== undefined);
            if (!readAccountModelCatalogEnabled(env) || !discoverySource)
              return false;
            const models = await control.readAccountModels(
              {
                ownerRef,
                accountRef: selected.binding.gatewayAccountRef,
                profileId: selected.binding.profileRef,
                expectedAuthorizationEpoch: account.authorizationEpoch,
              },
              budget.signal ? { signal: budget.signal } : {},
            );
            if (
              models.status !== "snapshot" ||
              models.source !== discoverySource ||
              Date.parse(models.fetchedAt) > Date.now() ||
              Date.parse(models.expiresAt) <= Date.now() ||
              !models.models.some(
                (model) => model.modelId === selected.provider.model,
              )
            )
              return false;
          }
          return (
            conversationDigest(await capture()) === conversationDigest(selected)
          );
        } catch {
          return false;
        }
      };
      const original = configuredLimits[0]!.limits;
      const limits = c.limits.parse({
        requests: 1,
        concurrency: 1,
        requestBytes: Math.min(
          131_072,
          original.requestBytes,
          relay.ingressBytes,
        ),
        outputBytes: Math.min(262_144, original.outputBytes),
        tokens: Math.min(2048, original.tokens, profile[0]!.outputTokens),
      });
      const bindingManifest = {
        ...selected.binding,
        model: selected.provider.model,
        configurationDigest: selected.configurationDigest,
        qualificationProofId: q.proofId,
        limits,
        deadline: controls.deadlineAt.toISOString(),
      };
      if (!(await remoteCurrent(controls)))
        throw new ConversationError("unavailable");
      const inference = createConversationGatewayInference({
        runAccess: {
          origin,
          runControlBearer: bearer,
          timeoutMs: Math.min(60_000, relay.requestTimeoutMs),
          ...(env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN
            ? {
                controlOrigin: env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN,
              }
            : {}),
        },
        prepare: {
          operationId: `rr-conversation-${processingId}`,
          invocationRef: `rr-conversation-${processingId}`,
          attemptRef: `rr-conversation-${processingId}-model`,
          accountRefs: [selected.binding.gatewayAccountRef],
          subjectRef: selected.binding.policySubject,
          policyRevision: selected.binding.policyRevision,
          bindingRevision: selected.binding.bindingRevision,
          profileId: selected.binding.profileRef,
          limits,
          deadline: controls.deadlineAt.toISOString(),
        },
        requestId: `rr-conversation-${processingId}-request`,
        model: selected.provider.model,
        ...(selected.binding.expectedAuthorizationEpoch !== undefined
          ? {
              expectedAuthorizationEpoch:
                selected.binding.expectedAuthorizationEpoch,
            }
          : {}),
        checkAuthority: remoteCurrent,
        admitDispatch: async (budget) =>
          input.prisma.$transaction((transaction) =>
            admitConversationDispatch(transaction, {
              processingId,
              workspaceId: identity.workspaceId,
              repositoryId: identity.repositoryId,
              bindingManifest,
              admitMemory: input.admitMemory,
              checkSelection: async (tx) => {
                if (
                  budget.signal?.aborted ||
                  Date.now() >= budget.deadlineAt.getTime() ||
                  conversationDigest(await captureWithin(tx)) !==
                    conversationDigest(selected)
                )
                  return false;
                return !!(await tx.repositoryConnection.findFirst({
                  where: {
                    id: identity.repositoryId,
                    workspaceId: identity.workspaceId,
                    selected: true,
                    archived: false,
                    githubRepositoryId: BigInt(identity.repositoryStableId),
                    installation: { status: "active" },
                  },
                  select: { id: true },
                }));
              },
            }),
          ),
        async onObserved(value) {
          await input.prisma.conversationProcessing.updateMany({
            where: {
              id: processingId,
              workspaceId: identity.workspaceId,
              repositoryId: identity.repositoryId,
            },
            data: {
              observedModel: value.model,
              ...(value.usage ? { observedUsage: value.usage } : {}),
              requestEffect: "completed",
            },
          });
        },
      });
      return {
        revision: `${selected.policy.policyVersion}:${selected.policy.safetyPolicyVersion}:${q.proofId}`,
        automaticLearning:
          selected.policy.memoryEnabled && selected.policy.automaticLearning,
        discussionReplies: true,
        contextWindowTokens: modelQualification[0]!.contextWindowTokens,
        tokensPerByteUpperBound: modelQualification[0]!.tokensPerByteUpperBound,
        maxInputBytes: limits.requestBytes,
        inference,
        bindingManifest,
        isCurrent: remoteCurrent,
      };
    },
  };
}
