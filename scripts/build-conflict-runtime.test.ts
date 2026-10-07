import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertConflictRuntimeBundleMatchesSource,
  buildConflictRuntime,
} from "./build-conflict-runtime.js";

describe("public conflict runtime bundle", () => {
  it("runs without workspace dependencies and retains preflight fail-closed behavior", async () => {
    const root = await mkdtemp(join(tmpdir(), "rr-conflict-bundle-NEWTEST-"));
    try {
      const outfile = join(root, "conflict-runtime.cjs");
      const options = {
        root: process.cwd(),
        outfile,
        ...(process.env.REVIEWROUTER_TEST_TSCONFIG
          ? { tsconfig: process.env.REVIEWROUTER_TEST_TSCONFIG }
          : {}),
      };
      await buildConflictRuntime(options);
      await assertConflictRuntimeBundleMatchesSource(options);
      const bundle = await readFile(outfile, "utf8");
      expect(bundle).not.toContain(process.cwd());
      expect(bundle).not.toContain("node_modules/.pnpm");
      for (const args of [[], ["preflight"]]) {
        const result = spawnSync(process.execPath, [outfile, ...args], {
          cwd: root,
          env: {},
          encoding: "utf8",
          timeout: 10_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          "reviewrouter_conflict_runtime_failed:",
        );
        expect(result.stderr).not.toContain("MODULE_NOT_FOUND");
        if (args.length > 0) {
          expect(result.stderr).toContain("missing_api_url");
        } else {
          expect(result.stderr).toContain(
            "usage:_reviewrouter-conflict-runtime",
          );
        }
      }
      await writeFile(outfile, "stale artifact bytes\n");
      await expect(
        assertConflictRuntimeBundleMatchesSource(options),
      ).rejects.toThrow("conflict_runtime_bundle_stale");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
