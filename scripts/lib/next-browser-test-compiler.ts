/** Shared compiler-only settings for explicitly selected development E2E runs. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import type { NextConfigComplete } from "next/dist/server/config-shared.js";

export interface LowMemoryNextConfigOptions {
  readonly distDir?: string;
  readonly onApplied?: (isServer: boolean) => void;
}

export function withLowMemoryWebpack(
  config: NextConfigComplete,
  options: LowMemoryNextConfigOptions = {},
): NextConfigComplete {
  const originalWebpack = config.webpack;
  return {
    ...config,
    ...(options.distDir === undefined ? {} : { distDir: options.distDir }),
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
      options.onApplied?.(context.isServer);
      return result;
    },
  };
}

export function installLowMemoryNextConfig(
  options: LowMemoryNextConfigOptions = {},
): void {
  // Next's custom server does not forward options.conf to its router server.
  // Wrap the genuine loader before Next captures it; the CLI and its restart
  // watcher keep their ordinary lifecycle in CLI-based E2E runs.
  const require = createRequire(import.meta.url);
  const configPath = require.resolve("next/dist/server/config.js");
  const configModule: typeof import("next/dist/server/config.js") = require(
    configPath,
  );
  const originalLoadConfig = configModule.default;
  const wrappedLoadConfig: typeof originalLoadConfig = async (...args) => {
    assert.equal(
      args[0],
      PHASE_DEVELOPMENT_SERVER,
      "The low-memory E2E compiler profile requires the development server",
    );
    return withLowMemoryWebpack(await originalLoadConfig(...args), options);
  };
  const replacement = { ...configModule, default: wrappedLoadConfig };
  Object.defineProperty(replacement, "__esModule", { value: true });
  const cachedModule = require.cache[configPath];
  assert(
    cachedModule,
    "Next config loader must be present in the module cache",
  );
  cachedModule.exports = replacement;
}
