import {
  selectProjection,
  type UsageFact,
  type UsageProjection,
} from "../domain/usage";
import { fact } from "./fixture";

const noTokens = {
  inputTotal: null,
  outputTotal: null,
  cacheRead: null,
  cacheWrite: null,
  reasoning: null,
  total: null,
};
/** Native counters as the Gateway source maps them: it never sends cache writes. */
export const gatewayNativeTokens = {
  inputTotal: 100,
  outputTotal: 30,
  cacheRead: 20,
  cacheWrite: null,
  reasoning: 5,
  total: 130,
};

/**
 * One Gateway call as the relay and native reconciliation record it: lifecycle
 * revisions 1 (prepared), 2 (dispatch started) and 3 (terminal), plus the
 * optional native observation. Omit `native` for a call not reconciled yet.
 */
export function gatewayCallProjection(input: {
  workspaceId: string;
  callId: string;
  runId: string;
  runAttempt: number;
  authorizationId: string;
  reviewerId: string;
  allocation: string;
  provider: string;
  requestedModel: string;
  occurredAt: string;
  outcome: "not_dispatched" | "completed" | "effect_unknown";
  native?: Partial<UsageFact>;
}): UsageProjection {
  const identity: UsageFact["identity"] = {
    ...fact().identity,
    callId: input.callId,
    workspaceId: input.workspaceId,
    runId: input.runId,
    runAttempt: input.runAttempt,
    authorizationId: input.authorizationId,
    invocationId: `${input.allocation}-invocation`,
    attemptId: `${input.allocation}-attempt`,
    bindingId: `${input.allocation}-binding`,
    route: "gateway",
    purpose: "review",
    provider: input.provider,
    requestedModel: input.requestedModel,
    parentScope: input.reviewerId,
    granularity: "call",
    occurredAt: input.occurredAt,
  };
  const lifecycle = (
    revision: number,
    state: UsageFact["state"],
    dispatchEffect: UsageFact["dispatchEffect"],
  ) =>
    fact({
      sourceInstance: "reviewrouter/gateway-lifecycle-v1",
      eventId: input.callId,
      revision,
      authority: "lifecycle",
      identity,
      actualProvider: null,
      actualModel: null,
      tokens: noTokens,
      cost: null,
      completeness: "unknown",
      state,
      dispatchEffect,
      durationMs: null,
      ttftMs: null,
    });
  const facts = [lifecycle(1, "prepared", "not_dispatched")];
  if (input.outcome === "not_dispatched")
    facts.push(lifecycle(3, "failed", "not_dispatched"));
  else
    facts.push(
      lifecycle(2, "dispatched", "dispatched"),
      input.outcome === "completed"
        ? lifecycle(3, "completed", "dispatched")
        : lifecycle(3, "unknown", "effect_unknown"),
    );
  if (input.native)
    facts.push(
      fact({
        sourceInstance: "gateway/native",
        eventId: `observation-${input.callId}`,
        identity,
        actualProvider: null,
        actualModel: null,
        tokens: gatewayNativeTokens,
        cost: null,
        durationMs: null,
        ttftMs: null,
        ...input.native,
      }),
    );
  return selectProjection(facts);
}

/**
 * An ordered fallback chain (plan 67): the first reviewer is refused before
 * dispatch, retried and stopped by provider quota; the second reviewer, on its
 * own allocation, completes. A rerun attempt of the same workflow run follows.
 */
export function reviewerChainScenario(
  workspaceId: string,
  day: string,
  reconciled = true,
) {
  const primary = { provider: "openrouter", requestedModel: "a/model:free" };
  const fallback = { provider: "nvidia", requestedModel: "nvidia/model" };
  const run = {
    workspaceId,
    runId: `${workspaceId}-run`,
    runAttempt: 1,
    authorizationId: `${workspaceId}-authorization-1`,
  };
  const call = (
    id: string,
    hour: string,
    rest: Omit<
      Parameters<typeof gatewayCallProjection>[0],
      "workspaceId" | "callId" | "occurredAt"
    >,
  ) =>
    gatewayCallProjection({
      ...rest,
      workspaceId,
      callId: `${workspaceId}-${id}`,
      occurredAt: `${day}T${hour}:00:00.000Z`,
    });
  return {
    primary,
    fallback,
    refused: call("refused", "10", {
      ...run,
      ...primary,
      reviewerId: "reviewer-1",
      allocation: "allocation-1",
      outcome: "not_dispatched",
    }),
    quota: call("quota", "11", {
      ...run,
      ...primary,
      reviewerId: "reviewer-1",
      allocation: "allocation-1",
      outcome: "effect_unknown",
      ...(reconciled
        ? {
            native: {
              tokens: noTokens,
              completeness: "partial" as const,
              state: "completed" as const,
            },
          }
        : {}),
    }),
    accepted: call("accepted", "12", {
      ...run,
      ...fallback,
      reviewerId: "reviewer-2",
      allocation: "allocation-2",
      outcome: "completed",
      ...(reconciled ? { native: {} } : {}),
    }),
    rerun: call("rerun", "13", {
      ...run,
      ...fallback,
      runAttempt: 2,
      authorizationId: `${workspaceId}-authorization-2`,
      reviewerId: "reviewer-2",
      allocation: "allocation-3",
      outcome: "completed",
      ...(reconciled ? { native: {} } : {}),
    }),
  };
}
