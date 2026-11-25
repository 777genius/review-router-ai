import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { after, test } from "node:test";
import {
  admitTools,
  createTestSubject,
  writeFixture,
} from "./lint-format-test-support.ts";

const root = realpathSync(process.cwd());
assert.equal(process.env.RR_N1_TEST_ROOT, root);
admitTools(root); // No registration or safety fixture writes before admission.
const scratch = process.env.RR_N1_SCRATCH;
assert.ok(scratch);
const subject = createTestSubject(root, scratch);
after(() => rmSync(subject, { recursive: true, force: true }));

// RED: recursive mkdir/write would follow this TEST link and overwrite evidence.
test("fixture writer refuses symlink components, escapes and existing bytes", () => {
  const outside = join(subject, "outside");
  mkdirSync(outside);
  writeFixture(subject, "outside/original.md", "original TEST evidence\n");
  symlinkSync(outside, join(subject, "linked"), "dir");
  assert.throws(
    () => writeFixture(subject, "linked/original.md", "lost"),
    /Symlink/,
  );
  assert.throws(
    () => writeFixture(subject, "outside/original.md", "lost"),
    /EEXIST/,
  );
  assert.throws(() => writeFixture(subject, "../escape.md", "lost"), /escapes/);
  assert.equal(
    readFileSync(join(outside, "original.md"), "utf8"),
    "original TEST evidence\n",
  );
  symlinkSync(join(outside, "original.md"), join(subject, "leaf.md"));
  assert.throws(() => writeFixture(subject, "leaf.md", "lost"), /EEXIST/);
});

test("fixture allocation refuses scratch writable by other users", () => {
  const writable = join(subject, "shared-scratch");
  mkdirSync(writable);
  chmodSync(writable, 0o777);
  assert.throws(
    () => createTestSubject(root, writable),
    /must not be writable by other users/,
  );
  assert.deepEqual(readdirSync(writable), []);
});

for (const fixture of [
  {
    name: "parser version",
    parserVersion: "0.1.0",
    scopeVersion: "8.73.0",
    visitorVersion: "8.73.0",
    typesVersion: "8.73.0",
    duplicateScope: false,
    rejection: /Expected qualified eslint-parser-oxc 0\.1\.1/,
  },
  {
    name: "scope version",
    parserVersion: "0.1.1",
    scopeVersion: "8.72.0",
    visitorVersion: "8.73.0",
    typesVersion: "8.73.0",
    duplicateScope: false,
    rejection: /Expected qualified @typescript-eslint\/scope-manager 8\.73\.0/,
  },
  {
    name: "second physical scope",
    parserVersion: "0.1.1",
    scopeVersion: "8.73.0",
    visitorVersion: "8.73.0",
    typesVersion: "8.73.0",
    duplicateScope: true,
    rejection: /must resolve the same qualified scope-manager/,
  },
  {
    name: "visitor-keys version",
    parserVersion: "0.1.1",
    scopeVersion: "8.73.0",
    visitorVersion: "8.72.0",
    typesVersion: "8.73.0",
    duplicateScope: false,
    rejection: /Expected qualified @typescript-eslint\/visitor-keys 8\.73\.0/,
  },
  {
    name: "types version",
    parserVersion: "0.1.1",
    scopeVersion: "8.73.0",
    visitorVersion: "8.73.0",
    typesVersion: "8.72.0",
    duplicateScope: false,
    rejection: /Expected qualified @typescript-eslint\/types 8\.73\.0/,
  },
]) {
  test(`adapter admission rejects ${fixture.name} before implementation or fixture allocation`, () => {
    const bad = mkdtempSync(join(subject, "wrong-adapter-"));
    const sentinel = join(bad, "implementation-started");
    const implementation = `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "called");\n`;
    new Script(implementation);
    for (const [name, version] of [
      ["stack-toolchain", "0.3.1"],
      ["typescript", "7.0.2"],
      ["eslint-parser-oxc", fixture.parserVersion],
      ["@typescript-eslint/scope-manager", fixture.scopeVersion],
      ["@typescript-eslint/visitor-keys", fixture.visitorVersion],
      ["@typescript-eslint/types", fixture.typesVersion],
    ] as const) {
      writeFixture(
        bad,
        `node_modules/${name}/package.json`,
        JSON.stringify({ name, version, main: "index.cjs" }),
      );
      writeFixture(bad, `node_modules/${name}/index.cjs`, implementation);
    }
    if (fixture.duplicateScope) {
      const duplicate =
        "node_modules/eslint-parser-oxc/node_modules/@typescript-eslint/scope-manager";
      writeFixture(
        bad,
        `${duplicate}/package.json`,
        JSON.stringify({
          name: "@typescript-eslint/scope-manager",
          version: "8.73.0",
          main: "index.cjs",
        }),
      );
      writeFixture(bad, `${duplicate}/index.cjs`, implementation);
    }
    const output = join(bad, "output");
    mkdirSync(output);
    assert.throws(
      () => createTestSubject(bad, output, { "stack-toolchain": "0.3.1" }),
      fixture.rejection,
    );
    assert.equal(existsSync(sentinel), false);
    assert.deepEqual(readdirSync(output), []);
  });
}

