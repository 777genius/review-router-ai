import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { collectFeatureLayout } from "./collect-feature-layout.ts";

const sourceRoot = "packages/features/qualification/src";

async function disposable(
  files: Readonly<Record<string, string>>,
  verify: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "rr-layout-native-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    await verify(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("native layout AST preserves type and value edges and exported implementation kinds", async () => {
  await disposable(
    {
      [`${sourceRoot}/domain/types.ts`]: "export type Thing = { value: number };",
      [`${sourceRoot}/domain/value.ts`]: "export const value = 1;",
      [`${sourceRoot}/application/use-cases/run.ts`]:
        'import type { Thing } from "../../domain/types.js";\n' +
        'import { value } from "../../domain/value.js";\n' +
        "export async function run() { return value; }\n" +
        "export const handler = () => 42;\n" +
        "export const status = 1;\n" +
        "export class Owner {}\n",
    },
    async (root) => {
      const records = await collectFeatureLayout(
        root,
        sourceRoot,
        "qualification",
      );
      assert.deepEqual(
        records.imports,
        [
          {
            from: "features/qualification/application/use-cases/run.ts",
            to: "features/qualification/domain/types.ts",
            mode: "type",
          },
          {
            from: "features/qualification/application/use-cases/run.ts",
            to: "features/qualification/domain/value.ts",
            mode: "value",
          },
        ],
      );
      assert.deepEqual(
        records.useCaseExports[
          "features/qualification/application/use-cases/run.ts"
        ],
        [
          { name: "run", kind: "function" },
          { name: "handler", kind: "function" },
          { name: "status", kind: "value" },
          { name: "Owner", kind: "value" },
        ],
      );
      assert.equal(records.files.length, 3);
    },
  );
});

test("native layout AST keeps the rejecting function-property port rule", async () => {
  await disposable(
    {
      [`${sourceRoot}/application/ports/repo.ts`]:
        "export interface Repository { read(): Promise<string> }",
    },
    async (root) => {
      await assert.rejects(
        collectFeatureLayout(root, sourceRoot, "qualification"),
        /feature_port_requires_function_property/,
      );
    },
  );
});

test("native layout AST rejects oversized maintained source", async () => {
  await disposable(
    {
      [`${sourceRoot}/domain/huge.ts`]: Array(301)
        .fill("// unchanged line")
        .join("\n"),
    },
    async (root) => {
      await assert.rejects(
        collectFeatureLayout(root, sourceRoot, "qualification"),
        /feature_source_size/,
      );
    },
  );
});

test("native layout AST does not infer imports from commented source text", async () => {
  await disposable(
    {
      [`${sourceRoot}/domain/notes.ts`]:
        '// import "@forbidden/package";\nexport const note = "import \'other\'";',
    },
    async (root) => {
      const records = await collectFeatureLayout(
        root,
        sourceRoot,
        "qualification",
      );
      assert.deepEqual(records.imports, []);
    },
  );
});
