import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  isSyntaxNode,
  parseSourceAst,
  walkSourceAst,
  type ParsedSource,
  type SyntaxNode,
} from "../lib/module-import-specifiers.ts";

type ValueImport = Readonly<{
  source: string;
  name: string;
  local: string;
}>;
const descriptors = new Set([
  "declareModule",
  "defineContract",
  "assemblyFor",
  "implement",
]);

function bindingNames(pattern: unknown, names: Set<string>): void {
  if (!isSyntaxNode(pattern)) return;
  if (pattern.type === "Identifier" && typeof pattern.name === "string") {
    names.add(pattern.name);
  } else if (pattern.type === "AssignmentPattern") {
    bindingNames(pattern.left, names);
  } else if (pattern.type === "RestElement") {
    bindingNames(pattern.argument, names);
  } else if (pattern.type === "TSParameterProperty") {
    bindingNames(pattern.parameter, names);
  } else if (
    pattern.type === "ArrayPattern" &&
    Array.isArray(pattern.elements)
  ) {
    for (const item of pattern.elements) bindingNames(item, names);
  } else if (
    pattern.type === "ObjectPattern" &&
    Array.isArray(pattern.properties)
  ) {
    for (const item of pattern.properties) {
      if (isSyntaxNode(item)) {
        bindingNames(
          item.type === "RestElement" ? item.argument : item.value,
          names,
        );
      }
    }
  }
}

function valueImports(parsed: ParsedSource): ValueImport[] {
  const imports: ValueImport[] = [];
  const shadowed = new Set<string>();
  walkSourceAst(parsed.root, (node) => {
    if (
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
      ].includes(node.type) &&
      Array.isArray(node.params)
    ) {
      for (const parameter of node.params) {
        bindingNames(parameter, shadowed);
      }
    }
    if (
      [
        "VariableDeclarator",
        "FunctionDeclaration",
        "FunctionExpression",
        "ClassDeclaration",
        "ClassExpression",
        "TSEnumDeclaration",
      ].includes(node.type)
    ) {
      bindingNames(node.id, shadowed);
    }
    if (node.type === "CatchClause") bindingNames(node.param, shadowed);
    if (
      node.type !== "ImportDeclaration" ||
      node.importKind === "type" ||
      !isSyntaxNode(node.source) ||
      typeof node.source.value !== "string" ||
      !Array.isArray(node.specifiers)
    ) {
      return;
    }
    for (const specifier of node.specifiers) {
      if (
        !isSyntaxNode(specifier) ||
        specifier.importKind === "type" ||
        !isSyntaxNode(specifier.local) ||
        typeof specifier.local.name !== "string"
      ) {
        continue;
      }
      const imported = specifier.imported;
      const name =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : specifier.type === "ImportNamespaceSpecifier"
            ? "*"
            : isSyntaxNode(imported) && typeof imported.name === "string"
              ? imported.name
              : undefined;
      if (name) {
        imports.push({
          source: node.source.value,
          name,
          local: specifier.local.name,
        });
      }
    }
  });
  // Conservatively exclude locally rebound imports instead of approximating
  // TypeScript scope resolution. An unambiguous import alias remains supported.
  return imports.filter((item) => !shadowed.has(item.local));
}

function importedCall(
  callee: unknown,
  imports: readonly ValueImport[],
  source: string,
): string | undefined {
  if (!isSyntaxNode(callee)) return;
  if (callee.type === "Identifier") {
    return imports.find(
      (item) =>
        item.source === source &&
        item.local === callee.name &&
        item.name !== "*",
    )?.name;
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    isSyntaxNode(callee.object) &&
    callee.object.type === "Identifier" &&
    isSyntaxNode(callee.property) &&
    typeof callee.property.name === "string"
  ) {
    const local = callee.object.name;
    if (
      imports.some(
        (item) =>
          item.source === source &&
          item.name === "*" &&
          item.local === local,
      )
    ) {
      return callee.property.name;
    }
  }
}

function sourceTarget(
  target: string,
  sources: ReadonlySet<string>,
): string | undefined {
  const base = target.replace(/\.[cm]?jsx?$/u, "");
  return [
    target,
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) => base + extension),
    resolve(base, "index.ts"),
  ].find((candidate) => sources.has(candidate));
}

function runtimeTargets(value: unknown): (string | null)[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(runtimeTargets);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([condition, target]) => {
      if (condition === "types") return [];
      // Server-only ESM compositions need neither browser nor CommonJS exports.
      if (
        (condition === "browser" || condition === "require") &&
        target === null
      ) {
        return [];
      }
      return runtimeTargets(target);
    });
  }
  // A blocked ESM/runtime condition cannot be repaired by a later default.
  return [null];
}

