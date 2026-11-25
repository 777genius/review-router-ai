import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
  isSyntaxNode,
  parseSourceAst,
  walkSourceAst,
} from "./module-import-specifiers.ts";
import type {
  ModuleLayoutRecords,
  LayoutImport,
  LayoutExport,
} from "@get-modular/conformance";

const isTest = (path: string) =>
  /(?:^|\/)(?:tests|testing)(?:\/|$)|\.(?:test|spec)\.ts$/u.test(path);
export async function collectFeatureLayout(
  root: string,
  sourceRoot: string,
  featureName: string,
): Promise<ModuleLayoutRecords> {
  const layoutPath = (path: string) =>
    path.startsWith(`${sourceRoot}/`)
      ? `features/${featureName}/${path.slice(sourceRoot.length + 1)}`
      : path;
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
    const ast = parseSourceAst(path, text);
    if (ast.errors.length > 0)
      throw new Error(`feature_source_parse:${path}:${ast.errors.join("; ")}`);
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
    const useCase = path.includes("/application/use-cases/");
    const interfacePort =
      path.includes("/domain/") || path.includes("/application/ports/");

    walkSourceAst(ast.root, (node, parent) => {
      if (
        (node.type === "ImportDeclaration" ||
          node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration") &&
        isSyntaxNode(node.source) &&
        typeof node.source.value === "string"
      ) {
        edge(
          node.source.value,
          (node.type === "ImportDeclaration"
            ? node.importKind
            : node.exportKind) === "type",
        );
      }

      const exported =
        parent?.type === "ExportNamedDeclaration" ||
        parent?.type === "ExportDefaultDeclaration";
      if (useCase && exported) {
        if (
          node.type === "FunctionDeclaration" &&
          isSyntaxNode(node.id) &&
          typeof node.id.name === "string"
        ) {
          exports.push({ name: node.id.name, kind: "function" });
        } else if (
          node.type === "VariableDeclaration" &&
          Array.isArray(node.declarations)
        ) {
          for (const declaration of node.declarations) {
            if (!isSyntaxNode(declaration) || !isSyntaxNode(declaration.id))
              continue;
            const id = declaration.id;
            const name =
              id.type === "Identifier" && typeof id.name === "string"
                ? id.name
                : typeof id.start === "number" && typeof id.end === "number"
                  ? text.slice(id.start, id.end)
                  : undefined;
            if (!name) continue;
            exports.push({
              name,
              kind:
                isSyntaxNode(declaration.init) &&
                (declaration.init.type === "ArrowFunctionExpression" ||
                  declaration.init.type === "FunctionExpression")
                  ? "function"
                  : "value",
            });
          }
        } else if (
          node.type === "ClassDeclaration" &&
          isSyntaxNode(node.id) &&
          typeof node.id.name === "string"
        ) {
          exports.push({ name: node.id.name, kind: "value" });
        }
      }

      if (interfacePort && node.type === "TSMethodSignature")
        throw new Error(`feature_port_requires_function_property:${path}`);
    });
    if (path.includes("/application/use-cases/"))
      useCaseExports[path] = exports;
    const lines = text.trimEnd().split("\n").length,
      limit = path.endsWith(".module.ts") ? 80 : 300;
    if (lines > limit)
      throw new Error(`feature_source_size:${path}:${lines}>${limit}`);
    if (path.endsWith(".declaration.ts")) {
      for (const item of imports.filter((item) => item.from === path))
        if (
          !["@get-modular/assembly", "@get-modular/core"].includes(item.to) &&
          !item.to.endsWith(`/${featureName}.contracts.ts`)
        )
          throw new Error(`feature_declaration_import:${path}:${item.to}`);
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
