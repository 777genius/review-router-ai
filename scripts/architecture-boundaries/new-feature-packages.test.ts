import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkNewFeaturePackageCompositions } from "./new-feature-packages.ts";
import type { ArchitectureViolation } from "./types.ts";

const roots: string[] = [];
const core = "0.8.0";
const conformance = "0.5.2";
const prefix = "packages/features/new-feature";
const descriptorReason =
  "New feature packages must compose through the Get Modular Assembly descriptors";
const testReason =
  "New feature packages require an active Vitest composition test using Get Modular Conformance";
const validManifest = {
  name: "@reviewrouter/features-new",
  private: true,
  dependencies: {
    "@get-modular/core": core,
    "@get-modular/assembly": core,
  },
  devDependencies: { "@get-modular/conformance": conformance },
  exports: {
    ".": "./src/index.ts",
    "./composition": "./src/composition/root.ts",
  },
};
const declaration = [
  "import { declareModule } from '@get-modular/assembly';",
  "export const item = declareModule({",
  "  moduleId: 'reviewrouter/new', implementationId: 'reviewrouter/new/default',",
  "  owner: { authority: 'reviewrouter', path: ['new'] }, provides: [], slots: [],",
  "});",
  "",
].join("\n");
const regression = [
  "import { it } from 'vitest';",
  "import { checkNamespaces } from '@get-modular/conformance';",
  "import { item } from './root.ts';",
  "it('composition', () => { checkNamespaces({ namespace: 'reviewrouter', declarations: [item] }); });",
  "",
].join("\n");

