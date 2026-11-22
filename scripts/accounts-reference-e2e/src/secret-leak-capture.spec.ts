import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Browser } from "@playwright/test";
import { captureSecretLeaks } from "./tests/support.ts";

test(
  "secret response capture preserves evidence across action completion",
  { timeout: 30_000 },
  async (t) => {
    const root = fileURLToPath(new URL("../../../tmp/", import.meta.url));
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "secret-leak-capture-"));
    for (const name of [
      "next-app.log",
      "gateway-requests.jsonl",
      "runtime.json",
      "boot-report.json",
      "boot-viewer.html",
    ])
      await writeFile(join(directory, name), "");
    const previousResult = process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON;
    process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON = join(
      directory,
      "result.json",
    );

    const routes = new Map<string, (reply: ServerResponse) => void>();
    const server = createServer((request, reply) => {
      request.resume();
      const route = routes.get(request.url ?? "");
      if (route) route(reply);
      else reply.writeHead(200, { "content-type": "text/html" }).end("ready");
    });
    const owned: { browser?: Browser } = {};
    const secret = "synthetic-capture-regression-secret";
    t.after(async () => {
      await owned.browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousResult === undefined)
        delete process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON;
      else process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON = previousResult;
      await rm(directory, { recursive: true, force: true });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const executablePath =
      process.env.ACCOUNTS_REFERENCE_E2E_BROWSER_EXECUTABLE;
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    owned.browser = browser;
    for (const failRequest of [false, true]) {
      await t.test(
        failRequest
          ? "a failed POST releases drain"
          : "drain waits for a POST before its response headers arrive",
        async () => {
          const page = await browser.newPage();
          let reply: ServerResponse | undefined;
          const received = new Promise<ServerResponse>((resolve) =>
            routes.set("/action", resolve),
          );
          const leaks = captureSecretLeaks(page, [secret]);
          try {
            await page.goto(origin);
            const started = page.waitForEvent("request", (request) =>
              request.url().endsWith("/action"),
            );
            await page.evaluate(() => {
              void fetch("/action", { method: "POST" }).catch(() => {});
            });
            await started;
            reply = await received;
            let drained = false;
            const drain = leaks.drain().then(() => {
              drained = true;
            });
            await page.evaluate(() => 1);
            assert.equal(
              drained,
              false,
              "in-flight POST must reserve the drain before requestfinished",
            );
            if (failRequest) {
              const responded = page.waitForEvent("response", (response) =>
                response.url().endsWith("/action"),
              );
              const failed = page.waitForEvent("requestfailed", (request) =>
                request.url().endsWith("/action"),
              );
              // A socket closed before headers can be transparently retried.
              // Start a response, then fail its body after Chromium sees it.
              reply.writeHead(200, {
                "content-type": "application/json",
                "content-length": "11",
              });
              reply.flushHeaders();
              await responded;
              reply.destroy();
              await failed;
            } else
              reply
                .writeHead(200, { "content-type": "application/json" })
                .end('{"ok":true}');
            await drain;
            await page.reload();
            await leaks.verify();
          } finally {
            reply?.destroy();
            await page.close();
          }
        },
      );
    }

    for (const unreadable of [false, true]) {
      await t.test(
        unreadable
          ? "an unreadable completed response still fails closed"
          : "a secret in a completed response is rejected without printing it",
        async () => {
          const page = await browser.newPage();
          routes.set("/response", (reply) =>
            reply
              .writeHead(200, { "content-type": "application/json" })
              .end(JSON.stringify({ value: unreadable ? "safe" : secret })),
          );
          if (unreadable)
            page.on("response", (response) => {
              if (response.url().endsWith("/response"))
                response.text = async () => {
                  throw new Error(secret);
                };
            });
          const leaks = captureSecretLeaks(page, [secret]);
          try {
            await page.goto(origin);
            const finished = page.waitForEvent("requestfinished", (request) =>
              request.url().endsWith("/response"),
            );
            await page.evaluate(async () => {
              await (await fetch("/response")).text();
            });
            await finished;
            await assert.rejects(
              leaks.verify(),
              (error: unknown) =>
                error instanceof Error &&
                error.message.includes(
                  unreadable
                    ? "unreadable completed HTTP/SSR response"
                    : "HTTP/SSR response",
                ) &&
                !error.message.includes(secret),
            );
          } finally {
            await page.close();
          }
        },
      );
    }
  },
);
