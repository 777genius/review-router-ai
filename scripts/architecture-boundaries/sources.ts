import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const allowedLayerSegments = new Set(["domain", "application"]);
const architecturalLayerSegments = new Set([
  ...allowedLayerSegments,
  "infrastructure",
  "interface",
  "composition",
  "adapters",
  "contract-source",
  "testing",
  "tests",
]);
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

export async function collectBoundaryFiles(
  directory: string,
  boundaryRoot: string,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectBoundaryFiles(path, boundaryRoot)));
      continue;
    }
    if (!entry.isFile() || !isSourceFile(entry.name)) {
      continue;
    }
    if (isDomainOrApplicationFile(path, boundaryRoot)) {
      collected.push(path);
    }
  }

  return collected.sort();
}

function isSourceFile(fileName: string): boolean {
  return [...sourceExtensions].some((extension) =>
    fileName.endsWith(extension),
  );
}

function isDomainOrApplicationFile(
  path: string,
  boundaryRoot: string,
): boolean {
  const segments = relative(boundaryRoot, path).split(/[\\/]/);
  const srcIndex = segments.indexOf("src");
  if (srcIndex === -1) {
    return false;
  }
  // Subfeatures may precede their layer (v2/domain, account-limits/application).
  // The first layer owns the file: domain/infrastructure stays core, while
  // infrastructure/domain stays an adapter.
  const layer = segments
    .slice(srcIndex + 1, -1)
    .find((segment) => architecturalLayerSegments.has(segment));
  return layer !== undefined && allowedLayerSegments.has(layer);
}

export function extractImportSpecifiers(source: string): ReadonlySet<string> {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^'";]+?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) {
        specifiers.add(value);
      }
    }
  }

  return specifiers;
}

export async function collectAllSourceFiles(
  directory: string,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected: string[] = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectAllSourceFiles(path)));
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      collected.push(path);
    }
  }
  return collected.sort();
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
