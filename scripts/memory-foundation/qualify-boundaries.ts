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

import { checkMemoryHostBoundaries } from "./host-boundaries.ts";

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
  /** Exercise an existing public entrypoint without broadening its policy root. */
  readonly append?: boolean;
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
const fixtures: readonly Fixture[] = [
  {
    name: "allowed-application-domain-contract",
    path: "packages/features/memory/src/application/__foundation_memory_qualification__.ts",
    source:
      "import type { MemoryKnowledgeEntryMetadata } from '../domain/memory-knowledge';\nexport type Snapshot = MemoryKnowledgeEntryMetadata;\n",
    rule: null,
  },
  {
    name: "allowed-sdk-in-hindsight-adapter",
    path: "packages/features/memory/src/infrastructure/hindsight/__foundation_memory_qualification__.ts",
    source: "import '@vectorize-io/hindsight-client';\n",
    rule: null,
  },
  {
    name: "forbidden-sdk-domain-value",
    path: "packages/features/memory/src/domain/__foundation_memory_qualification__.ts",
    source: "import '@vectorize-io/hindsight-client';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-sdk-application-type",
    path: "packages/features/memory/src/application/__foundation_memory_qualification__.ts",
    source:
      "import type * as Sdk from '@vectorize-io/hindsight-client';\nexport type LeakedSdk = typeof Sdk;\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-sdk-application-reexport",
    path: "packages/features/memory/src/application/__foundation_memory_qualification__.ts",
    source: "export * from '@vectorize-io/hindsight-client';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-sdk-application-type-reexport",
    path: "packages/features/memory/src/application/__foundation_memory_qualification__.ts",
    source: "export type * from '@vectorize-io/hindsight-client';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "forbidden-application-outward-import",
    path: "packages/features/memory/src/application/__foundation_memory_qualification__.ts",
    source:
      "import '../infrastructure/prisma/prisma-memory-knowledge-store';\n",
    rule: "forbidden-boundary-dependency",
  },
  {
    name: "forbidden-domain-application-import",
    path: "packages/features/memory/src/domain/__foundation_memory_qualification__.ts",
    source: "import '../application/ports/memory-knowledge-provider-port';\n",
    rule: "forbidden-boundary-dependency",
  },
  {
    name: "forbidden-get-modular-application-import",
    path: "packages/features/memory/src/application/__foundation_memory_qualification__.ts",
    source: "import '@get-modular/core';\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "allowed-public-core-type-export",
    path: "packages/features/memory/src/index.ts",
    source:
      "\nexport type { MemoryKnowledgeReader as QualificationReader } from './application/ports/memory-knowledge-provider-port';\n",
    rule: null,
    append: true,
  },
  {
    name: "forbidden-public-concrete-value-reexport",
    path: "packages/features/memory/src/index.ts",
    source:
      "\nexport { PrismaMemoryKnowledgeStore as QualificationPrisma } from './infrastructure/prisma/prisma-memory-knowledge-store';\n",
    rule: "forbidden-boundary-dependency",
    append: true,
  },
  {
    name: "forbidden-public-concrete-type-reexport",
    path: "packages/features/memory/src/index.ts",
    source:
      "\nexport type { PrismaMemoryKnowledgeStore as QualificationPrisma } from './infrastructure/prisma/prisma-memory-knowledge-store';\n",
    rule: "forbidden-boundary-dependency",
    append: true,
  },
  {
    name: "forbidden-prisma-sdk-import",
    path: "packages/features/memory/src/infrastructure/prisma/prisma-memory-knowledge-store.ts",
    source: "import '@vectorize-io/hindsight-client';\n",
    rule: "forbidden-package-dependency",
    append: true,
  },
  {
    name: "forbidden-prisma-specific-engine-import",
    path: "packages/features/memory/src/infrastructure/prisma/prisma-memory-knowledge-store.ts",
    source:
      "\nexport type { HindsightMemoryProvider as QualificationHindsight } from '../hindsight/hindsight-memory-provider';\n",
    rule: "forbidden-boundary-dependency",
    append: true,
  },
  {
    name: "forbidden-sdk-application-dynamic-import",
    path: "packages/features/memory/src/application/__foundation_memory_qualification__.ts",
    source:
      "export const native = () => import('@vectorize-io/hindsight-client');\n",
    rule: "forbidden-package-dependency",
  },
  {
    name: "allowed-host-neutral-composition-type",
    path: "apps/api/src/memory-operator-routes.ts",
    source:
      "\nexport type { MemoryKnowledgeRuntime as QualificationRuntime } from '@reviewrouter/features-memory/composition';\n",
    rule: null,
    append: true,
  },
  {
    name: "forbidden-api-host-sdk-value",
    path: "apps/api/src/memory-operator-routes.ts",
    source: "\nimport '@vectorize-io/hindsight-client';\n",
    rule: "memory-host.sdk-import",
    append: true,
  },
  {
    name: "forbidden-worker-host-sdk-type",
    path: "apps/worker/src/memory-knowledge-worker.ts",
    source: "\nexport type * from '@vectorize-io/hindsight-client';\n",
    rule: "memory-host.sdk-import",
    append: true,
  },
  {
    name: "forbidden-api-host-native-concrete-type",
    path: "apps/api/src/memory-operator-routes.ts",
    source:
      "\nexport type { HindsightMemoryProvider as QualificationNative } from '../../../packages/features/memory/src/infrastructure/hindsight/hindsight-memory-provider';\n",
    rule: "memory-host.concrete-provider-import",
    append: true,
  },
  {
    name: "forbidden-api-host-dynamic-sdk-import",
    path: "apps/api/src/memory-operator-routes.ts",
    source:
      "\nexport const qualificationLoad = () => import('@vectorize-io/hindsight-client');\n",
    rule: "memory-host.sdk-import",
    append: true,
  },
  {
    name: "forbidden-worker-host-sdk-require",
    path: "apps/worker/src/memory-knowledge-worker.ts",
    source:
      "\nconst qualificationNative = require('@vectorize-io/hindsight-client');\n",
    rule: "memory-host.sdk-import",
    append: true,
  },
  {
    name: "forbidden-production-import-of-native-proof-test-exception",
    path: "apps/api/src/memory-operator-routes.ts",
    source: "\nimport './memory-operator-routes.test';\n",
    rule: "memory-host.test-fixture-import",
    append: true,
  },
  {
    name: "unknown-memory-source",
    path: "packages/features/memory/src/__foundation_memory_qualification__.ts",
    source: "export const unowned = true;\n",
    rule: "unclassified-source-file",
  },
];

