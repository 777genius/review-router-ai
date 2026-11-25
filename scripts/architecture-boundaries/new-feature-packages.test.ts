import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkNewFeaturePackageCompositions } from "./new-feature-packages";
import type { ArchitectureViolation } from "./types";

const roots: string[] = [];
const core = "0.8.0";
const conformance = "0.5.2";
const validManifest = {
  name: "@reviewrouter/features-new",
  private: true,
  dependencies: {
    "@get-modular/core": core,
    "@get-modular/assembly": core,
  },
  devDependencies: {
    "@get-modular/conformance": conformance,
  },
  exports: {
    ".": "./src/index.ts",
    "./composition": "./src/composition/root.ts",
  },
};

function put(root: string, name: string, source: string): void {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function fixture(legacyFeaturePackages: readonly string[] = ["legacy"]): string {
  const root = mkdtempSync(join(tmpdir(), "reviewrouter-modular-default-"));
  roots.push(root);
  put(root, "package.json", JSON.stringify({
    devDependencies: {
      "@get-modular/core": core,
      "@get-modular/assembly": core,
      "@get-modular/conformance": conformance,
    },
  }));
  put(root, "architecture/consumer-module-standard/legacy-feature-packages.json",
    JSON.stringify({ schemaVersion: 1, legacyFeaturePackages }));
  return root;
}

function newPackage(root: string, manifest: unknown = validManifest): void {
  put(root, "packages/features/new-feature/package.json", JSON.stringify(manifest));
  put(root, "packages/features/new-feature/src/index.ts", "export const name = 'new';\n");
}

async function violations(root: string): Promise<ArchitectureViolation[]> {
  const result: ArchitectureViolation[] = [];
  await checkNewFeaturePackageCompositions(root, result);
  return result;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Get Modular default for new feature packages", () => {
  it("keeps existing explicitly listed feature packages out of the migration gate", async () => {
    const root = fixture();
    put(root, "packages/features/legacy/src/index.ts", "export {};\n");
    expect(await violations(root)).toEqual([]);
  });

  it("rejects a newly added package without a composition root", async () => {
    const root = fixture();
    newPackage(root);
    expect((await violations(root)).map(({ reason }) => reason)).toContain(
      "New feature packages require production source under src/composition/",
    );
  });

  it("requires pinned Core, Assembly, Conformance and a private composition export", async () => {
    const root = fixture();
    newPackage(root, {
      ...validManifest,
      dependencies: {},
      devDependencies: {},
      exports: { ".": "./src/index.ts" },
    });
    const problems = (await violations(root)).map(({ reason }) => reason);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining("Core and Assembly"),
      expect.stringContaining("Conformance"),
      expect.stringContaining("./composition"),
    ]));
  });

  it("rejects a decorative composition without Get Modular descriptors", async () => {
    const root = fixture();
    newPackage(root);
    put(root, "packages/features/new-feature/src/composition/root.ts",
      "export function create() { return {}; }\n");
    put(root, "packages/features/new-feature/src/composition/root.test.ts",
      "import { it } from 'vitest'; it('smoke', () => {});\n");
    expect((await violations(root)).map(({ reason }) => reason)).toContain(
      "New feature packages must compose through the Get Modular Assembly descriptors",
    );
  });

  it("requires an executable composition regression test", async () => {
    const root = fixture();
    newPackage(root);
    put(root, "packages/features/new-feature/src/composition/root.ts",
      "import { declareModule } from '@get-modular/assembly'; export const item = declareModule({});\n");
    expect((await violations(root)).map(({ reason }) => reason)).toContain(
      "New feature packages require a composition test executed by Vitest",
    );
  });

  it("accepts a new package with its own typed composition and test", async () => {
    const root = fixture();
    newPackage(root);
    put(root, "packages/features/new-feature/src/composition/root.ts",
      "import { declareModule } from '@get-modular/assembly'; export const item = declareModule({});\n");
    put(root, "packages/features/new-feature/src/composition/root.test.ts",
      "import { it } from 'vitest'; it('composition', () => {});\n");
    expect(await violations(root)).toEqual([]);
  });

  it("rejects edits that silently duplicate legacy baseline entries", async () => {
    const root = fixture(["legacy", "legacy"]);
    expect(() =>
      readFileSync(join(root, "architecture/consumer-module-standard/legacy-feature-packages.json"), "utf8"),
    ).not.toThrow();
    await expect(violations(root)).rejects.toThrow(
      "invalid_legacy_feature_package_policy",
    );
  });
});