for (const mode of ["esm", "commonjs"] as const) {
  test(`native guard rejects ${mode} legacy plugin before initialization`, () => {
    const bad = mkdtempSync(join(subject, "legacy-load-"));
    const sentinel = join(bad, "legacy-started");
    writeFixture(
      bad,
      "node_modules/typescript-eslint/package.json",
      JSON.stringify({
        name: "typescript-eslint",
        version: "8.59.1",
        main: "index.cjs",
      }),
    );
    const implementation = `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "called");\n`;
    new Script(implementation);
    writeFixture(
      bad,
      "node_modules/typescript-eslint/index.cjs",
      implementation,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(
          join(root, "scripts/local-checks/lint-format-native-load-guard.ts"),
        ).href,
        ...(mode === "esm" ? ["--input-type=module"] : []),
        "--eval",
        mode === "esm"
          ? 'await import("typescript-eslint");'
          : 'require("typescript-eslint");',
      ],
      { cwd: bad, encoding: "utf8", timeout: 30_000, shell: false },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /legacy_typescript_module_blocked: Legacy typescript-eslint implementation/,
    );
    assert.equal(existsSync(sentinel), false);
  });
}

// RED: the old ordinary identity test continued to register/run fixture tools.
// The actual harness now refuses a wrong version before reading configs,
// creating the minimal fixture root, invoking a fixture tool or registering tests.
test("wrong version refuses actual harness with no fixture writes or tool execution", () => {
  const bad = mkdtempSync(join(subject, "wrong-tools-"));
  writeFixture(
    bad,
    ".rr-n1-test-subject",
    "disposable N1 lint/format subject\n",
  );
  writeFixture(
    bad,
    "node_modules/oxlint/package.json",
    '{"name":"oxlint","version":"0.0.0"}\n',
  );
  const sentinel = join(bad, "fixture-tool-called");
  const sentinelSource = `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "called");\n`;
  new Script(sentinelSource); // Refuse a malformed observer that could hide an invocation.
  writeFixture(bad, "node_modules/oxlint/bin/oxlint", sentinelSource);
  const output = join(bad, "output");
  mkdirSync(output);
  const result = spawnSync(
    process.execPath,
    ["--test", join(root, "scripts/local-checks/lint-format-qualification.ts")],
    {
      cwd: bad,
      encoding: "utf8",
      timeout: 30_000,
      shell: false,
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        RR_N1_TEST_ROOT: bad,
        RR_N1_SCRATCH: output,
        TMPDIR: output,
      },
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, null);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    /Expected qualified oxlint 1\.87\.0/,
  );
  assert.equal(existsSync(sentinel), false);
  assert.deepEqual(readdirSync(output), []);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /native parity|format parity|effective fallback/,
  );
});