async function check(): Promise<{
  readonly report: Report;
  readonly exitCode: number | null;
  readonly hostGuardExitCode: number;
}> {
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
  const hostDiagnostics = await checkMemoryHostBoundaries(root);
  return {
    report: {
      ...report,
      outcome: hostDiagnostics.length ? "violations" : report.outcome,
      capabilities: [...report.capabilities, { diagnostics: hostDiagnostics }],
    },
    exitCode: result.status,
    hostGuardExitCode: hostDiagnostics.length ? 1 : 0,
  };
}

// Exercise the real installed CLI against the complete existing governed source
// universe. Run sequentially: these fixtures deliberately make that check fail.
// Never run another architecture/qualification check concurrently with this one.
rmSync(evidencePath, { force: true });
const baseline = await check();
assert.equal(
  baseline.report.outcome,
  "passed",
  JSON.stringify(baseline.report),
);
const results: {
  name: string;
  path: string;
  expectedRule: string | null;
  foundationExitCode: number | null;
  hostGuardExitCode: number;
}[] = [];
for (const fixture of fixtures) {
  const path = join(root, fixture.path);
  const original = fixture.append ? readFileSync(path, "utf8") : null;
  // Exclusive creation prevents this tool overwriting a source file or a
  // fixture left behind by another run. Existing entrypoints are appended to and
  // restored only if their bytes still match this run's expected modification.
  writeFileSync(path, fixture.source, { flag: fixture.append ? "a" : "wx" });
  try {
    const { report, exitCode, hostGuardExitCode } = await check();
    if (fixture.rule === null) {
      assert.equal(report.outcome, "passed", JSON.stringify(report));
    } else {
      assert.equal(report.outcome, "violations", JSON.stringify(report));
      const expectedRule = fixture.rule.startsWith("memory-host.")
        ? fixture.rule
        : `architecture.source-dependencies.${fixture.rule}`;
      assert(
        report.capabilities
          .flatMap(({ diagnostics }) => diagnostics)
          .some(
            (diagnostic) =>
              diagnostic.ruleId === expectedRule &&
              diagnostic.location?.path === fixture.path,
          ),
        JSON.stringify(report),
      );
    }
    results.push({
      name: fixture.name,
      path: fixture.path,
      expectedRule: fixture.rule,
      foundationExitCode: exitCode,
      hostGuardExitCode,
    });
  } finally {
    assert.equal(
      readFileSync(path, "utf8"),
      (original ?? "") + fixture.source,
      "Concurrent fixture change: preserve it for inspection.",
    );
    if (original === null) unlinkSync(path);
    else writeFileSync(path, original);
  }
}
const final = await check();
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
      foundationBaselineExitCode: baseline.exitCode,
      foundationFinalExitCode: final.exitCode,
      hostGuardBaselineExitCode: baseline.hostGuardExitCode,
      hostGuardFinalExitCode: final.hostGuardExitCode,
      cases: results,
    },
    null,
    2,
  ),
);
console.log(
  `Foundation + supplemental host AST memory qualification passed: ${results.length} real-workspace cases.`,
);
