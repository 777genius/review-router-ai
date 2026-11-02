import { expect, it, vi } from "vitest";
import { GatewayError } from "@agent-teams/account-gateway/http";
import type {
  ConsumerControlPort,
  ExecutionConnector,
} from "@agent-teams/account-gateway/llm";
import { conversationOutputSchema } from "@reviewrouter/features-conversations";
import { createConversationGatewayInference } from "./action-conversation-inference.js";

const model = "gpt-6.1-sol";
const text = '{"kind":"silent","answer":"","action":null}';
const usage = { input_tokens: 1137, output_tokens: 36 };
const completed = (response: Record<string, unknown> = {}) => ({
  type: "response.completed",
  response: {
    id: "response-original",
    status: "completed",
    model,
    // Valid SDK snapshot: no fabricated output-item id/status/role is required.
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage,
    ...response,
  },
});
function fixture(
  options: {
    afterPrepare?: () => void | Promise<void>;
    events?: readonly unknown[];
    closePending?: boolean;
    accessUnknown?: boolean;
    lostOutput?: boolean;
    epoch?: number;
    maxRequestBytes?: number;
    outputTokens?: number;
    controls?: { deadlineAt: Date; signal?: AbortSignal };
    preparedDeadlineAt?: Date;
  } = {},
) {
  const order: string[] = [];
  let authority = true,
    sourceCurrent = true,
    admission = true;
  const deadlineAt =
    options.preparedDeadlineAt ?? new Date(Date.now() + 20_000);
  const checkAuthority = vi.fn(async () => {
    order.push("authority");
    return authority;
  });
  const beforeDispatch = vi.fn(async () => {
    order.push("source");
    return sourceCurrent;
  });
  const admitDispatch = vi.fn(async () => {
    order.push("admit");
    return admission;
  });
  const onObserved = vi.fn(async () => {});
  const control: ConsumerControlPort = {
    runAccess: vi.fn<ConsumerControlPort["runAccess"]>(async (intent) => {
      order.push("prepare");
      await options.afterPrepare?.();
      if (options.accessUnknown)
        throw new GatewayError("transport", "effect_unknown");
      return {
        operation: {
          operationRef: intent.operationId,
          state: "applied",
          result: {
            kind: "execution",
            executionRef: "execution-original",
            state: "active",
            accountRef: intent.accountRefs[0]!,
            authorizationEpoch: options.epoch ?? 7,
            deadline: intent.deadline,
          },
        },
        bearer: "synthetic-execution-bearer",
        admission: {
          invocationRef: intent.invocationRef,
          attemptRef: intent.attemptRef,
          accountRef: intent.accountRefs[0]!,
          authorizationEpoch: options.epoch ?? 7,
          subjectRef: intent.subjectRef,
          policyRevision: intent.policyRevision,
          bindingRevision: intent.bindingRevision,
          profileId: intent.profileId,
          limits: intent.limits,
          expiresAt: intent.deadline,
        },
      };
    }),
  };
  const request = vi.fn<ReturnType<ExecutionConnector>["request"]>(
    async (_ref, value) => {
      order.push("request");
      if (options.lostOutput)
        throw new GatewayError("transport", "effect_unknown");
      const bytes = new TextEncoder().encode(
        (options.events ?? [completed()])
          .map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`)
          .join(""),
      );
      return {
        kind: "stream",
        requestRef: value.requestId,
        body: new ReadableStream({
          start(controller) {
            for (let i = 0; i < bytes.length; i += 7)
              controller.enqueue(bytes.slice(i, i + 7));
            controller.close();
          },
        }),
        cancel: async () => {},
      };
    },
  );
  const status = vi.fn<ReturnType<ExecutionConnector>["status"]>(async () => ({
    requestRef: "rr-conversation-original-a1-r",
    status: "completed",
    effect: "completed",
  }));
  const close = vi.fn<ReturnType<ExecutionConnector>["close"]>(
    async (_ref, value) => {
      order.push("close");
      if (options.closePending)
        throw new GatewayError("transport", "effect_unknown");
      return { operationRef: value.operationId, state: "applied" };
    },
  );
  const connectExecution: ExecutionConnector = vi.fn(() => ({
    request,
    status,
    close,
  }));
  const inference = createConversationGatewayInference({
    control,
    connectExecution,
    prepare: {
      operationId: "rr-conversation-original",
      invocationRef: "rr-conversation-original",
      attemptRef: "rr-conversation-original-model",
      accountRefs: ["selected-user-account"],
      subjectRef: "selected-user-policy",
      policyRevision: 3,
      bindingRevision: 5,
      profileId: "selected-review-profile",
      limits: {
        requests: 1,
        concurrency: 1,
        requestBytes: options.maxRequestBytes ?? 131_072,
        outputBytes: 262_144,
        tokens: options.outputTokens ?? 2048,
      },
      deadline: deadlineAt.toISOString(),
    },
    model,
    expectedAuthorizationEpoch: 7,
    checkAuthority,
    admitDispatch,
    onObserved,
  });
  const generate = () =>
    inference.generate(
      {
        instructions: "Synthetic test instructions.",
        messages: [{ role: "user", content: "Synthetic source." }],
        outputSchema: conversationOutputSchema,
      },
      options.controls ?? { deadlineAt },
      beforeDispatch,
    );
  return {
    generate,
    control,
    request,
    status,
    close,
    onObserved,
    checkAuthority,
    beforeDispatch,
    admitDispatch,
    order,
    revokeAccount: () => {
      authority = false;
    },
    revokeSource: () => {
      sourceCurrent = false;
    },
    denyAdmission: () => {
      admission = false;
    },
  };
}

it("uses actual SDK reduction and exact selected account/model policy with one acknowledged close", async () => {
  const preparedDeadlineAt = new Date(Date.now() + 80_000);
  const f = fixture({
    preparedDeadlineAt,
    controls: { deadlineAt: new Date(Date.now() + 90_000) },
  });
  expect(await f.generate()).toEqual({
    text,
    actualModel: model,
    usage: { inputTokens: 1137, outputTokens: 36 },
    effect: "completed",
  });
  expect(f.order).toEqual([
    "authority",
    "prepare",
    "authority",
    "source",
    "admit",
    "request",
    "close",
  ]);
  expect(f.control.runAccess).toHaveBeenCalledOnce();
  const intent = vi.mocked(f.control.runAccess).mock.calls[0]![0];
  expect(intent.deadline).toBe(preparedDeadlineAt.toISOString());
  expect(intent).toMatchObject({
    operationId: "rr-conversation-original-a1-p",
    invocationRef: "rr-conversation-original",
    attemptRef: "a1",
    accountRefs: ["selected-user-account"],
    profileId: "selected-review-profile",
    subjectRef: "selected-user-policy",
    policyRevision: 3,
    bindingRevision: 5,
    limits: { requests: 1, concurrency: 1, tokens: 2048, outputBytes: 262_144 },
  });
  const dispatched = f.request.mock.calls[0]![1];
  const body = JSON.parse(new TextDecoder().decode(dispatched.body));
  expect(intent.limits.requestBytes).toBe(dispatched.body.byteLength);
  expect(body).toMatchObject({
    model,
    stream: true,
    store: false,
    max_output_tokens: 2048,
    text: {
      format: {
        type: "json_schema",
        strict: true,
        schema: conversationOutputSchema.schema,
      },
    },
  });
  expect(dispatched.requestId).toBe("rr-conversation-original-a1-r");
  expect(f.close.mock.calls[0]![1].operationId).toBe(
    "rr-conversation-original-a1-c",
  );
  expect(f.onObserved).toHaveBeenCalledWith({
    model,
    usage: {
      inputTokens: 1137,
      outputTokens: 36,
      cachedInputTokens: null,
      reasoningTokens: null,
    },
    effect: "completed",
    cleanup: "closed",
  });
  await expect(f.generate()).rejects.toMatchObject({ code: "conflict" });
  expect(f.request).toHaveBeenCalledOnce();
});

it("accepts SDK terminal done-text reduction without requiring a duplicate final output snapshot", async () => {
  const f = fixture({
    events: [
      { type: "response.output_text.done", text },
      completed({ output: [] }),
    ],
  });
  expect((await f.generate()).text).toBe(text);
});

it.each(["account", "source", "admission", "epoch"] as const)(
  "rechecks %s after waiting for the grant and blocks paid dispatch",
  async (kind) => {
    const f = fixture({
      epoch: kind === "epoch" ? 8 : 7,
      afterPrepare: () => {
        if (kind === "account") f.revokeAccount();
        if (kind === "source") f.revokeSource();
        if (kind === "admission") f.denyAdmission();
      },
    });
    await expect(f.generate()).rejects.toMatchObject({ code: "unavailable" });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.onObserved).toHaveBeenCalledWith(
      expect.objectContaining({ effect: "not_dispatched", cleanup: "closed" }),
    );
    if (kind === "source") expect(f.admitDispatch).not.toHaveBeenCalled();
    await expect(f.generate()).rejects.toMatchObject({ code: "conflict" });
    expect(f.control.runAccess).toHaveBeenCalledOnce();
  },
);

it.each([
  { events: [completed({ model: "foreign-model" })] },
  { events: [completed({ model: undefined })] },
  {
    events: [
      completed({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "invalid JSON" }],
          },
        ],
      }),
    ],
  },
  {
    events: [
      completed({
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "Synthetic refusal" }],
          },
        ],
      }),
    ],
  },
  { events: [{ type: "response.incomplete", response: { model, usage } }] },
  { closePending: true },
])(
  "rejects incomplete, refused, invalid, foreign-model or unclosed output without a new attempt: %j",
  async (options) => {
    const f = fixture(options);
    await expect(f.generate()).rejects.toMatchObject({ code: "unavailable" });
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    await expect(f.generate()).rejects.toMatchObject({ code: "conflict" });
    expect(f.control.runAccess).toHaveBeenCalledOnce();
  },
);

it("records completed monetary effect without recovering lost output or dispatching a replacement", async () => {
  const f = fixture({ lostOutput: true });
  await expect(f.generate()).rejects.toMatchObject({ code: "unavailable" });
  expect(f.status).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.onObserved).toHaveBeenCalledWith({
    model: null,
    usage: null,
    effect: "completed",
    cleanup: "closed",
  });
  await expect(f.generate()).rejects.toMatchObject({ code: "conflict" });
  expect(f.request).toHaveBeenCalledOnce();
});

it("keeps an ambiguous grant cleanup pending and never prepares the same intent again", async () => {
  const f = fixture({ accessUnknown: true });
  await expect(f.generate()).rejects.toMatchObject({ code: "unavailable" });
  expect(f.onObserved).toHaveBeenCalledWith({
    model: null,
    usage: null,
    effect: "not_dispatched",
    cleanup: "pending",
  });
  await expect(f.generate()).rejects.toMatchObject({ code: "conflict" });
  expect(f.control.runAccess).toHaveBeenCalledOnce();
  expect(f.request).not.toHaveBeenCalled();
});

it("enforces the frozen exact encoded request-byte ceiling before runAccess", async () => {
  const f = fixture({ maxRequestBytes: 1 });
  await expect(f.generate()).rejects.toMatchObject({ code: "unavailable" });
  expect(f.control.runAccess).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
  expect(f.onObserved).toHaveBeenCalledWith(
    expect.objectContaining({
      effect: "not_dispatched",
      cleanup: "not_needed",
    }),
  );
});

it("cancels before paid dispatch after a waited grant and still closes with an independent signal", async () => {
  const controller = new AbortController();
  const f = fixture({
    controls: {
      deadlineAt: new Date(Date.now() + 10_000),
      signal: controller.signal,
    },
    afterPrepare: () => controller.abort(),
  });
  await expect(f.generate()).rejects.toMatchObject({ code: "unavailable" });
  expect(f.request).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.close.mock.calls[0]![2]?.signal?.aborted).toBe(false);
  expect(f.onObserved).toHaveBeenCalledWith(
    expect.objectContaining({ effect: "not_dispatched", cleanup: "closed" }),
  );
});

it("does not acquire a grant after the caller's original deadline", async () => {
  const f = fixture({ controls: { deadlineAt: new Date(Date.now() - 1) } });
  await expect(f.generate()).rejects.toMatchObject({ code: "unavailable" });
  expect(f.control.runAccess).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
});

it.each([8192, 1024])(
  "sends the exact frozen %i combined token budget once without reclamping",
  async (outputTokens) => {
    const f = fixture({ outputTokens });
    expect((await f.generate()).effect).toBe("completed");
    const intent = vi.mocked(f.control.runAccess).mock.calls[0]![0];
    const body = JSON.parse(
      new TextDecoder().decode(f.request.mock.calls[0]![1].body),
    );
    expect(intent.limits.tokens).toBe(outputTokens);
    expect(body.max_output_tokens).toBe(outputTokens);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    await expect(f.generate()).rejects.toMatchObject({ code: "conflict" });
    expect(f.request).toHaveBeenCalledOnce();
  },
);
