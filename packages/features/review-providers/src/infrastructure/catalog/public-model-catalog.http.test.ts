import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import {
  fetchPublicCatalog,
  publicCatalogPolicy,
} from "./public-model-catalog";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("loopback_address_required");
  return `http://127.0.0.1:${address.port}/catalog`;
}

it.each([503, 200])(
  "closes a rejected %s streaming body and can use the restored source",
  async (status) => {
    let healthy = false;
    let closed!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = createServer((request, response) => {
      if (healthy) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"recovered":true}');
        return;
      }
      request.once("close", closed);
      response.writeHead(status, { "content-type": "application/json" });
      response.write(
        status === 503 ? '{"error":"unavailable"' : "x".repeat(2048),
      );
      // Deliberately leave the body open. Header/size rejection must release it.
    });
    const origin = await listen(server);
    const fetchLocal: typeof fetch = (_url, init) => fetch(origin, init);
    const policy = { ...publicCatalogPolicy, timeoutMs: 1000, maxBytes: 1024 };
    await expect(
      fetchPublicCatalog("https://models.dev/api.json", fetchLocal, policy),
    ).rejects.toThrow(
      status === 503 ? "catalog_http_failure" : "catalog_too_large",
    );
    await expect(
      Promise.race([
        disconnected.then(() => "closed"),
        new Promise<string>((resolve) => {
          const timer = setTimeout(() => resolve("still_open"), 500);
          timer.unref();
        }),
      ]),
    ).resolves.toBe("closed");
    healthy = true;
    await expect(
      fetchPublicCatalog("https://models.dev/api.json", fetchLocal, policy),
    ).resolves.toEqual({ recovered: true });
  },
);

it("does not wait forever for an uncooperative oversized-body cancellation", async () => {
  let cancelStarted = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2048));
    },
    cancel() {
      cancelStarted = true;
      return pending;
    },
  });
  let signal: AbortSignal | null | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    signal = init?.signal;
    return new Response(stream);
  };
  try {
    await expect(
      fetchPublicCatalog("https://models.dev/api.json", fetchImpl, {
        ...publicCatalogPolicy,
        maxBytes: 1024,
      }),
    ).rejects.toThrow("catalog_too_large");
    expect(cancelStarted).toBe(true);
    expect(signal?.aborted).toBe(true);
  } finally {
    release();
  }
});
