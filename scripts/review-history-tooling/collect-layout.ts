import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import type {
  ModuleLayoutRecords,
  LayoutImport,
  LayoutExport,
} from "@get-modular/conformance";

export const sourceRoot = "packages/features/review-history/src";
// The scoped profile maps the package's src/ to the CMS feature-root layout.
const layoutPath = (path: string) =>
  path.startsWith(`${sourceRoot}/`)
    ? `features/review-history/${path.slice(sourceRoot.length + 1)}`
    : path;
const isTest = (path: string) =>
  /(?:^|\/)(?:tests|testing)(?:\/|$)|\.(?:test|spec)\.ts$/u.test(path);
export async function collectHistoryLayout(
  root: string,
): Promise<ModuleLayoutRecords> {
  const files: string[] = [],
    imports: LayoutImport[] = [];
  const useCaseExports: Record<string, LayoutExport[]> = {};
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(join(root, path), {
      withFileTypes: true,
    })) {
      const child = `${path}/${entry.name}`;
      if (isTest(child)) continue;
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith(".ts")) files.push(child);
    }
  }
  await walk(sourceRoot);
  files.sort();
  for (const path of files) {
    const text = await readFile(join(root, path), "utf8");
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const exports: LayoutExport[] = [];
    const edge = (specifier: string, typeOnly: boolean) => {
      const target = specifier.startsWith(".")
        ? posix
            .normalize(`${dirname(path)}/${specifier}`)
            .replace(/\.js$/u, ".ts")
        : specifier;
      imports.push({
        from: path,
        to: target,
        mode: typeOnly ? "type" : "value",
      });
    };
    function inspect(node: ts.Node): void {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        edge(node.moduleSpecifier.text, node.importClause?.isTypeOnly ?? false);
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        edge(node.moduleSpecifier.text, node.isTypeOnly);
      if (
        path.includes("/application/use-cases/") &&
        ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (ts.isFunctionDeclaration(node) && node.name)
          exports.push({ name: node.name.text, kind: "function" });
        else if (ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations)
            exports.push({
              name: declaration.name.getText(ast),
              kind:
                declaration.initializer &&
                (ts.isArrowFunction(declaration.initializer) ||
                  ts.isFunctionExpression(declaration.initializer))
                  ? "function"
                  : "value",
            });
        else if (ts.isClassDeclaration(node) && node.name)
          exports.push({ name: node.name.text, kind: "value" });
      }
      if (
        (path.includes("/domain/") || path.includes("/application/ports/")) &&
        ts.isMethodSignature(node)
      )
        throw new Error(`history_port_requires_function_property:${path}`);
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
    if (path.includes("/application/use-cases/"))
      useCaseExports[path] = exports;
    const lines = text.trimEnd().split("\n").length,
      limit = path.endsWith(".module.ts") ? 80 : 300;
    if (lines > limit)
      throw new Error(`history_source_size:${path}:${lines}>${limit}`);
    if (path.endsWith(".declaration.ts")) {
      for (const item of imports.filter((item) => item.from === path))
        if (
          !["@get-modular/assembly", "@get-modular/core"].includes(item.to) &&
          !item.to.endsWith("/review-history.contracts.ts")
        )
          throw new Error(`history_declaration_import:${path}:${item.to}`);
    }
  }
  return {
    files: files.map(layoutPath),
    imports: imports.map((item) => ({
      ...item,
      from: layoutPath(item.from),
      to: layoutPath(item.to),
    })),
    useCaseExports: Object.fromEntries(
      Object.entries(useCaseExports).map(([path, exports]) => [
        layoutPath(path),
        exports,
      ]),
    ),
  };
}
