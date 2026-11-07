import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { AgentInstallStatus } from "./install.ts";

const root = resolve(import.meta.dirname, "../..");
const entrypoint = join(root, "deploy/self-hosted/install.ts");

function invoke(...args: string[]) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: root,
    encoding: "utf8",
    input: "",
    timeout: 10_000,
    env: { ...process.env, CI: "true" },
  });
  assert.equal(result.error, undefined);
  return result;
}

test("agent status works without a TTY and without starting Docker or GitHub", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-agent-status-"));
  try {
    const result = invoke("--status", "--directory", directory);
    assert.equal(result.status, 0, result.stderr);
    const status: AgentInstallStatus = JSON.parse(result.stdout);
    assert.equal(status.schemaVersion, 1);
    assert.equal(status.state, "not_started");
    assert.equal(status.phase, "configuration");
    assert.equal(result.stdout.trim().split("\n").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("default installer returns one machine-readable input request, with private durable status and no credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-agent-input-"));
  try {
    const result = invoke("--directory", directory, "--repo", "example/review-target");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    const status: AgentInstallStatus = JSON.parse(result.stdout);
    assert.equal(status.state, "input_required");
    assert.equal(status.phase, "configuration");
    assert.deepEqual(status.next?.requiredOptions, ["--web-url"]);
    assert.deepEqual(status.next?.argv?.slice(0, 4), [
      "bash",
      "scripts/install-self-hosted.sh",
      "--directory",
      directory,
    ]);
    assert.deepEqual(status.next?.argv?.slice(-2), ["--repo", "example/review-target"]);
    const stateFile = join(directory, "agent-status.json");
    assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")), status);
    const resume = invoke("--status", "--directory", directory);
    assert.equal(resume.status, 0, resume.stderr);
    assert.deepEqual(JSON.parse(resume.stdout), status);
    await assert.rejects(readFile(join(directory, "installation.json"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(join(directory, ".env"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit human mode still requires a terminal, but agent mode does not", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-agent-interactive-"));
  try {
    const result = invoke("--directory", directory, "--interactive");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Interactive setup requires a terminal/);
    assert.equal(result.stdout.trim(), "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("status refuses to follow a private state symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-agent-symlink-"));
  try {
    const target = join(directory, "other-state");
    await symlink(target, join(directory, "agent-status.json"));
    const result = invoke("--status", "--directory", directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlinks are not accepted/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
