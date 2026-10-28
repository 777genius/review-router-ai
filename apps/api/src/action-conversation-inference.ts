import * as c from "@agent-teams/account-gateway/contracts";
import {
  GatewayError,
  type NativeResponse,
} from "@agent-teams/account-gateway/http";
import {
  ConversationError,
  assertConversationLive,
  type TextInferencePort,
  type RequestControls,
} from "@reviewrouter/features-conversations";
import {
  createRunAccessClient,
  type RunAccessConfig,
} from "./account-gateway-run-access.js";

type OutputItem = {
  readonly id: string;
  readonly type: string;
  readonly role?: string;
  readonly status?: string;
  readonly content?: readonly {
    readonly type: string;
    readonly text?: string;
  }[];
};
function outputText(items: readonly OutputItem[]): string {
  let text = "",
    messages = 0;
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id))
      throw new ConversationError("unavailable");
    ids.add(item.id);
    // Reasoning metadata is consumed but is never returned, logged or persisted.
    if (item.type === "reasoning") continue;
    if (
      item.type !== "message" ||
      item.role !== "assistant" ||
      item.status !== "completed" ||
      !Array.isArray(item.content) ||
      !item.content.length
    )
      throw new ConversationError("unavailable");
    messages++;
    for (const part of item.content) {
      if (part.type !== "output_text" || typeof part.text !== "string")
        throw new ConversationError("unavailable");
      text += part.text;
    }
  }
  if (messages !== 1 || !text || Buffer.byteLength(text) > 16_384)
    throw new ConversationError("unavailable");
  return text;
}

/** One bounded Responses stream. Status has effect facts only and never supplies lost output. */
export async function readConversationResponses(
  response: NativeResponse,
  model: string,
  controls: RequestControls,
  maxBytes = 262_144,
): Promise<Awaited<ReturnType<TextInferencePort["generate"]>>> {
  if (response.kind !== "stream") throw new ConversationError("unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    buffer = "",
    terminal: Awaited<ReturnType<TextInferencePort["generate"]>> | undefined;
  const doneItems: OutputItem[] = [];
  const doneIds = new Set<string>();
  const addedIds = new Set<string>();
  let responseId: string | undefined;
  const events = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      if (!terminal) throw new ConversationError("unavailable");
      return;
    }
    if (terminal) throw new ConversationError("unavailable");
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = String(event.type);
    const eventName = frame
      .split(/\r?\n/)
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    if (eventName && eventName !== type)
      throw new ConversationError("unavailable");
    if (/tool|function_call|refusal|\.failed$|\.incomplete$|^error$/.test(type))
      throw new ConversationError("unavailable");
    if (
      ![
        "response.created",
        "response.in_progress",
        "response.queued",
        "response.output_item.added",
        "response.output_item.done",
        "response.content_part.added",
        "response.content_part.done",
        "response.output_text.delta",
        "response.output_text.done",
        "response.output_text.annotation.added",
        "response.completed",
        "response.reasoning_summary_part.added",
        "response.reasoning_summary_part.done",
        "response.reasoning_summary_text.delta",
        "response.reasoning_summary_text.done",
      ].includes(type)
    )
      throw new ConversationError("unavailable");
    if (
      ["response.created", "response.in_progress", "response.queued"].includes(
        type,
      )
    ) {
      const id = (event.response as { readonly id?: unknown } | undefined)?.id;
      if (typeof id !== "string" || !id || (responseId && responseId !== id))
        throw new ConversationError("unavailable");
      responseId = id;
    }
    if (type.startsWith("response.content_part.")) {
      const part = event.part as { readonly type?: unknown } | undefined;
      if (part?.type !== "output_text")
        throw new ConversationError("unavailable");
    }
    if (
      type === "response.output_item.added" ||
      type === "response.output_item.done"
    ) {
      const item = event.item as OutputItem | undefined;
      if (!item || !["message", "reasoning"].includes(item.type))
        throw new ConversationError("unavailable");
      if (type.endsWith(".added")) {
        if (!item.id || addedIds.has(item.id))
          throw new ConversationError("unavailable");
        addedIds.add(item.id);
      }
      if (type.endsWith(".done")) {
        if (
          !item.id ||
          doneIds.has(item.id) ||
          (addedIds.size > 0 && !addedIds.has(item.id))
        )
          throw new ConversationError("unavailable");
        doneIds.add(item.id);
        doneItems.push(item);
      }
    }
    if (type !== "response.completed") return;
    const completed = event.response as
      | {
          readonly id?: string;
          readonly status?: string;
          readonly model?: string;
          readonly output?: readonly OutputItem[];
          readonly output_text?: string;
          readonly usage?: {
            readonly input_tokens?: number;
            readonly output_tokens?: number;
          };
        }
      | undefined;
    if (
      !completed ||
      !completed.id ||
      (responseId && completed.id !== responseId) ||
      [...addedIds].some((id) => !doneIds.has(id)) ||
      completed.status !== "completed" ||
      completed.model !== model ||
      !Array.isArray(completed.output)
    )
      throw new ConversationError("unavailable");
    const output = completed.output.length ? completed.output : doneItems;
    if (
      completed.output.length &&
      doneItems.length &&
      JSON.stringify(completed.output) !== JSON.stringify(doneItems)
    )
      throw new ConversationError("unavailable");
    const text = outputText(output);
    if (completed.output_text !== undefined && completed.output_text !== text)
      throw new ConversationError("unavailable");
    const usage = completed.usage;
    const validUsage =
      usage &&
      Number.isSafeInteger(usage.input_tokens) &&
      usage.input_tokens! >= 0 &&
      Number.isSafeInteger(usage.output_tokens) &&
      usage.output_tokens! >= 0;
    terminal = {
      text,
      actualModel: completed.model,
      usage: validUsage
        ? {
            inputTokens: usage.input_tokens!,
            outputTokens: usage.output_tokens!,
          }
        : null,
      effect: "completed",
    };
  };
  try {
    for (;;) {
      assertConversationLive(controls);
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new ConversationError("unavailable");
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const separator = /\r?\n\r?\n/.exec(buffer);
        if (!separator) break;
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        events(frame);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new ConversationError("unavailable");
    if (!terminal) throw new ConversationError("unavailable");
    return terminal;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await response.cancel().catch(() => {});
  }
}

