import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { warmDashboardScripts } from "./accounts-reference-e2e/src/dashboard-script-warmup.ts";

it("waits for complete Next script bodies, deduplicates them, and ignores external script URLs", async () => {
  let release!: () => void;
  let requested!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const bodyReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url!);
    response.writeHead(200, { "content-type": "application/javascript" });
    response.flushHeaders();
    requested();
    await bodyReady;
    response.end("globalThis.fixtureScriptReady = true;");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture_address_required");
    let completed = false;
    const warming = warmDashboardScripts(
      `http://127.0.0.1:${address.port}`,
      '<script src="/_next/static/chunks/page.js"></script><script src="/_next/static/chunks/page.js"></script><script src="https://external.invalid/asset.js"></script>',
      AbortSignal.timeout(5_000),
    ).then(() => {
      completed = true;
    });
    await requestStarted;
    await setImmediate();
    expect(completed).toBe(false);
    release();
    await warming;
    expect(requests).toEqual(["/_next/static/chunks/page.js"]);
    expect(completed).toBe(true);
  } finally {
    release();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

it("fails setup when a required script is unavailable or the shared setup deadline aborts", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture_address_required");
    const origin = `http://127.0.0.1:${address.port}`;
    const html = '<script src="/_next/static/chunks/page.js"></script>';
    await expect(
      warmDashboardScripts(origin, html, AbortSignal.timeout(5_000)),
    ).rejects.toThrow("script_warmup_status_404");
    await expect(
      warmDashboardScripts(origin, html, AbortSignal.abort()),
    ).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

it("refuses a non-loopback origin and missing Next scripts", async () => {
  await expect(
    warmDashboardScripts(
      "https://reviewrouter.org",
      "",
      AbortSignal.timeout(5_000),
    ),
  ).rejects.toThrow("warmup_requires_loopback");
  await expect(
    warmDashboardScripts("http://127.0.0.1:1", "", AbortSignal.timeout(5_000)),
  ).rejects.toThrow("warmup_missing_scripts");
});
