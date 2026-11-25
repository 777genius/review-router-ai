import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Report = {
  outcome: string;
  capabilities: {
    diagnostics: { ruleId: string; location?: { path: string } }[];
  }[];
};
const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(
  root,
  "node_modules/@agent-teams/engineering-foundation/dist/cli.js",
);
function check(): Report {
  const result = spawnSync(
    process.execPath,
    [cli, "check", "--consumer", root, "--json"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  if (result.error || result.signal)
    throw new Error(
      `Foundation check did not complete: ${result.error?.message ?? result.signal}`,
    );
  const report = JSON.parse(result.stdout) as Report;
  assert.equal(
    result.status,
    report.outcome === "passed" ? 0 : 1,
    result.stderr || result.stdout,
  );
  return report;
}
// The actual workspace is checked. No reduced workspace or source projection is
// substituted for the production gate. Qualification files are exclusive and
// removed in finally; do not run architecture checks concurrently with this script.
assert.equal(
  check().outcome,
  "passed",
  "Existing governed sources must pass before negative qualification.",
);
const cases = [
  {
    name: "allowed-domain-import",
    path: "packages/features/review-providers/src/domain/__foundation_qualification__.ts",
    source: "import type {} from './provider-catalog';\nexport {};\n",
    rule: null,
  },
  {
    name: "forbidden-value-package",
    path: "packages/features/review-providers/src/domain/__foundation_qualification__.ts",
    source: "import '@prisma/client';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-type-package",
    path: "packages/features/review-providers/src/domain/__foundation_qualification__.ts",
    source:
      "import type { PrismaClient } from '@prisma/client';\nexport type Client = PrismaClient;\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-domain-shared-protocol",
    path: "packages/features/review-providers/src/domain/__foundation_qualification__.ts",
    source: "import '@reviewrouter/shared';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-http-adapter",
    path: "packages/features/review-providers/src/domain/__foundation_qualification__.ts",
    source: "import '../infrastructure/openrouter/openrouter-model-catalog';\n",
    rule: "forbidden-boundary-dependency",
  },
  {
    name: "forbidden-other-feature-internal",
    path: "packages/features/review-providers/src/domain/__foundation_qualification__.ts",
    source:
      "import '../../../review-config/src/domain/review-configuration';\n",
    target:
      "packages/features/review-config/src/domain/review-configuration.ts",
    // A real neighboring file outside the adopted source universe must fail closed.
    rule: "unresolved-local-import",
  },
  {
    name: "unknown-governed-source",
    path: "packages/features/review-providers/src/__foundation_qualification__.ts",
    source: "export const unowned = true;\n",
    rule: "unclassified-source-file",
  },
] as const;
const results: { name: string; rule: string | null }[] = [];
const selected = process.argv.slice(2);
assert(
  selected.every((name) => cases.some((item) => item.name === name)),
  "Unknown qualification case.",
);
for (const item of cases.filter(
  (item) => selected.length === 0 || selected.includes(item.name),
)) {
  if ("target" in item) assert(existsSync(join(root, item.target)));
  const path = join(root, item.path);
  writeFileSync(path, item.source, { flag: "wx" });
  try {
    const report = check();
    if (item.rule === null) assert.equal(report.outcome, "passed");
    else {
      assert.equal(report.outcome, "violations");
      assert(
        report.capabilities
          .flatMap(({ diagnostics }) => diagnostics)
          .some(
            (diagnostic) =>
              diagnostic.ruleId ===
                `architecture.source-dependencies.${item.rule}` &&
              diagnostic.location?.path === item.path,
          ),
        JSON.stringify(report),
      );
    }
    results.push({ name: item.name, rule: item.rule });
  } finally {
    // Refuse to remove a concurrently changed file.
    assert.equal(readFileSync(path, "utf8"), item.source);
    unlinkSync(path);
  }
}
mkdirSync(join(root, "tmp/provider-tooling"), { recursive: true });
writeFileSync(
  join(root, "tmp/provider-tooling/boundary-qualification.json"),
  JSON.stringify(results, null, 2),
);
console.log(
  `Foundation real-workspace qualification passed: ${results.length} cases.`,
);
