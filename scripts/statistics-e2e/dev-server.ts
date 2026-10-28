/** Test-only compiler settings; real product routes, auth and readers run unchanged. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type loadConfig from "next/dist/server/config";

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
// Next16's custom server does not forward options.conf to its router server.
// Delegate to the genuine installed config loader in this child process before
// Next captures it. No product file, route or authorization handler is replaced.
const require = createRequire(import.meta.url);
const configPath = require.resolve("next/dist/server/config");
const configModule = require(configPath) as { default: typeof loadConfig };
const originalLoadConfig = configModule.default;
const wrappedLoadConfig: typeof loadConfig = async (...args) => {
  const config = await originalLoadConfig(...args);
  const originalWebpack = config.webpack;
  return {
    ...config,
    distDir: relative(appDir, resolve(distDir, "dev")),
    experimental: { ...config.experimental, webpackMemoryOptimizations: true },
    webpack(webpackConfig, context) {
      const result = originalWebpack
        ? originalWebpack(webpackConfig, context)
        : webpackConfig;
      result.cache = false;
      // Disable only debugger maps, which retain substantial compilation memory.
      result.plugins = (result.plugins ?? []).filter(
        (plugin: unknown) =>
          typeof plugin !== "object" ||
          plugin === null ||
          plugin.constructor.name !== "EvalSourceMapDevToolPlugin",
      );
      console.log(
        "Applied test compiler configuration",
        JSON.stringify({
          cache: false,
          debuggerSourceMaps: false,
          distDir,
          target: context.isServer ? "server" : "client",
        }),
      );
      return result;
    },
  };
};
const replacement = { ...configModule, default: wrappedLoadConfig };
Object.defineProperty(replacement, "__esModule", { value: true });
assert(require.cache[configPath]);
require.cache[configPath]!.exports = replacement;
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
    request.url?.startsWith("/api/dashboard/review-history")
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
