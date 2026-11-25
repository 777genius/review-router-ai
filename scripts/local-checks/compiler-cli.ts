import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from this repository, never from cwd or the colliding tsc PATH bins.
export function compilerInvocation() {
  // Keep the alias in its existing isolated install: both packages expose "tsc".
  const require = createRequire(
    new URL("./native/package.json", import.meta.url),
  );
  const manifestPath = require.resolve("typescript-native/package.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    !isRecord(manifest) ||
    manifest.name !== "typescript" ||
    manifest.version !== "7.0.2" ||
    !isRecord(manifest.bin) ||
    typeof manifest.bin.tsc !== "string" ||
    manifest.bin.tsc.length === 0
  ) {
    throw new Error(
      "typescript-native must resolve to typescript@7.0.2 with a tsc entry",
    );
  }
  return {
    command: process.execPath,
    args: [resolve(dirname(manifestPath), manifest.bin.tsc)],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--legacy")) {
      throw new Error("legacy_compiler_disabled: use native TypeScript 7.0.2");
    }
    if (args[0] === "--native") args.shift();
    const invocation = compilerInvocation();
    const result = spawnSync(
      invocation.command,
      [...invocation.args, ...args],
      {
        cwd: process.cwd(),
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.signal)
      throw new Error(`compiler terminated by ${result.signal}`);
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
