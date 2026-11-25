import "../local-checks/lint-format-native-load-guard.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilerInvocation } from "../local-checks/compiler-cli.ts";
import { verifyNativeJestProfile } from "./verify-profile.ts";

const consumerRequire = createRequire(import.meta.url);
const nativeGuard = new URL(
  "../local-checks/lint-format-native-load-guard.ts",
  import.meta.url,
).href;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packageVersion(
  require: NodeJS.Require,
  packageName: string,
  expectedVersion: string,
): void {
  const manifest: unknown = JSON.parse(
    readFileSync(require.resolve(`${packageName}/package.json`), "utf8"),
  );
  assert(isRecord(manifest), `Invalid ${packageName} manifest`);
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.version, expectedVersion);
}

/** This consumer profile does not change the frozen Action's default toolchain. */
export function nativeJestConfiguration(actionDirectory: string) {
  const actionRoot = realpathSync(actionDirectory);
  const actionRequire = createRequire(resolve(actionRoot, "package.json"));
  packageVersion(actionRequire, "jest", "29.7.0");
  packageVersion(actionRequire, "babel-jest", "29.7.0");
  packageVersion(actionRequire, "@babel/core", "7.29.7");
  // These are private Next entrypoints, qualified with this exact consumer pin.
  packageVersion(consumerRequire, "next", "16.4.6");

  const original: unknown = actionRequire("./jest.config.js");
  assert(isRecord(original), "Expected the paired Action Jest configuration");
  assert.equal(original.preset, "ts-jest");
  assert.equal(original.transform, undefined);
  // Reject a config that JSON transport would silently discard or reinterpret.
  assert.deepEqual(JSON.parse(JSON.stringify(original)), original);
  const configuration = { ...original };
  delete configuration.preset;

  return {
    ...configuration,
    rootDir: actionRoot,
    // Qualification must transform the current inputs, never reuse an old cache.
    cache: false,
    transform: {
      "^.+\\.tsx?$": [
        actionRequire.resolve("babel-jest"),
        {
          babelrc: false,
          configFile: false,
          presets: [
            [
              consumerRequire.resolve(
                "next/dist/compiled/babel/preset-typescript",
              ),
              { allowDeclareFields: true, onlyRemoveTypeImports: false },
            ],
          ],
          plugins: [
            consumerRequire.resolve(
              "next/dist/compiled/babel/plugin-transform-modules-commonjs",
            ),
          ],
        },
      ],
    },
  };
}

function execute(args: readonly string[], cwd: string): number {
  const result = spawnSync(
    process.execPath,
    ["--import", nativeGuard, ...args],
    {
      cwd,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.signal)
    throw new Error(`Qualification terminated by ${result.signal}`);
  return result.status ?? 1;
}

export function checkNativeActionProject(actionDirectory: string): number {
  const actionRoot = realpathSync(actionDirectory);
  const projectPath = resolve(actionRoot, "tsconfig.json");
  const project: unknown = JSON.parse(readFileSync(projectPath, "utf8"));
  assert(isRecord(project) && isRecord(project.compilerOptions));
  assert.equal(project.compilerOptions.strict, true);
  const compiler = compilerInvocation();
  return execute(
    [
      ...compiler.args,
      "--noEmit",
      "--project",
      projectPath,
      // Match the producer's documented native check of its esbuild boundary.
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
    ],
    actionRoot,
  );
}

export function runNativeActionTests(
  actionDirectory: string,
  jestArguments: readonly string[],
): number {
  const actionRoot = realpathSync(actionDirectory);
  const configuration = nativeJestConfiguration(actionRoot);
  const typecheckStatus = checkNativeActionProject(actionRoot);
  if (typecheckStatus !== 0) return typecheckStatus;
  verifyNativeJestProfile(actionRoot, configuration);
  console.log(
    "Paired Action native typecheck and Babel/Jest semantic fixtures passed",
  );
  const actionRequire = createRequire(resolve(actionRoot, "package.json"));
  return execute(
    [
      actionRequire.resolve("jest/bin/jest"),
      "--config",
      JSON.stringify(configuration),
      ...jestArguments,
    ],
    actionRoot,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [actionDirectory, ...jestArguments] = process.argv.slice(2);
    assert(actionDirectory, "Expected the immutable paired Action checkout");
    process.exitCode = runNativeActionTests(actionDirectory, jestArguments);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
