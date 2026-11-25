import ts from "typescript";

/**
 * Read module references from the checker's existing syntax tree. Computed
 * references stay explicit so bounded allowlists can reject unknown targets.
 */
export function collectModuleImportSpecifiers(
  source: ts.SourceFile,
): ReadonlySet<string> {
  const specifiers = new Set<string>();

  function visit(node: ts.Node): void {
    let specifier: ts.Node | null | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isImportTypeNode(node)) {
      specifier = ts.isLiteralTypeNode(node.argument)
        ? node.argument.literal
        : null;
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      specifier = node.moduleReference.expression ?? null;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      specifier = node.arguments[0] ?? null;
    }

    if (specifier !== undefined) {
      specifiers.add(
        specifier !== null && ts.isStringLiteralLike(specifier)
          ? specifier.text
          : "computed module import",
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return specifiers;
}
