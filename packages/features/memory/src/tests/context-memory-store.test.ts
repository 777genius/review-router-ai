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
      if (url.endsWith("/config"))
        return new Response(
          JSON.stringify({
            config: {
              retain_strategies: {
                "exact-statements": { retain_extraction_mode: "chunks" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
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

it.each([null, false, [], 0, "scalar"].map((value) => ({ value })))(
  "rejects malformed successful native payload $value rather than treating it as source absence",
  async ({ value }) => {
    const engine = new HindsightMemoryStore({
      baseUrl: "http://fixture.invalid",
      apiKey: "synthetic",
      bankForScope: (scope) => scope,
      exactStatementStrategy: "exact-statements",
      fetch: async () =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const controls = { deadlineAt: new Date(Date.now() + 5000) };
    for (const request of [
      () => engine.readSource({ scope: "notebook", id: "note-1" }, controls),
      () => engine.listSources({ scope: "notebook", limit: 10 }, controls),
      () => engine.operation({ scope: "notebook", id: "operation" }, controls),
      () =>
        engine.recallEvidence(
          { scope: "notebook", query: "timestamps", limit: 2 },
          controls,
        ),
    ])
      await expect(request()).rejects.toMatchObject({ code: "unavailable" });
  },
);

it("keeps HTTP404 source absence distinct from malformed HTTP200", async () => {
  const engine = new HindsightMemoryStore({
    baseUrl: "http://fixture.invalid",
    apiKey: "synthetic",
    bankForScope: (scope) => scope,
    exactStatementStrategy: "exact-statements",
    fetch: async () =>
      new Response(JSON.stringify({ detail: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
  });
  expect(
    await engine.readSource(
      { scope: "notebook", id: "missing" },
      { deadlineAt: new Date(Date.now() + 5000) },
    ),
  ).toBeNull();
});

it.each([
  { name: "unknown", strategy: undefined },
  { name: "semantic", strategy: { retain_extraction_mode: "concise" } },
  { name: "malformed", strategy: ["chunks"] },
])(
  "rejects $name exact-storage strategy before native retain",
  async ({ strategy }) => {
    const requests: string[] = [];
    const engine = new HindsightMemoryStore({
      baseUrl: "http://fixture.invalid",
      apiKey: "synthetic",
      bankForScope: (scope) => scope,
      exactStatementStrategy: "exact-statements",
      fetch: async (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response(
          JSON.stringify({
            config: {
              retain_extraction_mode: "concise",
              retain_strategies: strategy
                ? { "exact-statements": strategy }
                : {},
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    await expect(
      engine.replaceSource(
        {
          source: {
            ref: { scope: "notebook", id: "note-1" },
            body: "Use UTC timestamps.",
            metadata: {},
            tags: [],
          },
          operationId: "11111111-1111-4111-8111-111111111111",
          statementAt: "2026-10-28T00:00:00.000Z",
          derivationTags: [],
        },
        { deadlineAt: new Date(Date.now() + 5000) },
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(requests).toEqual(["GET /v1/default/banks/notebook/config"]);
  },
);