function put(root: string, name: string, source: string): void {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function fixture(
  legacyFeaturePackages: readonly string[] = ["legacy"],
): string {
  const root = mkdtempSync(join(tmpdir(), "reviewrouter-modular-default-"));
  roots.push(root);
  put(root, "package.json", JSON.stringify(validManifest));
  put(
    root,
    "architecture/consumer-module-standard/legacy-feature-packages.json",
    JSON.stringify({ schemaVersion: 1, legacyFeaturePackages }),
  );
  put(
    root,
    "architecture/foundation/provider-seams.yaml",
    "schemaVersion: 1\ngovernedRoots:\n  - packages/features/new-feature/src\n",
  );
  return root;
}

function newPackage(root: string, manifest: unknown = validManifest): void {
  put(root, prefix + "/package.json", JSON.stringify(manifest));
  put(root, prefix + "/src/index.ts", "export const name = 'new';\n");
}

function completePackage(root: string): void {
  newPackage(root);
  put(root, prefix + "/src/composition/root.ts", declaration);
  put(root, prefix + "/src/composition/root.test.ts", regression);
}

async function reasons(root: string): Promise<string[]> {
  const result: ArchitectureViolation[] = [];
  await checkNewFeaturePackageCompositions(root, result);
  return result.map(({ reason }) => reason);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Get Modular default for new feature packages", () => {
  it("keeps explicitly listed legacy packages out of the migration gate", async () => {
    const root = fixture();
    put(root, "packages/features/legacy/src/index.ts", "export {};\n");
    expect(await reasons(root)).toEqual([]);
  });

  it("rejects a new package without a production composition", async () => {
    const root = fixture();
    newPackage(root);
    expect(await reasons(root)).toContain(
      "New feature packages require production source under src/composition/",
    );
  });

  it("requires root-pinned dependencies and a separate export", async () => {
    const root = fixture();
    completePackage(root);
    newPackage(root, {
      ...validManifest,
      dependencies: {},
      devDependencies: {},
      exports: { ".": "./src/index.ts" },
    });
    expect(await reasons(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Core and Assembly"),
        expect.stringContaining("Conformance"),
        expect.stringContaining("./composition"),
      ]),
    );
  });

  it.each([
    null,
    "./src/index.ts",
    "./src/composition/missing.ts",
    { types: "./src/composition/root.ts" },
    { production: null, default: "./src/composition/root.ts" },
    { import: null, default: "./src/composition/root.ts" },
    { import: "./src/composition/root.ts", default: null },
    { node: { import: null }, default: "./src/composition/root.ts" },
  ])("rejects a missing or blocked runtime composition export: %j", async (target) => {
    const root = fixture();
    completePackage(root);
    newPackage(root, {
      ...validManifest,
      exports: { ...validManifest.exports, "./composition": target },
    });
    expect(await reasons(root)).toContainEqual(
      expect.stringContaining("./composition entrypoint"),
    );
  });

  it.each([
    "export const create = () => ({});",
    "import { declareModule } from '@get-modular/assembly'; // declareModule({})",
    "import { declareModule } from '@get-modular/assembly'; export const text = 'declareModule({})';",
    "import type { declareModule } from '@get-modular/assembly'; declareModule({});",
    "import { type declareModule } from '@get-modular/assembly'; declareModule({});",
    "import { group } from '@get-modular/assembly'; const declareModule = () => ({}); declareModule();",
    "import { declareModule as descriptor } from '@get-modular/assembly'; declareModule({});",
    "import { declareModule } from '@get-modular/assembly'; declareModule({",
    "import { declareModule } from '@get-modular/assembly'; export function root(declareModule: () => object) { return declareModule(); }",
    "import { declareModule } from '@get-modular/assembly'; export function root() { const declareModule = () => ({}); return declareModule(); }",
    "import * as assembly from '@get-modular/assembly'; export function root({ assembly }: { assembly: { declareModule: () => object } }) { return assembly.declareModule(); }",
  ])("rejects decorative, shadowed or invalid descriptor source: %s", async (source) => {
    const root = fixture();
    completePackage(root);
    put(root, prefix + "/src/composition/root.ts", source);
    expect(await reasons(root)).toContain(descriptorReason);
  });

  it("ignores real declarations disconnected from the composition export", async () => {
    const root = fixture();
    completePackage(root);
    put(root, prefix + "/src/composition/root.ts", "export const item = {};\n");
    put(root, prefix + "/src/composition/unused.ts", declaration);
    expect(await reasons(root)).toContain(descriptorReason);
  });

  it.each([
    "import type { item } from './unused.ts'; export type Item = typeof item;",
    "export type { item } from './unused.ts';",
    "export { type item } from './unused.ts';",
  ])("ignores declarations reached only through type edges", async (source) => {
    const root = fixture();
    completePackage(root);
    put(root, prefix + "/src/composition/root.ts", source);
    put(root, prefix + "/src/composition/unused.ts", declaration);
    expect(await reasons(root)).toContain(descriptorReason);
  });

  it.each([
    "export {};",
    "import { it } from 'vitest'; it('unrelated', () => {});",
    regression.replace("it('composition'", "it.skip('composition'"),
    regression.replace("import { checkNamespaces }", "import type { checkNamespaces }"),
    regression.replace("import { item }", "import type { item }"),
    regression.replace(
      "checkNamespaces({ namespace: 'reviewrouter', declarations: [item] });",
      "void item;",
    ),
    regression.replace(
      "() => { checkNamespaces",
      "() => { const checkNamespaces = (...values: unknown[]) => values; checkNamespaces",
    ),
    regression.replace(
      "it('composition'",
      "function fake(it: (...values: unknown[]) => void) { it('composition'",
    ) + "}\n",
    regression.replace(
      "() => { checkNamespaces",
      "() => { const item = {}; checkNamespaces",
    ),
  ])("requires an active conformance regression using composition: %s", async (source) => {
    const root = fixture();
    completePackage(root);
    put(root, prefix + "/src/composition/root.test.ts", source);
    expect(await reasons(root)).toContain(testReason);
  });

  it.each([
    "describe.skip",
    "describe.skip.each([1])",
    "describe.concurrent.skip",
    "describe.skipIf(true).each([1])",
  ])("rejects conformance tests inside %s", async (suite) => {
    const root = fixture();
    completePackage(root);
    const source = regression
      .replace("import { it }", "import { it, describe }")
      .replace("it('composition'", suite + "('suite', () => { it('composition'") +
      "});\n";
    put(root, prefix + "/src/composition/root.test.ts", source);
    expect(await reasons(root)).toContain(testReason);
  });

  it.each(["root.spec.ts", "root.test.mts", "root.test.cts"])(
    "rejects tests outside package Vitest include patterns: %s",
    async (name) => {
      const root = fixture();
      completePackage(root);
      rmSync(join(root, prefix + "/src/composition/root.test.ts"));
      put(root, prefix + "/src/composition/" + name, regression);
      expect(await reasons(root)).toContain(testReason);
    },
  );

  it.each([
    declaration,
    declaration + "export type Callback = (declareModule: string) => void;\n",
    declaration
      .replace("{ declareModule }", "{ declareModule as module }")
      .replace("= declareModule(", "= module("),
    declaration
      .replace("{ declareModule }", "* as assembly")
      .replace("= declareModule(", "= assembly.declareModule("),
  ])("accepts direct, aliased and namespace descriptor calls", async (source) => {
    const root = fixture();
    completePackage(root);
    put(root, prefix + "/src/composition/root.ts", source);
    expect(await reasons(root)).toEqual([]);
  });

  it("follows runtime re-exports and server-only package conditions", async () => {
    const root = fixture();
    completePackage(root);
    put(
      root,
      prefix + "/src/composition/root.ts",
      "export { item } from './module.js';\n",
    );
    put(root, prefix + "/src/composition/module.ts", declaration);
    newPackage(root, {
      ...validManifest,
      exports: {
        ...validManifest.exports,
        "./composition": {
          types: "./src/composition/root.ts",
          browser: null,
          require: null,
          production: "./dist/composition/root.js",
          default: "./src/composition/root.ts",
        },
      },
    });
    expect(await reasons(root)).toEqual([]);
  });

  it("rejects new packages omitted from Foundation source governance", async () => {
    const root = fixture();
    completePackage(root);
    put(
      root,
      "architecture/foundation/provider-seams.yaml",
      "schemaVersion: 1\ngovernedRoots: []\n",
    );
    expect(await reasons(root)).toContain(
      "New feature packages must be covered by Engineering Foundation source dependencies",
    );
  });

  it("rejects duplicate legacy baseline entries", async () => {
    const root = fixture(["legacy", "legacy"]);
    newPackage(root);
    await expect(reasons(root)).rejects.toThrow(
      "invalid_legacy_feature_package_policy",
    );
  });

  it("rejects unpinned root dependency ranges", async () => {
    const root = fixture();
    completePackage(root);
    put(
      root,
      "package.json",
      JSON.stringify({
        ...validManifest,
        dependencies: {
          ...validManifest.dependencies,
          "@get-modular/core": "^0.8.0",
        },
      }),
    );
    await expect(reasons(root)).rejects.toThrow("get_modular_root_pins_missing");
  });

  it("enforces admission through the real architecture CLI", () => {
    const root = fixture();
    completePackage(root);
    const run = () =>
      execFileSync(
        process.execPath,
        [resolve("scripts/check-architecture-boundaries.mjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, REVIEWROUTER_ARCHITECTURE_ROOT: root },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    expect(run()).toContain("Architecture boundary check passed");
    put(root, prefix + "/src/composition/root.ts", "export const item = {};\n");
    expect(run).toThrow(/Get Modular Assembly descriptors/);
  });
});
