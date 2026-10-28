import { expect, it } from "vitest";
import { HindsightMemoryStore } from "context-memory";
it("ordinary source lifecycle uses exact chunks and exposes current native readback separately from operation completion", async () => {
  const wire: Record<string, unknown>[] = [];
  const source = {
    ref: { scope: "notebook", id: "note-1" },
    body: "Use UTC timestamps.",
    metadata: { revision: "one" },
    tags: ["notebook"],
  };
  const engine = new HindsightMemoryStore({
    baseUrl: "http://fixture.invalid",
    apiKey: "synthetic",
    bankForScope: (scope) => scope,
    exactStatementStrategy: "exact-statements",
    fetch: async (request, init) => {
      const url =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.href
            : request.url;
      const method =
        init?.method ?? (request instanceof Request ? request.method : "GET");
      if (method === "POST") {
        const text =
          init?.body ??
          (request instanceof Request ? await request.text() : "{}");
        wire.push(JSON.parse(String(text)));
        return new Response(
          JSON.stringify({
            success: true,
            operation_id: "11111111-1111-4111-8111-111111111111",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/operations/"))
        return new Response(
          JSON.stringify({
            status: "completed",
            operation_type: "batch_retain",
            child_operations: [{ operation_id: "child", status: "completed" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      if (url.includes("/documents/"))
        return new Response(
          JSON.stringify({
            id: source.ref.id,
            bank_id: source.ref.scope,
            original_text: source.body,
            document_metadata: source.metadata,
            tags: source.tags,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(
        JSON.stringify({ items: [{ id: "note-1" }], total: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const controls = { deadlineAt: new Date(Date.now() + 5000) };
  expect(
    await engine.replaceSource(
      {
        source,
        operationId: "11111111-1111-4111-8111-111111111111",
        statementAt: "2026-10-28T00:00:00.000Z",
        derivationTags: ["notebook"],
      },
      controls,
    ),
  ).toEqual({ id: "11111111-1111-4111-8111-111111111111", state: "submitted" });
  expect(wire[0]).toMatchObject({
    async: true,
    items: [
      {
        content: source.body,
        strategy: "exact-statements",
        update_mode: "replace",
        entities: [],
        resolve_entities: false,
      },
    ],
  });
  expect(
    await engine.operation(
      { scope: "notebook", id: "11111111-1111-4111-8111-111111111111" },
      controls,
    ),
  ).toMatchObject({ state: "completed", kind: "batch_retain" });
  expect(await engine.readSource(source.ref, controls)).toEqual(source);
  expect(
    await engine.listSources({ scope: "notebook", limit: 10 }, controls),
  ).toEqual({ sources: [source.ref], nextCursor: null });
});
