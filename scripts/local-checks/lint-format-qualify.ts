import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  admitTools,
  assertNoSymlinks,
  toolVersions,
  writeFixture,
} from "./lint-format-test-support.ts";
import {
  copiedInputCustody,
  digest,
  finishProof,
  recordProofFailure,
  type ProofFailure,
} from "./lint-format-proof.ts";

interface Input {
  readonly path: string;
  readonly bytes: Buffer;
  readonly sha256: string;
}

interface Stage {
  readonly name: string;
  readonly command: readonly string[];
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly elapsedMilliseconds: number;
  readonly output: string;
  readonly outputSha256: string;
}

interface Counts {
  readonly total: number;
  readonly passed: number;
}

interface Results {
  readonly nativeFormatter: Counts;
  readonly safetyAndQualification: Counts;
}

function snapshot(root: string): Input[] {
  const paths = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".gitignore",
    ".prettierignore",
    ".prettierrc.json",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    "eslint.config.mjs",
    "eslint.native-fallback.config.mjs",
    "tsconfig.base.json",
    "tsconfig.lint-format.json",
  ]);
  for (const name of readdirSync(join(root, "scripts/local-checks"))) {
    if (name.startsWith("lint-format-")) {
      paths.add(`scripts/local-checks/${name}`);
    }
  }
  // Preserve the same tracked generated/evidence witnesses read by the suite.
  for (const entry of readFileSync(join(root, ".prettierignore"), "utf8").split(
    /\r?\n/,
  )) {
    if (
      !entry.startsWith("#") &&
      /\.(?:js|md|json|yaml)$/.test(entry) &&
      existsSync(join(root, entry))
    ) {
      paths.add(entry);
    }
  }
  return [...paths].sort().map((path) => {
    const absolute = join(root, path);
    assertNoSymlinks(absolute);
    assert.ok(lstatSync(absolute).isFile(), `Expected an input file: ${path}`);
    const bytes = readFileSync(absolute);
    return { path, bytes, sha256: digest(bytes) };
  });
}

function inputHashes(inputs: readonly Input[]): Record<string, string> {
  return Object.fromEntries(inputs.map(({ path, sha256 }) => [path, sha256]));
}

function outputDirectory(args: readonly string[]): string {
  assert.ok(
    args.length === 0 || (args.length === 2 && args[0] === "--output"),
    "Usage: node scripts/local-checks/lint-format-qualify.ts [--output NEW_DIRECTORY]",
  );
  assert.notEqual(
    process.getuid?.(),
    undefined,
    "Cannot verify private TEST directory ownership",
  );
  const requested = args[1];
  if (requested === undefined) {
    return mkdtempSync(
      join(realpathSync(tmpdir()), "reviewrouter-lint-proof-"),
    );
  }
  const output = resolve(requested);
  assertNoSymlinks(dirname(output));
  mkdirSync(output, { mode: 0o700 });
  return output;
}

function runStage(
  outputRoot: string,
  stages: Stage[],
  name: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout: number,
): void {
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const log = `${name}.log`;
  writeFixture(outputRoot, log, output);
  stages.push({
    name,
    command: [process.execPath, ...args],
    status: result.status,
    signal: result.signal,
    elapsedMilliseconds: performance.now() - started,
    output: log,
    outputSha256: digest(output),
  });
  process.stdout.write(output);
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${name} terminated by signal`);
  assert.equal(
    result.status,
    0,
    `${name} failed; see ${join(outputRoot, log)}`,
  );
}

function nativeCounts(path: string): Counts {
  const report: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(
    typeof report === "object" && report !== null && !Array.isArray(report),
  );
  assert.ok(
    "success" in report && report.success === true,
    "Native suite did not pass",
  );
  for (const name of [
    "numFailedTests",
    "numPendingTests",
    "numTodoTests",
    "numFailedTestSuites",
    "numPendingTestSuites",
  ]) {
    assert.ok(name in report);
    assert.equal(Reflect.get(report, name), 0, `${name} is not a pass`);
  }
  const total: unknown = Reflect.get(report, "numTotalTests");
  const passed: unknown = Reflect.get(report, "numPassedTests");
  assert.ok(
    typeof total === "number" && Number.isSafeInteger(total) && total > 0,
  );
  assert.ok(typeof passed === "number" && passed === total);
  return { total, passed };
}

function nodeCounts(path: string): Counts {
  const output = readFileSync(path, "utf8");
  const count = (name: string): number => {
    const values = [
      ...output.matchAll(new RegExp(`^# ${name} ([0-9]+)\\r?$`, "gm")),
    ];
    const value = values.at(-1)?.[1];
    assert.notEqual(value, undefined, `Missing Node test summary: ${name}`);
    return Number(value);
  };
  for (const name of ["fail", "cancelled", "skipped", "todo"]) {
    assert.equal(count(name), 0, `${name} is not a pass`);
  }
  const total = count("tests");
  const passed = count("pass");
  assert.ok(Number.isSafeInteger(total) && total > 0);
  assert.equal(passed, total);
  return { total, passed };
}

