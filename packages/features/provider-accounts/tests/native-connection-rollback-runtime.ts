/** Byte and resolution boundary for the disposable compatible-floor reader. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { readFile, readdir, realpath } from "node:fs/promises";
import { registerHooks } from "node:module";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const compatibleReader = "38eb54a1706658fc005eba99d5c774c50005df90";
// The complete generated client from the already qualified floor reader, not
// merely a schema hash. All 16 files include package imports and WASM assets.
export const admittedGeneratedClientSHA256 =
  "f5751d0ebd2fd8c3f792d90c1b3b79290db738f084c5be2991b99a5520b3ea1a";
export const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function equalBytes(
  actual: Uint8Array | string,
  expected: Uint8Array | string,
  label: string,
) {
  const actualBytes = typeof actual === "string" ? Buffer.from(actual) : actual;
  const expectedBytes =
    typeof expected === "string" ? Buffer.from(expected) : expected;
  assert.ok(
    Buffer.from(actualBytes).equals(expectedBytes),
    `${label}: actual SHA256 ${digest(actual)}, expected SHA256 ${digest(expected)}`,
  );
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  assert.equal(typeof encoded, "string");
  return encoded;
}

export async function packageFiles(root: string): Promise<[string, string][]> {
  const files: [string, string][] = [];
  async function visit(directory: string) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    )) {
      // Only this package's dependency links are checked separately. Nested
      // directories and assets remain part of the complete byte inventory.
      if (directory === root && item.name === "node_modules") continue;
      const file = join(directory, item.name);
      if (item.isDirectory()) await visit(file);
      else {
        assert.ok(item.isFile(), "reader package files must be regular files");
        files.push([relative(root, file), digest(await readFile(file))]);
      }
    }
  }
  await visit(root);
  return files;
}

export type ReaderPackage = {
  key: string;
  name: string;
  version: string;
  root: string;
  treeSHA256: string;
  links: Record<string, string>;
};
export type ReaderRuntime = {
  contract: "rr-native-reader-runtime/v1";
  readerSHA: string;
  root: string;
  oldLockSHA256: string;
  currentLockSHA256: string;
  selectedClosureSHA256: string;
  packages: ReaderPackage[];
  generated: Omit<ReaderPackage, "key" | "name" | "version">;
  client: string;
  adapter: string;
};

async function dependencyLinks(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const modules = join(root, "node_modules");
  async function visit(directory: string, scope = "") {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      },
    );
    for (const item of entries) {
      const name = scope + item.name;
      const path = join(directory, item.name);
      if (item.isSymbolicLink()) result[name] = await realpath(path);
      else {
        assert.ok(
          item.isDirectory() &&
            scope === "" &&
            (item.name.startsWith("@") || item.name === ".prisma"),
          "reader dependency directories must contain only admitted links",
        );
        await visit(path, `${item.name}/`);
      }
    }
  }
  await visit(modules);
  return result;
}

export async function verifyReaderRuntime(runtime: ReaderRuntime) {
  assert.equal(runtime.contract, "rr-native-reader-runtime/v1");
  assert.equal(runtime.readerSHA, compatibleReader);
  assert.equal(runtime.packages.length, 23);
  assert.equal(await realpath(runtime.root), runtime.root);
  const packages = [...runtime.packages, runtime.generated];
  const roots = new Set(packages.map((item) => item.root));
  assert.equal(roots.size, 24);
  const files = new Map<string, string>();
  for (const item of packages) {
    assert.ok(
      isAbsolute(item.root) && item.root.startsWith(runtime.root + "/"),
    );
    assert.equal(await realpath(item.root), item.root);
    const inventory = await packageFiles(item.root);
    assert.equal(digest(JSON.stringify(inventory)), item.treeSHA256);
    equalBytes(
      canonical(await dependencyLinks(item.root)),
      canonical(item.links),
      "isolated reader dependency links",
    );
    for (const target of Object.values(item.links))
      assert.ok(
        roots.has(target),
        "reader dependency link escapes admitted roots",
      );
    for (const [path, sha256] of inventory)
      files.set(join(item.root, path), sha256);
  }
  assert.equal(runtime.generated.treeSHA256, admittedGeneratedClientSHA256);
  for (const entry of [runtime.client, runtime.adapter]) {
    assert.ok(
      files.has(entry),
      "reader entry must be an inventoried copied file",
    );
    assert.equal(await realpath(entry), entry);
  }
  return files;
}

/** Register after harness preparation and before dynamic reader imports. Both
 * ESM import and CommonJS require are covered by Node's synchronous hooks. */
export function restrictReaderImports(
  files: ReadonlyMap<string, string>,
  bundle: string,
  bundleSHA256: string,
) {
  const allowed = new Map(files);
  allowed.set(bundle, bundleSHA256);
  const observed = new Set<string>();
  function check(url: string) {
    if (url.startsWith("node:")) return;
    assert.ok(url.startsWith("file:"), "reader cannot load non-file modules");
    const file = fileURLToPath(url);
    assert.equal(realpathSync(file), file);
    const expected = allowed.get(file);
    assert.ok(
      expected,
      "reader module escaped the copied runtime and old bundle",
    );
    assert.equal(
      digest(readFileSync(file)),
      expected,
      "reader module bytes changed",
    );
    observed.add(file);
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      check(result.url);
      return result;
    },
    load(url, context, nextLoad) {
      check(url);
      return nextLoad(url, context);
    },
  });
  return { observed, close: () => hooks.deregister() };
}
