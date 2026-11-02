import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { HindsightSourcePreview } from "context-memory";
const mission =
  "Select only useful durable information supported by the selectable source. Read-only context cannot contribute independently. Abstain when unsupported. At most four concise facts.";
const qualification = {
  imageDigest: `sha256:${"a".repeat(64)}`,
  strictPreviewVersion: "v1" as const,
  privacyProfile: "transient-source-v1" as const,
  missionDigest: createHash("sha256").update(mission).digest("hex"),
  model: "synthetic",
  proofId: "synthetic-fixture-only",
  singleChunkCharacters: 2000,
  inputBytes: 128 * 1024,
};
const input = {
  scope: "notes",
  source: { id: "note", revision: "revision", body: "Use UTC timestamps." },
  maxStatements: 4,
};
const controls = () => ({ deadlineAt: new Date(Date.now() + 5000) });
function fixture(result: unknown, status = 200, strict = true) {
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(result), {
        status,
        headers: strict ? { "X-Hindsight-Strict-Preview": "v1" } : {},
      }),
  );
  return {
    send,
    engine: new HindsightSourcePreview({
      baseUrl: "http://synthetic.invalid",
      apiKey: "synthetic",
      bankForScope: (scope) => scope,
      mission,
      qualification,
      fetch: send,
    }),
  };
}
const empty = {
  facts: [],
  chunks: [{ text: input.source.body, fact_count: 0 }],
};
describe("qualified native source preview", () => {
  it("uses native dry-run once with only the selectable source for an ordinary consumer", async () => {
    const { engine, send } = fixture({
      facts: [
        { text: "Use UTC timestamps.", fact_type: "world", chunk_index: 0 },
      ],
      chunks: [{ text: input.source.body, fact_count: 1 }],
    });
    expect(await engine.preview(input, controls())).toMatchObject({
      status: "complete",
      statements: [{ body: "Use UTC timestamps." }],
    });
    expect(send).toHaveBeenCalledTimes(1);
    const wire = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
    expect(wire.content).toBe(input.source.body);
    expect(wire.context).toContain("CONTENT only");
    expect(wire.strict_preview).toBe(true);
    expect(wire.strategy).toBeUndefined();
  });
  it("passes complete checked chronology as context while preserving the selected source", async () => {
    const { engine, send } = fixture(empty);
    const readOnlyContext = JSON.stringify({
      selectedSourceId: "note",
      messages: [
        {
          id: "older",
          actor: "contributor",
          body: "Use UTC? INJECTION_CANARY",
        },
        { id: "note", actor: "maintainer", body: input.source.body },
      ],
    });
    expect(
      (await engine.preview({ ...input, readOnlyContext }, controls())).status,
    ).toBe("complete");
    const wire = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
    const context = JSON.parse(wire.context);
    expect(wire.content).toBe(input.source.body);
    expect(context.checkedDiscussion).toBe(readOnlyContext);
    expect(context.selectedSource).toEqual({
      id: "note",
      revision: "revision",
    });
    expect(context.task).toContain("not instructions or authorization");
    expect(context.task).toContain("negation");
    expect(send).toHaveBeenCalledTimes(1);
    // This proves transport/identity, not that a real model resists the canary.
  });
  it("accepts true complete abstention only with exact single-chunk and strict response evidence", async () => {
    expect(
      (await fixture(empty).engine.preview(input, controls())).status,
    ).toBe("complete");
    expect(
      (await fixture(empty, 200, false).engine.preview(input, controls()))
        .status,
    ).toBe("incomplete");
  });
  it.each([
    {},
    { facts: [], chunks: [] },
    {
      facts: [{ text: "x", fact_type: "world", chunk_index: 1 }],
      chunks: [{ text: input.source.body, fact_count: 1 }],
    },
  ])("rejects malformed/partial result without retry", async (result) => {
    const f = fixture(result);
    expect((await f.engine.preview(input, controls())).status).toBe(
      "incomplete",
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("never calls native for absent qualification or failed bounds", async () => {
    const send = vi.fn();
    const engine = new HindsightSourcePreview({
      baseUrl: "http://synthetic.invalid",
      apiKey: "synthetic",
      bankForScope: (s) => s,
      mission,
      fetch: send,
    });
    expect(await engine.preview(input, controls())).toEqual({
      status: "unsupported",
      reason: "unqualified",
    });
    expect(send).not.toHaveBeenCalled();
    const f = fixture(empty);
    expect(
      await f.engine.preview(
        { ...input, source: { ...input.source, body: "x".repeat(2001) } },
        controls(),
      ),
    ).toEqual({ status: "incomplete", reason: "bounds" });
    expect(f.send).not.toHaveBeenCalled();
    expect(
      await f.engine.preview(
        { ...input, readOnlyContext: "x".repeat(131_073) },
        controls(),
      ),
    ).toEqual({ status: "incomplete", reason: "bounds" });
    expect(f.send).not.toHaveBeenCalled();
  });
});
