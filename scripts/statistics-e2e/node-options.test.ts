import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { statisticsNodeOptions } from "./node-options.ts";

it.each([1024, 2048] as const)(
  "runs the inherited native guard and keeps the %i MiB scenario heap cap",
  (oldSpaceLimitMiB) => {
    const directory = mkdtempSync(join(tmpdir(), "rr-stat-node-options-"));
    try {
      const auditPath = join(directory, "native-audit.jsonl");
      const guard = new URL(
        "../local-checks/lint-format-native-load-guard.ts",
        import.meta.url,
      ).href;
      const inherited = [
        process.env.NODE_OPTIONS,
        `--import=${guard}`,
        "--max-old-space-size=4096",
        "--max-semi-space-size=8",
      ]
        .filter(Boolean)
        .join(" ");
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'import { getHeapStatistics } from "node:v8"; console.log(process.pid); console.log(getHeapStatistics().heap_size_limit);',
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: {
            NODE_ENV: "test",
            NODE_OPTIONS: statisticsNodeOptions(inherited, oldSpaceLimitMiB),
            REVIEWROUTER_NATIVE_FORMAT_AUDIT: auditPath,
          },
        },
      );
      const [pid, heapLimitBytes] = output.trim().split("\n").map(Number);
      expect(existsSync(auditPath), "inherited guard must run in child").toBe(
        true,
      );
      const events: unknown[] = readFileSync(auditPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(
        expect.objectContaining({ event: "guard-installed", pid }),
      );
      // V8 also reserves young-generation space; the 4 GiB inherited cap must
      // not replace either scenario's maintained 1/2 GiB old-space budget.
      expect(heapLimitBytes).toBeGreaterThanOrEqual(
        oldSpaceLimitMiB * 1024 ** 2,
      );
      expect(heapLimitBytes).toBeLessThan((oldSpaceLimitMiB + 64) * 1024 ** 2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
