import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

const runnerUrl = new URL("../run-self-hosted-e2e.mjs", import.meta.url).href;

function isolatedRunnerCheck(body: string) {
  const absentTemporaryRoot = join(tmpdir(), `rr-inert-import-${randomUUID()}`);
  assert.equal(existsSync(absentTemporaryRoot), false);
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", body],
    {
      env: { ...process.env, TMPDIR: absentTemporaryRoot, PATH: "" },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(absentTemporaryRoot), false);
  return result.stdout.trim();
}

test("importing the stock runner has no sandbox or process effects", () => {
  assert.equal(
    isolatedRunnerCheck(
      `const runner = await import(${JSON.stringify(runnerUrl)}); console.log(typeof runner.runSelfHostedE2E);`,
    ),
    "function",
  );
});

test("invalid configuration and a second invocation refuse before sandbox creation", () => {
  const result = isolatedRunnerCheck(`
    const { runSelfHostedE2E } = await import(${JSON.stringify(runnerUrl)});
    const failures = [];
    for (const options of [{ configuredApiOrigin: "https://127.0.0.1:9443" }, {}]) {
      try { await runSelfHostedE2E(options); process.exitCode = 1; }
      catch (error) { failures.push(error.message); }
    }
    console.log(JSON.stringify(failures));
  `);
  assert.deepEqual(JSON.parse(result), [
    "configured_sandbox_api_origin_invalid",
    "self_hosted_e2e_already_invoked",
  ]);
});
