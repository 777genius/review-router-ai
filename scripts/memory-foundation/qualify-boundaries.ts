import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Report = {
  readonly outcome: string;
  readonly capabilities: readonly {
    readonly diagnostics: readonly {
      readonly ruleId: string;
      readonly location?: { readonly path: string };
    }[];
  }[];
};
type Fixture = {
  readonly name: string;
  readonly path: string;
  readonly source: string;
  readonly rule: string | null;
};

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(
  root,
  "node_modules/@agent-teams/engineering-foundation/dist/cli.js",
);
const policyPath = "architecture/foundation/provider-seams.yaml";
const evidencePath = join(
  root,
  "tmp/memory-foundation/boundary-qualification.json",
);
const fixtureName = "__foundation_memory_qualification__.ts";
const memoryRoot = "packages/features/memory/src";
const fixtures: readonly Fixture[] = [
  {
    name: "allowed-application-domain-contract",
    path: `${memoryRoot}/application/${fixtureName}`,
    source:
      "import type { MemoryItemSnapshot } from '../domain/memory-item';\nexport type Snapshot = MemoryItemSnapshot;\n",
    rule: null,
  },
  {
    name: "allowed-sdk-in-infinity-adapter",
    path: `${memoryRoot}/infrastructure/infinity/${fixtureName}`,
    source: "import '@infinity-context/sdk';\n",
    rule: null,
  },
  {
    name: "forbidden-sdk-domain-value",
    path: `${memoryRoot}/domain/${fixtureName}`,
    source: "import '@infinity-context/sdk';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-sdk-application-type",
    path: `${memoryRoot}/application/${fixtureName}`,
    source:
      "import type * as Sdk from '@infinity-context/sdk';\nexport type LeakedSdk = typeof Sdk;\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-sdk-application-reexport",
    path: `${memoryRoot}/application/${fixtureName}`,
    source: "export * from '@infinity-context/sdk';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-sdk-application-type-reexport",
    path: `${memoryRoot}/application/${fixtureName}`,
    source: "export type * from '@infinity-context/sdk';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-application-outward-import",
    path: `${memoryRoot}/application/${fixtureName}`,
    source: "import '../infrastructure/prisma/prisma-memory-search-index';\n",
    rule: "forbidden-boundary-dependency",
  },
  {
    name: "forbidden-domain-application-import",
    path: `${memoryRoot}/domain/${fixtureName}`,
    source: "import '../application/ports/memory-search-index-port';\n",
    rule: "forbidden-boundary-dependency",
  },
  {
    name: "forbidden-get-modular-application-import",
    path: `${memoryRoot}/application/${fixtureName}`,
    source: "import '@get-modular/core';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "unknown-memory-source",
    path: `${memoryRoot}/${fixtureName}`,
    source: "export const unowned = true;\n",
    rule: "unclassified-source-file",
  },
];

function check(): {
  readonly report: Report;
  readonly exitCode: number | null;
} {
  const result = spawnSync(
    process.execPath,
    [cli, "check", "--consumer", root, "--json"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert(
    !result.error && !result.signal,
    `Foundation did not complete: ${result.error?.message ?? result.signal}`,
  );
  const report = JSON.parse(result.stdout) as Report;
  assert.equal(
    result.status,
    report.outcome === "passed" ? 0 : 1,
    result.stderr || result.stdout,
  );
  return { report, exitCode: result.status };
}

// Exercise the real installed CLI against the complete existing governed source
// universe. Run sequentially: these fixtures deliberately make that check fail.
// Never run another architecture/qualification check concurrently with this one.
rmSync(evidencePath, { force: true });
const baseline = check();
assert.equal(
  baseline.report.outcome,
  "passed",
  JSON.stringify(baseline.report),
);
const results: {
  name: string;
  path: string;
  expectedRule: string | null;
  exitCode: number | null;
}[] = [];
for (const fixture of fixtures) {
  const path = join(root, fixture.path);
  // Exclusive creation prevents this tool overwriting a source file or a
  // fixture left behind by another run. Only this run's unchanged bytes are removed.
  writeFileSync(path, fixture.source, { flag: "wx" });
  try {
    const { report, exitCode } = check();
    if (fixture.rule === null) {
      assert.equal(report.outcome, "passed", JSON.stringify(report));
    } else {
      assert.equal(report.outcome, "violations", JSON.stringify(report));
      assert(
        report.capabilities
          .flatMap(({ diagnostics }) => diagnostics)
          .some(
            (diagnostic) =>
              diagnostic.ruleId ===
                `architecture.source-dependencies.${fixture.rule}` &&
              diagnostic.location?.path === fixture.path,
          ),
        JSON.stringify(report),
      );
    }
    results.push({
      name: fixture.name,
      path: fixture.path,
      expectedRule: fixture.rule,
      exitCode,
    });
  } finally {
    assert.equal(
      readFileSync(path, "utf8"),
      fixture.source,
      "Concurrent fixture change: preserve it for inspection.",
    );
    unlinkSync(path);
  }
}
const final = check();
assert.equal(final.report.outcome, "passed", JSON.stringify(final.report));
mkdirSync(join(root, "tmp/memory-foundation"), { recursive: true });
writeFileSync(
  evidencePath,
  JSON.stringify(
    {
      policyPath,
      policySha256: createHash("sha256")
        .update(readFileSync(join(root, policyPath)))
        .digest("hex"),
      baselineExitCode: baseline.exitCode,
      finalExitCode: final.exitCode,
      cases: results,
    },
    null,
    2,
  ),
);
console.log(
  `Foundation memory qualification passed: ${results.length} real-workspace cases.`,
);
