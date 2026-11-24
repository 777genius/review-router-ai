import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants.js";
import type {
  NextConfigComplete,
  WebpackConfigContext,
} from "next/dist/server/config-shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  installLowMemoryNextConfig,
  withLowMemoryWebpack,
} from "./next-browser-test-compiler.ts";

const require = createRequire(import.meta.url);
const configPath = require.resolve("next/dist/server/config");
function nextConfigModule(): typeof import("next/dist/server/config") {
  return require(configPath);
}

let directory: string;
let config: NextConfigComplete;
const customConfig = {
  distDir: ".next-original",
  serverExternalPackages: ["original-external-package"],
  transpilePackages: ["original-workspace-package"],
  experimental: { webpackMemoryOptimizations: false },
};
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "next-browser-test-compiler-"));
  config = await nextConfigModule().default(
    PHASE_DEVELOPMENT_SERVER,
    directory,
    { customConfig },
  );
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function contextFor(
  nextConfig: NextConfigComplete,
  isServer: boolean,
): WebpackConfigContext {
  return {
    dir: directory,
    dev: true,
    isServer,
    buildId: "test-build",
    config: nextConfig,
    defaultLoaders: { babel: {} },
    totalPages: 1,
    webpack: {},
  };
}

class EvalSourceMapDevToolPlugin {}
class ProductPlugin {}

describe("development E2E compiler profile", () => {
  it("preserves the loaded config, including its output and experimental settings", () => {
    const original = Object.freeze({
      ...config,
      experimental: Object.freeze({ ...config.experimental }),
    });
    const transformed = withLowMemoryWebpack(original);
    const { webpack, experimental, ...rest } = transformed;
    const {
      webpack: originalWebpack,
      experimental: originalExperimental,
      ...originalRest
    } = original;
    expect(rest).toEqual(originalRest);
    // The genuine development loader appends /dev before the profile runs.
    expect(transformed.distDir).toBe(".next-original/dev");
    expect(webpack).toBeTypeOf("function");
    expect(originalWebpack).toBeNull();
    expect(experimental).toEqual({
      ...originalExperimental,
      webpackMemoryOptimizations: true,
    });
    expect(originalExperimental.webpackMemoryOptimizations).toBe(false);
  });

  it("changes the output only when the caller supplies its owned directory", () => {
    const transformed = withLowMemoryWebpack(config, {
      distDir: "../../tmp/statistics-e2e/owned/dev",
    });
    expect(transformed.distDir).toBe("../../tmp/statistics-e2e/owned/dev");
    expect(config.distDir).toBe(".next-original/dev");
  });

  it.each([true, false])(
    "retains the original hook result and non-debug plugins (server=%s)",
    (isServer) => {
      const first = new ProductPlugin();
      const last = new ProductPlugin();
      const functionPlugin = () => {};
      const plugins = Object.freeze([
        first,
        false,
        new EvalSourceMapDevToolPlugin(),
        null,
        functionPlugin,
        last,
      ]);
      const originalResult = {
        cache: { type: "filesystem" },
        plugins,
        resolve: { alias: { product: "./original-product" } },
        module: { rules: [{ test: /product/, loader: "product-loader" }] },
      };
      const originalWebpack = vi.fn(() => originalResult);
      const onApplied = vi.fn();
      const transformed = withLowMemoryWebpack(
        { ...config, webpack: originalWebpack },
        { onApplied },
      );
      const input = { cache: { type: "memory" }, plugins: [first] };
      const context = contextFor(transformed, isServer);
      assert(transformed.webpack);
      const result = transformed.webpack(input, context);
      expect(originalWebpack).toHaveBeenCalledExactlyOnceWith(input, context);
      expect(result).toBe(originalResult);
      expect(result.cache).toBe(false);
      expect(result.plugins).toEqual([
        first,
        false,
        null,
        functionPlugin,
        last,
      ]);
      expect(result.resolve.alias.product).toBe("./original-product");
      expect(result.module.rules).toEqual([
        { test: /product/, loader: "product-loader" },
      ]);
      expect(input).toEqual({ cache: { type: "memory" }, plugins: [first] });
      expect(plugins).toHaveLength(6);
      expect(onApplied).toHaveBeenCalledExactlyOnceWith(isServer);
    },
  );

  it("handles a config without an existing hook or plugins", () => {
    const transformed = withLowMemoryWebpack(config);
    const input = { name: "original-compiler" };
    assert(transformed.webpack);
    expect(transformed.webpack(input, contextFor(transformed, false))).toEqual({
      name: "original-compiler",
      cache: false,
      plugins: [],
    });
  });

  it("delegates to the genuine loader, keeps its other exports, and rejects production", async () => {
    const cachedModule = require.cache[configPath];
    assert(cachedModule);
    const original = nextConfigModule();
    try {
      installLowMemoryNextConfig();
      const wrapped = nextConfigModule();
      expect(wrapped.normalizeConfig).toBe(original.normalizeConfig);
      const loaded = await wrapped.default(
        PHASE_DEVELOPMENT_SERVER,
        directory,
        {
          customConfig,
        },
      );
      expect(loaded.serverExternalPackages).toEqual(
        config.serverExternalPackages,
      );
      expect(loaded.distDir).toBe(config.distDir);
      expect(loaded.experimental.webpackMemoryOptimizations).toBe(true);
      await expect(
        wrapped.default(PHASE_PRODUCTION_BUILD, directory),
      ).rejects.toThrow("requires the development server");
    } finally {
      cachedModule.exports = original;
    }
    expect(nextConfigModule()).toBe(original);
  });
});
