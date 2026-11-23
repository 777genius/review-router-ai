import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { transformSync } from "esbuild";
import { parseSync } from "oxc-parser";
import { afterAll, describe, expect, it } from "vitest";
import { compilerInvocation } from "./compiler-cli.ts";
import {
  consumerTypeAssertions,
  emissionSubjects,
} from "./compiler-pilot-fixtures.ts";
import { publicModuleSurface } from "./compiler-public-surface.ts";

const root = resolve(import.meta.dirname, "../..");
const scratch = mkdtempSync(join(tmpdir(), "compiler-native-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function record(evidence: Record<string, unknown>) {
  const path = process.env.REVIEW_ROUTER_COMPILER_PROOF_LOG;
  if (path) appendFileSync(path, JSON.stringify(evidence) + "\n");
}

function runBoundary(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  const started = performance.now();
  const result = spawnSync(command, [...args], options);
  record({
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
  });
  return result;
}

function compile(cwd: string, args: string[]) {
  const invocation = compilerInvocation();
  const result = runBoundary(
    invocation.command,
    [...invocation.args, ...args],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`compiler terminated by ${result.signal}`);
  if (result.status === null)
    throw new Error("compiler completed without an exit status");
  record({
    kind: "native-compiler",
    version: "7.0.2",
    cwd,
    args,
    exit: result.status,
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

function project(source: string, extraOptions: Record<string, unknown> = {}) {
  const input = join(scratch, "input.ts");
  const config = join(scratch, "tsconfig.json");
  writeFileSync(input, source);
  record({ kind: "native-consumer-project", source, extraOptions });
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

function toolingRootFiles(config: string): string[] {
  const shown = compile(root, ["--showConfig", "-p", config]);
  expect(shown.status, shown.output).toBe(0);
  const value: unknown = JSON.parse(shown.output);
  if (
    typeof value !== "object" ||
    value === null ||
    !("files" in value) ||
    !Array.isArray(value.files) ||
    !value.files.every((file) => typeof file === "string")
  ) {
    throw new Error("compiler_tooling_config_files_invalid");
  }
  if (
    !("compilerOptions" in value) ||
    typeof value.compilerOptions !== "object" ||
    value.compilerOptions === null
  ) {
    throw new Error("compiler_tooling_config_options_invalid");
  }
  expect(value.compilerOptions).toMatchObject({
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
  });
  const files = value.files.map((file) => resolve(root, file));
  for (const file of [
    "scripts/lib/server-rendered-heading.ts",
    "scripts/lib/server-rendered-heading.test.ts",
    "scripts/local-checks/compiler-cli.pilot.ts",
    "scripts/local-checks/compiler-pilot-fixtures.ts",
    "scripts/local-checks/compiler-public-surface.ts",
    "scripts/local-checks/compiler-public-surface.test.ts",
  ])
    expect(files).toContain(join(root, file));
  record({
    kind: "native-tooling-config",
    config,
    files,
    compilerOptions: value.compilerOptions,
  });
  return files;
}

describe("pinned native compiler boundary", () => {
  it("selects native by default and explicitly without consulting cwd or PATH", () => {
    const version = compile(scratch, ["--version"]);
    expect(version.status, version.output).toBe(0);
    expect(version.output.trim()).toBe("Version 7.0.2");
    const collision = join(scratch, "tsc");
    writeFileSync(collision, "#!/bin/sh\nexit 79\n");
    chmodSync(collision, 0o700);
    for (const selector of [[], ["--native"]]) {
      const result = runBoundary(
        process.execPath,
        [
          join(root, "scripts/local-checks/compiler-cli.ts"),
          ...selector,
          "--version",
        ],
        {
          cwd: scratch,
          encoding: "utf8",
          env: { ...process.env, PATH: scratch },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("Version 7.0.2");
    }
  });

  it("rejects legacy before even resolving a compiler installation", () => {
    const directory = join(scratch, "uninstalled-cli");
    mkdirSync(directory);
    const cli = join(directory, "compiler-cli.ts");
    copyFileSync(join(root, "scripts/local-checks/compiler-cli.ts"), cli);
    for (const args of [
      ["--legacy"],
      ["--native", "--legacy"],
      ["--version", "--legacy"],
    ]) {
      const result = runBoundary(process.execPath, [cli, ...args], {
        cwd: directory,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr.trim()).toBe(
        "legacy_compiler_disabled: use native TypeScript 7.0.2",
      );
      expect(result.stdout).toBe("");
    }
  });

  it("rejects invalid alias manifests before executing their bin", () => {
    const manifests: unknown[] = [
      null,
      { name: "other", version: "7.0.2", bin: { tsc: "sentinel.cjs" } },
      { name: "typescript", version: "6.0.3", bin: { tsc: "sentinel.cjs" } },
      { name: "typescript", version: "7.0.2", bin: { tsc: "" } },
      { name: "typescript", version: "7.0.2", bin: "sentinel.cjs" },
    ];
    for (const [index, manifest] of manifests.entries()) {
      const directory = join(scratch, `invalid-manifest-${index}`);
      const alias = join(directory, "native/node_modules/typescript-native");
      mkdirSync(alias, { recursive: true });
      const cli = join(directory, "compiler-cli.ts");
      copyFileSync(join(root, "scripts/local-checks/compiler-cli.ts"), cli);
      writeFileSync(
        join(directory, "native/package.json"),
        '{"private":true}\n',
      );
      writeFileSync(join(alias, "package.json"), JSON.stringify(manifest));
      const sentinel = join(directory, "bin-executed");
      writeFileSync(
        join(alias, "sentinel.cjs"),
        `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed");\n`,
      );
      const result = runBoundary(process.execPath, [cli, "--version"], {
        cwd: directory,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      if (manifest === null) {
        // Node rejects a null package manifest before our JSON validation.
        expect(result.stderr).toContain("Invalid package config");
      } else {
        expect(result.stderr.trim()).toBe(
          "typescript-native must resolve to typescript@7.0.2 with a tsc entry",
        );
      }
      expect(existsSync(sentinel)).toBe(false);
    }
  });

  it("checks the real tooling project and rejects an invalid heading assignment", () => {
    const config = join(root, "tsconfig.tooling.json");
    const roots = toolingRootFiles(config);
    const valid = compile(root, ["-p", config]);
    expect(valid.status, valid.output).toBe(0);
    const listed = compile(root, ["--listFilesOnly", "-p", config]);
    expect(listed.status, listed.output).toBe(0);
    const localClosure = listed.output
      .trim()
      .split(/\r?\n/u)
      .map((file) => resolve(root, file))
      .filter(
        (file) =>
          file.startsWith(root + sep) &&
          !file.split(sep).includes("node_modules"),
      );
    for (const file of roots) expect(localClosure).toContain(file);
    record({ kind: "native-tooling-local-closure", files: localClosure });
    const subject = join(scratch, "tooling-project");
    mkdirSync(subject);
    const inputs = new Set([
      config,
      join(root, "tsconfig.base.json"),
      ...localClosure,
    ]);
    const dependencies = new Set<string>();
    for (const source of localClosure) {
      let directory = dirname(source);
      while (directory === root || directory.startsWith(root + sep)) {
        const manifest = join(directory, "package.json");
        const installed = join(directory, "node_modules");
        if (existsSync(manifest)) inputs.add(manifest);
        if (existsSync(installed)) dependencies.add(installed);
        if (directory === root) break;
        directory = dirname(directory);
      }
    }
    for (const source of inputs) {
      const destination = join(subject, relative(root, source));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      chmodSync(destination, 0o600);
    }
    // Workspace imports and relative imports must resolve to the same copied
    // declarations, including nominal identities such as private class members.
    const workspaceLinks: { installed: string; copied: string }[] = [];
    const linkDependency = (installed: string, destination: string) => {
      const resolved = realpathSync(installed);
      const local = relative(root, resolved);
      const workspacePackage =
        resolved.startsWith(root + sep) &&
        !local.split(sep).includes("node_modules");
      let target = installed;
      if (workspacePackage) {
        target = join(subject, local);
        mkdirSync(target, { recursive: true });
        const manifest = join(resolved, "package.json");
        if (!inputs.has(manifest)) {
          inputs.add(manifest);
          copyFileSync(manifest, join(target, "package.json"));
          chmodSync(join(target, "package.json"), 0o600);
        }
        workspaceLinks.push({ installed, copied: target });
      }
      symlinkSync(
        target,
        destination,
        statSync(installed).isDirectory() ? "junction" : "file",
      );
    };
    for (const installed of dependencies) {
      const destination = join(subject, relative(root, installed));
      mkdirSync(destination, { recursive: true });
      for (const entry of readdirSync(installed)) {
        const source = join(installed, entry);
        const copied = join(destination, entry);
        if (entry.startsWith("@") && statSync(source).isDirectory()) {
          mkdirSync(copied);
          for (const name of readdirSync(source))
            linkDependency(join(source, name), join(copied, name));
        } else {
          linkDependency(source, copied);
        }
      }
    }
    record({
      kind: "native-tooling-fixture-inputs",
      files: [...inputs],
      dependencies: [...dependencies],
      workspaceLinks,
    });
    const selected = join(subject, "tsconfig.tooling.json");
    const fixtureValid = compile(subject, ["-p", selected]);
    expect(fixtureValid.status, fixtureValid.output).toBe(0);
    const fixtureListed = compile(subject, ["--listFilesOnly", "-p", selected]);
    expect(fixtureListed.status, fixtureListed.output).toBe(0);
    const fixtureFiles = fixtureListed.output
      .trim()
      .split(/\r?\n/u)
      .map((file) => resolve(subject, file));
    for (const original of localClosure)
      expect(fixtureFiles).toContain(join(subject, relative(root, original)));
    for (const file of fixtureFiles)
      expect(
        file.startsWith(root + sep) &&
          !file.split(sep).includes("node_modules"),
        `uncopied workspace source: ${file}`,
      ).toBe(false);
    record({ kind: "native-tooling-fixture-closure", files: fixtureFiles });
    const heading = join(subject, "scripts/lib/server-rendered-heading.ts");
    appendFileSync(heading, "\nconst compilerNativeInvalid: string = 42;\n");
    const invalid = compile(subject, ["-p", selected]);
    expect(invalid.status, invalid.output).not.toBe(0);
    expect(invalid.output).toContain("TS2322");
  }, 60_000);

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
    ] as const;
    for (const [source, diagnostic] of cases) {
      const config = project(source, {
        paths: { "@dependency": [dependency] },
      });
      const result = compile(root, ["-p", config]);
      expect(result.status, result.output).not.toBe(0);
      expect(result.output).toContain(diagnostic);
    }
    const config = project(
      'import { value } from "@dependency"; const x: string = value;',
      { paths: { "@dependency": [dependency] } },
    );
    const result = compile(root, ["-p", config]);
    expect(result.status, result.output).toBe(0);
  });

  it("preserves actual package and restricted contract emission and consumers", () => {
    for (const subject of emissionSubjects) {
      const directory = join(scratch, subject.path.replaceAll("/", "-"));
      const out = join(directory, "packages/subject/dist");
      const result = compile(join(root, subject.path), [
        "-p",
        subject.config,
        "--outDir",
        out,
      ]);
      expect(result.status, result.output).toBe(0);
      const files = readdirSync(out, { recursive: true, encoding: "utf8" })
        .filter((file) => statSync(join(out, file)).isFile())
        .sort();
      const expectedFiles = subject.modules
        .flatMap(({ file }) => [`${file}.js`, `${file}.d.ts`])
        .sort();
      expect(files).toEqual(expectedFiles);
      const outputs = Object.fromEntries(
        files.map((file) => [file, readFileSync(join(out, file), "utf8")]),
      );
      for (const module of subject.modules) {
        const original = readFileSync(
          join(root, subject.path, "src", `${module.file}.ts`),
          "utf8",
        );
        const source = publicModuleSurface(`${module.file}.ts`, original);
        const declaration = publicModuleSurface(
          `${module.file}.d.ts`,
          readFileSync(join(out, `${module.file}.d.ts`), "utf8"),
        );
        const runtime = publicModuleSurface(
          `${module.file}.js`,
          readFileSync(join(out, `${module.file}.js`), "utf8"),
        );
        const names = [...module.exports].sort();
        expect(source.names).toEqual(names);
        expect(declaration).toEqual(source);
        expect(runtime.names).toEqual(
          names.filter((name) => !module.typeOnly.includes(name)),
        );
      }
      record({
        kind: "native-emission",
        compiler: "7.0.2",
        path: subject.path,
        config: subject.config,
        outputs,
      });
      symlinkSync(
        join(root, subject.path, "node_modules"),
        join(directory, "node_modules"),
        "junction",
      );
      const rewrite = runBoundary(
        process.execPath,
        [join(root, "scripts/rewrite-dist-esm-imports.mjs")],
        { cwd: directory, encoding: "utf8" },
      );
      expect(rewrite.status, rewrite.stderr).toBe(0);
      record({
        kind: "native-runtime-outputs",
        path: subject.path,
        outputs: Object.fromEntries(
          files
            .filter((file) => file.endsWith(".js"))
            .map((file) => [file, readFileSync(join(out, file), "utf8")]),
        ),
      });
      writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
      const imports = Object.entries(subject.imports)
        .map(
          ([name, file]) =>
            `import * as ${name} from ${JSON.stringify(join(out, `${file}.js`))};`,
        )
        .join("\n");
      const declarationConsumers = subject.modules
        .map((module, index) => {
          const original = JSON.stringify(
            join(root, subject.path, "src", `${module.file}.js`),
          );
          const emitted = JSON.stringify(join(out, `${module.file}.js`));
          return [
            `import type * as Source${index} from ${original};`,
            `import type * as Emitted${index} from ${emitted};`,
            `type RuntimeExports${index} = Expect<Compatible<typeof Source${index}, typeof Emitted${index}>>;`,
            ...module.typeOnly.map(
              (name) =>
                `type TypeExport${index}${name} = Expect<Compatible<Source${index}.${name}, Emitted${index}.${name}>>;`,
            ),
          ].join("\n");
        })
        .join("\n");
      const runtime = runBoundary(
        process.execPath,
        [
          "--conditions=production",
          "--input-type=module",
          "-e",
          'import assert from "node:assert/strict";\n' +
            imports +
            subject.runtime,
        ],
        { cwd: directory, encoding: "utf8" },
      );
      expect(runtime.status, runtime.stderr).toBe(0);
      const checked = compile(root, [
        "-p",
        project(
          imports +
            consumerTypeAssertions +
            subject.consumer +
            declarationConsumers,
        ),
      ]);
      expect(checked.status, checked.output).toBe(0);
      for (const rejected of subject.rejectedConsumers) {
        const invalid = compile(root, [
          "-p",
          project(imports + "\n" + rejected.source),
        ]);
        expect(invalid.status, invalid.output).not.toBe(0);
        expect(invalid.output).toContain(rejected.diagnostic);
      }
    }
  }, 60_000);

  it("parses and transforms the real governed sources with public native tools", () => {
    const example = "export const value: number = 42;";
    const parsedExample = parseSync("example.ts", example);
    expect(parsedExample.errors).toEqual([]);
    expect(parsedExample.program.body[0]?.type).toBe("ExportNamedDeclaration");
    const emittedExample = transformSync(example, {
      loader: "ts",
      format: "esm",
      target: "es2022",
    });
    expect(emittedExample.code).toContain("const value = 42;");
    expect(emittedExample.code).not.toContain(": number");
    expect(
      parseSync("invalid.ts", "export const value: = 42;").errors.length,
    ).toBeGreaterThan(0);
    expect(() =>
      transformSync("export const value: = 42;", { loader: "ts" }),
    ).toThrow();
    for (const path of [
      "scripts/check-architecture-boundaries.mjs",
      "scripts/manage-review-provider-scope-concurrency.test.ts",
      "apps/web/app/dashboard/actions-hosted-workflow-recovery.test.ts",
    ]) {
      const consumer = join(root, path);
      const source = readFileSync(consumer, "utf8");
      const parsed = parseSync(consumer, source);
      expect(parsed.errors).toEqual([]);
      expect(parsed.program.body.length).toBeGreaterThan(10);
      const output = transformSync(source, {
        loader: path.endsWith(".mjs") ? "js" : "ts",
        sourcefile: consumer,
        format: "esm",
        target: "es2022",
      });
      expect(output.warnings).toEqual([]);
      expect(output.code.length).toBeGreaterThan(0);
    }
  });

  it("retains the pure Node heading import and positive/negative behavior", () => {
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
