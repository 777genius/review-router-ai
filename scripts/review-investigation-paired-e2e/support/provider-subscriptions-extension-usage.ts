/** Attribution is captured before ingress; all usage facts come from the real journal. */
import assert from "node:assert/strict";
import type { ConnectionProfileV3 } from "@agent-teams/account-gateway/contracts";
import {
  buildUsagePeriodReport,
  selectProjection,
  validateUsageFact,
  type UsageFact,
  type UsageIdentity,
} from "../../../packages/features/provider-usage/src/index";
import {
  createGatewayUsageSource,
  gatewayUsageCallId,
} from "../../../apps/api/src/provider-usage-gateway-source";
import { buildUsageReport } from "../../../apps/web/src/server/provider-usage-view-model";
import { createNativeConnectionConsumerControlClient } from "../../../apps/web/src/server/native-connection-client";
import type { JoinedDispatchTrace } from "./provider-subscriptions-dispatch-trace";

export function createExtensionUsageObserver(input: {
  origin: string;
  consumerToken: string;
  ownerRef: string;
  accountRef: string;
  profile: ConnectionProfileV3;
  modelId: string;
}) {
  const consumer = createNativeConnectionConsumerControlClient({
    role: "consumer-control",
    origin: input.origin,
    token: input.consumerToken,
  });
  const identities = new Map<string, UsageIdentity>();
  const start = new Date();
  const workspaceId = input.ownerRef;
  const source = createGatewayUsageSource({
    workspaceId,
    sourceInstance: "joined-native-extension",
    client: { listUsage: (query) => consumer.listUsageV2(query) },
    attribution: {
      findIdentity: async (query) => {
        assert.equal(query.workspaceId, workspaceId);
        return identities.get(query.callId) ?? null;
      },
      readDispatchSnapshot: async (query) => {
        assert.equal(query.workspaceId, workspaceId);
        assert.ok(identities.has(query.callId));
        return { serviceTier: "default", priceSnapshot: null };
      },
    },
    // No cursor is advanced past unattributed data. This bounded fixture must
    // contain only the two requests whose identities were captured beforehand.
    quarantine: async () => {
      throw new Error("joined_extension_usage_unattributed");
    },
  });
  let priorReport:
    | Pick<ReturnType<typeof buildUsageReport>, "rows" | "totals">
    | undefined;

  async function readReport() {
    assert.equal(identities.size, 2, "the real review must enter two requests");
    const facts = new Map<string, UsageFact[]>();
    let afterCursor: string | null = null;
    let highWaterMark: string | null = null;
    let complete = false;
    for (let pages = 0; pages < 8 && !complete; pages++) {
      const page = await source.listUsage({
        afterCursor,
        highWaterMark,
        limit: 50,
      });
      for (const fact of page.facts) {
        validateUsageFact(fact);
        assert.ok(identities.has(fact.identity.callId));
        const current = facts.get(fact.identity.callId) ?? [];
        current.push(fact);
        facts.set(fact.identity.callId, current);
      }
      afterCursor = page.cursor;
      highWaterMark = page.highWaterMark;
      complete = page.complete;
    }
    assert.equal(
      complete,
      true,
      "usage reconciliation must reach its high water mark",
    );
    assert.equal(facts.size, identities.size);
    const projections = [...facts.values()].map(selectProjection);
    for (const projection of projections) {
      assert.deepEqual(
        projection.identity,
        identities.get(projection.identity.callId),
      );
      assert.equal(projection.usage?.state, "completed");
      assert.equal(projection.usage?.authority, "native");
      assert.equal(projection.usage.nativeEvidenceVersion, 2);
      assert.equal(
        projection.usage.nativeContext?.providerId,
        input.profile.provider.id,
      );
      assert.equal(
        projection.usage.nativeContext?.productId,
        input.profile.product.id,
      );
      assert.equal(
        projection.usage.nativeContext?.profileId,
        input.profile.profileId,
      );
      assert.equal(projection.usage.nativeContext?.modelId, input.modelId);
      assert.equal(projection.usage.tokens.inputTotal, 7);
      assert.equal(projection.usage.tokens.outputTotal, 3);
      assert.equal(projection.usage.tokens.total, 10);
      assert.equal(
        projection.usage.cost,
        null,
        "unobserved cost remains unknown",
      );
    }
    const report = buildUsageReport(
      buildUsagePeriodReport(projections, {
        workspaceId,
        actorId: null,
        access: "admin",
        from: start,
        to: new Date(),
        route: "gateway",
        purpose: "review",
      }),
    );
    assert.equal(report.rows.length, 2);
    assert.equal(report.totals.providerAttempts, 2);
    assert.equal(report.totals.tokens.inputTotal, 14);
    assert.equal(report.totals.tokens.outputTotal, 6);
    assert.equal(report.totals.tokens.total, 20);
    assert.equal(report.totals.unknownCostCount, 2);
    for (const row of report.rows) {
      assert.equal(row.provider, input.profile.provider.id);
      assert.equal(row.requestedProvider, input.profile.provider.id);
      assert.equal(row.model, input.modelId);
      assert.equal(row.requestedModel, input.modelId);
      assert.equal(row.authority, "native");
      assert.equal(row.total, 10);
      assert.equal(row.cost, null);
      assert.deepEqual(
        row.billing,
        projections.find((value) => value.identity.callId === row.id)?.usage
          ?.nativeContext?.billing,
        "billing is historical source evidence, never inferred from a profile name",
      );
    }
    return { rows: report.rows, totals: report.totals };
  }

  return {
    beforeDispatch: async (trace: JoinedDispatchTrace) => {
      assert.equal(trace.accountRef, input.accountRef);
      assert.equal(trace.profileId, input.profile.profileId);
      assert.equal(trace.modelId, input.modelId);
      assert.equal(trace.serviceTier, "default");
      assert.ok(Number.isFinite(Date.parse(trace.occurredAt)));
      const callId = gatewayUsageCallId(trace.executionRef, trace.requestRef);
      assert.equal(identities.has(callId), false);
      // The fixture owns this attribution context before provider ingress.
      // No identity field is recovered or guessed from a later usage event.
      identities.set(
        callId,
        Object.freeze({
          callId,
          workspaceId,
          repositoryId: null,
          actorId: null,
          runId: trace.invocationRef,
          runAttempt: 1,
          invocationId: trace.invocationRef,
          attemptId: trace.attemptRef,
          bindingId: trace.policySubjectRef,
          authorizationId: trace.runOperationId,
          route: "gateway",
          purpose: "review",
          provider: input.profile.provider.id,
          requestedModel: trace.modelId,
          runtimeType: "codex",
          parentScope: null,
          granularity: "call",
          occurredAt: trace.occurredAt,
        }),
      );
    },
    afterReview: async () => {
      priorReport = await readReport();
      return {
        actualUsage: true as const,
        attributedRequests: identities.size,
        providerId: input.profile.provider.id,
        modelId: input.modelId,
        inputTokens: priorReport.totals.tokens.inputTotal,
        outputTokens: priorReport.totals.tokens.outputTotal,
        cost: "unknown" as const,
        billing: priorReport.rows.map((row) => row.billing),
      };
    },
    afterRetirement: async () => {
      assert.ok(priorReport);
      assert.deepEqual(await readReport(), priorReport);
      return { historyAfterRetirement: true as const };
    },
  };
}