function qualify(
  repository: string,
  subject: string,
  output: string,
  stages: Stage[],
): Results {
  const scratch = join(subject, "output");
  const guard = pathToFileURL(
    join(subject, "scripts/local-checks/lint-format-native-load-guard.ts"),
  ).href;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${guard}`]
      .filter(Boolean)
      .join(" "),
    NODE_TEST_CONTEXT: undefined,
    RR_N1_TEST_ROOT: subject,
    RR_N1_SCRATCH: scratch,
    TMPDIR: scratch,
    REVIEWROUTER_NATIVE_FORMAT_AUDIT: join(output, "native-load-audit.ndjson"),
  };
  runStage(
    output,
    stages,
    "strict-original-project",
    [
      join(repository, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--pretty",
      "false",
      "-p",
      join(repository, "tsconfig.lint-format.json"),
    ],
    repository,
    env,
    60_000,
  );
  runStage(
    output,
    stages,
    "native-formatter-goldens",
    [
      join(repository, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      join(subject, "scripts/local-checks/lint-format-vitest.config.ts"),
      "--configLoader",
      "native",
      "--reporter",
      "json",
      "--outputFile",
      join(output, "native-formatter-results.json"),
    ],
    subject,
    env,
    180_000,
  );
  const nativeFormatter = nativeCounts(
    join(output, "native-formatter-results.json"),
  );
  runStage(
    output,
    stages,
    "safety-and-full-qualification",
    [
      "--test",
      "--test-reporter=tap",
      join(subject, "scripts/local-checks/lint-format-safety.test.ts"),
      join(subject, "scripts/local-checks/lint-format-qualification.ts"),
    ],
    subject,
    env,
    180_000,
  );
  return {
    nativeFormatter,
    safetyAndQualification: nodeCounts(
      join(output, "safety-and-full-qualification.log"),
    ),
  };
}

function main(): void {
  const repository = realpathSync(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  // Fail before TEST allocation, source copying or tool execution on an unqualified graph.
  admitTools(repository);
  const inputs = snapshot(repository);
  const expected = inputHashes(inputs);
  const output = outputDirectory(process.argv.slice(2));
  const subject = join(output, "TEST");
  const scratch = join(subject, "output");
  const stages: Stage[] = [];
  const failures: ProofFailure[] = [];
  let results: Results | undefined;
  try {
    mkdirSync(subject, { mode: 0o700 });
    mkdirSync(scratch, { mode: 0o700 });
    for (const { path, bytes } of inputs) {
      writeFixture(subject, path, bytes);
    }
    writeFixture(
      subject,
      ".rr-n1-test-subject",
      "disposable N1 lint/format subject\n",
    );
    // The installed frozen dependency graph is read through this link. Sources,
    // fixture writes, Vite cache and temporary tool files stay in the private copy.
    symlinkSync(
      realpathSync(join(repository, "node_modules")),
      join(subject, "node_modules"),
      "dir",
    );
    results = qualify(repository, subject, output, stages);
  } catch (error) {
    recordProofFailure(failures, "execution", error);
  }

  // Verify exactly the copied input set, even when a stage failed. Intentional
  // inner TEST fixtures and caches are outside this set.
  let copied: ReturnType<typeof copiedInputCustody> | undefined;
  try {
    copied = copiedInputCustody(subject, expected);
    assert.ok(
      copied.matches,
      "Copied TEST qualification inputs changed during execution",
    );
  } catch (error) {
    recordProofFailure(failures, "copied-inputs", error);
  }
  let after: Record<string, string> | undefined;
  try {
    after = inputHashes(snapshot(repository));
    assert.deepEqual(
      after,
      expected,
      "Original qualification inputs changed during execution",
    );
  } catch (error) {
    recordProofFailure(failures, "original-inputs", error);
  }
  try {
    admitTools(repository);
  } catch (error) {
    recordProofFailure(failures, "installed-identities", error);
  }

  const ledgers: string[] = [];
  const ledgerSha256: Record<string, string> = {};
  let nativeAuditSha256: string | null = null;
  try {
    for (const name of readdirSync(scratch).filter((entry) =>
      /^rule-ledger-.*\.json$/.test(entry),
    )) {
      const bytes = readFileSync(join(scratch, name));
      writeFixture(output, name, bytes);
      ledgers.push(name);
      ledgerSha256[name] = digest(bytes);
    }
    const auditPath = join(output, "native-load-audit.ndjson");
    if (existsSync(auditPath))
      nativeAuditSha256 = digest(readFileSync(auditPath));
    if (failures.length === 0) {
      assert.ok(
        ledgers.length > 0,
        "Full qualification did not produce its independent rule ledger",
      );
      assert.notEqual(
        nativeAuditSha256,
        null,
        "Native qualification did not produce its preload audit",
      );
    }
  } catch (error) {
    recordProofFailure(failures, "evidence", error);
  }

  // The final receipt follows cleanup and records any cleanup debt alongside
  // all earlier failures; no passing receipt is written before TEST removal.
  const receipt = finishProof(
    output,
    {
      nodeVersion: process.version,
      tools: toolVersions,
      originalInputs: expected,
      finalInputs: after,
      copiedInputs: copied,
      stages,
      results,
      ledgers,
      ledgerSha256,
      nativeAuditSha256,
      qualificationScope:
        "Complete maintained lint/format fixture suites and original strict project; whole-repository lint remains a separate gate.",
    },
    failures,
  );
  process.stdout.write(
    JSON.stringify({ ...receipt, evidenceDirectory: output }) + "\n",
  );
  if (receipt.status === "failed") {
    throw new Error(
      receipt.failures
        .map(({ phase, message }) => `${phase}: ${message}`)
        .join("\n"),
    );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? (error.stack ?? error.message) : String(error)) +
      "\n",
  );
  process.exitCode = 1;
}
