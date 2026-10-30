import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCliOptions } from "./accounts-reference-e2e/src/cli.ts";
import { readSourceRevision } from "./accounts-reference-e2e/src/source-revision.ts";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reviewrouter-source-revision-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function commitRepository(root: string): string {
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Source revision fixture",
    "-c",
    "user.email=source-revision@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Source revision fixture",
    "--allow-empty",
  ]);
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function parseOptions(...args: string[]) {
  return parseCliOptions(
    [
      process.execPath,
      "run.ts",
      "--repo-root",
      directory,
      "--isolated-pglite",
      ...args,
    ],
    {},
  );
}

describe("Accounts browser source revision", () => {
  it("keeps a missing expected revision optional for local runs", () => {
    expect(parseOptions().expectedRevision).toBeNull();
  });

  it("accepts an explicitly supplied immutable SHA", () => {
    const expected = "a".repeat(40);
    expect(parseOptions("--expected-revision", expected).expectedRevision).toBe(
      expected,
    );
    expect(
      parseOptions(`--expected-revision=${expected}`).expectedRevision,
    ).toBe(expected);
  });

  it.each(["main", "a".repeat(39), "A".repeat(40), "", "--bootstrap-only"])(
    "rejects malformed explicit revision %j",
    (expected) => {
      expect(() => parseOptions("--expected-revision", expected)).toThrow(
        "accounts_reference_e2e_expected_revision_must_be_lowercase_full_commit_sha",
      );
    },
  );

  it("rejects an expected revision flag without a value", () => {
    expect(() => parseOptions("--expected-revision")).toThrow(
      "accounts_reference_e2e_expected_revision_must_be_lowercase_full_commit_sha",
    );
  });

  it("reads and accepts the requested checkout's exact revision", async () => {
    const expected = commitRepository(directory);
    await expect(readSourceRevision(directory, expected)).resolves.toBe(
      expected,
    );
    await expect(readSourceRevision(directory, null)).resolves.toBe(expected);
  });

  it("rejects a different committed revision", async () => {
    const actual = commitRepository(directory);
    const expected = "0".repeat(40);
    await expect(readSourceRevision(directory, expected)).rejects.toThrow(
      `accounts_reference_e2e_revision_mismatch:expected=${expected}:actual=${actual}`,
    );
  });

  it("does not substitute an unrelated working-directory checkout", async () => {
    const unrelated = join(directory, "unrelated");
    const sourceCopy = join(directory, "source-copy");
    const unrelatedRevision = commitRepository(unrelated);
    mkdirSync(sourceCopy);
    vi.spyOn(process, "cwd").mockReturnValue(unrelated);

    await expect(readSourceRevision(sourceCopy, null)).resolves.toBe("unknown");
    await expect(
      readSourceRevision(sourceCopy, unrelatedRevision),
    ).rejects.toThrow("actual=unknown");
  });

  it("does not assign an ancestor checkout's identity to a source copy", async () => {
    const ancestorRevision = commitRepository(directory);
    const sourceCopy = join(directory, "source-copy");
    mkdirSync(sourceCopy);

    await expect(readSourceRevision(sourceCopy, null)).resolves.toBe("unknown");
    await expect(
      readSourceRevision(sourceCopy, ancestorRevision),
    ).rejects.toThrow("actual=unknown");
  });

  it("rejects an explicit expectation before the real entrypoint creates fixtures", () => {
    const actual = commitRepository(directory);
    const expected = "0".repeat(40);
    const harnessRoot = fileURLToPath(
      new URL("./accounts-reference-e2e/", import.meta.url),
    );
    const entrypointDirectory = join(directory, "entrypoint");
    mkdirSync(entrypointDirectory);
    for (const name of [
      "run.ts",
      "cli.ts",
      "contracts.ts",
      "source-revision.ts",
    ]) {
      copyFileSync(
        join(harnessRoot, "src", name),
        join(entrypointDirectory, name),
      );
    }
    const workDir = join(
      directory,
      "tmp",
      "accounts-reference-e2e",
      "rejected-source",
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        fileURLToPath(
          new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url),
        ),
        join(entrypointDirectory, "run.ts"),
        "--repo-root",
        directory,
        "--isolated-pglite",
        "--work-dir",
        workDir,
        "--expected-revision",
        expected,
      ],
      { cwd: directory, encoding: "utf8", timeout: 20_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `accounts_reference_e2e_revision_mismatch:expected=${expected}:actual=${actual}`,
    );
    expect(existsSync(workDir)).toBe(false);
  });
});
