import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { statisticsNodeOptions } from "./node-options.ts";

it.each([
  "--max-old-space-size-percentage=100",
  "--max-old-space-size-percentage 100",
  "--max_old_space_size_percentage=100",
  "--max_old-space_size-percentage=100",
  '"--max-old-space-size-percentage=100"',
  '--max-old-"space"-size-percentage=100',
  String.raw`"--max-old-space-size-percen\tage=100"`,
])("rejects inherited percentage heap options: %s", (inherited) => {
  expect(() => statisticsNodeOptions(inherited, 1024)).toThrow(
    "Statistics browser fixtures do not support percentage heap limits in NODE_OPTIONS",
  );
});

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
      const quotedPreload = join(
        directory,
        "guard --max-old-space-size-percentage=100.mjs",
      );
      writeFileSync(
        quotedPreload,
        [
          'import { appendFileSync } from "node:fs";',
          "appendFileSync(process.env.REVIEWROUTER_NATIVE_FORMAT_AUDIT,",
          '  JSON.stringify({ event: "quoted-preload", pid: process.pid }) + "\\n");',
        ].join("\n"),
      );
      const inherited = [
        process.env.NODE_OPTIONS,
        `--import=${guard}`,
        `--import=${JSON.stringify(pathToFileURL(quotedPreload).href.replaceAll("%20", " "))}`,
        '--title="--max-old-space-size-percentage=100"',
        "--max-old-space-size=4096",
        '--max_old_space_size="4096"',
        "--max-semi-space-size=8",
      ]
        .filter(Boolean)
        .join(" ");
      const options = statisticsNodeOptions(inherited, oldSpaceLimitMiB);
      expect(options).toBe(
        `${inherited} --max-old-space-size=${oldSpaceLimitMiB}`,
      );
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
            NODE_OPTIONS: options,
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
      expect(events).toContainEqual(
        expect.objectContaining({ event: "quoted-preload", pid }),
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
