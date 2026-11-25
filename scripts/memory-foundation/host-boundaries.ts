import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, posix, relative } from "node:path";
import {
  isSyntaxNode,
  parseSourceAst,
  walkSourceAst,
  type SyntaxNode,
} from "../lib/module-import-specifiers.ts";

export interface MemoryHostBoundaryDiagnostic {
  readonly ruleId:
    | "memory-host.sdk-import"
    | "memory-host.concrete-provider-import"
    | "memory-host.test-fixture-import";
  readonly location: { readonly path: string };
}
const nativeSdk = "@vectorize-io/hindsight-client";
const nativeRoot = "packages/features/memory/src/infrastructure/hindsight";
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const excludedDirectories = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".git",
]);
// These exercise actual signature verification in tests; no production file may
// import this exception. New native proof fixtures require an explicit review.
const nativeProofFixtures = new Set([
  "apps/api/src/memory-operator-routes.test.ts",
]);
const isTest = (path: string) =>
  /(?:^|\/)(?:__tests__|tests)\//.test(path) ||
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
const sourcePath = (path: string) => {
  const candidate = path.replace(/\.(?:[cm]?js|jsx)$/, ".ts");
  return sourceExtensions.has(extname(candidate))
    ? candidate
    : `${candidate}.ts`;
};

async function discover(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !excludedDirectories.has(entry.name))
      paths.push(...(await discover(join(directory, entry.name))));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name)))
      paths.push(join(directory, entry.name));
  }
  return paths.sort();
}

function staticText(
  node: unknown,
  constants: ReadonlyMap<string, string>,
): string | undefined {
  if (!isSyntaxNode(node)) return undefined;
  if (
    (node.type === "Literal" || node.type === "StringLiteral") &&
    typeof node.value === "string"
  )
    return node.value;
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0 &&
    Array.isArray(node.quasis)
  ) {
    const first: unknown = node.quasis[0];
    if (isSyntaxNode(first) && first.value && typeof first.value === "object") {
      const cooked = (first.value as { cooked?: unknown }).cooked;
      if (typeof cooked === "string") return cooked;
    }
  }
  if (node.type === "TSLiteralType") return staticText(node.literal, constants);
  if (node.type === "Identifier" && typeof node.name === "string")
    return constants.get(node.name);
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "ParenthesizedExpression"
  )
    return staticText(node.expression, constants);
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticText(node.left, constants);
    const right = staticText(node.right, constants);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

/** Complement to bounded Foundation v1: actual host source imports, never copied fixtures. */
export async function checkMemoryHostBoundaries(
  root: string,
): Promise<readonly MemoryHostBoundaryDiagnostic[]> {
  const diagnostics: MemoryHostBoundaryDiagnostic[] = [];
  for (const host of ["apps/api/src", "apps/worker/src"])
    for (const file of await discover(join(root, host))) {
      const path = relative(root, file).split("\\").join("/");
      const source = parseSourceAst(path, await readFile(file, "utf8"));
      if (source.errors.length > 0)
        throw new Error(
          `memory_host_parse:${path}:${source.errors.join("; ")}`,
        );
      const constants = new Map<string, string>();
      const declarations: SyntaxNode[] = [];
      walkSourceAst(source.root, (node) => {
        if (
          node.type === "VariableDeclarator" &&
          isSyntaxNode(node.id) &&
          node.id.type === "Identifier"
        )
          declarations.push(node);
      });
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (const declaration of declarations) {
          const value = staticText(declaration.init, constants);
          const name = isSyntaxNode(declaration.id)
            ? declaration.id.name
            : undefined;
          if (
            value !== undefined &&
            typeof name === "string" &&
            constants.get(name) !== value
          ) {
            constants.set(name, value);
            changed = true;
          }
        }
        if (!changed) break;
      }
      const rules = new Set<MemoryHostBoundaryDiagnostic["ruleId"]>();
      const inspect = (specifier: string | undefined) => {
        if (!specifier) return;
        const normalized = specifier.startsWith(".")
          ? posix.normalize(
              posix.join(dirname(path).split("\\").join("/"), specifier),
            )
          : specifier;
        const resolved = specifier.startsWith(".")
          ? sourcePath(normalized)
          : normalized;
        if (!isTest(path) && nativeProofFixtures.has(resolved))
          rules.add("memory-host.test-fixture-import");
        if (nativeProofFixtures.has(path)) return;
        if (specifier === nativeSdk || specifier.startsWith(`${nativeSdk}/`))
          rules.add("memory-host.sdk-import");
        if (
          normalized === nativeRoot ||
          normalized.startsWith(`${nativeRoot}/`) ||
          specifier.startsWith(
            "@reviewrouter/features-memory/infrastructure/hindsight",
          )
        )
          rules.add("memory-host.concrete-provider-import");
      };
      walkSourceAst(source.root, (node) => {
        if (
          node.type === "ImportDeclaration" ||
          node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration"
        )
          inspect(staticText(node.source, constants));
        if (
          node.type === "TSImportEqualsDeclaration" &&
          isSyntaxNode(node.moduleReference) &&
          node.moduleReference.type === "TSExternalModuleReference"
        )
          inspect(staticText(node.moduleReference.expression, constants));
        if (node.type === "TSImportType")
          inspect(staticText(node.source, constants));
        if (node.type === "ImportExpression")
          inspect(staticText(node.source, constants));
        if (node.type === "CallExpression" && isSyntaxNode(node.callee)) {
          const callee = node.callee;
          const direct =
            callee.type === "Import" ||
            (callee.type === "Identifier" && callee.name === "require");
          const member =
            callee.type === "MemberExpression" &&
            !callee.computed &&
            isSyntaxNode(callee.object) &&
            callee.object.type === "Identifier" &&
            callee.object.name === "require" &&
            isSyntaxNode(callee.property) &&
            callee.property.type === "Identifier" &&
            callee.property.name === "resolve";
          if (direct || member)
            inspect(
              staticText(
                Array.isArray(node.arguments) ? node.arguments[0] : undefined,
                constants,
              ),
            );
        }
      });
      for (const ruleId of [...rules].sort())
        diagnostics.push({ ruleId, location: { path } });
    }
  return diagnostics;
}
