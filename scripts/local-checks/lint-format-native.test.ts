import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { formatCases } from "./lint-format-fixtures.ts";
import { nativeFormatCases } from "./lint-format-native-fixtures.ts";
import { format } from "./lint-format-native.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const guard = new URL("./lint-format-native-load-guard.ts", import.meta.url)
  .href;
const plugin = new URL("./lint-format-native.ts", import.meta.url).href;
const require = createRequire(import.meta.url);
const prettierCli = require.resolve("prettier/bin/prettier.cjs");

function runNode(args: string[], input?: string, cwd = root) {
  return spawnSync(process.execPath, ["--import", guard, ...args], {
    cwd,
    encoding: "utf8",
    input,
    env: { ...process.env, PRETTIER_DEBUG: "1" },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
}

describe("native Prettier public API", () => {
  test.each([...formatCases, ...nativeFormatCases])(
    "$path preserves its independent golden and is idempotent",
    async ({ path, input, expected }) => {
      expect(await format(input, { filepath: path })).toBe(expected);
      expect(await format(expected, { filepath: path })).toBe(expected);
    },
  );

  test("supports the generator's explicit TypeScript parser without a filepath", async () => {
    expect(
      await format("export const value:number=1\n", { parser: "typescript" }),
    ).toBe("export const value: number = 1;\n");
  });

  test.each(["ts", "mts", "cts", "tsx"])(
    "rejects genuinely malformed %s source",
    async (extension) => {
      await expect(
        format("export const value: = 1;\n", {
          filepath: "malformed." + extension,
        }),
      ).rejects.toThrow();
    },
  );
});

describe("actual Prettier CLI and configuration", () => {
  test("the unchanged root config rejects unformatted TS and accepts its golden", () => {
    const args = [
      prettierCli,
      "--check",
      "--stdin-filepath",
      "native-example.ts",
    ];
    const unformatted = runNode(args, "export const value:number=1\n");
    expect(unformatted.error).toBeUndefined();
    expect(unformatted.status, unformatted.stderr).toBe(1);
    const formatted = runNode(args, "export const value: number = 1;\n");
    expect(formatted.error).toBeUndefined();
    expect(formatted.status, formatted.stderr).toBe(0);
  });

  test.each([
    ["malformed.md", "```ts\nexport const value: = 1;\n```\n"],
    [
      "malformed.html",
      '<script type="application/x-typescript">export const value: = 1;</script>\n',
    ],
  ])(
    "debug qualification rejects malformed embedded source in %s",
    (path, input) => {
      const result = runNode([prettierCli, "--stdin-filepath", path], input);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).not.toContain("legacy_typescript_module_blocked");
    },
  );

  test("keeps ignored generated/vendor files while formatting an included file", async () => {
    await mkdir(join(root, "tmp"), { recursive: true });
    const subject = await mkdtemp(join(root, "tmp/native-prettier-ignore-"));
    const ignored = [
      "dist/ignored.ts",
      "action-dist/ignored.ts",
      "deploy/self-hosted/conversation-verifier.mjs",
      "ai-docs/design/impeccable/reference/ignored.ts",
      "packages/features/hosted-account-pool/src/ignored.js",
    ];
    const unformatted = "const untouched={value:1}\n";
    try {
      await Promise.all(
        [".gitignore", ".prettierignore"].map((name) =>
          copyFile(join(root, name), join(subject, name)),
        ),
      );
      await writeFile(
        join(subject, ".prettierrc.json"),
        JSON.stringify({ plugins: [plugin] }),
      );
      for (const path of ignored) {
        await mkdir(dirname(join(subject, path)), { recursive: true });
        await writeFile(join(subject, path), unformatted);
      }
      await writeFile(join(subject, "included.ts"), unformatted);
      const result = runNode([prettierCli, "--write", "."], undefined, subject);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(join(subject, "included.ts"), "utf8")).toBe(
        "const untouched = { value: 1 };\n",
      );
      for (const path of ignored) {
        expect(await readFile(join(subject, path), "utf8"), path).toBe(
          unformatted,
        );
      }
    } finally {
      await rm(subject, { recursive: true, force: true });
    }
  });
});

describe("legacy parser guard negative controls", () => {
  test.each([
    ["ESM", "await import('prettier/plugins/typescript')", "module"],
    ["CommonJS", "require('prettier/plugins/typescript')", "commonjs"],
  ])(
    "blocks the actual bundled parser before %s initialization",
    (_name, source, mode) => {
      const result = runNode(["--input-type=" + mode, "--eval", source]);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "legacy_typescript_module_blocked: Prettier bundled legacy TypeScript parser",
      );
    },
  );

  test("blocks a standalone legacy package before its initializer can write", async () => {
    await mkdir(join(root, "tmp"), { recursive: true });
    const subject = await mkdtemp(join(root, "tmp/native-prettier-guard-"));
    const packageRoot = join(subject, "node_modules/typescript");
    const implementation = join(packageRoot, "lib/typescript.js");
    const marker = join(subject, "initialized");
    try {
      await mkdir(dirname(implementation), { recursive: true });
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name: "typescript",
          version: "6.0.3",
          type: "commonjs",
        }),
      );
      // Deliberate CommonJS initializer fixture, not an old compiler implementation.
      await writeFile(
        implementation,
        'require("node:fs").writeFileSync(' +
          JSON.stringify(marker) +
          ', "ran");',
      );
      for (const source of [
        "await import(" +
          JSON.stringify(pathToFileURL(implementation).href) +
          ")",
        "import { createRequire } from 'node:module'; createRequire(import.meta.url)(" +
          JSON.stringify(implementation) +
          ")",
      ]) {
        const result = runNode(["--input-type=module", "--eval", source]);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("TypeScript 6.0.3 is older than 7.0.2");
        expect(existsSync(marker)).toBe(false);
      }
    } finally {
      await rm(subject, { recursive: true, force: true });
    }
  });
});
