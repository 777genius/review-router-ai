/** Test-only compiler settings; real product routes, auth and readers run unchanged. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installLowMemoryNextConfig } from "../lib/next-browser-test-compiler.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const appDir = resolve(root, "apps/web");
const port = Number(process.argv[2]);
const distDir = process.argv[3] ?? "";
assert(Number.isInteger(port) && port > 0 && port < 65536);
assert(
  isAbsolute(distDir) &&
    resolve(distDir).startsWith(resolve(root, "tmp/statistics-e2e") + "/"),
  "Test build output must stay in the owned evidence directory",
);
installLowMemoryNextConfig({
  distDir: relative(appDir, resolve(distDir, "dev")),
  onApplied(isServer) {
    console.log(
      "Applied test compiler configuration",
      JSON.stringify({
        cache: false,
        debuggerSourceMaps: false,
        distDir,
        target: isServer ? "server" : "client",
      }),
    );
  },
});
const { default: next } = await import("next");
const app = next({
  dev: true,
  webpack: true,
  hostname: "127.0.0.1",
  port,
  dir: appDir,
});
await app.prepare();
const server = createServer((request, response) => {
  if (
    request.url?.startsWith("/dashboard") ||
    request.url?.startsWith("/api/dashboard/review-statistics") ||
    request.url?.startsWith("/api/dashboard/review-history") ||
    request.url?.startsWith("/api/dashboard/provider-usage")
  ) {
    response.once("finish", () => {
      global.gc?.();
      console.log(
        "Test-only post-response GC",
        JSON.stringify(process.memoryUsage()),
      );
    });
  }
  void app.getRequestHandler()(request, response);
});
// NextCustomServer installs its own upgrade listener on the first HTTP request.
await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
console.log(`Statistics test Next server ready on 127.0.0.1:${port}`);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close();
    void app.close().finally(() => process.exit(0));
  });
}
