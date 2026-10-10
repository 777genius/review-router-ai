import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from this repository, never from cwd or the colliding tsc PATH bins.
export function compilerInvocation(legacy = true) {
  // Keep the alias in a separate opt-in install: both packages expose "tsc".
  const require = createRequire(
    legacy
      ? import.meta.url
      : new URL("./native/package.json", import.meta.url),
  );
  const alias = legacy ? "typescript" : "typescript-native";
  const expected = legacy ? "6.0.3" : "7.0.2";
  const manifestPath = require.resolve(`${alias}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name: string;
    version: string;
    bin: { tsc: string };
  };
  if (manifest.name !== "typescript" || manifest.version !== expected) {
    throw new Error(`${alias} must resolve to typescript@${expected}`);
  }
  return {
    command: process.execPath,
    args: [resolve(dirname(manifestPath), manifest.bin.tsc)],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    // Native is opt-in; omitting the selector always retains the API compiler.
    const legacy = args[0] !== "--native";
    if (args[0] === "--native" || args[0] === "--legacy") args.shift();
    const invocation = compilerInvocation(legacy);
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
