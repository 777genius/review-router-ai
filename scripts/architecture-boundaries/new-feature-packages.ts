import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { collectAllSourceFiles, extractImportSpecifiers } from "./sources.ts";
import type { ArchitectureViolation } from "./types.ts";

type LegacyFeaturePolicy = {
  readonly schemaVersion: 1;
  readonly legacyFeaturePackages: readonly string[];
};

type PackageManifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function legacyFeatureNames(root: string): ReadonlySet<string> {
  const path = join(
    root,
    "architecture/consumer-module-standard/legacy-feature-packages.json",
  );
  const policy = readJson<LegacyFeaturePolicy>(path);
  if (
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.legacyFeaturePackages) ||
    policy.legacyFeaturePackages.some(
      (name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(name),
    ) ||
    new Set(policy.legacyFeaturePackages).size !== policy.legacyFeaturePackages.length
  ) {
    throw new Error("invalid_legacy_feature_package_policy");
  }
  return new Set(policy.legacyFeaturePackages);
}

/**
 * Existing packages retain their current qualified adoption scope. Any new
 * packages/features/* package must use a real Get Modular composition and have
 * a runnable test; adding a package to the historical baseline is a policy
 * change that must be reviewed as such, not an implicit bypass.
 */
export async function checkNewFeaturePackageCompositions(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const featureRoot = join(root, "packages/features");
  if (!existsSync(featureRoot)) return;

  const legacy = legacyFeatureNames(root);
  const rootPackage = readJson<PackageManifest>(join(root, "package.json"));
  const expectedCore = rootPackage.devDependencies?.["@get-modular/core"];
  const expectedAssembly = rootPackage.devDependencies?.["@get-modular/assembly"];
  const expectedConformance = rootPackage.devDependencies?.["@get-modular/conformance"];
  if (!expectedCore || !expectedAssembly || !expectedConformance) {
    throw new Error("get_modular_root_pins_missing");
  }

  const directories = readdirSync(featureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of directories) {
    if (legacy.has(name)) continue;
    const pkgRoot = join(featureRoot, name);
    const manifestPath = join(pkgRoot, "package.json");
    const reject = (reason: string, imported = name): void => {
      violations.push({ file: manifestPath, imported, reason });
    };
    if (!existsSync(manifestPath)) {
      reject("New feature packages require a package.json");
      continue;
    }
    const manifest = readJson<PackageManifest>(manifestPath);
    const deps = manifest.dependencies ?? {};
    const dev = manifest.devDependencies ?? {};
    if (
      deps["@get-modular/core"] !== expectedCore ||
      deps["@get-modular/assembly"] !== expectedAssembly
    ) {
      reject("New feature packages must declare the root-pinned Get Modular Core and Assembly");
    }
    if (dev["@get-modular/conformance"] !== expectedConformance) {
      reject("New feature packages must qualify their composition with root-pinned Get Modular Conformance");
    }
    if (!manifest.exports || !Object.hasOwn(manifest.exports, "./composition")) {
      reject("New feature packages must expose a distinct ./composition entrypoint");
    }

    const src = join(pkgRoot, "src");
    if (!existsSync(src)) {
      reject("New feature packages require src/ with a Get Modular composition");
      continue;
    }
    const files = await collectAllSourceFiles(pkgRoot);
    const compositionPrefix = join(src, "composition") + sep;
    const compositionFiles = files.filter(
      (path) =>
        path.startsWith(compositionPrefix) &&
        !/\.(?:test|spec)\.[cm]?tsx?$/u.test(path),
    );
    if (compositionFiles.length === 0) {
      reject("New feature packages require production source under src/composition/");
      continue;
    }
    let hasAssembly = false;
    let hasDeclaration = false;
    for (const file of compositionFiles) {
      const source = readFileSync(file, "utf8");
      const imports = extractImportSpecifiers(source, file);
      if (imports.includes("@get-modular/assembly")) {
        hasAssembly = true;
      }
      if (/\b(?:declareModule|defineContract|assemblyFor|implement)\s*(?:<[^()\n]*>)?\s*\(/u.test(source)) {
        hasDeclaration = true;
      }
    }
    if (!hasAssembly || !hasDeclaration) {
      reject("New feature packages must compose through the Get Modular Assembly descriptors");
    }
    const hasCompositionTest = files.some(
      (file) =>
        /\.(?:test|spec)\.[cm]?tsx?$/u.test(file) &&
        (file.startsWith(compositionPrefix) ||
          file.includes(`${sep}tests${sep}`)),
    );
    if (!hasCompositionTest) {
      reject("New feature packages require a composition test executed by Vitest");
    }
  }
}
