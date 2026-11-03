import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

type BoundaryViolation = Readonly<{
  file: string;
  imported: string;
  reason: string;
}>;

const features = [
  "workflow-provisioning",
  "review-config",
  "audit-log",
] as const;
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];
const outerLayers = new Set([
  "infrastructure",
  "interface",
  "composition",
  "adapters",
  "testing",
  "tests",
]);
const coreLayers = new Set(["domain", "application"]);

/** Bounded adoption for three existing owners; external legacy graphs remain out of scope. */
export async function checkApplicationCompositionBoundaries(
  root: string,
  imports: (source: string) => Iterable<string>,
): Promise<BoundaryViolation[]> {
  const violations: BoundaryViolation[] = [];
  const featureRoot = join(root, "packages", "features");
  if (!existsSync(featureRoot)) return violations;
  const profiles = features.map((name) => ({
    name,
    packageName: `@reviewrouter/features-${name}`,
    sourceRoot: join(featureRoot, name, "src"),
  }));

  function outerImport(file: string, imported: string): boolean {
    for (const profile of profiles) {
      if (imported.startsWith(`${profile.packageName}/`)) {
        const subpath = imported.slice(profile.packageName.length + 1);
        if (outerLayers.has(subpath.split("/")[0]!)) return true;
      }
      if (imported.startsWith(".")) {
        const target = resolve(dirname(file), imported);
        const path = relative(profile.sourceRoot, target);
        if (inside(path) && outerLayers.has(firstLayer(path) ?? ""))
          return true;
      }
    }
    return false;
  }

  // All feature core consumers must respect the selected owners' outer boundary.
  for (const file of await sourceFiles(featureRoot)) {
    const path = relative(featureRoot, file);
    const segments = path.split(/[\\/]/u);
    const src = segments.indexOf("src");
    if (
      src < 0 ||
      !coreLayers.has(firstLayer(segments.slice(src + 1).join("/")) ?? "")
    )
      continue;
    for (const imported of imports(readFileSync(file, "utf8"))) {
      if (outerImport(file, imported))
        violations.push({
          file,
          imported,
          reason:
            "feature core cannot depend on selected composition or infrastructure adapters",
        });
    }
  }

  for (const profile of profiles) {
    if (!existsSync(profile.sourceRoot)) continue;
    const manifest = join(profile.sourceRoot, "..", "package.json");
    const entrypoint = join(profile.sourceRoot, "index.ts");
    const composition = join(profile.sourceRoot, "composition", "index.ts");
    const expectedComposition = {
      types: "./src/composition/index.ts",
      production: "./dist/composition/index.js",
      default: "./src/composition/index.ts",
    };
    let validExport = false;
    if (existsSync(manifest)) {
      const value: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      const exports = record(record(value)?.exports);
      const conditions = record(exports?.["./composition"]);
      const rootConditions = record(exports?.["."]);
      validExport =
        conditions !== null &&
        rootConditions !== null &&
        Object.keys(conditions).length === 3 &&
        Object.keys(rootConditions).length === 3 &&
        Object.entries(expectedComposition).every(
          ([key, value]) => conditions[key] === value,
        ) &&
        rootConditions.types === "./src/index.ts" &&
        rootConditions.production === "./dist/index.js" &&
        rootConditions.default === "./src/index.ts";
    }
    if (!validExport || !existsSync(composition) || !existsSync(entrypoint))
      violations.push({
        file: manifest,
        imported: "./composition",
        reason:
          "selected application roots require source, type and production composition entrypoints",
      });

    // Follow only this owner's local public-root graph. This catches a forwarding
    // barrel without attempting to certify other legacy packages transitively.
    const pending = [entrypoint];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (visited.has(file) || !existsSync(file)) continue;
      visited.add(file);
      for (const imported of imports(readFileSync(file, "utf8"))) {
        if (outerImport(file, imported)) {
          violations.push({
            file,
            imported,
            reason:
              "selected application root cannot expose composition or infrastructure adapters, including forwarding modules",
          });
          continue;
        }
        if (!imported.startsWith(".")) continue;
        const target = resolve(dirname(file), imported);
        if (!inside(relative(profile.sourceRoot, target))) continue;
        const source = sourcePath(target);
        if (source) pending.push(source);
      }
    }
  }
  return violations;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inside(path: string): boolean {
  return (
    path !== ".." &&
    !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}

function firstLayer(path: string): string | undefined {
  return path
    .split(/[\\/]/u)
    .find((part) => coreLayers.has(part) || outerLayers.has(part));
}

function sourcePath(target: string): string | undefined {
  const extension = extname(target);
  const base = [".js", ".jsx", ".mjs", ".cjs"].includes(extension)
    ? target.slice(0, -extension.length)
    : target;
  return [
    base,
    ...sourceExtensions.map((extension) => base + extension),
    join(base, "index.ts"),
  ].find(
    (candidate) =>
      sourceExtensions.some((extension) => candidate.endsWith(extension)) &&
      existsSync(candidate),
  );
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (
      entry.isFile() &&
      sourceExtensions.some((extension) => path.endsWith(extension))
    )
      files.push(path);
  }
  return files;
}
