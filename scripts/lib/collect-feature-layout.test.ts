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
      [`${sourceRoot}/domain/types.ts`]:
        "export type Thing = { value: number };",
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
      assert.deepEqual(records.imports, [
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
      ]);
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

test("native layout AST retains exported ambient functions without inventing type-only exports", async () => {
  await disposable(
    {
      [`${sourceRoot}/application/use-cases/read.ts`]:
        "declare function hidden(): void;\n" +
        "export declare function read(id: string): Promise<string>;\n" +
        "export type Result = string;\n" +
        "export interface Options { readonly id: string }\n",
    },
    async (root) => {
      const records = await collectFeatureLayout(
        root,
        sourceRoot,
        "qualification",
      );
      assert.deepEqual(
        records.useCaseExports[
          "features/qualification/application/use-cases/read.ts"
        ],
        [{ name: "read", kind: "function" }],
      );
    },
  );
});

test("native layout AST preserves every exported overload declaration in source order", async () => {
  await disposable(
    {
      [`${sourceRoot}/application/use-cases/select.ts`]:
        "export function select(id: string): string;\n" +
        "export function select(id: number): number;\n" +
        "export function select(id: string | number) { return id; }\n",
    },
    async (root) => {
      const records = await collectFeatureLayout(
        root,
        sourceRoot,
        "qualification",
      );
      assert.deepEqual(
        records.useCaseExports[
          "features/qualification/application/use-cases/select.ts"
        ],
        [
          { name: "select", kind: "function" },
          { name: "select", kind: "function" },
          { name: "select", kind: "function" },
        ],
      );
    },
  );
});

test.each([
  ["{ run, label }", "{ run: () => number; label: string }", ""],
  ["[run, label]", "readonly [() => number, string]", ""],
  [
    "{ run /* retained */ }",
    "{ run: () => number; label: string }",
    " /* trailing } ] */ /* another */\n// line comment } ]\n ",
  ],
  [
    "[run /* retained */]",
    "readonly [() => number, string]",
    " /* trailing } ] */ /* another */\n// line comment } ]\n ",
  ],
] as const)(
  "native layout AST keeps the binding-pattern name without its annotation: %s",
  async (pattern, type, trivia) => {
    await disposable(
      {
        [`${sourceRoot}/application/use-cases/bind.ts`]:
          `type Bindings = ${type};\n` +
          "declare const source: Bindings;\n" +
          `export const ${pattern}${trivia}: Bindings = source;\n`,
      },
      async (root) => {
        const records = await collectFeatureLayout(
          root,
          sourceRoot,
          "qualification",
        );
        assert.deepEqual(
          records.useCaseExports[
            "features/qualification/application/use-cases/bind.ts"
          ],
          [{ name: pattern, kind: "value" }],
        );
      },
    );
  },
);

test.each([
  ["(() => 42)", "value"],
  ["(function named() { return 42; })", "value"],
  ["() => 42", "function"],
  ["function named() { return 42; }", "function"],
] as const)(
  "native layout AST preserves the syntax-specific initializer kind: %s",
  async (initializer, kind) => {
    await disposable(
      {
        [`${sourceRoot}/application/use-cases/run.ts`]: `export const run = ${initializer};\n`,
      },
      async (root) => {
        const records = await collectFeatureLayout(
          root,
          sourceRoot,
          "qualification",
        );
        assert.deepEqual(
          records.useCaseExports[
            "features/qualification/application/use-cases/run.ts"
          ],
          [{ name: "run", kind }],
        );
      },
    );
  },
);
