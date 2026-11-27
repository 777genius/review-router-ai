import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FlowRecord } from "./flows.js";
import type { VisualRunFlags } from "./fixture-contract.js";
import type { VisualSourceProvenance } from "./onboarding-qualification.js";

export const NATIVE_VISIBILITY_FLOW = "flow-native-visibility";

/** Runs only after the parent's app and DB clients close. Other flows keep
 * their original process environment; the required role flow is still counted. */
export async function runIsolatedNativeVisibility(input: {
  repoRoot: string;
  outDir: string;
  databaseUrl: string;
  flags: VisualRunFlags;
  nextHeapMb: number | undefined;
  browserExecutable: string | undefined;
  source: VisualSourceProvenance;
}): Promise<FlowRecord> {
  const startedAt = Date.now();
  const prefix = "isolated-native-visibility";
  const directory = join(input.outDir, prefix);
  try {
    // A previous child's receipt must never count as this invocation's work.
    await mkdir(directory, { mode: 0o700 });
    const args = [
      "--import",
      "tsx",
      join(input.repoRoot, "scripts/provider-setup-visual/run.ts"),
      "--flows-only",
      "--only",
      `^${NATIVE_VISIBILITY_FLOW}$`,
      "--out",
      directory,
      ...(input.flags.rotating ? ["--rotating"] : []),
      ...(input.flags.nvidiaEvaluation ? ["--nvidia-evaluation"] : []),
      ...(input.nextHeapMb === undefined
        ? []
        : ["--next-heap-mb", String(input.nextHeapMb)]),
    ];
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: input.repoRoot,
        env: {
          ...process.env,
          PROVIDER_VISUAL_DATABASE_URL: input.databaseUrl,
          ...(input.browserExecutable
            ? { PROVIDER_VISUAL_BROWSER_EXECUTABLE: input.browserExecutable }
            : {}),
        },
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const raw = await readFile(join(directory, "manifest.json"), "utf8");
    assert.ok(Buffer.byteLength(raw) <= 1024 * 1024);
    const receipt = JSON.parse(raw) as {
      sourceBefore: VisualSourceProvenance;
      sourceAfter: VisualSourceProvenance;
      flags: VisualRunFlags;
      runtime: { node: string; nextHeapMb: number | null };
      flowSummary: { pass: number; fail: number; skipped: number };
      network: { blocked: unknown[]; githubUnhandled: unknown[] };
      flows: FlowRecord[];
    };
    assert.equal(code, 0, "isolated visibility process must succeed");
    assert.deepEqual(receipt.sourceBefore, input.source);
    assert.deepEqual(receipt.sourceAfter, input.source);
    assert.deepEqual(receipt.flags, input.flags);
    assert.deepEqual(receipt.runtime, {
      node: process.version,
      nextHeapMb: input.nextHeapMb ?? null,
    });
    assert.deepEqual(receipt.flowSummary, { pass: 1, fail: 0, skipped: 0 });
    assert.deepEqual(receipt.network.blocked, []);
    assert.deepEqual(receipt.network.githubUnhandled, []);
    assert.equal(receipt.flows.length, 1);
    const flow = receipt.flows[0]!;
    assert.equal(flow.flow, NATIVE_VISIBILITY_FLOW);
    assert.equal(flow.status, "pass");
    assert.equal(flow.checks.length, 4);
    assert.ok(flow.checks.every((check) => check.pass === true));
    assert.deepEqual(flow.pageErrors, []);
    assert.deepEqual(flow.blockedRequests, []);
    assert.equal(flow.screenshots.length, 4);
    for (const file of flow.screenshots) {
      assert.equal(dirname(file), "flows");
      assert.match(
        basename(file),
        /^flow-native-visibility--\d{2}-[a-z-]+\.png$/,
      );
      assert.ok((await stat(join(directory, file))).size > 0);
    }
    return {
      ...flow,
      screenshots: flow.screenshots.map((file) => join(prefix, file)),
    };
  } catch {
    // The child's own receipt/logs retain detailed evidence; no failure becomes
    // an absent or skipped flow in the parent qualification.
    return {
      flow: NATIVE_VISIBILITY_FLOW,
      title: "Isolated native account role visibility",
      status: "fail",
      reason: `isolated native visibility failed; see ${prefix}/manifest.json and next-app.log`,
      checks: [
        { name: "isolated process and exact source receipt", pass: false },
      ],
      screenshots: [],
      pageErrors: [],
      blockedRequests: [],
      durationMs: Date.now() - startedAt,
    };
  }
}
