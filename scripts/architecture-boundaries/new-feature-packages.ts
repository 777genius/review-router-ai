import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { collectAllSourceFiles } from "./sources.ts";
import {
  compositionEntrypoints,
  hasAssemblyComposition,
  hasCompositionConformanceTest,
} from "./feature-composition-evidence.ts";
import type { ArchitectureViolation } from "./types.ts";

type LegacyFeaturePolicy = {
  readonly schemaVersion: 1;
  readonly legacyFeaturePackages: readonly string[];
};

type PackageManifest = {
  readonly name?: string;
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
      (name) =>
        typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(name),
    ) ||
    new Set(policy.legacyFeaturePackages).size !==
      policy.legacyFeaturePackages.length
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
  const foundationPolicy = parseYaml(
    readFileSync(
      join(root, "architecture/foundation/provider-seams.yaml"),
      "utf8",
    ),
  ) as { readonly governedRoots?: readonly string[] };
  if (!Array.isArray(foundationPolicy?.governedRoots)) {
    throw new Error("foundation_feature_coverage_missing");
  }
  const governed = new Set(foundationPolicy.governedRoots);
  const expectedCore =
    rootPackage.dependencies?.["@get-modular/core"] ??
    rootPackage.devDependencies?.["@get-modular/core"];
  const expectedAssembly =
    rootPackage.dependencies?.["@get-modular/assembly"] ??
    rootPackage.devDependencies?.["@get-modular/assembly"];
  const expectedConformance =
    rootPackage.devDependencies?.["@get-modular/conformance"];
  if (
    ![expectedCore, expectedAssembly, expectedConformance].every(
      (version) =>
        typeof version === "string" &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version),
    )
  ) {
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
    if (!governed.has("packages/features/" + name + "/src")) {
      reject(
        "New feature packages must be covered by Engineering Foundation source dependencies",
      );
    }
    const deps = manifest.dependencies ?? {};
    const dev = manifest.devDependencies ?? {};
    if (
      deps["@get-modular/core"] !== expectedCore ||
      deps["@get-modular/assembly"] !== expectedAssembly
    ) {
      reject(
        "New feature packages must declare the root-pinned Get Modular Core and Assembly",
      );
    }
    if (dev["@get-modular/conformance"] !== expectedConformance) {
      reject(
        "New feature packages must qualify their composition with root-pinned Get Modular Conformance",
      );
    }
    const src = join(pkgRoot, "src");
    if (!existsSync(src)) {
      reject(
        "New feature packages require src/ with a Get Modular composition",
      );
      continue;
    }
    const files = await collectAllSourceFiles(pkgRoot);
    const compositionPrefix = join(src, "composition") + sep;
    const compositionFiles = new Set(
      files.filter(
        (path) =>
          path.startsWith(compositionPrefix) &&
          !/\.(?:test|spec)\.[cm]?tsx?$/u.test(path) &&
          !/\.d\.[cm]?ts$/u.test(path),
      ),
    );
    const entrypoints = compositionEntrypoints(
      pkgRoot,
      manifest.exports?.["./composition"],
      compositionFiles,
    );
    if (entrypoints.length === 0) {
      reject(
        "New feature packages must expose a distinct ./composition entrypoint backed by production composition source",
      );
    }
    if (compositionFiles.size === 0) {
      reject(
        "New feature packages require production source under src/composition/",
      );
      continue;
    }
    if (!hasAssemblyComposition(entrypoints, compositionFiles)) {
      reject(
        "New feature packages must compose through the Get Modular Assembly descriptors",
      );
    }
    const hasCompositionTest = files.some(
      (file) =>
        (file.startsWith(compositionPrefix) ||
          file.includes(sep + "tests" + sep)) &&
        hasCompositionConformanceTest(
          file,
          compositionFiles,
          manifest.name,
        ),
    );
    if (!hasCompositionTest) {
      reject(
        "New feature packages require an active Vitest composition test using Get Modular Conformance",
      );
    }
  }
}
