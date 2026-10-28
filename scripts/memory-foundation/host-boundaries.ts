import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, posix, relative } from "node:path";
import ts from "typescript";

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
  node: ts.Node | undefined,
  constants: ReadonlyMap<string, string>,
): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) return constants.get(node.text);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return staticText(node.expression, constants);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
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
      const source = ts.createSourceFile(
        path,
        await readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        false,
        path.endsWith(".tsx") || path.endsWith(".jsx")
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS,
      );
      const constants = new Map<string, string>();
      const declarations: ts.VariableDeclaration[] = [];
      const collect = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
          declarations.push(node);
        ts.forEachChild(node, collect);
      };
      collect(source);
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (const declaration of declarations) {
          const value = staticText(declaration.initializer, constants);
          if (
            value !== undefined &&
            ts.isIdentifier(declaration.name) &&
            constants.get(declaration.name.text) !== value
          ) {
            constants.set(declaration.name.text, value);
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
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
          inspect(staticText(node.moduleSpecifier, constants));
        if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference)
        )
          inspect(staticText(node.moduleReference.expression, constants));
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
          inspect(staticText(node.argument.literal, constants));
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require") ||
            (ts.isPropertyAccessExpression(node.expression) &&
              ts.isIdentifier(node.expression.expression) &&
              node.expression.expression.text === "require" &&
              node.expression.name.text === "resolve"))
        )
          inspect(staticText(node.arguments[0], constants));
        ts.forEachChild(node, visit);
      };
      visit(source);
      for (const ruleId of [...rules].sort())
        diagnostics.push({ ruleId, location: { path } });
    }
  return diagnostics;
}
