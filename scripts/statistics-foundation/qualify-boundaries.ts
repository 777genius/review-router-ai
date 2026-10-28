import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Report = {
  outcome: string;
  capabilities: readonly {
    diagnostics: readonly {
      ruleId: string;
      location?: { path: string };
    }[];
  }[];
};
const root = fileURLToPath(new URL("../../", import.meta.url));
function check(): Report {
  const result = spawnSync(
    process.execPath,
    [
      join(
        root,
        "node_modules/@agent-teams/engineering-foundation/dist/cli.js",
      ),
      "check",
      "--consumer",
      root,
      "--json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  if (result.error || result.signal)
    throw new Error(
      `statistics_boundary_check_failed:${result.error?.message ?? result.signal}`,
    );
  const report = JSON.parse(result.stdout) as Report;
  assert.equal(
    result.status,
    report.outcome === "passed" ? 0 : 1,
    result.stderr || result.stdout,
  );
  return report;
}
const prefix = "packages/features/review-statistics/src";
const fixture = "__statistics_boundary_qualification__.ts";
const cases = [
  {
    name: "allowed-application-domain",
    path: `${prefix}/application/${fixture}`,
    source:
      "import type { StatisticsReport } from '../domain/statistics';\nexport type Report = StatisticsReport;\n",
    rule: null,
  },
  {
    name: "forbidden-domain-infrastructure",
    path: `${prefix}/domain/${fixture}`,
    source: "import '../infrastructure/prisma-statistics-reader';\n",
    rule: "forbidden-boundary-dependency",
  },
  {
    name: "forbidden-application-prisma-type",
    path: `${prefix}/application/${fixture}`,
    source:
      "import type { PrismaClient } from '@prisma/client';\nexport type Client = PrismaClient;\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-application-composition",
    path: `${prefix}/application/${fixture}`,
    source: "import '../composition/index';\n",
    rule: "forbidden-boundary-dependency",
  },
  {
    name: "forbidden-domain-modular",
    path: `${prefix}/domain/${fixture}`,
    source: "import '@get-modular/assembly';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-public-infrastructure",
    path: `${prefix}/index.ts`,
    source:
      "\nexport { PrismaReviewStatisticsReader } from './infrastructure/prisma-statistics-reader';\n",
    rule: "forbidden-boundary-dependency",
    append: true,
  },
] as const;
assert.equal(
  check().outcome,
  "passed",
  "The actual governed workspace must pass before negative fixtures.",
);
const results: { name: string; rule: string | null }[] = [];
for (const item of cases) {
  const path = join(root, item.path);
  const original = "append" in item ? readFileSync(path, "utf8") : null;
  const source = (original ?? "") + item.source;
  writeFileSync(path, source, original === null ? { flag: "wx" } : undefined);
  try {
    const report = check();
    if (item.rule === null) assert.equal(report.outcome, "passed");
    else {
      assert.equal(report.outcome, "violations");
      assert(
        report.capabilities
          .flatMap((x) => x.diagnostics)
          .some(
            (x) =>
              x.ruleId === `architecture.source-dependencies.${item.rule}` &&
              x.location?.path === item.path,
          ),
        JSON.stringify(report),
      );
    }
    results.push({ name: item.name, rule: item.rule });
  } finally {
    assert.equal(
      readFileSync(path, "utf8"),
      source,
      "Refusing to remove a concurrently changed qualification file.",
    );
    if (original === null) unlinkSync(path);
    else writeFileSync(path, original);
  }
}
mkdirSync(join(root, "tmp/statistics-qualification"), { recursive: true });
writeFileSync(
  join(root, "tmp/statistics-qualification/boundaries.json"),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(
  `Statistics real-workspace boundary qualification passed: ${results.length} cases.`,
);
