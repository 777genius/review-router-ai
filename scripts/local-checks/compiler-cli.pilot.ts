import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { compilerInvocation } from "./compiler-cli.ts";

const root = resolve(import.meta.dirname, "../..");
const scratch = mkdtempSync(join(tmpdir(), "compiler-parity-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function runBoundary(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  const started = performance.now();
  const result = spawnSync(command, [...args], options);
  const evidence = process.env.REVIEW_ROUTER_COMPILER_PROOF_LOG;
  if (evidence)
    appendFileSync(
      evidence,
      JSON.stringify({
        kind: "process",
        command,
        args,
        cwd: options.cwd ?? process.cwd(),
        exit: result.status,
        signal: result.signal,
        elapsedMs: performance.now() - started,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error?.message,
      }) + "\n",
    );
  return result;
}

function compile(legacy: boolean, cwd: string, args: string[]) {
  const invocation = compilerInvocation(legacy);
  const started = performance.now();
  const result = runBoundary(
    invocation.command,
    [...invocation.args, ...args],
    {
      cwd,
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  const evidence = process.env.REVIEW_ROUTER_COMPILER_PROOF_LOG;
  if (evidence)
    appendFileSync(
      evidence,
      JSON.stringify({
        legacy,
        cwd,
        command: invocation.command,
        args: [...invocation.args, ...args],
        exit: result.status,
        elapsedMs: performance.now() - started,
        stdout: result.stdout,
        stderr: result.stderr,
      }) + "\n",
    );
  return { status: result.status, output: result.stdout + result.stderr };
}

function project(source: string, extraOptions = {}) {
  const input = join(scratch, "input.ts");
  const config = join(scratch, "tsconfig.json");
  writeFileSync(input, source);
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(root, "tsconfig.base.json"),
      compilerOptions: { noEmit: true, types: [], ...extraOptions },
      files: [input],
      include: [],
    }),
  );
  return config;
}

// Declaration union ordering is semantically irrelevant; preserve every member.
function declarationSurface(source: string) {
  const file = ts.createSourceFile(
    "surface.d.ts",
    source,
    ts.ScriptTarget.Latest,
  );
  const printer = ts.createPrinter();
  const transformed = ts.transform(file, [
    (context) => {
      const visit: ts.Visitor = (node) => {
        const visited = ts.visitEachChild(node, visit, context);
        if (!ts.isUnionTypeNode(visited)) return visited;
        return ts.factory.updateUnionTypeNode(
          visited,
          ts.factory.createNodeArray(
            [...visited.types].sort((a, b) =>
              printer
                .printNode(ts.EmitHint.Unspecified, a, file)
                .localeCompare(
                  printer.printNode(ts.EmitHint.Unspecified, b, file),
                ),
            ),
          ),
        );
      };
      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    },
  ]);
  const output = printer.printFile(transformed.transformed[0]!);
  transformed.dispose();
  return output;
}

