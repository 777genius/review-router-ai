import {
  gatewayProbeId,
  gatewayProbeLimits as limits,
  gatewayProbeTimeoutMs,
} from "@reviewrouter/features-provider-accounts/gateway-probe";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createExecutionClient,
  type ConsumerControlClient,
  type ExecutionClient,
} from "@agent-teams/account-gateway/http";
import {
  ProviderAccountError,
  type SafeBindingTuple,
} from "@reviewrouter/features-provider-accounts";
import { RateLimitExceededError } from "@reviewrouter/features-rate-limits";
import type {
  ConnectionProbeEvent,
  ConnectionProbeRequest,
} from "../features/account-gateway/connection-probe";

type Selection = SafeBindingTuple & { authorizationEpoch: number };
class ProbeFailure extends Error {
  constructor(
    readonly code: Extract<ConnectionProbeEvent, { ok: false }>["code"],
  ) {
    super(code);
  }
}

/** A single bounded inference, independent of review agents and PR execution.
 * The consumer supplies live binding authority, never upstream credentials.
 */
export function createGatewayConnectionProbe(input: {
  resolve(bindingId: string, model: string): Promise<Selection>;
  admit(): Promise<void>;
  control: Pick<ConsumerControlClient, "runAccess">;
  executionOrigin: string;
  executionControlOrigin?: string;
  timeoutMs?: number;
}) {
  // Validate deployment-only destinations before reserving any execution.
  for (const origin of [input.executionOrigin, input.executionControlOrigin]) {
    if (origin !== undefined)
      createExecutionClient({
        role: "execution",
        origin,
        token: "probe-config-validation-token",
      });
  }
  return async (
    request: Pick<ConnectionProbeRequest, "bindingId" | "model" | "nonce">,
    emit: (event: ConnectionProbeEvent) => void,
    signal: AbortSignal,
  ) => {
    const start = Date.now();
    const timeoutMs = input.timeoutMs ?? gatewayProbeTimeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const abort = AbortSignal.any([signal, timeout]);
    let client: ExecutionClient | undefined;
    let executionRef: string | undefined;
    let response: Awaited<ReturnType<ExecutionClient["request"]>> | undefined;
    let outcome: Extract<ConnectionProbeEvent, { type: "result" }> | undefined;
    const id = (kind: string) =>
      gatewayProbeId(kind, request.bindingId, request.nonce);
    const progress = (
      stage: Extract<ConnectionProbeEvent, { type: "progress" }>["stage"],
    ) => {
      abort.throwIfAborted();
      emit({ type: "progress", stage });
    };
    try {
      progress("authorizing");
      const original = await input.resolve(request.bindingId, request.model);
      const check = async () => {
        abort.throwIfAborted();
        const live = await input.resolve(request.bindingId, request.model);
        if (JSON.stringify(live) !== JSON.stringify(original))
          throw new ProbeFailure("denied");
      };
      await input.admit();
      await check();
      progress("connecting");
      const intent = c.prepare.parse({
        operationId: id("prepare"),
        invocationRef: id("invocation"),
        attemptRef: id("attempt"),
        accountRefs: [original.gatewayAccountRef],
        subjectRef: original.policySubject,
        policyRevision: original.policyRevision,
        bindingRevision: original.bindingRevision,
        profileId: original.profileRef,
        limits,
        deadline: new Date(start + timeoutMs).toISOString(),
      });
      const access = await input.control.runAccess(intent, { signal: abort });
      const operation = c.preparationOperation.parse(access.operation);
      if (
        operation.state !== "applied" ||
        operation.result?.kind !== "execution"
      )
        throw new ProbeFailure("unavailable");
      executionRef = operation.result.executionRef;
      // Capture cleanup authority before any subsequent validation can fail.
      const settings = {
        role: "execution" as const,
        token: access.bearer,
        timeoutMs,
        responseBytes: 65536,
        bufferBytes: limits.outputBytes,
      };
      const data = createExecutionClient({
        ...settings,
        origin: input.executionOrigin,
      });
      const control = input.executionControlOrigin
        ? createExecutionClient({
            ...settings,
            origin: input.executionControlOrigin,
          })
        : data;
      client = {
        ...data,
        close: control.close,
        operation: control.operation,
        status: control.status,
      };
      const admission = c.admission.parse(access.admission);
      const expected = {
        invocationRef: intent.invocationRef,
        attemptRef: intent.attemptRef,
        accountRef: original.gatewayAccountRef,
        authorizationEpoch: original.authorizationEpoch,
        subjectRef: intent.subjectRef,
        policyRevision: intent.policyRevision,
        bindingRevision: intent.bindingRevision,
        profileId: intent.profileId,
        limits,
        expiresAt: intent.deadline,
      };
      if (
        operation.operationRef !== intent.operationId ||
        operation.result.state !== "active" ||
        operation.result.accountRef !== original.gatewayAccountRef ||
        operation.result.authorizationEpoch !== original.authorizationEpoch ||
        operation.result.deadline !== intent.deadline ||
        JSON.stringify(admission) !==
          JSON.stringify(c.admission.parse(expected))
      )
        throw new ProbeFailure("denied");
      await check();
      progress("requesting");
      response = await client.request(
        executionRef,
        {
          requestId: id("request"),
          admission,
          body: new TextEncoder().encode(
            JSON.stringify({
              model: request.model,
              instructions:
                "You are testing an API connection. Answer briefly.",
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: "Reply with the single word OK.",
                    },
                  ],
                },
              ],
              stream: true,
              service_tier: "default",
              // Codex's native Responses endpoint rejects max_output_tokens.
              // The execution admission still bounds requests/bytes/tokens.
              ...(original.profileRef === "openai-codex-oauth-responses-v1"
                ? {}
                : { max_output_tokens: limits.tokens }),
              store: false,
            }),
          ),
        },
        { signal: abort },
      );
      if (response.kind !== "stream")
        throw new ProbeFailure(
          response.status.error?.code === "admission_limited"
            ? "busy"
            : "unavailable",
        );
      await check();
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let body = "",
        bytes = 0,
        receiving = false;
      try {
        for (;;) {
          abort.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limits.outputBytes)
            throw new ProbeFailure("invalid_response");
          if (!receiving) {
            progress("receiving");
            receiving = true;
          }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      progress("validating");
      validateProbeResponse(body);
      await check();
      outcome = {
        type: "result",
        ok: true,
        elapsedMs: Date.now() - start,
        model: request.model,
      };
    } catch (error) {
      outcome = {
        type: "result",
        ok: false,
        code: timeout.aborted
          ? "timeout"
          : signal.aborted
            ? "cancelled"
            : error instanceof ProbeFailure
              ? error.code
              : error instanceof ProviderAccountError
                ? "denied"
                : error instanceof RateLimitExceededError
                  ? "rate_limited"
                  : "unavailable",
      };
    } finally {
      if (response?.kind === "stream") await response.cancel().catch(() => {});
      if (client && executionRef) {
        emit({ type: "progress", stage: "closing" });
        // Cleanup has its own bounded signal: cancelling the UI must still close
        // the one-request execution capability. Unknown effects are never replayed.
        try {
          const closed = await client.close(
            executionRef,
            {
              operationId: id("close"),
              reason: abort.aborted
                ? "cancelled"
                : outcome?.ok
                  ? "completed"
                  : "failed",
            },
            { signal: AbortSignal.timeout(10000) },
          );
          if (closed.state !== "applied" || closed.operationRef !== id("close"))
            outcome = { type: "result", ok: false, code: "cleanup_pending" };
        } catch {
          outcome = { type: "result", ok: false, code: "cleanup_pending" };
        }
      }
    }
    emit(outcome ?? { type: "result", ok: false, code: "unavailable" });
  };
}

/** Require completed generation with actual text, not just HTTP 200 or [DONE]. */
export function validateProbeResponse(body: string) {
  let completed = false,
    text = false;
  for (const frame of body.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new ProbeFailure("invalid_response");
    }
    if (!event || typeof event !== "object")
      throw new ProbeFailure("invalid_response");
    if (
      event.type === "error" ||
      event.type === "response.failed" ||
      event.type === "response.incomplete"
    )
      throw new ProbeFailure("invalid_response");
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string" &&
      event.delta.trim()
    )
      text = true;
    if (
      event.type === "response.completed" &&
      event.response?.status === "completed"
    ) {
      completed = true;
      if (Array.isArray(event.response.output))
        for (const item of event.response.output) {
          if (
            item.type === "message" &&
            Array.isArray(item.content) &&
            item.content.some(
              (part: { type?: string; text?: string }) =>
                part.type === "output_text" &&
                typeof part.text === "string" &&
                part.text.trim(),
            )
          )
            text = true;
        }
    }
  }
  if (!completed || !text) throw new ProbeFailure("invalid_response");
}
