import { expect, it } from "vitest";
import type { NativeResponse } from "@agent-teams/account-gateway/http";
import { readConversationResponses } from "./action-conversation-inference.js";
const model = "gpt-6.1-sol";
const message = {
  id: "message-1",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [
    {
      type: "output_text",
      text: '{"kind":"silent","answer":"","action":null}',
    },
  ],
};
function stream(events: readonly unknown[], splitEvery = 7) {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""),
  );
  let cancelled = 0;
  const response: NativeResponse = {
    kind: "stream",
    requestRef: "request-1",
    body: new ReadableStream({
      start(controller) {
        for (let at = 0; at < bytes.length; at += splitEvery)
          controller.enqueue(bytes.slice(at, at + splitEvery));
        controller.close();
      },
    }),
    cancel: async () => {
      cancelled++;
    },
  };
  return { response, cancelled: () => cancelled };
}
const completed = (output: unknown[] = [message]) => ({
  type: "response.completed",
  response: {
    id: "response-1",
    status: "completed",
    model,
    output,
    usage: { input_tokens: 100, output_tokens: 20 },
  },
});
const controls = () => ({ deadlineAt: new Date(Date.now() + 1000) });
it("collects one selected-model store:false stream across split CRLF boundaries and cancels the native response", async () => {
  const fixture = stream([
    { type: "response.created", response: { id: "response-1" } },
    {
      type: "response.output_item.added",
      item: { ...message, status: "in_progress", content: [] },
    },
    { type: "response.output_item.done", item: message },
    completed([]),
  ]);
  expect(
    await readConversationResponses(fixture.response, model, controls()),
  ).toEqual({
    text: message.content[0]!.text,
    actualModel: model,
    usage: { inputTokens: 100, outputTokens: 20 },
    effect: "completed",
  });
  expect(fixture.cancelled()).toBe(1);
});
it.each(
  [
    [
      {
        type: "response.output_item.done",
        item: { id: "tool-1", type: "function_call" },
      },
      completed(),
    ],
    [
      {
        type: "response.content_part.added",
        part: { type: "refusal", refusal: "no" },
      },
      completed(),
    ],
    [
      { type: "response.created", response: { id: "different-response" } },
      completed(),
    ],
    [{ type: "response.output_item.added", item: message }, completed([])],
    [{ type: "response.incomplete", response: { status: "incomplete" } }],
    [{ type: "response.unsupported_shape" }, completed()],
  ].map((events) => [events]),
)(
  "rejects a non-text, incoherent or incomplete native stream without accepting terminal-looking output",
  async (events) => {
    const fixture = stream(events);
    await expect(
      readConversationResponses(fixture.response, model, controls()),
    ).rejects.toThrow("conversation_unavailable");
    expect(fixture.cancelled()).toBe(1);
  },
);
it("treats completed status as unavailable output and enforces the captured aggregate stream budget", async () => {
  await expect(
    readConversationResponses(
      {
        kind: "status",
        status: {
          requestRef: "request-1",
          effect: "completed",
          status: "completed",
        },
      },
      model,
      controls(),
    ),
  ).rejects.toThrow("conversation_unavailable");
  const fixture = stream([completed()]);
  await expect(
    readConversationResponses(fixture.response, model, controls(), 32),
  ).rejects.toThrow("conversation_unavailable");
  expect(fixture.cancelled()).toBe(1);
});