describe("pinned compiler boundary", () => {
  // RED: alias bin collisions or cwd/PATH resolution select TS7 for fallback.
  it("keeps default and explicit fallback on TS6, with native opt-in", () => {
    expect(compilerInvocation()).toEqual(compilerInvocation(true));
    for (const [legacy, version] of [
      [true, "6.0.3"],
      [false, "7.0.2"],
    ] as const) {
      const result = compile(legacy, scratch, ["--version"]);
      expect(result.status, result.output).toBe(0);
      expect(result.output.trim()).toBe(`Version ${version}`);
    }
    const cli = join(root, "scripts/local-checks/compiler-cli.ts");
    for (const [selector, version] of [
      [[], "6.0.3"],
      [["--legacy"], "6.0.3"],
      [["--native"], "7.0.2"],
    ] as const) {
      const result = runBoundary(
        process.execPath,
        [cli, ...selector, "--version"],
        {
          cwd: scratch,
          encoding: "utf8",
          env: { ...process.env, PATH: scratch },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(`Version ${version}`);
    }
  });

  // RED: the invoked tooling project omits heading, tests or the new harness.
  it("checks the real tooling project and rejects an invalid heading assignment", () => {
    const config = join(root, "tsconfig.tooling.json");
    const subject = join(scratch, "tooling-project");
    mkdirSync(subject);
    const parsed = ts.parseJsonConfigFileContent(
      ts.readConfigFile(config, ts.sys.readFile).config,
      ts.sys,
      root,
    );
    for (const source of [
      config,
      join(root, "tsconfig.base.json"),
      ...parsed.fileNames,
    ]) {
      const destination = join(subject, relative(root, source));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      // Fixtures are writable outputs even when the qualified inputs are frozen.
      chmodSync(destination, 0o600);
    }
    symlinkSync(
      join(root, "node_modules"),
      join(subject, "node_modules"),
      "junction",
    );
    const heading = join(subject, "scripts/lib/server-rendered-heading.ts");
    mkdirSync(dirname(heading), { recursive: true });
    const validHeading = readFileSync(
      join(root, "scripts/lib/server-rendered-heading.ts"),
      "utf8",
    );
    for (const legacy of [true, false]) {
      const valid = compile(legacy, root, ["-p", config]);
      expect(valid.status, valid.output).toBe(0);
      writeFileSync(heading, validHeading);
      const selected = join(subject, "tsconfig.tooling.json");
      const fixtureValid = compile(legacy, subject, ["-p", selected]);
      expect(fixtureValid.status, fixtureValid.output).toBe(0);
      writeFileSync(
        heading,
        validHeading + "\nconst compilerParityInvalid: string = 42;\n",
      );
      const invalid = compile(legacy, subject, ["-p", selected]);
      expect(invalid.status, invalid.output).not.toBe(0);
      expect(invalid.output).toContain("TS2322");
    }
  });

  // RED: loss of any independent strict option, or ignored alias dependencies.
  it("rejects optional, indexed, null and aliased downstream type errors", () => {
    const dependency = join(scratch, "dependency.ts");
    writeFileSync(dependency, 'export const value: string = "valid";\n');
    const cases = [
      ["const x: { value?: string } = { value: undefined };", "TS2375"],
      ["const x: string = ([] as string[])[0];", "TS2322"],
      ["const x: string = null;", "TS2322"],
      [
        'import { value } from "@dependency"; const x: number = value;',
        "TS2322",
      ],
    ];
    for (const [source, diagnostic] of cases) {
      const config = project(source!, {
        paths: { "@dependency": [dependency] },
      });
      for (const legacy of [true, false]) {
        const result = compile(legacy, root, ["-p", config]);
        expect(result.status, result.output).not.toBe(0);
        expect(result.output).toContain(diagnostic);
      }
    }
    const config = project(
      'import { value } from "@dependency"; const x: string = value;',
      { paths: { "@dependency": [dependency] } },
    );
    for (const legacy of [true, false]) {
      const result = compile(legacy, root, ["-p", config]);
      expect(result.status, result.output).toBe(0);
    }
  });

  // RED: TS7 drops JS/declarations, changes their surface or emits broken imports.
  it("preserves actual package and restricted contract emission and consumers", () => {
    const subjects = [
      ["packages/protocol-review-workflow", "tsconfig.build.json", "index"],
      [
        "packages/features/review-evidence",
        "tsconfig.contract-source.json",
        "contract-source/index",
      ],
    ];
    for (const [path, config, entry] of subjects) {
      const outputs: Record<string, string>[] = [];
      for (const legacy of [true, false]) {
        const subject = join(
          scratch,
          `${legacy}-${entry!.replaceAll("/", "-")}`,
        );
        const out = join(subject, "packages/subject/dist");
        const result = compile(legacy, join(root, path!), [
          "-p",
          config!,
          "--outDir",
          out,
        ]);
        expect(result.status, result.output).toBe(0);
        const files = readdirSync(out, { recursive: true })
          .filter((file) => /\.(js|d\.ts)$/.test(String(file)))
          .map(String)
          .sort();
        expect(files).toContain(`${entry}.js`);
        expect(files).toContain(`${entry}.d.ts`);
        outputs.push(
          Object.fromEntries(
            files.map((file) => [file, readFileSync(join(out, file), "utf8")]),
          ),
        );
        const rewrite = runBoundary(
          process.execPath,
          [join(root, "scripts/rewrite-dist-esm-imports.mjs")],
          { cwd: subject, encoding: "utf8" },
        );
        expect(rewrite.status, rewrite.stderr).toBe(0);
        writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
        const runtime = runBoundary(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `const m = await import(${JSON.stringify(join(out, `${entry}.js`))});
           if (${
             entry === "index"
               ? 'm.managedCodexWorkflowPath !== ".github/workflows/reviewrouter-codex.yml"'
               : "m.reviewEvidenceContractDescriptor.contractVersion !== 1"
           })
             throw new Error("wrong emitted runtime");`,
          ],
          { encoding: "utf8" },
        );
        expect(runtime.status, runtime.stderr).toBe(0);
        const consumer = project(
          `import * as m from ${JSON.stringify(join(out, `${entry}.js`))};
           const value: ${entry === "index" ? "string" : "1"} =
             m.${entry === "index" ? "managedCodexWorkflowPath" : "reviewEvidenceContractDescriptor.contractVersion"};`,
        );
        const checked = compile(legacy, root, ["-p", consumer]);
        expect(checked.status, checked.output).toBe(0);
        writeFileSync(
          join(scratch, "input.ts"),
          readFileSync(join(scratch, "input.ts"), "utf8").replace(
            /const value: (string|1)/,
            "const value: boolean",
          ),
        );
        const invalid = compile(legacy, root, ["-p", consumer]);
        expect(invalid.status, invalid.output).not.toBe(0);
        expect(invalid.output).toContain("TS2322");
      }
      const evidence = process.env.REVIEW_ROUTER_COMPILER_PROOF_LOG;
      if (evidence)
        appendFileSync(evidence, JSON.stringify({ path, outputs }) + "\n");
      const surfaces = outputs.map((files) =>
        Object.fromEntries(
          Object.entries(files).map(([name, text]) => [
            name,
            name.endsWith(".d.ts") ? declarationSurface(text) : text,
          ]),
        ),
      );
      expect(surfaces[1]).toEqual(surfaces[0]);
    }
  }, 60_000);

  // RED: replacing ordinary typescript removes its legacy AST/transpile API.
  it("retains real TS6 AST/transpile behavior and pure Node24 heading imports", () => {
    expect(ts.version).toBe("6.0.3");
    const file = ts.createSourceFile(
      "test.ts",
      "export const value: number = 42;",
      ts.ScriptTarget.Latest,
      true,
    );
    expect(ts.isVariableStatement(file.statements[0]!)).toBe(true);
    const output = ts.transpileModule(file.text, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText;
    expect(output).toContain("export const value = 42;");
    expect(output).not.toContain(": number");
    for (const path of [
      "scripts/check-architecture-boundaries.mjs",
      "scripts/manage-review-provider-scope-concurrency.test.ts",
      "apps/web/app/dashboard/actions-hosted-workflow-recovery.test.ts",
    ]) {
      const consumer = join(root, path);
      expect(createRequire(consumer).resolve("typescript")).toBe(
        createRequire(import.meta.url).resolve("typescript"),
      );
      const source = readFileSync(consumer, "utf8");
      const parsed = ts.createSourceFile(
        consumer,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      expect(parsed.statements.length).toBeGreaterThan(10);
      expect(
        ts
          .transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.ESNext },
            reportDiagnostics: true,
          })
          .diagnostics?.filter(
            (item) => item.category === ts.DiagnosticCategory.Error,
          ),
      ).toEqual([]);
    }
    const result = runBoundary(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {hasH1Text} from ${JSON.stringify(join(root, "scripts/lib/server-rendered-heading.ts"))};
       if (!hasH1Text("<h1>Hello</h1>", "Hello") ||
           hasH1Text("<h1>Other</h1>", "Hello")) throw new Error("heading");`,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });
});