export function createConversationGatewayInference(input: {
  readonly runAccess: RunAccessConfig;
  readonly prepare: c.Prepare;
  readonly requestId: string;
  readonly model: string;
  readonly expectedAuthorizationEpoch?: number;
  readonly checkAuthority: (controls: RequestControls) => Promise<boolean>;
  readonly admitDispatch?: (controls: RequestControls) => Promise<boolean>;
  readonly onObserved?: (value: {
    readonly model: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
    } | null;
  }) => Promise<void>;
}): TextInferencePort {
  const prepare = c.prepare.parse(input.prepare),
    requestId = c.reference.parse(input.requestId),
    model = input.model;
  const access = createRunAccessClient(input.runAccess);
  let attempted = false;
  return Object.freeze({
    async generate(
      request: Parameters<TextInferencePort["generate"]>[0],
      outerControls: RequestControls,
    ) {
      if (attempted) throw new ConversationError("conflict");
      const deadlineAt = new Date(
        Math.min(
          outerControls.deadlineAt.getTime(),
          Date.parse(prepare.deadline),
          Date.now() + 60_000,
        ),
      );
      const remaining = deadlineAt.getTime() - Date.now();
      if (remaining <= 0) throw new ConversationError("unavailable");
      const signal = outerControls.signal
        ? AbortSignal.any([
            outerControls.signal,
            AbortSignal.timeout(remaining),
          ])
        : AbortSignal.timeout(remaining);
      const controls = { deadlineAt, signal };
      const body = new TextEncoder().encode(
        JSON.stringify({
          model,
          instructions: request.instructions,
          input: request.messages.map((message) => ({
            role: message.role,
            content: [
              {
                type:
                  message.role === "assistant" ? "output_text" : "input_text",
                text: message.content,
              },
            ],
          })),
          tools: [],
          tool_choice: "none",
          parallel_tool_calls: false,
          stream: true,
          store: false,
          service_tier: "default",
          max_output_tokens: Math.min(2048, prepare.limits.tokens),
          ...(request.outputSchema
            ? {
                text: {
                  format: {
                    type: "json_schema",
                    name: "codex_output_schema",
                    strict: true,
                    schema: request.outputSchema.schema,
                  },
                },
              }
            : {}),
        }),
      );
      if (body.byteLength > Math.min(131_072, prepare.limits.requestBytes))
        throw new ConversationError("context_incomplete");
      if (!(await input.checkAuthority(controls)))
        throw new ConversationError("forbidden");
      attempted = true; // The same finite intent is never replaced after an ambiguous Prepare or request.
      let prepared: Awaited<ReturnType<typeof access.prepare>> | undefined;
      let completed = false;
      try {
        prepared = await access.prepare(prepare, { signal });
        if (
          input.expectedAuthorizationEpoch !== undefined &&
          prepared.admission.authorizationEpoch !==
            input.expectedAuthorizationEpoch
        )
          throw new ConversationError("forbidden");
        if (!(await input.checkAuthority(controls)))
          throw new ConversationError("forbidden");
        if (input.admitDispatch && !(await input.admitDispatch(controls)))
          throw new ConversationError("forbidden");
        const response = await prepared.client.request(
          prepared.executionRef,
          { requestId, admission: prepared.admission, body },
          { signal },
        );
        const result = await readConversationResponses(
          response,
          model,
          controls,
          Math.min(262_144, prepare.limits.outputBytes),
        );
        completed = true;
        await input.onObserved?.({
          model: result.actualModel,
          usage: result.usage,
        });
        return result;
      } catch (error) {
        // Readback reconciles the original monetary effect only. No model output replay or new attempt.
        if (prepared && !signal.aborted)
          await prepared.client
            .status(prepared.executionRef, requestId, { signal })
            .catch(() => undefined);
        if (error instanceof GatewayError || error instanceof ConversationError)
          throw new ConversationError("unavailable");
        throw new ConversationError("unavailable");
      } finally {
        if (prepared)
          await prepared.client
            .close(
              prepared.executionRef,
              {
                operationId: `${prepare.operationId}-close`,
                reason: completed ? "completed" : "cancelled",
              },
              { signal: AbortSignal.timeout(2000) },
            )
            .catch(() => undefined);
      }
    },
  });
}
