import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createConnectionProbeHandler } from "./gateway-connection-probe-http";

const payload = () => ({
  context: "viewer-scope",
  workspaceId: "workspace",
  bindingId: "binding",
  model: "model",
  nonce: randomUUID(),
});
function request(
  origin = "https://reviewrouter.example",
  body: unknown = payload(),
) {
  return new Request("http://localhost:3000/api/dashboard/accounts/test", {
    method: "POST",
    headers: {
      host: "reviewrouter.example",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
it("streams behind Next host normalization while rejecting cross-site input before loading authority", async () => {
  let loads = 0,
    calls = 0;
  const handler = createConnectionProbeHandler(async () => {
    loads++;
    return {
      scope: "viewer-scope",
      probe: () => async (_request, emit) => {
        calls++;
        emit({ type: "progress", stage: "requesting" });
        emit({ type: "result", ok: true, model: "model", elapsedMs: 12 });
      },
    };
  }, "https://reviewrouter.example");
  for (const origin of [
    "http://reviewrouter.example",
    "https://foreign.example",
    "https://sub.reviewrouter.example",
  ]) {
    expect((await handler(request(origin))).status).toBe(403);
  }
  expect(loads).toBe(0);
  const response = await handler(request());
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-type")).toContain(
    "application/x-ndjson",
  );
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.map((event) => event.type)).toEqual([
    "progress",
    "progress",
    "result",
  ]);
  expect(calls).toBe(1);
});
it("refuses stale viewer context and oversized or extended request bodies without dispatch", async () => {
  let calls = 0;
  const handler = createConnectionProbeHandler(
    async () => ({
      scope: "other-viewer",
      probe: () => async () => {
        calls++;
      },
    }),
    "https://reviewrouter.example",
  );
  expect(await (await handler(request())).text()).toContain('"code":"denied"');
  expect(
    (
      await handler(
        request(undefined, {
          ...payload(),
          upstreamUrl: "http://private-service",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handler(
        request(undefined, { ...payload(), model: "a".repeat(5000) }),
      )
    ).status,
  ).toBe(413);
  expect(calls).toBe(0);
});
