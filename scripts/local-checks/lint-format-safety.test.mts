import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
import { Script } from "node:vm";
import { after, test } from "node:test";
import {
  admitTools,
  createTestSubject,
  writeFixture,
} from "./lint-format-test-support.mts";

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
    [
      "--test",
      join(root, "scripts/local-checks/lint-format-qualification.mts"),
    ],
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