/** Resolve the package's runtime composition export back to owned source. */
export function compositionEntrypoints(
  pkgRoot: string,
  target: unknown,
  sources: ReadonlySet<string>,
): string[] {
  const resolved = runtimeTargets(target).map((value) => {
    if (
      value === null ||
      !/^\.\/(?:src|dist)\/composition\//u.test(value)
    ) {
      return;
    }
    return sourceTarget(
      resolve(pkgRoot, value.replace(/^\.\/dist\//u, "./src/")),
      sources,
    );
  });
  if (
    resolved.length === 0 ||
    resolved.some((value) => value === undefined)
  ) {
    return [];
  }
  return [
    ...new Set(
      resolved.filter((value): value is string => value !== undefined),
    ),
  ];
}

/** Follow exported runtime imports, never examples or type-only edges. */
export function hasAssemblyComposition(
  entrypoints: readonly string[],
  sources: ReadonlySet<string>,
): boolean {
  const pending = [...entrypoints];
  const visited = new Set<string>();
  let found = false;
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const parsed = parseSourceAst(file, readFileSync(file, "utf8"));
    if (parsed.errors.length > 0) return false;
    const imports = valueImports(parsed);
    walkSourceAst(parsed.root, (node) => {
      if (node.type === "CallExpression") {
        const name = importedCall(
          node.callee,
          imports,
          "@get-modular/assembly",
        );
        if (name && descriptors.has(name)) found = true;
      }
      const runtimeEdge =
        (node.type === "ImportDeclaration" && node.importKind !== "type") ||
        ((node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration") &&
          node.exportKind !== "type");
      if (
        !runtimeEdge ||
        !isSyntaxNode(node.source) ||
        typeof node.source.value !== "string" ||
        !node.source.value.startsWith(".")
      ) {
        return;
      }
      const specifier = node.source.value;
      if (
        node.type === "ImportDeclaration" &&
        !imports.some((item) => item.source === specifier)
      ) {
        return;
      }
      if (
        node.type === "ExportNamedDeclaration" &&
        Array.isArray(node.specifiers) &&
        node.specifiers.length > 0 &&
        node.specifiers.every(
          (item) => isSyntaxNode(item) && item.exportKind === "type",
        )
      ) {
        return;
      }
      const target = sourceTarget(
        resolve(dirname(file), specifier),
        sources,
      );
      if (target) pending.push(target);
    });
  }
  return found;
}

function vitestFunction(
  callee: unknown,
  imports: readonly ValueImport[],
): Readonly<{ name: string; modifiers: readonly string[] }> | undefined {
  if (!isSyntaxNode(callee)) return;
  const direct = importedCall(callee, imports, "vitest");
  if (direct) return { name: direct, modifiers: [] };
  if (callee.type === "CallExpression") {
    return vitestFunction(callee.callee, imports);
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    isSyntaxNode(callee.property) &&
    typeof callee.property.name === "string"
  ) {
    const root = vitestFunction(callee.object, imports);
    if (root) {
      return {
        name: root.name,
        modifiers: [...root.modifiers, callee.property.name],
      };
    }
  }
}

function activeTest(
  callee: unknown,
  imports: readonly ValueImport[],
): boolean {
  const root = vitestFunction(callee, imports);
  return (
    root !== undefined &&
    ["it", "test"].includes(root.name) &&
    root.modifiers.every((modifier) =>
      ["each", "concurrent", "sequential"].includes(modifier),
    )
  );
}

function skippedSuite(
  callee: unknown,
  imports: readonly ValueImport[],
): boolean {
  const root = vitestFunction(callee, imports);
  return (
    root !== undefined &&
    ["describe", "suite"].includes(root.name) &&
    root.modifiers.some((modifier) =>
      ["skip", "todo", "skipIf", "runIf"].includes(modifier),
    )
  );
}

/** Admission evidence only: Vitest still executes the actual regression. */
export function hasCompositionConformanceTest(
  file: string,
  sources: ReadonlySet<string>,
  packageName: string | undefined,
): boolean {
  // These are the package patterns included by the repository's Vitest config.
  if (!/\.test\.tsx?$/u.test(file)) return false;
  const parsed = parseSourceAst(file, readFileSync(file, "utf8"));
  if (parsed.errors.length > 0) return false;
  const imports = valueImports(parsed);
  const compositionImports = imports.filter(
    (item) =>
      (packageName !== undefined &&
        item.source === packageName + "/composition") ||
      (item.source.startsWith(".") &&
        sourceTarget(resolve(dirname(file), item.source), sources)),
  );
  if (compositionImports.length === 0) return false;
  let found = false;
  const inactive = new Set<SyntaxNode>();
  walkSourceAst(parsed.root, (node, parent) => {
    if (
      (parent && inactive.has(parent)) ||
      (node.type === "CallExpression" && skippedSuite(node.callee, imports))
    ) {
      inactive.add(node);
      return;
    }
    if (
      node.type !== "CallExpression" ||
      !activeTest(node.callee, imports) ||
      !Array.isArray(node.arguments)
    ) {
      return;
    }
    for (const argument of node.arguments) {
      if (
        !isSyntaxNode(argument) ||
        !["ArrowFunctionExpression", "FunctionExpression"].includes(
          argument.type,
        )
      ) {
        continue;
      }
      let callsConformance = false;
      let usesComposition = false;
      walkSourceAst(argument, (child) => {
        if (
          child.type === "CallExpression" &&
          importedCall(child.callee, imports, "@get-modular/conformance")
        ) {
          callsConformance = true;
        }
        if (
          child.type === "Identifier" &&
          compositionImports.some((item) => item.local === child.name)
        ) {
          usesComposition = true;
        }
      });
      if (callsConformance && usesComposition) found = true;
    }
  });
  return found;
}
