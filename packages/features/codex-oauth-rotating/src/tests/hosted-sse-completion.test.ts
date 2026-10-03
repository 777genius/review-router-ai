import { describe, expect, it } from "vitest";
import { HostedSseCompletion } from "../action/hosted-sse-completion";

const completed = {
  type: "response.completed",
  response: { id: "response-test", status: "completed" },
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const parse = (text: string) => {
  const parser = new HostedSseCompletion();
  parser.push(new TextEncoder().encode(text));
  return parser.finish();
};

describe("hosted SSE semantic completion", () => {
  it("accepts a real completed response without requiring DONE or output fields", () => {
    expect(parse(frame(completed))).toBe(true);
    expect(parse(frame(completed) + "data: [DONE]\n\n")).toBe(true);
  });

  it.each(["\n", "\r\n", "\r"])(
    "handles SSE framing and every UTF8 byte split using %j",
    (nl) => {
      const wire =
        `: comment${nl}${nl}event: response.completed${nl}` +
        JSON.stringify(
          {
            ...completed,
            response: { ...completed.response, optional: "Привіт" },
          },
          null,
          2,
        )
          .split("\n")
          .map((line) => `data: ${line}${nl}`)
          .join("") +
        nl;
      const bytes = new TextEncoder().encode(wire);
      for (let split = 0; split <= bytes.length; split++) {
        const parser = new HostedSseCompletion();
        parser.push(bytes.subarray(0, split));
        parser.push(bytes.subarray(split));
        expect(parser.finish()).toBe(true);
      }
    },
  );

  it.each([
    ["DONE alone", "data: [DONE]\n\n"],
    ["bare completed", frame({ type: "response.completed" })],
    [
      "wrong status",
      frame({
        ...completed,
        response: { ...completed.response, status: "in_progress" },
      }),
    ],
    [
      "empty id",
      frame({ ...completed, response: { ...completed.response, id: "" } }),
    ],
    [
      "contradictory error",
      frame({
        ...completed,
        response: { ...completed.response, error: { code: "failed" } },
      }),
    ],
    [
      "contradictory incomplete details",
      frame({
        ...completed,
        response: {
          ...completed.response,
          incomplete_details: { reason: "max_output_tokens" },
        },
      }),
    ],
    [
      "missing terminal",
      frame({ type: "response.output_text.delta", delta: "text" }),
    ],
    [
      "failed plus DONE",
      frame({ type: "response.failed" }) + "data: [DONE]\n\n",
    ],
    [
      "incomplete plus DONE",
      frame({ type: "response.incomplete" }) + "data: [DONE]\n\n",
    ],
    ["error plus completed", frame({ type: "error" }) + frame(completed)],
    ["malformed JSON", "data: {broken}\n\n" + frame(completed)],
    ["unterminated terminal frame", frame(completed).slice(0, -1)],
    ["partial trailing payload", frame(completed) + "data: {"],
    ["duplicate terminal", frame(completed) + frame(completed)],
    [
      "postterminal delta",
      frame(completed) +
        frame({ type: "response.output_text.delta", delta: "late" }),
    ],
    ["duplicate DONE", frame(completed) + "data: [DONE]\n\ndata: [DONE]\n\n"],
    ["conflicting event name", "event: response.failed\n" + frame(completed)],
    [
      "conflicting response id",
      frame({ type: "response.created", response: { id: "other" } }) +
        frame(completed),
    ],
  ])("rejects %s", (_name, wire) => expect(parse(wire)).toBe(false));

  it("requires a complete frame before granting terminal authority", () => {
    const parser = new HostedSseCompletion();
    const bytes = new TextEncoder().encode(frame(completed));
    parser.push(bytes.subarray(0, -1));
    expect(parser.completed).toBe(false);
    parser.push(bytes.subarray(-1));
    expect(parser.completed).toBe(true);
    expect(parser.finish()).toBe(true);
  });

  it("rejects malformed UTF8 and bounds a fully framed oversized comment", () => {
    const parser = new HostedSseCompletion();
    parser.push(new Uint8Array([0xc3, 0x28]));
    expect(parser.finish()).toBe(false);
    expect(parse("data: " + "x".repeat(2_000_001))).toBe(false);
    expect(parse(": comment\n\n" + frame(completed))).toBe(true);
    expect(parse(":" + "x".repeat(2_000_001) + "\n\n" + frame(completed))).toBe(
      false,
    );
  });
});
