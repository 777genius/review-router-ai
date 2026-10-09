import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { Script } from "node:vm";
import { after, test } from "node:test";
import { ESLint } from "eslint";
import ts from "typescript";
import {
  admitTools,
  assertNoSymlinks,
  createTestSubject,
  toolVersions,
  writeFixture,
} from "./lint-format-test-support.mts";
import {
  fallbackCases,
  formatCases,
  nativeRuleCases,
} from "./lint-format-fixtures.ts";

// Run only from an admitted disposable TEST copy with its own dependencies.
const root = realpathSync(process.cwd());
assert.equal(
  process.env.RR_N1_TEST_ROOT,
  root,
  "Set RR_N1_TEST_ROOT to the isolated TEST subject",
);
assert.equal(
  readFileSync(join(root, ".rr-n1-test-subject"), "utf8"),
  "disposable N1 lint/format subject\n",
);
admitTools(root);
for (const name of ["oxlint", "oxfmt"] as const) {
  const version = spawnSync(
    process.execPath,
    [join(root, "node_modules", name, `bin/${name}`), "--version"],
    { cwd: root, encoding: "utf8", timeout: 30_000, shell: false },
  );
  assert.ifError(version.error);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), `Version: ${toolVersions[name]}`);
}
const scratch = process.env.RR_N1_SCRATCH;
assert.ok(
  scratch,
  "Set RR_N1_SCRATCH to existing job-owned scratch beneath the TEST dependency root",
);
assertNoSymlinks(scratch);
const ignoredEntries = readFileSync(join(root, ".prettierignore"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"));
const originals = ignoredEntries
  .filter(
    (entry) =>
      /\.(?:js|md|json|yaml)$/.test(entry) && existsSync(join(root, entry)),
  )
  .map((entry) => {
    assertNoSymlinks(join(root, entry));
    return [entry, readFileSync(join(root, entry))] as const;
  });
const subject = createTestSubject(root, scratch);
const baseline = new ESLint({
  cwd: subject,
  overrideConfigFile: join(subject, "eslint.config.mjs"),
});
const fallback = new ESLint({
  cwd: subject,
  overrideConfigFile: join(subject, "eslint.native-fallback.config.mjs"),
});
const extensions = ["js", "mjs", "cjs", "ts", "mts", "cts", "tsx"] as const;
const migrated = new Set(Object.keys(nativeRuleCases));

function cli(
  tool: "oxlint" | "oxfmt" | "prettier",
  args: string[],
  input?: string,
) {
  const entry = tool === "prettier" ? "bin/prettier.cjs" : `bin/${tool}`;
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules", tool, entry), ...args],
    {
      cwd: subject,
      input,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, TMPDIR: scratch },
      shell: false,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${tool} terminated: ${result.signal}`);
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    stdout: result.stdout,
  };
}
const lint = (path: string) =>
  cli("oxlint", [
    "--config",
    ".oxlintrc.json",
    "--threads",
    "1",
    "--no-ignore",
    "--disable-nested-config",
    "--no-error-on-unmatched-pattern",
    "--",
    path,
  ]);
const format = (tool: "oxfmt" | "prettier", path: string, input: string) =>
  cli(
    tool,
    tool === "oxfmt"
      ? [
          "--config",
          ".oxfmtrc.json",
          "--threads",
          "1",
          "--stdin-filepath",
          path,
        ]
      : ["--stdin-filepath", path],
    input,
  );

// RED: wrong installed versions must refuse qualification before fixture execution.
test("exact pinned native and baseline tool identities", () => {
  for (const [name, version] of Object.entries(toolVersions)) {
    assert.equal(
      JSON.parse(
        readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
      ).version,
      version,
    );
  }
});

// RED: accidental removal/scope widening of any retained rule/global changes this ledger.
test("effective fallback rule ledger preserves every non-migrated rule by file scope", async () => {
  const ledger: unknown[] = [];
  for (const ext of extensions) {
    const path = join(subject, `scope.${ext}`);
    const old = await baseline.calculateConfigForFile(path);
    const next = await fallback.calculateConfigForFile(path);
    assert.ok(old && next);
    assert.deepEqual(next.languageOptions, old.languageOptions);
    for (const [rule, setting] of Object.entries(old.rules)) {
      assert.deepEqual(
        next.rules[rule],
        migrated.has(rule) ? [0, ...(setting as unknown[]).slice(1)] : setting,
        `${ext}: ${rule}`,
      );
      ledger.push({
        extension: ext,
        rule,
        old: setting,
        candidate: next.rules[rule],
        owner: migrated.has(rule) ? "oxlint" : "eslint-fallback",
      });
    }
    assert.deepEqual(
      Object.keys(next.rules).sort(),
      Object.keys(old.rules).sort(),
    );
  }
  writeFixture(
    scratch,
    `rule-ledger-${basename(subject)}.json`,
    JSON.stringify(ledger, null, 2) + "\n",
  );
});

// RED: the old rule rejects each invalid source; a missing native rule accepts it.
for (const ext of extensions) {
  for (const [rule, [positive, negative]] of Object.entries(nativeRuleCases)) {
    test(`native parity ${ext} ${rule}: positive and rejecting`, async () => {
      for (const [source, rejected] of [
        [positive, false],
        [negative, true],
      ] as const) {
        const path = writeFixture(
          subject,
          `case-${rule}-${rejected}.${ext}`,
          source + "\n",
        );
        const results = await baseline.lintFiles([path]);
        assert.equal(
          results.flatMap((r) => r.messages).some((m) => m.ruleId === rule),
          rejected,
        );
        assert.equal(lint(path).status === 0, !rejected, rule);
        if (rejected) assert.match(lint(path).output, new RegExp(rule));
      }
    });
  }
}

// RED: JS globals, readonly globals, unused TS, MTS any or empty types pass after lost fallback.
for (const [ext, rule, source] of fallbackCases) {
  test(`retained fallback ${ext} ${rule}`, async () => {
    const path = join(subject, `fallback.${ext}`);
    const [result] = await fallback.lintText(source, { filePath: path });
    assert.ok(result?.messages.some((m) => m.ruleId === rule));
    const positive =
      ext === "tsx"
        ? "export const view = <section />;"
        : ext === "ts"
          ? "export const value: any = 1;"
          : "console.log(process, Buffer, URL, setTimeout, clearTimeout, document, window, HTMLElement);";
    const [valid] = await fallback.lintText(positive, { filePath: path });
    assert.equal(valid?.errorCount, 0, JSON.stringify(valid?.messages));
  });
}

// RED: broad TS overrides would erroneously allow any in MTS; TS/TSX retain exceptions.
test("any exception is TS/TSX only; eslint suppression remains effective", async () => {
  for (const ext of ["ts", "tsx", "mts"] as const) {
    const [result] = await fallback.lintText("export const value: any = 1;", {
      filePath: join(subject, `any.${ext}`),
    });
    assert.equal(result?.errorCount, ext === "mts" ? 1 : 0);
  }
  const path = join(subject, "suppressed.js");
  writeFixture(
    subject,
    "suppressed.js",
    "// eslint-disable-next-line no-debugger\ndebugger;\n",
  );
  assert.equal(lint(path).status, 0);
});

// RED: ignore drift exposes generated action/build output or Prettier secret/evidence inputs.
test("lint ignores and formatter explicit-file exclusions", async () => {
  for (const directory of [
    "dist",
    "action-dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    "nested/dist",
    "nested/.next",
    "nested/.turbo",
    "nested/coverage",
  ]) {
    const path = writeFixture(
      subject,
      `${directory}/n1-invalid.js`,
      "debugger;\n",
    );
    assert.equal(await baseline.isPathIgnored(path), true);
    assert.equal(await fallback.isPathIgnored(path), true);
    assert.equal(lint(path).status, 0);
  }
  const ignored = ignoredEntries;
  for (const entry of ignored) {
    const local = /\.(?:js|md|json|yaml)$/.test(entry)
      ? entry
      : `${entry}/n1-ignore.js`;
    const path = writeFixture(subject, local, "const value={a:1}\n");
    const before = readFileSync(path, "utf8");
    const native = cli("oxfmt", [
      "--config",
      ".oxfmtrc.json",
      "--ignore-path",
      ".prettierignore",
      "--check",
      path,
    ]);
    assert.equal(native.status, 2, native.output);
    assert.match(
      native.output,
      /All matched files may have been excluded by ignore rules/,
    );
    const old = cli("prettier", [
      "--ignore-path",
      ".prettierignore",
      "--check",
      path,
    ]);
    assert.equal(old.status, entry === "node_modules" ? 2 : 0, old.output);
    assert.equal(readFileSync(path, "utf8"), before);
  }
});

// RED: Git ignores must not narrow the ESLint source scope.
test("Git-only ignores do not hide handwritten lint inputs", () => {
  writeFixture(subject, ".gitignore", "git-only/\n");
  writeFixture(subject, "git-only/case.js", "debugger;\n");
  assert.notEqual(lint(join(subject, "git-only", "case.js")).status, 0);
  const directory = spawnSync(
    process.execPath,
    [
      join(root, "scripts/local-checks/lint-format-lint.mts"),
      join(subject, "git-only"),
    ],
    { cwd: subject, encoding: "utf8", timeout: 30_000 },
  );
  assert.notEqual(directory.status, 0);
  assert.match(directory.stderr, /Supply explicit files/);
});

// RED: Oxfmt defaults (100 columns/sorting), comment loss or non-idempotence changes independent golden text.
for (const fixture of formatCases) {
  test(`format parity and idempotence ${fixture.path}`, () => {
    for (const tool of ["prettier", "oxfmt"] as const) {
      const first = format(tool, fixture.path, fixture.input);
      assert.equal(first.status, 0, first.output);
      assert.equal(first.stdout, fixture.expected);
      assert.equal(
        format(tool, fixture.path, first.stdout).stdout,
        fixture.expected,
      );
      if (/\.(?:js|mjs|cjs|ts|mts|cts|tsx)$/.test(fixture.path)) {
        const parsed = ts.transpileModule(first.stdout, {
          fileName: fixture.path,
          reportDiagnostics: true,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.Preserve,
          },
        });
        assert.deepEqual(parsed.diagnostics, []);
        if (
          [
            "comments.js",
            "template.mjs",
            "types.mts",
            "types.ts",
            "regex.cjs",
          ].includes(fixture.path)
        ) {
          const emitted = ts.transpileModule(first.stdout, {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
            },
          }).outputText;
          const exports: Record<string, unknown> = {};
          const observations: unknown[] = [];
          new Script(emitted).runInNewContext(
            {
              exports,
              console: { log: (value: unknown) => observations.push(value) },
            },
            { timeout: 1_000 },
          );
          if (fixture.path === "template.mjs")
            assert.equal(exports.value, "hello 3");
          if (fixture.path === "types.mts" || fixture.path === "types.ts")
            assert.equal(JSON.stringify(exports.value), '{"label":"ok"}');
          if (fixture.path === "regex.cjs")
            assert.deepEqual(observations, [true]);
        }
      }
      if (fixture.path === "view.tsx") {
        const emitted = ts.transpileModule(first.stdout, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.React,
            jsxFactory: "element",
          },
        }).outputText;
        const exports: Record<string, unknown> = {};
        new Script(emitted).runInNewContext(
          {
            exports,
            element: (tag: string, props: unknown, child: string) => ({
              tag,
              props,
              child,
            }),
          },
          { timeout: 1_000 },
        );
        assert.equal(
          JSON.stringify(exports.view),
          '{"tag":"section","props":{"title":"ok"},"child":"Hello"}',
        );
      }
      if (fixture.path.endsWith(".json"))
        assert.deepEqual(JSON.parse(first.stdout), JSON.parse(fixture.input));
    }
  });
}

// RED: a native-only adapter would miss the retained TS rule or ignore a valid file.
test("real lint adapter checks native plus retained rules and reports skips", () => {
  for (const [source, exit] of [
    ["export const value: any = 1;", 1],
    ["export const value = 1;", 0],
    ["debugger;", 1],
  ] as const) {
    const path = writeFixture(
      subject,
      `adapter-${exit}-${source.startsWith("debugger")}.mts`,
      source + "\n",
    );
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/local-checks/lint-format-lint.mts"), path],
      { cwd: subject, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.status, exit, result.stdout + result.stderr);
  }
  const ignored = spawnSync(
    process.execPath,
    [
      join(root, "scripts/local-checks/lint-format-lint.mts"),
      "dist/n1-invalid.js",
    ],
    { cwd: subject, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(ignored.status, 0);
  assert.equal(JSON.parse(ignored.stdout).status, "not-checked");
});

// No auto-write, provider/runtime invocation or C3 apply mechanism in this harness.
after(() => {
  for (const [entry, bytes] of originals)
    assert.deepEqual(
      readFileSync(join(root, entry)),
      bytes,
      `Original bytes changed: ${entry}`,
    );
  rmSync(subject, { recursive: true, force: true });
});

// RED: each independent golden distinguishes its claimed option from a real
// native mutant. These are disposable configs, never edits to the candidate.
for (const [path, option, value] of [
  ["width.ts", "printWidth", 100],
  ["imports.ts", "sortImports", true],
  ["package.json", "sortPackageJson", true],
  ["tailwind.tsx", "sortTailwindcss", true],
] as const) {
  test(`reject formatter option mutation ${option}`, () => {
    const fixture = formatCases.find((item) => item.path === path);
    assert.ok(fixture);
    const config = JSON.parse(
      readFileSync(join(subject, ".oxfmtrc.json"), "utf8"),
    ) as Record<string, unknown>;
    const mutant = writeFixture(
      subject,
      `mutant-${option}.json`,
      JSON.stringify({ ...config, [option]: value }),
    );
    const result = cli(
      "oxfmt",
      ["--config", mutant, "--threads", "1", "--stdin-filepath", path],
      fixture.input,
    );
    assert.equal(result.status, 0, result.output);
    assert.notEqual(
      result.stdout,
      fixture.expected,
      `${option} fixture fails to distinguish mutant`,
    );
  });
}

// RED: the prior harness wrote ignored tracked subjects directly under root.
test("original ignored generated and release-evidence bytes survive", () => {
  assert.ok(
    originals.some(([entry]) => entry.endsWith(".generated.js")),
    "Copy original generated TEST subject before qualification",
  );
  assert.ok(
    originals.some(([entry]) => entry.startsWith("docs/release-evidence/")),
    "Copy original evidence TEST subjects before qualification",
  );
  for (const [entry, bytes] of originals)
    assert.deepEqual(readFileSync(join(root, entry)), bytes);
});
