import { createHash } from "node:crypto";
import type { UsageObservation } from "@agent-teams/account-gateway/contracts";
import { estimateUsageCost } from "@reviewrouter/features-provider-usage";
import type {
  UsageAttributionReader,
  UsageFact,
  UsageSourceReader,
} from "@reviewrouter/features-provider-usage";

/** Safe native facade contract; no native DB, administrative credential or body. */
export interface GatewayUsageObservation {
  schemaVersion: 1;
  eventId: string;
  revision: number;
  executionRef: string;
  requestRef: string;
  invocationRef: string;
  attemptRef: string;
  accountRef: string;
  profileId: string;
  model: string;
  occurredAt: string;
  effect:
    | "not_dispatched"
    | "dispatch_started"
    | "response_started"
    | "completed"
    | "effect_unknown"
    | "rejected_before_dispatch";
  /** unknown: no counter observed (newer Gateways); older ones send partial. */
  completeness: UsageObservation["completeness"];
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  cost: null;
}
export const gatewayUsageCallId = (executionRef: string, requestRef: string) =>
  `gw-${createHash("sha256").update(executionRef).update("\0").update(requestRef).digest("hex")}`;

export function createGatewayUsageSource(input: {
  workspaceId: string;
  sourceInstance: string;
  attribution: UsageAttributionReader;
  client: {
    listUsage(query: {
      afterCursor?: string;
      highWaterCursor?: string;
      limit: number;
    }): Promise<{
      observations: readonly GatewayUsageObservation[];
      nextCursor: string;
      highWaterCursor: string;
    }>;
  };
  /** A durable quarantine is required before a page may advance past unknown scope. */
  quarantine(
    observation: GatewayUsageObservation,
    reason?: "usage_unattributed" | "usage_report_expired",
  ): Promise<void>;
  now?: () => Date;
}): UsageSourceReader {
  return {
    async listUsage(query) {
      const page = await input.client.listUsage({
        ...(query.afterCursor ? { afterCursor: query.afterCursor } : {}),
        ...(query.highWaterMark
          ? { highWaterCursor: query.highWaterMark }
          : {}),
        // Reconciliation atomically accepts at most 100 facts; a terminal
        // diagnostic contributes its native snapshot and one lifecycle fact.
        limit: Math.min(query.limit, 50),
      });
      const facts: UsageFact[] = [];
      for (const observation of page.observations) {
        // Native revision + 1 must fit the existing PostgreSQL usage-fact int.
        if (
          !Number.isSafeInteger(observation.revision) ||
          observation.revision < 0 ||
          observation.revision > 2147483646
        )
          throw new Error("gateway_usage_revision_invalid");
        const identity = await input.attribution.findIdentity({
          workspaceId: input.workspaceId,
          callId: gatewayUsageCallId(
            observation.executionRef,
            observation.requestRef,
          ),
        });
        // The caller never supplies tenant, actor or run attribution to native.
        // Late reports reuse the original immutable server identity and instant.
        if (
          !identity ||
          identity.workspaceId !== input.workspaceId ||
          identity.callId !==
            gatewayUsageCallId(
              observation.executionRef,
              observation.requestRef,
            ) ||
          identity.route !== "gateway" ||
          identity.invocationId !== observation.invocationRef ||
          identity.attemptId !== observation.attemptRef
        ) {
          await input.quarantine(observation, "usage_unattributed");
          continue;
        }
        // Old attributed observations remain durable evidence, but an expired
        // replay must not poison a recreated checkpoint before recent pages.
        if (
          (input.now?.() ?? new Date()).getTime() >
          Date.parse(identity.occurredAt) + 30 * 86400000
        ) {
          await input.quarantine(observation, "usage_report_expired");
          continue;
        }
        const dispatch = await input.attribution.readDispatchSnapshot({
          workspaceId: input.workspaceId,
          callId: identity.callId,
        });
        const fact: UsageFact = {
          schemaVersion: 1,
          sourceInstance: input.sourceInstance,
          eventId: observation.eventId,
          revision: observation.revision + 1,
          authority: "native",
          identity,
          // Native protocol/model does not prove the upstream vendor.
          actualProvider: null,
          // Source model records the validated request, not observed provider output.
          actualModel: null,
          tokens: {
            inputTotal: observation.inputTokens,
            outputTotal: observation.outputTokens,
            cacheRead:
              observation.cachedInputTokens !== null &&
              observation.inputTokens !== null &&
              observation.cachedInputTokens <= observation.inputTokens
                ? observation.cachedInputTokens
                : null,
            cacheWrite: null,
            reasoning:
              observation.reasoningTokens !== null &&
              observation.outputTokens !== null &&
              observation.reasoningTokens <= observation.outputTokens
                ? observation.reasoningTokens
                : null,
            total:
              observation.inputTokens !== null &&
              observation.outputTokens !== null &&
              Number.isSafeInteger(
                observation.inputTokens + observation.outputTokens,
              )
                ? observation.inputTokens + observation.outputTokens
                : null,
          },
          cost: null,
          completeness: observation.completeness,
          state:
            observation.effect === "completed"
              ? "completed"
              : ["not_dispatched", "rejected_before_dispatch"].includes(
                    observation.effect,
                  )
                ? "failed"
                : observation.effect === "effect_unknown"
                  ? "unknown"
                  : "dispatched",
          dispatchEffect: [
            "not_dispatched",
            "rejected_before_dispatch",
          ].includes(observation.effect)
            ? "not_dispatched"
            : observation.effect === "effect_unknown"
              ? "effect_unknown"
              : "dispatched",
          durationMs: null,
          ttftMs: null,
          correctionReason: observation.revision
            ? "native_terminal_observation"
            : null,
          childCallIds: null,
          serviceTier: dispatch?.serviceTier ?? null,
          priceSnapshot: dispatch?.priceSnapshot ?? null,
        };
        fact.cost = estimateUsageCost({
          snapshot: fact.priceSnapshot ?? null,
          tokens: fact.tokens,
          provider: fact.actualProvider,
          model: fact.actualModel,
          tier: fact.serviceTier ?? null,
          occurredAt: identity.occurredAt,
        });
        facts.push(fact);
        // Probe access durably captured this owner/nonce before returning its
        // capability. Unlike reviews, diagnostics have no ReviewRunAuthorization
        // terminal hook. Only the correlated authenticated native effect settles
        // their lifecycle; counters and completeness never authorize completion.
        if (
          identity.purpose === "diagnostic" &&
          identity.runtimeType === "diagnostic" &&
          identity.authorizationId === identity.invocationId &&
          identity.actorId !== null &&
          identity.bindingId !== null &&
          identity.runId === null &&
          identity.runAttempt === null &&
          ["completed", "failed", "unknown"].includes(fact.state)
        ) {
          facts.push({
            ...fact,
            sourceInstance: input.sourceInstance,
            eventId: `diagnostic-terminal:${identity.callId}`,
            authority: "lifecycle",
            tokens: {
              inputTotal: null,
              outputTotal: null,
              total: null,
              cacheRead: null,
              cacheWrite: null,
              reasoning: null,
            },
            cost: null,
            completeness: "unknown",
            serviceTier: null,
            priceSnapshot: null,
            correctionReason: "native_terminal_observation",
          });
        }
      }
      return {
        facts,
        cursor: page.nextCursor,
        highWaterMark: page.highWaterCursor,
        complete: page.nextCursor === page.highWaterCursor,
      };
    },
  };
}
