import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkFeatureModule,
  STANDARD,
} from "@agent-teams/feature-module-standard";
import { conformanceCases } from "@agent-teams/feature-module-standard/fixtures";
import type { NodeCheckConfig } from "@agent-teams/feature-module-standard/node";
import {
  checkFeatureModuleOnDisk,
  formatNodeReport,
} from "@agent-teams/feature-module-standard/node";
const root = fileURLToPath(new URL("../../", import.meta.url));
const tool = fileURLToPath(new URL("./", import.meta.url));
const feature = "packages/features/review-skills",
  source = `${feature}/src`;
const profile = JSON.parse(
  await readFile(
    join(root, "architecture/review-skills/consumer-module-profile.json"),
    "utf8",
  ),
);
assert.equal(STANDARD.digest, profile.standards.featureModuleStandard.digest);
const manifest = JSON.parse(
  await readFile(join(root, feature, "package.json"), "utf8"),
);
for (const [name, version] of Object.entries(profile.packages).filter(([n]) =>
  n.startsWith("@get-modular/"),
))
  assert.equal(
    manifest.dependencies?.[name] ?? manifest.devDependencies?.[name],
    version,
  );
const config = (consumerRoot: string): NodeCheckConfig => ({
  consumerRoot,
  sourceRoots: [source],
  testRoots: [`${source}/tests`],
  structure: {
    featureRoots: [feature],
    roleRoots: [
      { root: `${source}/domain`, role: "domain" },
      { root: `${source}/application`, role: "application" },
      { root: `${source}/infrastructure`, role: "adapters" },
      { root: `${source}/composition`, role: "composition" },
      { root: `${source}/testing`, role: "testing" },
      { root: `${source}/index.ts`, role: "composition" },
    ],
  },
  surfaces: {
    public: [`${source}/index.ts`],
    compositionSurface: [`${source}/composition/index.ts`],
    testing: [`${source}/testing/index.ts`],
  },
});
for (const test of conformanceCases) {
  const result = checkFeatureModule(test.input);
  assert.equal(result.ok, test.ok, test.id);
  assert.deepEqual(
    result.diagnostics.map((d) => d.code).sort(),
    [...test.expect].sort(),
    test.id,
  );
}
const report = await checkFeatureModuleOnDisk(config(root));
if (!report.ok) {
  process.stderr.write(formatNodeReport(report));
  process.exit(1);
}
// Independent real file mutation: a domain dependency on application must fail.
await mkdir(join(root, "tmp"), { recursive: true });
const temporary = await mkdtemp(join(root, "tmp/skills-architecture-"));
try {
  await cp(join(root, source), join(temporary, source), { recursive: true });
  await writeFile(
    join(temporary, source, "domain/forbidden.ts"),
    "import { createReviewSkillsService } from '../application/create-review-skills-service';\nexport const forbidden = createReviewSkillsService;\n",
  );
  const rejected = await checkFeatureModuleOnDisk(config(temporary));
  assert.equal(rejected.ok, false);
  assert.ok(rejected.diagnostics.some((d) => d.code === "layer-direction"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const cli = join(
  tool,
  "node_modules/@agent-teams/engineering-foundation/dist/cli.js",
);
for (const args of [
  [
    "check",
    "architecture.source-dependencies",
    "--consumer",
    root,
    "--format",
    "json",
  ],
  ["assert-dev-only", "--consumer", tool, "--json"],
  ["assert-registry", "--consumer", tool, "--json"],
]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_TEAMS_FOUNDATION_NODE_EXECUTABLE: process.execPath,
    },
  });
  if (result.status !== 0) {
    process.stderr.write(
      (result.stdout ?? "") +
        (result.stderr ?? "") +
        (result.error?.message ?? ""),
    );
    process.exit(result.status ?? 1);
  }
}
process.stdout.write(
  `Review Skills scoped architecture passed; ${conformanceCases.length} shared FMS cases and rejecting file mutation.\n`,
);
