import { randomUUID } from "crypto";
import { performance } from "perf_hooks";
import { UsageDelivery } from "./provider-usage-delivery.js";
import {
  UsageFact,
  UsageTokens,
} from "@reviewrouter/protocol-review-action-v2";
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const count = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
/** One recorder for one actual Responses HTTP attempt; never parses review content. */
export function createResponsesUsageObserver(
  delivery: UsageDelivery,
  _requestedModel: string,
  provider:
    | "openrouter"
    | "codex"
    | "openai"
    | "mimo"
    | "kimi"
    | "claude" = "openrouter",
) {
  const callId = delivery.scope.callIdPrefix + randomUUID(),
    occurredAt = new Date().toISOString(),
    started = performance.now();
  let revision = 0,
    finished = false,
    sent = false,
    responseReceived = false,
    completed = false,
    reportedFailed = false,
    actualModel: string | null = null;
  let anthropicInput: number | null = null;
  let anthropicCacheRead: number | null = null;
  let anthropicCacheWrite: number | null = null;
  let tokens: UsageTokens = {
    inputTotal: null,
    outputTotal: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    total: null,
  };
  const emit = (state: UsageFact["state"]) =>
    delivery.record({
      schemaVersion: 1,
      sourceInstance: delivery.scope.sourceInstance,
      eventId: callId,
      revision: ++revision,
      authority: "runtime",
      identity: {
        ...delivery.scopeIdentity(),
        callId,
        attemptId: callId,
        route: delivery.scope.route,
        purpose: delivery.scope.purpose ?? "review",
        provider: delivery.scope.provider,
        requestedModel: delivery.scope.requestedModel,
        runtimeType: delivery.scope.runtimeType,
        parentScope: null,
        granularity: "call",
        occurredAt,
      },
      actualProvider: provider,
      actualModel,
      tokens: { ...tokens },
      cost: null,
      completeness:
        (completed || reportedFailed) &&
        tokens.inputTotal !== null &&
        tokens.outputTotal !== null
          ? "complete"
          : Object.values(tokens).some((v) => v !== null)
            ? "partial"
            : "unknown",
      state,
      dispatchEffect: responseReceived ? "dispatched" : "effect_unknown",
      durationMs:
        state === "dispatched"
          ? null
          : Math.max(0, Math.floor(performance.now() - started)),
      ttftMs: null,
      correctionReason: null,
      childCallIds: null,
    });
  return {
    dispatched() {
      sent = true;
      emit("dispatched");
    },
    responseReceived() {
      responseReceived = true;
    },
    observe(value: unknown) {
      const frame = object(value),
        response =
          object(frame?.response) ??
          (provider === "claude" ? object(frame?.message) : undefined) ??
          frame;
      if (!response) return;
      if (
        provider === "claude" &&
        (frame?.type === "message_stop" ||
          (frame?.type === "message" && typeof frame.stop_reason === "string"))
      )
        completed = true;
      if (provider === "claude" && frame?.type === "error")
        reportedFailed = true;
      if (
        frame?.type === "response.completed" ||
        response.status === "completed"
      )
        completed = true;
      if (
        ["response.failed", "response.incomplete"].includes(
          String(frame?.type),
        ) ||
        ["failed", "incomplete"].includes(String(response.status))
      )
        reportedFailed = true;
      if (
        typeof response.model === "string" &&
        /^[A-Za-z0-9._:/@+-]{1,200}$/.test(response.model)
      )
        actualModel = response.model;
      const usage = object(response.usage);
      if (!usage) return;
      if (provider === "claude") {
        if (Object.hasOwn(usage, "input_tokens"))
          anthropicInput = count(usage.input_tokens);
        if (Object.hasOwn(usage, "cache_read_input_tokens"))
          anthropicCacheRead = count(usage.cache_read_input_tokens);
        if (Object.hasOwn(usage, "cache_creation_input_tokens"))
          anthropicCacheWrite = count(usage.cache_creation_input_tokens);
        const inputTotal =
          anthropicInput !== null &&
          anthropicCacheRead !== null &&
          anthropicCacheWrite !== null
            ? count(anthropicInput + anthropicCacheRead + anthropicCacheWrite)
            : null;
        const outputTotal = Object.hasOwn(usage, "output_tokens")
          ? count(usage.output_tokens)
          : tokens.outputTotal;
        tokens = {
          inputTotal,
          outputTotal,
          cacheRead: anthropicCacheRead,
          cacheWrite: anthropicCacheWrite,
          reasoning: null,
          total:
            inputTotal !== null && outputTotal !== null
              ? count(inputTotal + outputTotal)
              : null,
        };
        return;
      }
      const inputTotal = count(usage.input_tokens),
        outputTotal = count(usage.output_tokens);
      const cacheRead = count(
          object(usage.input_tokens_details)?.cached_tokens,
        ),
        reasoning = count(
          object(usage.output_tokens_details)?.reasoning_tokens,
        );
      tokens = {
        inputTotal,
        outputTotal,
        cacheRead:
          cacheRead !== null && inputTotal !== null && cacheRead <= inputTotal
            ? cacheRead
            : null,
        cacheWrite: null,
        reasoning:
          reasoning !== null && outputTotal !== null && reasoning <= outputTotal
            ? reasoning
            : null,
        total:
          inputTotal !== null && outputTotal !== null
            ? count(inputTotal + outputTotal)
            : null,
      };
    },
    finish(failed: boolean, aborted: boolean) {
      if (finished || !sent) return;
      finished = true;
      emit(
        completed
          ? "completed"
          : reportedFailed
            ? "failed"
            : aborted
              ? "cancelled"
              : failed
                ? "failed"
                : "unknown",
      );
    },
  };
}

/** Passive bounded protocol projection. Never changes inference bytes or throws. */
export function createResponsesUsageStreamObserver(
  observer: ReturnType<typeof createResponsesUsageObserver>,
  contentType: string | null,
) {
  const decoder = new TextDecoder();
  const sse = contentType?.includes("text/event-stream");
  let pending = "",
    enabled = true;
  const frame = (text: string) => {
    try {
      observer.observe(JSON.parse(text));
    } catch {
      /* Missing usage stays unknown. */
    }
  };
  return {
    chunk(bytes: Uint8Array) {
      if (!enabled) return;
      pending += decoder.decode(bytes, { stream: true });
      if (sse) {
        for (;;) {
          const delimiter = /\r\n\r\n|\n\n|\r\r/.exec(pending);
          if (!delimiter) break;
          const event = pending.slice(0, delimiter.index);
          pending = pending.slice(delimiter.index + delimiter[0].length);
          const data = event
            .split(/\r\n|\n|\r/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data !== "[DONE]") frame(data);
        }
      }
      if (Buffer.byteLength(pending) > 1024 * 1024) {
        pending = "";
        enabled = false;
      }
    },
    end() {
      if (enabled && !sse) frame(pending + decoder.decode());
      pending = "";
    },
  };
}
