import { HindsightMemoryStore } from "context-memory";

// Disposable ordinary application: synthetic transport, no Router identity or credentials.
// Native image/privacy/semantic qualification is a separate gate.
const source = {
  ref: { scope: "notebook", id: "note-1" },
  body: "Use UTC timestamps.",
  metadata: { revision: "one" },
  tags: ["notebook"],
};
const operationId = "11111111-1111-4111-8111-111111111111";
const seen = [];
const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const memory = new HindsightMemoryStore({
  baseUrl: "http://synthetic.invalid",
  apiKey: "synthetic-service-key",
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
      const body = JSON.parse(
        String(
          init?.body ??
            (request instanceof Request ? await request.text() : "{}"),
        ),
      );
      seen.push(body);
      if (url.endsWith("/recall"))
        return json({
          results: [
            {
              id: "fact-1",
              type: "world",
              text: source.body,
              document_id: source.ref.id,
            },
          ],
          source_facts: {},
        });
      return json({ success: true, operation_id: operationId });
    }
    if (url.endsWith("/config"))
      return json({
        config: {
          retain_strategies: {
            "exact-statements": { retain_extraction_mode: "chunks" },
          },
        },
      });
    if (url.includes("/operations/"))
      return json({
        status: "completed",
        operation_type: "batch_retain",
        child_operations: [{ operation_id: "child-1", status: "completed" }],
      });
    if (url.includes("/documents/"))
      return json({
        id: source.ref.id,
        bank_id: source.ref.scope,
        original_text: source.body,
        document_metadata: source.metadata,
        tags: source.tags,
      });
    return json({ items: [{ id: source.ref.id }], total: 1 });
  },
});
const controls = { deadlineAt: new Date(Date.now() + 10000) };
function check(condition, message) {
  if (!condition) throw new Error(message);
}
const accepted = await memory.replaceSource(
  {
    source,
    statementAt: "2026-10-28T00:00:00.000Z",
    operationId,
    derivationTags: ["notebook"],
  },
  controls,
);
check(accepted.state === "submitted", "exact source submission missing");
check(
  seen[0].items[0].content === source.body &&
    seen[0].items[0].strategy === "exact-statements",
  "frozen exact chunks changed",
);
check(
  (
    await memory.operation(
      { scope: source.ref.scope, id: operationId },
      controls,
    )
  ).state === "completed",
  "operation observation missing",
);
check(
  JSON.stringify(await memory.readSource(source.ref, controls)) ===
    JSON.stringify(source),
  "current provider body differs",
);
check(
  (await memory.listSources({ scope: source.ref.scope, limit: 10 }, controls))
    .sources[0].id === source.ref.id,
  "current source list missing",
);
check(
  (
    await memory.recallEvidence(
      { scope: source.ref.scope, query: "Timestamp convention", limit: 4 },
      controls,
    )
  )[0].evidenceComplete,
  "scoped native evidence missing",
);
console.log(
  "ordinary packed context-memory consumer: 5 capabilities passed (synthetic transport; no native qualification claim)",
);
