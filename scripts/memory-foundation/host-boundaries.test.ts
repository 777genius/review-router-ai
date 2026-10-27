import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { checkMemoryHostBoundaries } from "./host-boundaries.ts";

async function fixture(
  files: Readonly<Record<string, string>>,
  work: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "rr-memory-host-guard-"));
  try {
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await mkdir(join(root, "apps/worker/src"), { recursive: true });
    for (const [path, source] of Object.entries(files))
      await writeFile(join(root, path), source);
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("host AST guard rejects value, type, re-export, import-type, dynamic import and require SDK edges", async () => {
  const sdk = "@vectorize-io/hindsight-client";
  const sources = [
    `import '${sdk}';`,
    `import type * as Native from '${sdk}';`,
    `export type * from '${sdk}';`,
    `type Client = import('${sdk}').Client;`,
    `const native = () => import('${sdk}');`,
    `const native = require('${sdk}');`,
    `const native = require.resolve('${sdk}');`,
    `const prefix='@vectorize-io/'; const moduleName=prefix+'hindsight-client'; const native=import(moduleName);`,
  ];
  for (const [index, source] of sources.entries())
    await fixture(
      { [`apps/api/src/source-${index}.ts`]: source },
      async (root) => {
        assert.deepEqual(await checkMemoryHostBoundaries(root), [
          {
            ruleId: "memory-host.sdk-import",
            location: { path: `apps/api/src/source-${index}.ts` },
          },
        ]);
      },
    );
});

test("host AST guard accepts neutral composition/core contracts and ignores prose mentioning SDK", async () => {
  await fixture(
    {
      "apps/api/src/runtime.ts":
        "import type { MemoryKnowledgeRuntime } from '@reviewrouter/features-memory/composition'; import type { MemoryKnowledgeReader } from '@reviewrouter/features-memory'; const docs='@vectorize-io/hindsight-client'; // import '@vectorize-io/hindsight-client';",
    },
    async (root) => assert.deepEqual(await checkMemoryHostBoundaries(root), []),
  );
});

test("host AST guard rejects direct concrete native adapter imports in both hosts", async () => {
  await fixture(
    {
      "apps/api/src/runtime.ts":
        "import type { HindsightMemoryProvider } from '../../../packages/features/memory/src/infrastructure/hindsight/hindsight-memory-provider';",
      "apps/worker/src/worker.ts":
        "export type * from '@reviewrouter/features-memory/infrastructure/hindsight/hindsight-memory-provider';",
    },
    async (root) => {
      const result = await checkMemoryHostBoundaries(root);
      assert.equal(result.length, 2);
      assert(
        result.every(
          (item) => item.ruleId === "memory-host.concrete-provider-import",
        ),
      );
    },
  );
});

test("only explicit native proof test fixture is exempt, and production cannot import that exception", async () => {
  for (const suffix of ["", ".js", ".ts"])
    await fixture(
      {
        "apps/api/src/memory-operator-routes.test.ts":
          "import '@vectorize-io/hindsight-client'; import type { HindsightCleanupProofAdapter } from '../../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-proof-adapter';",
        "apps/api/src/runtime.ts": `import './memory-operator-routes.test${suffix}';`,
      },
      async (root) => {
        assert.deepEqual(await checkMemoryHostBoundaries(root), [
          {
            ruleId: "memory-host.test-fixture-import",
            location: { path: "apps/api/src/runtime.ts" },
          },
        ]);
      },
    );
  await fixture(
    {
      "apps/worker/src/unreviewed.test.ts":
        "import '@vectorize-io/hindsight-client';",
    },
    async (root) =>
      assert.equal(
        (await checkMemoryHostBoundaries(root))[0]?.ruleId,
        "memory-host.sdk-import",
      ),
  );
});
