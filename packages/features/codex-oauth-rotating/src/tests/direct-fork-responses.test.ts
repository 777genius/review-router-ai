import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestDirectForkReview,
  validateCertifiedForkModelOutputForPrompt,
  type DirectForkResponsesInput,
} from "../action/direct-fork-responses.js";
import {
  certifiedForkReviewPromptContextHash,
  parseCertifiedForkReviewModelOutput,
  parseCertifiedForkReviewPromptPacket,
  serializeCertifiedForkReviewPromptPacket,
} from "../../../action-control-plane/src/application/use-cases/certified-fork-review-packet.js";
import { assertCertifiedForkReviewBindingMatches } from "../../../action-control-plane/src/application/use-cases/certified-fork-review-binding.js";

const endpoint = "https://chatgpt.com/backend-api/codex/responses";
const secret = "SECRET_TOKEN_CANARY";
const codec = {
  parsePromptPacket: parseCertifiedForkReviewPromptPacket,
  serializePromptPacket: serializeCertifiedForkReviewPromptPacket,
  assertBindingMatches: assertCertifiedForkReviewBindingMatches,
  parseModelOutput: parseCertifiedForkReviewModelOutput,
};
function packet() {
  const binding = {
    sourceRepository: "fork-owner/source",
    sourceRepositoryId: "10",
    baseRepository: "owner/base",
    baseRepositoryId: "20",
    pullRequestNumber: 42,
    reviewHeadSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    trustDomain: "fork" as const,
  };
  const files = ["src/a.ts", "src/b.ts"].map((path) => ({
    path,
    status: "modified" as const,
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-ignore\n+$(touch /tmp/never-execute) `secret` 🦊",
  }));
  return {
    protocolVersion: 1 as const,
    binding,
    files,
    contextHash: certifiedForkReviewPromptContextHash({ binding, files }),
  };
}
function output() {
  return {
    protocolVersion: 1,
    summaryMarkdown: "Review 🦊",
    findings: [
      {
        severity: "minor",
        title: "Title",
        body: "Body",
        path: "src/a.ts",
        startLine: 1,
        endLine: 2,
      },
    ],
  };
}
function envelope() {
  const prompt = packet();
  return {
    contextHash: prompt.contextHash,
    binding: prompt.binding,
    reviewedPaths: prompt.files.map((file) => file.path),
    modelOutput: output(),
  };
}
function completed(text = JSON.stringify(envelope())) {
  return {
    id: "resp_1",
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}
function frame(event: unknown, newline = "\n") {
  return `data: ${JSON.stringify(event)}${newline}${newline}`;
}
function terminal(text = JSON.stringify(envelope())) {
  return frame({ type: "response.completed", response: completed(text) });
}
function lifecycle(): Record<string, unknown>[] {
  const text = JSON.stringify(envelope());
  const identity = { item_id: "msg_1", output_index: 0, content_index: 0 };
  return [
    { type: "response.created", response: { id: "resp_1", output: [] } },
    { type: "response.in_progress", response: { id: "resp_1", output: [] } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...completed().output[0], status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      ...identity,
      part: { type: "output_text", text: "" },
    },
    { type: "response.output_text.delta", ...identity, delta: text },
    { type: "response.output_text.done", ...identity, text },
    {
      type: "response.content_part.done",
      ...identity,
      part: { type: "output_text", text },
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: completed().output[0],
    },
    { type: "response.completed", response: completed() },
  ];
}
function wire(events: unknown[]) {
  return events.map((event) => frame(event)).join("");
}
function response(text = terminal(), type = "text/event-stream") {
  return new Response(text, { headers: { "content-type": type } });
}
function setup(
  reply = response(),
  changes: Partial<DirectForkResponsesInput> = {},
) {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply);
  const input: DirectForkResponsesInput = {
    fetchImpl,
    accessToken: secret,
    chatgptAccountId: "account_1",
    promptPacket: packet(),
    codec,
    ...changes,
  };
  return { fetchImpl, input, run: () => requestDirectForkReview(input) };
}
function streamed(bytes: Uint8Array, cuts: number[]) {
  let start = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const end of [...cuts, bytes.length]) {
          controller.enqueue(bytes.slice(start, end));
          start = end;
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
afterEach(() => vi.useRealTimers());

describe("unused direct fork model transport", () => {
  it.each(["\n", "\r\n", "\r"])(
    "counts original frame bytes at the exact %j boundary",
    async (nl) => {
      for (const extra of [0, 1]) {
        const comment =
          ":" +
          "é" +
          "x".repeat(512 * 1024 - 3 - 2 * nl.length + extra) +
          nl +
          nl;
        expect(Buffer.byteLength(comment)).toBe(512 * 1024 + extra);
        const pending = setup(response(comment + terminal())).run();
        if (extra) await expect(pending).rejects.toThrow("event_too_large");
        else expect(await pending).toEqual(output());
      }
    },
  );

  it("rejects duplicate, missing, reordered and inconsistent lifecycle identities", async () => {
    const baseline = lifecycle();
    const variants: unknown[][] = [];
    for (let i = 0; i < baseline.length - 1; i++) {
      variants.push([
        ...baseline.slice(0, i),
        baseline[i],
        ...baseline.slice(i),
      ]);
      if (i !== 1) variants.push(baseline.filter((_, index) => index !== i));
    }
    for (let i = 3; i <= 6; i++) {
      for (const change of [
        { item_id: "unrelated" },
        { output_index: -1 },
        { output_index: 1 },
        { content_index: -1 },
        { content_index: 1 },
      ]) {
        variants.push(
          baseline.map((event, index) =>
            index === i ? { ...event, ...change } : event,
          ),
        );
      }
    }
    variants.push(
      baseline.map((event, index) =>
        index === 7 ? { ...event, output_index: -1 } : event,
      ),
    );
    variants.push(
      baseline.map((event, index) =>
        index === 7
          ? { ...event, item: { ...completed().output[0], id: "other" } }
          : event,
      ),
    );
    variants.push(
      baseline.map((event, index) =>
        index === 8
          ? {
              ...event,
              response: {
                ...completed(),
                output: [
                  ...completed().output,
                  { type: "reasoning", id: "extra", summary: [] },
                ],
              },
            }
          : event,
      ),
    );
    for (const events of variants) {
      await expect(setup(response(wire(events))).run()).rejects.toThrow(
        "certified_fork_transport_",
      );
    }
  });

  it("redacts hostile thrown proxies, accessors, setup and cleanup", async () => {
    vi.useFakeTimers();
    const trap = vi.fn(() => {
      throw new Error(secret);
    });
    const hostile = new Proxy({}, { getPrototypeOf: trap, get: trap });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const thrown of [
      hostile,
      revoked.proxy,
      Object.defineProperty({}, "cause", { get: trap }),
      secret,
    ]) {
      const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(thrown);
      const error = await setup(response(), { fetchImpl })
        .run()
        .catch((error: unknown) => error);
      expect(error).toMatchObject({
        name: "DirectForkTransportError",
        message: "certified_fork_transport_invalid_response_or_request",
      });
      expect((error as Error).cause).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
    expect(trap).not.toHaveBeenCalled();
    for (const key of [
      "timeoutMs",
      "signal",
      "accessToken",
      "chatgptAccountId",
      "promptPacket",
      "fetchImpl",
    ]) {
      const test = setup();
      Object.defineProperty(test.input, key, { get: trap });
      await expect(test.run()).rejects.toThrow(
        "certified_fork_transport_invalid_response_or_request",
      );
      expect(vi.getTimerCount()).toBe(0);
    }
    for (const key of ["addEventListener", "aborted", "removeEventListener"]) {
      const signal = new AbortController().signal;
      Object.defineProperty(signal, key, { get: trap });
      await expect(setup(response(), { signal }).run()).rejects.toThrow(
        "certified_fork_transport_invalid_response_or_request",
      );
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each(["\n", "\r\n"])(
    "counts data and delimiter bytes at the %j frame limit",
    async (nl) => {
      const event = frame(
        { type: "response.completed", response: completed() },
        nl,
      );
      for (const extra of [0, 1]) {
        const padding =
          ":" +
          "x".repeat(
            512 * 1024 - Buffer.byteLength(event) - 1 - nl.length + extra,
          ) +
          nl;
        const body = padding + event;
        expect(Buffer.byteLength(body)).toBe(512 * 1024 + extra);
        const test = setup(response(body));
        if (extra) await expect(test.run()).rejects.toThrow("event_too_large");
        else expect(await test.run()).toEqual(output());
        expect(test.fetchImpl).toHaveBeenCalledOnce();
      }
    },
  );

  it("counts the original UTF-8 BOM bytes in the first frame budget", async () => {
    for (const nl of ["\n", "\r\n"]) {
      const event = frame(
        { type: "response.completed", response: completed() },
        nl,
      );
      for (const extra of [0, 1]) {
        const body =
          "\uFEFF:" +
          "x".repeat(
            512 * 1024 - Buffer.byteLength(event) - 4 - nl.length + extra,
          ) +
          nl +
          event;
        expect(Buffer.byteLength(body)).toBe(512 * 1024 + extra);
        const pending = setup(response(body)).run();
        if (extra) await expect(pending).rejects.toThrow("event_too_large");
        else expect(await pending).toEqual(output());
      }
    }
  });

  it("rejects reordered transitions and conflicting item event identities", async () => {
    const baseline = lifecycle();
    const variants: unknown[][] = [];
    for (let index = 0; index < baseline.length - 1; index++) {
      const events = [...baseline];
      [events[index], events[index + 1]] = [events[index + 1]!, events[index]!];
      variants.push(events);
    }
    for (const index of [2, 7]) {
      for (const change of [
        { item_id: "other" },
        { output_index: -1 },
        { output_index: 1 },
        { output_index: 0.5 },
      ]) {
        variants.push(
          baseline.map((event, i) =>
            i === index ? { ...event, ...change } : event,
          ),
        );
      }
    }
    for (const events of variants) {
      const test = setup(response(wire(events)));
      await expect(test.run()).rejects.toThrow("certified_fork_transport_");
      expect(test.fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("compares snapshots independent of JSON key order and retains safe part metadata", async () => {
    const events = lifecycle();
    const final = completed();
    const part = { ...final.output[0]!.content[0]!, annotations: [] };
    const item = { ...final.output[0]!, content: [part] };
    events[6] = { ...events[6], part };
    events[7] = { ...events[7], item };
    events[8] = {
      ...events[8],
      response: {
        ...final,
        output: [Object.fromEntries(Object.entries(item).reverse())],
      },
    };
    expect(await setup(response(wire(events))).run()).toEqual(output());
  });

  it("tracks multiple content indices after a completed reasoning item", async () => {
    const text = JSON.stringify(envelope());
    const parts = [text.slice(0, 20), text.slice(20)].map((text) => ({
      type: "output_text",
      text,
    }));
    const reasoning = { type: "reasoning", id: "reason_1", summary: [] };
    const message = { ...completed().output[0]!, content: parts };
    const events: Record<string, unknown>[] = [
      ...lifecycle().slice(0, 2),
      { type: "response.output_item.added", output_index: 0, item: reasoning },
      { type: "response.output_item.done", output_index: 0, item: reasoning },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: { ...message, status: "in_progress", content: [] },
      },
    ];
    for (const [content_index, part] of parts.entries()) {
      const identity = { item_id: message.id, output_index: 1, content_index };
      events.push(
        {
          type: "response.content_part.added",
          ...identity,
          part: { type: "output_text", text: "" },
        },
        { type: "response.output_text.delta", ...identity, delta: part.text },
        { type: "response.output_text.done", ...identity, text: part.text },
        { type: "response.content_part.done", ...identity, part },
      );
    }
    events.push(
      { type: "response.output_item.done", output_index: 1, item: message },
      {
        type: "response.completed",
        response: { ...completed(), output: [reasoning, message] },
      },
    );
    expect(await setup(response(wire(events))).run()).toEqual(output());
    for (const change of [
      { item_id: reasoning.id },
      { output_index: 0 },
      { content_index: 0 },
    ]) {
      const wrong = events.map((event, index) =>
        index === 10 ? { ...event, ...change } : event,
      );
      await expect(setup(response(wire(wrong))).run()).rejects.toThrow(
        "certified_fork_transport_",
      );
    }
  });

  it("redacts hostile adapter and reader accessors and releases on throwing cancel", async () => {
    const trap = vi.fn(() => {
      throw new Error(secret);
    });
    const hostile = new Proxy({}, { getPrototypeOf: trap, get: trap });
    for (const key of ["status", "headers", "body"]) {
      const reply = response();
      Object.defineProperty(reply, key, {
        get() {
          throw hostile;
        },
      });
      const error = await setup(reply)
        .run()
        .catch((error: unknown) => error);
      expect(error).toMatchObject({
        message: "certified_fork_transport_invalid_response_or_request",
      });
      expect((error as Error).cause).toBeUndefined();
    }
    const releaseLock = vi.fn();
    const reader = {
      read: () => Promise.reject(hostile),
      cancel() {
        throw hostile;
      },
      releaseLock,
    };
    const reply = response();
    Object.defineProperty(reply, "body", {
      value: { getReader: () => reader },
    });
    await expect(setup(reply).run()).rejects.toThrow(
      "certified_fork_transport_invalid_response_or_request",
    );
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(trap).not.toHaveBeenCalled();
  });

  it("posts once to the fixed adapter endpoint with bounded tool-free input", async () => {
    const test = setup();
    expect(await test.run()).toEqual(output());
    expect(test.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = test.fetchImpl.mock.calls[0]!;
    expect(url).toBe(endpoint);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: {
        authorization: `Bearer ${secret}`,
        "chatgpt-account-id": "account_1",
        originator: "reviewrouter_certified_fork",
      },
    });
    expect(Object.keys(init!.headers!)).toHaveLength(5);
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      max_output_tokens: 12000,
      tools: [],
      tool_choice: "none",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
    expect(JSON.parse(body.input[0].content[0].text)).toEqual(packet());
    expect(body.instructions).toContain("untrusted data");
    expect(init!.signal!.aborted).toBe(true);
  });

  it("accepts completed JSON and returns only authoritative parsed output", async () => {
    const test = setup(
      response(JSON.stringify(completed()), "application/json; charset=UTF-8"),
    );
    const result = await test.run();
    expect(result).toEqual(
      parseCertifiedForkReviewModelOutput(output(), ["src/a.ts", "src/b.ts"]),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual([
      "protocolVersion",
      "summaryMarkdown",
      "findings",
    ]);
  });

  it.each(["\n", "\r\n", "\r"])(
    "accepts comments, event names and multiline data using %j",
    async (nl) => {
      const event = JSON.stringify(
        { type: "response.completed", response: completed() },
        null,
        2,
      );
      const text =
        `: comment${nl}${nl}event: response.completed${nl}` +
        event
          .split("\n")
          .map((line) => `data: ${line}${nl}`)
          .join("") +
        nl;
      expect(await setup(response(text)).run()).toEqual(output());
    },
  );

  it("is deterministic at every byte split including CRLF and multibyte UTF-8", async () => {
    const bytes = new TextEncoder().encode(terminal().replaceAll("\n", "\r\n"));
    for (let index = 0; index <= bytes.length; index += 1) {
      expect(await setup(streamed(bytes, [index])).run()).toEqual(output());
    }
  });

  it("accepts one-byte chunks with a full text delta lifecycle", async () => {
    const wire = lifecycle()
      .map((event) => frame(event))
      .join("");
    const bytes = new TextEncoder().encode(wire);
    expect(
      await setup(
        streamed(
          bytes,
          Array.from({ length: bytes.length }, (_, i) => i),
        ),
      ).run(),
    ).toEqual(output());
  });

  it.each([
    ["empty", ""],
    ["malformed JSON", "data: {secret\n\n"],
    [
      "missing completion",
      frame({ type: "response.output_text.delta", delta: "{}" }),
    ],
    ["no frame delimiter", terminal().slice(0, -1)],
    ["partial line", terminal().slice(0, -2)],
    ["DONE alone", "data: [DONE]\n\n"],
    ["duplicate terminal", terminal() + terminal()],
    [
      "post terminal delta",
      terminal() + frame({ type: "response.output_text.delta", delta: secret }),
    ],
    ["post terminal DONE", terminal() + "data: [DONE]\n\n"],
    ["post terminal comment", terminal() + ": secret\n\n"],
    ["event name mismatch", "event: wrong\n" + terminal()],
    ["unknown field", "retry: 1\n" + terminal()],
    ["event without data", "event: response.created\n\n" + terminal()],
    ["unknown event", frame({ type: "execute", command: secret }) + terminal()],
    ["failed", frame({ type: "response.failed", error: secret })],
    ["incomplete", frame({ type: "response.incomplete" })],
  ])("rejects %s without retry", async (_name, wire) => {
    const test = setup(response(wire));
    await expect(test.run()).rejects.toThrow("certified_fork_transport_");
    expect(test.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    frame({ type: "response.output_text.delta", delta: "wrong" }) + terminal(),
    frame({ type: "response.output_text.done", text: "wrong" }) + terminal(),
    frame({ type: "response.output_text.done", text: "" }) +
      frame({ type: "response.output_text.delta", delta: "x" }) +
      terminal(),
    frame({ type: "response.output_text.done", text: "" }).repeat(2) +
      terminal(),
    frame({ type: "response.created", response: { id: "stale", output: [] } }) +
      terminal(),
    frame({
      type: "response.output_text.delta",
      delta: "",
      sequence_number: 1,
    }).repeat(2) + terminal(),
  ])("rejects inconsistent lifecycle %j", async (wire) => {
    await expect(setup(response(wire)).run()).rejects.toThrow(
      "certified_fork_transport_",
    );
  });

  it.each([
    "function_call",
    "computer_call",
    "local_shell_call",
    "custom_tool_call",
  ])("rejects %s without execution", async (type) => {
    const payload = completed();
    const wire = { ...payload, output: [{ type, command: secret }] };
    await expect(
      setup(response(JSON.stringify(wire), "application/json")).run(),
    ).rejects.toThrow("item_rejected");
    await expect(
      setup(
        response(
          frame({ type: "response.output_item.added", item: { type } }) +
            terminal(),
        ),
      ).run(),
    ).rejects.toThrow("item_rejected");
  });

  it.each([
    "text/plain",
    "application/jsonish",
    "text/event-stream-evil",
    "",
    "application/json; charset=latin1",
    "text/event-stream; boundary=x",
  ])("rejects content type %j", async (type) => {
    await expect(setup(response(terminal(), type)).run()).rejects.toThrow(
      "content_type_rejected",
    );
  });

  it.each([201, 204, 301, 400, 401, 429, 500])(
    "rejects status %i without exposing its body",
    async (status) => {
      const reply = new Response(status === 204 ? null : secret, { status });
      const test = setup(reply);
      await expect(test.run()).rejects.toThrow("http_rejected");
      expect(test.fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a redirected or unexpected response URL", async () => {
    for (const field of ["redirected", "url"]) {
      const reply = response();
      Object.defineProperty(reply, field, {
        value: field === "url" ? "https://evil.invalid" : true,
      });
      await expect(setup(reply).run()).rejects.toThrow("http_rejected");
    }
  });

  it.each(["", "token\r\ncookie: leak", "a b", "x".repeat(16385)])(
    "rejects malformed auth before fetch",
    async (accessToken) => {
      const test = setup(response(), { accessToken });
      await expect(test.run()).rejects.toThrow("credentials_invalid");
      expect(test.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid account IDs and timeout overrides before fetch", async () => {
    for (const changes of [
      { chatgptAccountId: "x\nsecret" },
      { timeoutMs: 0 },
      { timeoutMs: 600001 },
      { timeoutMs: 1.5 },
    ]) {
      const test = setup(response(), changes);
      await expect(test.run()).rejects.toThrow("certified_fork_transport_");
      expect(test.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("rejects response, event and output byte budget overflow", async () => {
    for (const wire of [
      "x".repeat(2 * 1024 * 1024 + 1),
      ":" + "x".repeat(512 * 1024) + "\n\n",
      terminal("x".repeat(256 * 1024 + 1)),
    ]) {
      await expect(setup(response(wire)).run()).rejects.toThrow("too_large");
    }
  });

  it("rejects too many events", async () => {
    const events = lifecycle();
    const wire =
      events
        .slice(0, 4)
        .map((event) => frame(event))
        .join("") +
      frame({ ...events[4], delta: "" }).repeat(10001) +
      terminal();
    await expect(setup(response(wire)).run()).rejects.toThrow(
      "event_budget_exceeded",
    );
  });

  it("checks declared body length and cancels on early rejection", async () => {
    for (const length of ["2097153", "-1", "abc", "1"]) {
      const reply = response();
      reply.headers.set("content-length", length);
      await expect(setup(reply).run()).rejects.toThrow(
        "certified_fork_transport_",
      );
      expect(reply.body!.locked).toBe(false);
    }
  });

  it("rejects invalid and truncated UTF-8", async () => {
    for (const bytes of [new Uint8Array([255]), new Uint8Array([0xf0, 0x9f])]) {
      await expect(setup(streamed(bytes, [])).run()).rejects.toThrow(
        "certified_fork_transport_",
      );
    }
  });

  it("redacts fetch and stream errors, JSON parser bodies and causes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(`authorization=${secret}; cookie=${secret}`),
      );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(secret));
      },
    });
    const cases = [
      setup(response(), { fetchImpl }),
      setup(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      ),
      setup(response(`{"${secret}`, "application/json")),
      setup(response(terminal(secret))),
    ];
    for (const test of cases) {
      const error = await test.run().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect((error as Error).cause).toBeUndefined();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cancels immediately when the caller is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(secret);
    const test = setup(response(), { signal: controller.signal });
    await expect(test.run()).rejects.toThrow("aborted");
    expect(test.fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts a pending fetch even if the injected adapter ignores signals", async () => {
    const controller = new AbortController();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const pending = setup(response(), {
      fetchImpl,
      signal: controller.signal,
    }).run();
    controller.abort(secret);
    await expect(pending).rejects.toThrow("aborted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cleans a late response from an aborted adapter", async () => {
    let resolve!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const controller = new AbortController();
    const pending = setup(response(), {
      fetchImpl,
      signal: controller.signal,
    }).run();
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["timeout", "caller"])(
    "cancels and unlocks a stalled reader on %s",
    async (mode) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const reply = new Response(new ReadableStream<Uint8Array>({ cancel }), {
        headers: { "content-type": "text/event-stream" },
      });
      const test = setup(reply, { signal: controller.signal, timeoutMs: 10 });
      const pending = test.run();
      const rejection = expect(pending).rejects.toThrow(
        mode === "timeout" ? "timeout" : "aborted",
      );
      await Promise.resolve();
      await Promise.resolve();
      if (mode === "timeout") await vi.advanceTimersByTimeAsync(10);
      else controller.abort(secret);
      await rejection;
      expect(cancel).toHaveBeenCalledOnce();
      expect(reply.body!.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(test.fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("cleans timers and caller listeners after success and failure", async () => {
    vi.useFakeTimers();
    for (const reply of [response(), response("invalid")]) {
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      await setup(reply, { signal: controller.signal })
        .run()
        .catch(() => undefined);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      expect(reply.body!.locked).toBe(false);
    }
  });
});

describe("authoritative packet and output adaptation", () => {
  const validate = (modelOutput: unknown, promptPacket: unknown = packet()) =>
    validateCertifiedForkModelOutputForPrompt({
      modelOutput,
      promptPacket,
      codec,
    });

  it("permits reordered exact reviewed paths and findings on a subset", () => {
    const value = envelope();
    value.reviewedPaths.reverse();
    expect(validate(value)).toEqual(output());
  });

  it.each(
    [
      [],
      ["src/a.ts"],
      ["src/a.ts", "src/a.ts"],
      ["src/a.ts", "extra.ts"],
      ["src/a.ts", "src/b.ts", "extra.ts"],
    ].map((paths) => [paths] as const),
  )("rejects non-exact reviewed file sets %j", (reviewedPaths) => {
    expect(() => validate({ ...envelope(), reviewedPaths })).toThrow(
      "output_invalid",
    );
  });

  it.each([
    "../src/a.ts",
    "/src/a.ts",
    "C:/a.ts",
    "src\\a.ts",
    "src/./a.ts",
    "src//a.ts",
    "src/\u0085a.ts",
    "src/\u2028a.ts",
    "src/\u202ea.ts",
    "src/`a.ts",
  ])("delegates unsafe path rejection: %j", async (path) => {
    const prompt = packet();
    prompt.files[0]!.path = path;
    expect(() => parseCertifiedForkReviewPromptPacket(prompt)).toThrow();
    const test = setup(response(), { promptPacket: prompt });
    await expect(test.run()).rejects.toThrow("certified_fork_transport_");
    expect(test.fetchImpl).not.toHaveBeenCalled();
    const value = envelope();
    value.modelOutput.findings[0]!.path = path;
    expect(() => validate(value)).toThrow("output_invalid");
  });

  it("rejects stale context hashes and every changed binding tuple field", () => {
    expect(() =>
      validate({ ...envelope(), contextHash: "0".repeat(64) }),
    ).toThrow("output_invalid");
    for (const [key, old] of Object.entries(envelope().binding)) {
      const value = envelope();
      Object.assign(value.binding, {
        [key]: typeof old === "number" ? old + 1 : `${old}x`,
      });
      expect(() => validate(value)).toThrow("output_invalid");
    }
  });

  it("rejects packet hash tampering and missing/extra files before fetch", async () => {
    for (const edit of [
      (p: ReturnType<typeof packet>) => {
        p.files.pop();
      },
      (p: ReturnType<typeof packet>) => {
        p.files.push({ ...p.files[0]!, path: "extra.ts" });
      },
      (p: ReturnType<typeof packet>) => {
        p.binding.reviewHeadSha = "c".repeat(40);
      },
      (p: ReturnType<typeof packet>) => {
        p.contextHash = "bad";
      },
    ]) {
      const prompt = packet();
      edit(prompt);
      const test = setup(response(), { promptPacket: prompt });
      await expect(test.run()).rejects.toThrow("certified_fork_transport_");
      expect(test.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("uses authoritative output byte bounds and exact keys", () => {
    for (const modelOutput of [
      { ...output(), summaryMarkdown: "🦊".repeat(15001) },
      { ...output(), extra: secret },
      { ...output(), protocolVersion: 2 },
      { ...output(), findings: [{ ...output().findings[0], endLine: 0 }] },
      {
        ...output(),
        findings: [{ ...output().findings[0], title: "é".repeat(101) }],
      },
      {
        ...output(),
        findings: [{ ...output().findings[0], path: "unknown.ts" }],
      },
    ]) {
      expect(() =>
        parseCertifiedForkReviewModelOutput(modelOutput, [
          "src/a.ts",
          "src/b.ts",
        ]),
      ).toThrow();
      expect(() => validate({ ...envelope(), modelOutput })).toThrow(
        "output_invalid",
      );
    }
  });

  it("rejects hostile getters and proxies without invoking them", () => {
    const invoked = vi.fn(() => {
      throw new Error(secret);
    });
    const paths = ["src/a.ts", "src/b.ts"];
    Object.defineProperty(paths, "0", { get: invoked, enumerable: true });
    expect(() => validate({ ...envelope(), reviewedPaths: paths })).toThrow(
      "output_invalid",
    );
    expect(() =>
      validate({
        ...envelope(),
        reviewedPaths: new Proxy([], { get: invoked }),
      }),
    ).toThrow("output_invalid");
    const value = envelope();
    Object.defineProperty(value, "modelOutput", {
      get: invoked,
      enumerable: true,
    });
    expect(() => validate(value)).toThrow("output_invalid");
    expect(invoked).not.toHaveBeenCalled();
  });
});

describe("additional fail-closed transport boundaries", () => {
  it("accepts safe item and content lifecycle echoes", async () => {
    expect(await setup(response(wire(lifecycle()))).run()).toEqual(output());
  });

  it("rejects conflicting completed item and part echoes", async () => {
    for (const index of [6, 7]) {
      const events = lifecycle();
      events[index] =
        index === 6
          ? { ...events[index], part: { type: "output_text", text: "wrong" } }
          : { ...events[index], item: completed("wrong").output[0] };
      await expect(setup(response(wire(events))).run()).rejects.toThrow(
        "lifecycle_invalid",
      );
    }
  });

  it("rejects malformed completed JSON envelopes", async () => {
    for (const payload of [
      null,
      [],
      {},
      { ...completed(), status: "incomplete" },
      { ...completed(), id: "" },
      { ...completed(), output: [] },
      { ...completed(), output_text: "wrong" },
      { ...completed(), output: completed().output.concat(completed().output) },
      { ...completed(), output: [{ ...completed().output[0], role: "user" }] },
      {
        ...completed(),
        output: [
          {
            ...completed().output[0],
            content: [{ type: "refusal", refusal: secret }],
          },
        ],
      },
    ]) {
      await expect(
        setup(response(JSON.stringify(payload), "application/json")).run(),
      ).rejects.toThrow("certified_fork_transport_");
    }
  });

  it("allows bounded reasoning items without exposing them", async () => {
    const payload = completed();
    const wire = {
      ...payload,
      output: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: secret }],
        },
        ...payload.output,
      ],
    };
    const result = await setup(
      response(JSON.stringify(wire), "application/json"),
    ).run();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects oversized prompt patches before fetch", async () => {
    const prompt = packet();
    prompt.files[0]!.patch = "x".repeat(200001);
    const test = setup(response(), { promptPacket: prompt });
    await expect(test.run()).rejects.toThrow("certified_fork_transport_");
    expect(test.fetchImpl).not.toHaveBeenCalled();
  });

  it("times out a fetch that never resolves and clears the deadline", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const pending = setup(response(), { fetchImpl, timeoutMs: 5 }).run();
    const rejection = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a missing body and cancels HTTP errors without reading", async () => {
    await expect(
      setup(
        new Response(null, { headers: { "content-type": "application/json" } }),
      ).run(),
    ).rejects.toThrow("body_missing");
    const cancel = vi.fn();
    const reply = new Response(new ReadableStream({ cancel }), { status: 429 });
    await expect(setup(reply).run()).rejects.toThrow("http_rejected");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
