import {
  lifecycleVerificationContract,
  prDescriptionContract,
} from "@reviewrouter/shared";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { providerUsageConfiguredProvider } from "./provider-usage-provider.js";
import { providerUsagePriceSnapshots } from "./provider-usage-price-snapshot.js";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  IngestUsage,
  type UsageFact,
} from "@reviewrouter/features-provider-usage";
import {
  PrismaUsageStore,
  PrismaUsageAttributionReader,
} from "@reviewrouter/features-provider-usage/composition";
import {
  parseReviewRunRuntimeSnapshot,
  getReviewRunReviewer,
  getReviewRunGatewayAllocation,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import { gatewayUsageCallId } from "./provider-usage-gateway-source";
/** Durable lifecycle correlation is written before dispatch; unknown tokens stay null. */
export function createGatewayUsageRecorder(
  prisma: PrismaClient,
  resolveActor?: (auth: ReviewRunAuthorization) => Promise<string | null>,
) {
  const store = new PrismaUsageStore(prisma);
  const ingest = new IngestUsage(store);
  const attribution = new PrismaUsageAttributionReader(prisma);
  const empty = {
    inputTotal: null,
    outputTotal: null,
    total: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  };
  const sourceInstance = "reviewrouter/gateway-lifecycle-v1";
  return {
    async diagnostic(input: {
      workspaceId: string;
      actorId: string;
      bindingId: string;
      invocationId: string;
      attemptId: string;
      executionRef: string;
      requestRef: string;
      model: string;
      deadline: Date;
    }) {
      const fact: UsageFact = {
        schemaVersion: 1,
        sourceInstance,
        eventId: gatewayUsageCallId(input.executionRef, input.requestRef),
        revision: 1,
        authority: "lifecycle",
        identity: {
          callId: gatewayUsageCallId(input.executionRef, input.requestRef),
          workspaceId: input.workspaceId,
          repositoryId: null,
          actorId: input.actorId,
          runId: null,
          runAttempt: null,
          invocationId: input.invocationId,
          attemptId: input.attemptId,
          bindingId: input.bindingId,
          authorizationId: input.invocationId,
          route: "gateway",
          purpose: "diagnostic",
          provider: "unknown",
          requestedModel: input.model,
          runtimeType: "diagnostic",
          parentScope: null,
          granularity: "call",
          occurredAt: new Date().toISOString(),
        },
        actualProvider: null,
        actualModel: null,
        tokens: empty,
        cost: null,
        completeness: "unknown",
        state: "prepared",
        dispatchEffect: "not_dispatched",
        durationMs: null,
        ttftMs: null,
        correctionReason: null,
        childCallIds: null,
      };
      await store.prepare(fact, {
        workspaceId: input.workspaceId,
        invocationId: input.invocationId,
        source: "native",
        now: new Date(),
        replayUntil: input.deadline,
      });
    },
    async prepare(input: {
      authorization: ReviewRunAuthorization;
      executionRef: string;
      requestRef: string;
      occurredAt: string;
      model: string;
      reviewerId?: string;
      role?: "lifecycle_verification" | "pr_description";
    }) {
      const snapshot = parseReviewRunRuntimeSnapshot(
        input.authorization.runtimeSnapshotCanonicalJson,
      );
      if (!snapshot) throw new Error("usage_gateway_snapshot_missing");
      const reviewer =
        snapshot.snapshotVersion === 4 && input.reviewerId !== undefined
          ? getReviewRunReviewer(snapshot, input.reviewerId)
          : undefined;
      const gateway =
        snapshot.snapshotVersion === 4
          ? reviewer
            ? getReviewRunGatewayAllocation(
                snapshot,
                reviewer.transport.allocationId,
              )
            : null
          : snapshot.gateway;
      if (
        !gateway ||
        (snapshot.snapshotVersion === 3 && input.reviewerId !== undefined)
      )
        throw new Error("usage_gateway_snapshot_missing");
      if (reviewer && input.model !== reviewer.requestedModel)
        throw new Error("usage_gateway_reviewer_mismatch");
      const config = parseReviewConfigurationStrict(
        JSON.parse(snapshot.configurationCanonicalJson),
      );
      const lane =
        config.providers[
          reviewer?.providerIndex ??
            (snapshot.snapshotVersion === 3
              ? snapshot.gateway!.providerIndex
              : -1)
        ];
      if (!lane) throw new Error("usage_gateway_provider_missing");
      const configured = providerUsageConfiguredProvider(lane);
      const repo = await prisma.scmRepositoryIdentity.findUnique({
        where: {
          scmRepositoryIdentityId: input.authorization.scmRepositoryIdentityId,
        },
        select: { externalRepositoryId: true },
      });
      const priceSnapshot = await (
        await providerUsagePriceSnapshots()
      )
        .read({
          provider: configured.provider,
          model: input.model,
          occurredAt: input.occurredAt,
          tier: "standard",
        })
        .catch(() => null);
      const grant = await prisma.providerUsageGrant.findFirst({
        where: {
          authorizationId: input.authorization.authorizationId,
          revokedAt: null,
        },
        orderBy: { issuedAt: "asc" },
        select: { actorId: true },
      });
      const fact: UsageFact = {
        schemaVersion: 1,
        priceSnapshot,
        serviceTier: null,
        sourceInstance,
        eventId: gatewayUsageCallId(input.executionRef, input.requestRef),
        revision: 1,
        authority: "lifecycle",
        identity: {
          callId: gatewayUsageCallId(input.executionRef, input.requestRef),
          workspaceId: input.authorization.workspaceId,
          repositoryId: repo?.externalRepositoryId ?? null,
          actorId:
            grant?.actorId ??
            (await resolveActor?.(input.authorization)) ??
            null,
          runId: input.authorization.sourceRunId,
          runAttempt: Number(input.authorization.sourceRunAttempt),
          invocationId: gateway.invocationId,
          attemptId: gateway.attemptId,
          bindingId: gateway.bindingId,
          authorizationId: input.authorization.authorizationId,
          route: "gateway",
          purpose: "review",
          provider: configured.provider,
          requestedModel: input.model,
          runtimeType:
            input.role === "lifecycle_verification"
              ? lifecycleVerificationContract.executor
              : input.role === "pr_description"
                ? prDescriptionContract.taskKind
                : (reviewer?.agentProfile.agentKind ??
                  (snapshot.snapshotVersion === 3
                    ? snapshot.agent.agentKind
                    : "unknown")),
          parentScope: reviewer?.reviewerId ?? null,
          granularity: "call",
          occurredAt: input.occurredAt,
        },
        actualProvider: null,
        actualModel: null,
        tokens: empty,
        cost: null,
        completeness: "unknown",
        state: "prepared",
        dispatchEffect: "not_dispatched",
        durationMs: null,
        ttftMs: null,
        correctionReason: null,
        childCallIds: null,
      };
      return store.prepare(fact, {
        workspaceId: fact.identity.workspaceId,
        invocationId: fact.identity.invocationId,
        source: "native",
        now: new Date(),
        replayUntil: input.authorization.maxExpiresAt,
      });
    },
    async ownsRequest(input: {
      authorizationId: string;
      executionRef: string;
      requestRef: string;
      reviewerId: string;
    }) {
      const auth = await prisma.reviewRunAuthorization.findUnique({
        where: { authorizationId: input.authorizationId },
        select: { workspaceId: true },
      });
      if (!auth) return false;
      const identity = await attribution.findIdentity({
        workspaceId: auth.workspaceId,
        callId: gatewayUsageCallId(input.executionRef, input.requestRef),
      });
      return (
        identity?.authorizationId === input.authorizationId &&
        identity.parentScope === input.reviewerId
      );
    },
    async outcome(input: {
      authorizationId: string;
      executionRef: string;
      requestRef: string;
      effect: string;
    }) {
      const auth = await prisma.reviewRunAuthorization.findUnique({
        where: { authorizationId: input.authorizationId },
        select: { workspaceId: true, maxExpiresAt: true },
      });
      if (!auth) return;
      const identity = await attribution.findIdentity({
        workspaceId: auth.workspaceId,
        callId: gatewayUsageCallId(input.executionRef, input.requestRef),
      });
      if (!identity) return;
      const notDispatched = [
        "not_dispatched",
        "rejected_before_dispatch",
      ].includes(input.effect);
      const completed = input.effect === "completed";
      const unknown = input.effect === "effect_unknown";
      const fact: UsageFact = {
        schemaVersion: 1,
        sourceInstance,
        eventId: identity.callId,
        revision: completed || unknown || notDispatched ? 3 : 2,
        authority: "lifecycle",
        identity,
        actualProvider: null,
        actualModel: null,
        tokens: empty,
        cost: null,
        completeness: "unknown",
        state: completed
          ? "completed"
          : notDispatched
            ? "failed"
            : unknown
              ? "unknown"
              : "dispatched",
        dispatchEffect: notDispatched
          ? "not_dispatched"
          : unknown
            ? "effect_unknown"
            : "dispatched",
        durationMs: null,
        ttftMs: null,
        correctionReason: null,
        childCallIds: null,
      };
      await ingest.execute(fact, {
        workspaceId: identity.workspaceId,
        invocationId: identity.invocationId,
        source: "native",
        now: new Date(),
        replayUntil: new Date(auth.maxExpiresAt.getTime() + 30 * 86400000),
      });
    },
  };
}
