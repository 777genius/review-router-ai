import { appendFileSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Qualification preload, not a replacement parser. Throw before nextLoad reads
// or initializes a legacy implementation, for both import() and require().
const auditPath = process.env.REVIEWROUTER_NATIVE_FORMAT_AUDIT;
const checkedPackages = new Map<string, string>();

function record(event: string, details: Record<string, string>): void {
  if (auditPath) {
    appendFileSync(
      auditPath,
      JSON.stringify({ event, pid: process.pid, ...details }) + "\n",
    );
  }
}

function block(url: string, reason: string): never {
  record("blocked-before-initialization", { url, reason });
  throw new Error("legacy_typescript_module_blocked: " + reason + ": " + url);
}

function checkedTypeScriptVersion(packageRoot: string, url: string): string {
  const cached = checkedPackages.get(packageRoot);
  if (cached) return cached;
  const manifest: unknown = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    manifest.name !== "typescript" ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    block(url, "unverified TypeScript package identity");
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
  if (!match) block(url, "unverified TypeScript version " + manifest.version);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major < 7 || (major === 7 && minor === 0 && patch < 2)) {
    block(url, "TypeScript " + manifest.version + " is older than 7.0.2");
  }
  checkedPackages.set(packageRoot, manifest.version);
  return manifest.version;
}

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) {
      const path = fileURLToPath(url).replaceAll("\\", "/");
      if (/\/prettier\/plugins\/typescript\.[cm]?js$/.test(path)) {
        block(url, "Prettier bundled legacy TypeScript parser");
      }
      const packageRoot =
        /^(.*\/node_modules\/(?:typescript|typescript-native))\/(?:lib|bin)\//.exec(
          path,
        )?.[1];
      if (packageRoot && !path.endsWith(".json")) {
        const version = checkedTypeScriptVersion(packageRoot, url);
        record("native-typescript-module", { url, version });
      }
      if (
        /\/node_modules\/(?:@prettier\/plugin-oxc|oxc-parser|@oxc-parser\/)/.test(
          path,
        ) ||
        /\/prettier\/plugins\/[^/]+\.[cm]?js$/.test(path)
      ) {
        record("formatter-module", { url });
      }
    }
    return nextLoad(url, context);
  },
});

record("guard-installed", { nodeVersion: process.version });
