import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const rootPackage = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const rootLock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8").split(
  "\n  apps/",
)[0];

function fixtureFor(name, packagePath, exportSource) {
  const fixture = mkdtempSync(join(tmpdir(), "reviewrouter-root-import-"));
  const linkedPackage = join(fixture, packagePath);
  mkdirSync(join(linkedPackage, "dist"), { recursive: true });
  copyFileSync(
    join(root, packagePath, "package.json"),
    join(linkedPackage, "package.json"),
  );
  writeFileSync(join(linkedPackage, "dist/index.js"), exportSource);
  mkdirSync(join(fixture, "node_modules/@reviewrouter"), { recursive: true });
  if (rootPackage.dependencies[name] === "workspace:*") {
    symlinkSync(linkedPackage, join(fixture, "node_modules", name));
  }
  return fixture;
}

function runFixture(fixture, script) {
  const result = spawnSync(
    process.execPath,
    ["--conditions=production", script],
    {
      cwd: fixture,
      encoding: "utf8",
      env: { NODE_ENV: "test" },
      timeout: 15_000,
      killSignal: "SIGKILL",
      maxBuffer: 65_536,
    },
  );
  assert.ifError(result.error);
  return result;
}

function assertRootLockLink(name, packagePath) {
  assert.ok(
    rootLock.includes(
      `      '${name}':\n        specifier: workspace:*\n        version: link:${packagePath}`,
    ),
    `root lock importer must link ${name} to ${packagePath}`,
  );
}

test("root witness script reaches its guard after resolving the declared platform DB export", () => {
  const name = "@reviewrouter/platform-db";
  const packagePath = "packages/platform/db";
  const source = readFileSync(
    join(root, "scripts/record-runtime-generation-witness-proof.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /import \{ createPrismaClient \} from "@reviewrouter\/platform-db";/,
  );
  assertRootLockLink(name, packagePath);
  const fixture = fixtureFor(
    name,
    packagePath,
    "export function createPrismaClient() { throw new Error('database must remain untouched'); }\n",
  );
  try {
    mkdirSync(join(fixture, "scripts"));
    copyFileSync(
      join(root, "scripts/record-runtime-generation-witness-proof.mjs"),
      join(fixture, "scripts/record-runtime-generation-witness-proof.mjs"),
    );
    copyFileSync(
      join(root, "scripts/verify-runtime-generation-witness.mjs"),
      join(fixture, "scripts/verify-runtime-generation-witness.mjs"),
    );
    const result = runFixture(
      fixture,
      "scripts/record-runtime-generation-witness-proof.mjs",
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /runtime_generation_witness_required:REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS/,
    );
    assert.doesNotMatch(
      result.stderr,
      /ERR_MODULE_NOT_FOUND|database must remain untouched/,
    );
    unlinkSync(join(fixture, "node_modules", name));
    const missing = runFixture(
      fixture,
      "scripts/record-runtime-generation-witness-proof.mjs",
    );
    assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("root protected-environment script resolves its declared release-rollout export", () => {
  const name = "@reviewrouter/features-release-rollout";
  const packagePath = "packages/features/release-rollout";
  const source = readFileSync(
    join(root, "scripts/observe-private-pg17-protected-environment.ts"),
    "utf8",
  );
  const importLine = source.match(
    /^import \{ ReleaseApprovalMode \} from "@reviewrouter\/features-release-rollout";$/m,
  )?.[0];
  assert.ok(
    importLine,
    "the protected-environment script must keep its package import",
  );
  assertRootLockLink(name, packagePath);
  const fixture = fixtureFor(
    name,
    packagePath,
    "export const ReleaseApprovalMode = { Independent: 'independent' };\n",
  );
  try {
    writeFileSync(
      join(fixture, "probe.mjs"),
      `${importLine}\nif (!ReleaseApprovalMode.Independent) throw new Error('missing release export');\n`,
    );
    const result = runFixture(fixture, "probe.mjs");
    assert.equal(result.status, 0, result.stderr);
    unlinkSync(join(fixture, "node_modules", name));
    const missing = runFixture(fixture, "probe.mjs");
    assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
