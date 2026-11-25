import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  collectModuleImportSpecifiers,
  isSyntaxNode,
  parseSourceAst,
  walkSourceAst,
} from "../lib/module-import-specifiers.ts";

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

export function extractImportSpecifiers(
  source: string,
  filename: string,
): ReadonlySet<string> {
  const parsed = parseSourceAst(filename, source);
  // Retain the established diagnostic groups: imports, re-exports, dynamic
  // imports/import types, then require. Within each group keep source order.
  const groups = [
    new Set<string>(),
    new Set<string>(),
    new Set<string>(),
    new Set<string>(),
  ];
  walkSourceAst(parsed.root, (node) => {
    let group: Set<string> | undefined;
    if (node.type === "ImportDeclaration") group = groups[0];
    else if (
      (node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    )
      group = groups[1];
    else if (node.type === "ImportExpression" || node.type === "TSImportType")
      group = groups[2];
    else if (node.type === "TSImportEqualsDeclaration") group = groups[3];
    else if (node.type === "CallExpression" && isSyntaxNode(node.callee)) {
      if (node.callee.type === "Import") group = groups[2];
      else if (
        node.callee.type === "Identifier" &&
        node.callee.name === "require"
      )
        group = groups[3];
    }
    if (!group) return;
    for (const imported of collectModuleImportSpecifiers({
      ...parsed,
      root: node,
      errors: [],
    }))
      group.add(imported);
  });
  const specifiers = new Set<string>();
  for (const group of groups)
    for (const imported of group) specifiers.add(imported);
  // Allowlist policies reject unknown imports; target-specific policies retain
  // their bounded scope rather than inventing a target for a computed import.
  if (parsed.errors.length > 0) specifiers.add("computed module import");
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
