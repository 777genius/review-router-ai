import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkModuleLayout } from "@get-modular/conformance";
import { collectFeatureLayout } from "../lib/collect-feature-layout.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = "packages/features/provider-accounts/src/account-metadata";
const profile = JSON.parse(
  await readFile(
    join(root, "architecture/account-metadata/consumer-module-profile.json"),
    "utf8",
  ),
);
assert.equal(profile.sourceRoot, source);
assert.equal(
  profile.productionRoot,
  `${source}/composition/account-metadata.root.ts`,
);
assert.deepEqual(profile.exceptions, []);
assert.equal(
  profile.standards.consumerModuleStandard.commit,
  "7a7c4c54add9ccc06509423d7b89bcfc037227b1",
);
assert.equal(
  profile.standards.consumerModuleStandard.sha256,
  "3c5814ebf1ab1bd17688e49955aa0baa2ee91dd3a369adcea4d38aaccd53ba86",
);
assert.equal(
  profile.standards.moduleAuthoringGuide.sha256,
  "9bdbc6a6eac511691cf429c7e7e12b4cf4fd86ec16a348fb3af7a46c989af144",
);
assert.equal(
  profile.standards.featureModuleStandard.sha256,
  "cfa088ef7396139554fe5e3bcc839271b23299c6b60c569a3a7f1cd7c9f0bc6c",
);
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
for (const [name, version] of Object.entries({
  "@get-modular/core": "0.7.0",
  "@get-modular/assembly": "0.7.0",
  "@get-modular/conformance": "0.5.0",
})) {
  assert.equal(profile.packages[name], version);
  assert.equal(
    manifest.dependencies?.[name] ?? manifest.devDependencies?.[name],
    version,
  );
}
assert(
  manifest.scripts["architecture:check"]
    .split(" && ")
    .includes("pnpm metadata:architecture"),
);
assert(
  manifest.scripts["modular:qualify"].includes(
    `${source}/composition/account-metadata.root.test.ts`,
  ),
);
const config = JSON.parse(
  await readFile(join(root, "tsconfig.account-metadata.json"), "utf8"),
);
assert.equal(config.compilerOptions.skipLibCheck, false);
for (const path of [
  profile.productionRoot,
  profile.group,
  profile.module,
  profile.decision,
  ...profile.fixedAdapters,
])
  assert((await readFile(join(root, path), "utf8")).length > 0);
const records = await collectFeatureLayout(root, source, "account-metadata");
assert.deepEqual(checkModuleLayout(records).violations, []);
// Collected source is the input; the rejecting fixture is not derived from its declarations.
assert.throws(() =>
  checkModuleLayout({
    ...records,
    files: [
      ...records.files,
      "features/account-metadata/composition/orphan.module.ts",
    ],
  }),
);
console.log("Account metadata scoped layout/profile: passed");
