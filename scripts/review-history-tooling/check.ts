import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkModuleLayout } from "@get-modular/conformance";
import { collectHistoryLayout, sourceRoot } from "./collect-layout.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const profilePath = "architecture/review-history/consumer-module-profile.json";
const decisionPath =
  "ai-docs/decisions/032-review-history-scoped-composition.md";
// Independent reviewed identities: a drifted profile must not validate itself.
const identities = {
  cmsCommit: "7a7c4c54add9ccc06509423d7b89bcfc037227b1",
  cmsBlob: "df4eff7235ac781ec574903c6b2aec13bcd7bfaa",
  cmsDigest: "3c5814ebf1ab1bd17688e49955aa0baa2ee91dd3a369adcea4d38aaccd53ba86",
  guideDigest:
    "9bdbc6a6eac511691cf429c7e7e12b4cf4fd86ec16a348fb3af7a46c989af144",
  fmsDigest: "cfa088ef7396139554fe5e3bcc839271b23299c6b60c569a3a7f1cd7c9f0bc6c",
};
type Profile = {
  decision: string;
  sourceRoot: string;
  layoutMapping: { physical: string; conformance: string };
  productionRoot: string;
  group: string;
  module: string;
  standards: {
    consumerModuleStandard: { commit: string; gitBlob: string; sha256: string };
    moduleAuthoringGuide: { commit: string; sha256: string };
    featureModuleStandard: { version: string; sha256: string };
  };
  packages: Record<string, string>;
  fixedAdapters: string[];
  exceptions: unknown[];
};
type Manifest = {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
function checkPins(profile: Profile): void {
  assert.equal(
    profile.standards.consumerModuleStandard.commit,
    identities.cmsCommit,
  );
  assert.equal(
    profile.standards.consumerModuleStandard.gitBlob,
    identities.cmsBlob,
  );
  assert.equal(
    profile.standards.consumerModuleStandard.sha256,
    identities.cmsDigest,
  );
  assert.equal(
    profile.standards.moduleAuthoringGuide.commit,
    identities.cmsCommit,
  );
  assert.equal(
    profile.standards.moduleAuthoringGuide.sha256,
    identities.guideDigest,
  );
  assert.equal(profile.standards.featureModuleStandard.version, "v1.1");
  assert.equal(
    profile.standards.featureModuleStandard.sha256,
    identities.fmsDigest,
  );
  assert.equal(profile.sourceRoot, sourceRoot);
  assert.deepEqual(profile.layoutMapping, {
    physical: sourceRoot,
    conformance: "features/review-history",
  });
  assert.equal(
    profile.productionRoot,
    `${sourceRoot}/composition/review-history.root.ts`,
  );
  assert.equal(
    profile.group,
    `${sourceRoot}/composition/review-history.group.ts`,
  );
  assert.equal(
    profile.module,
    `${sourceRoot}/composition/review-history.module.ts`,
  );
  assert.equal(profile.decision, decisionPath);
  assert.deepEqual(profile.exceptions, []);
}
function checkCommands(manifest: Manifest): void {
  assert.equal(
    manifest.scripts["history:architecture"],
    "node --import tsx scripts/review-history-tooling/check.ts",
  );
  assert(
    manifest.scripts["architecture:check"]
      ?.split("&&")
      .map((part) => part.trim())
      .includes("pnpm history:architecture"),
  );
  assert(
    manifest.scripts["modular:qualify"]?.includes(
      "packages/features/review-history/src/composition/review-history.root.test.ts",
    ),
  );
  assert(!manifest.scripts["modular:qualify"]?.includes("echo "));
}
async function foundation(expectedRule?: string): Promise<void> {
  const outcome = spawnSync(
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
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert(
    !outcome.error && !outcome.signal,
    outcome.error?.message ?? outcome.signal ?? "",
  );
  const report = JSON.parse(outcome.stdout) as {
    outcome: string;
    capabilities: {
      diagnostics: { ruleId: string; location?: { path: string } }[];
    }[];
  };
  if (!expectedRule)
    assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
  else {
    assert.equal(outcome.status, 1, outcome.stdout + outcome.stderr);
    assert(
      report.capabilities
        .flatMap((capability) => capability.diagnostics)
        .some(
          (diagnostic) =>
            diagnostic.ruleId.endsWith(expectedRule) &&
            diagnostic.location?.path.includes("__history_reject__"),
        ),
      outcome.stdout,
    );
  }
}
const profile = JSON.parse(
  await readFile(join(root, profilePath), "utf8"),
) as Profile;
const manifest = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
) as Manifest;
checkPins(profile);
checkCommands(manifest);
const featureManifest = JSON.parse(
  await readFile(
    join(root, "packages/features/review-history/package.json"),
    "utf8",
  ),
) as Manifest;
assert.deepEqual(profile.packages, {
  "@get-modular/core": "0.7.0",
  "@get-modular/assembly": "0.7.0",
  "@get-modular/conformance": "0.5.0",
  "@get-modular/resources": "0.2.1",
});
for (const [name, version] of Object.entries(profile.packages))
  assert.equal(
    featureManifest.dependencies?.[name] ??
      featureManifest.devDependencies?.[name],
    version,
  );
for (const path of [
  profile.productionRoot,
  profile.group,
  profile.module,
  profile.decision,
  ...profile.fixedAdapters,
])
  assert((await readFile(join(root, path), "utf8")).length > 0, path);
assert(
  (await readFile(join(root, decisionPath), "utf8")).includes(
    "consumer-module-profile.json",
  ),
);
assert(
  (await readFile(join(root, "ai-docs/decisions/README.md"), "utf8")).includes(
    "032-review-history-scoped-composition.md",
  ),
);
const records = await collectHistoryLayout(root);
assert.deepEqual(checkModuleLayout(records).violations, []);
const nativeConfig = JSON.parse(
  await readFile(join(root, "tsconfig.modular.json"), "utf8"),
) as { include: string[] };
assert(
  nativeConfig.include.includes("packages/features/review-history/src/**/*.ts"),
);
// Reject changed pins and disabled entry chains without mutating repository files.
assert.throws(() => checkPins({ ...profile, productionRoot: "missing.ts" }));
assert.throws(() =>
  checkPins({
    ...profile,
    standards: {
      ...profile.standards,
      consumerModuleStandard: {
        ...profile.standards.consumerModuleStandard,
        sha256: "0".repeat(64),
      },
    },
  }),
);
assert.throws(() =>
  checkCommands({
    ...manifest,
    scripts: { ...manifest.scripts, "history:architecture": "echo passed" },
  }),
);
assert.throws(() =>
  checkCommands({
    ...manifest,
    scripts: { ...manifest.scripts, "architecture:check": "echo passed" },
  }),
);
await mkdir(join(root, "tmp"), { recursive: true });
const temporary = await mkdtemp(join(root, "tmp/history-layout-"));
try {
  await cp(join(root, sourceRoot), join(temporary, sourceRoot), {
    recursive: true,
  });
  const unowned = `${sourceRoot}/composition/unowned.module.ts`;
  await writeFile(
    join(temporary, unowned),
    "export const unknownModule = {};\n",
    { flag: "wx" },
  );
  const unknownRecords = await collectHistoryLayout(temporary);
  assert.throws(
    () => checkModuleLayout(unknownRecords),
    /unowned\.module\.ts/u,
  );
  await unlink(join(temporary, unowned));
  await unlink(join(temporary, profile.module));
  const missingRecords = await collectHistoryLayout(temporary);
  assert.throws(() => checkModuleLayout(missingRecords), /orphan-declaration/u);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
await foundation();
// Real Foundation type/value edge qualification; never run concurrent qualifiers.
for (const [directory, source, rule] of [
  [
    "application/ports",
    "import type { PrismaClient } from '@prisma/client';\nexport type Forbidden = PrismaClient;\n",
    "forbidden-package-dependency",
  ],
  [
    "domain",
    "import '../../composition/review-history.root.js';\n",
    "forbidden-boundary-dependency",
  ],
] as const) {
  const relative = `${sourceRoot}/${directory}/__history_reject__.ts`,
    path = join(root, relative);
  // Domain fixture deliberately resolves the feature's real composition root.
  const body =
    directory === "domain"
      ? source.replace("../../composition", "../composition")
      : source;
  await writeFile(path, body, { flag: "wx" });
  try {
    await foundation(rule);
  } finally {
    assert.equal(await readFile(path, "utf8"), body);
    await unlink(path);
  }
}
console.log(
  "Review History scoped pins/layout/import rejection qualification passed.",
);
