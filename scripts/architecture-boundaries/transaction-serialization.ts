import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isSyntaxNode,
  parseSourceAst,
  walkSourceAst,
  type ParsedSource,
  type SyntaxNode,
} from "../lib/module-import-specifiers.ts";
import { collectAllSourceFiles } from "./sources.ts";
import type { ArchitectureViolation } from "./types.ts";

export async function checkPrismaTransactionQuerySerialization(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const sourceRoots = [join(root, "apps"), join(root, "packages")].filter(
    (directory) => existsSync(directory),
  );
  const sourceFiles = (
    await Promise.all(
      sourceRoots.map((directory) => collectAllSourceFiles(directory)),
    )
  ).flat();
  for (const file of sourceFiles) {
    const repositoryPath = relative(root, file).replaceAll("\\", "/");
    if (
      repositoryPath.includes("/tests/") ||
      repositoryPath.endsWith(".test.ts") ||
      repositoryPath.endsWith(".test.tsx")
    ) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    const sourceFile = parseSourceAst(file, source);
    const aliases = concurrentPrismaTransactionAliases(sourceFile);
    if (aliases.length > 0) {
      violations.push({
        file,
        imported: `Promise.all(${aliases.join("|")}.*)`,
        reason:
          "Prisma interactive transaction clients use one database connection; issue their queries sequentially",
      });
    }
  }
}

type LocalBinding = Readonly<{
  value: SyntaxNode | null;
}>;

type LocalBindings = Readonly<{
  parents: ReadonlyMap<SyntaxNode, SyntaxNode | null>;
  declarations: ReadonlyMap<SyntaxNode, LocalBinding>;
  resolve: (name: string, from: SyntaxNode) => LocalBinding | null;
}>;

function concurrentPrismaTransactionAliases(parsed: ParsedSource): string[] {
  const bindings = localBindings(parsed.root);
  const transactionCallbacks = new Set<SyntaxNode>();
  walkSourceAst(parsed.root, (node) => {
    if (!isPrismaTransactionCall(node)) return;
    const argument = firstArgument(node);
    const callback =
      argument && callbackFunction(argument, bindings, new Set());
    if (callback) transactionCallbacks.add(callback);
  });

  const transactionClients = new Set<LocalBinding>();
  walkSourceAst(parsed.root, (node) => {
    if (!isFunctionNode(node)) return;
    for (const parameter of transactionParameters(
      node,
      parsed.source,
      transactionCallbacks.has(node),
    )) {
      const binding = bindings.declarations.get(parameter);
      if (binding) transactionClients.add(binding);
    }
  });

  const unsafeAliases = new Set<string>();
  walkSourceAst(parsed.root, (node) => {
    if (!isPromiseAllCall(node)) return;
    const input = firstArgument(node);
    if (!input) return;
    const activeBindings = new Set<LocalBinding>();
    const activeFunctions = new Set<SyntaxNode>();
    const visit = (
      candidate: SyntaxNode,
      called = false,
      pendingFunction: SyntaxNode | null = null,
    ): void => {
      const expression = unwrapExpression(candidate);
      if (expression.type.startsWith("TS")) return;
      // Awaited inputs and captured completed values are safe. Await inside a
      // helper invoked by this Promise.all still schedules transaction work.
      if (expression.type === "AwaitExpression") {
        if (
          pendingFunction === null ||
          enclosingFunction(expression, bindings) !== pendingFunction
        )
          return;
      }
      if (isFunctionNode(expression)) {
        if (
          !called ||
          !isSyntaxNode(expression.body) ||
          activeFunctions.has(expression)
        )
          return;
        activeFunctions.add(expression);
        visit(expression.body, false, expression);
        activeFunctions.delete(expression);
        return;
      }
      if (
        expression.type === "CallExpression" &&
        isSyntaxNode(expression.callee)
      ) {
        const localFunction = callbackFunction(
          expression.callee,
          bindings,
          new Set(),
        );
        visit(localFunction ?? expression.callee, true, pendingFunction);
        if (Array.isArray(expression.arguments)) {
          for (const argument of expression.arguments)
            if (isSyntaxNode(argument)) visit(argument, true, pendingFunction);
        }
        return;
      }
      if (
        expression.type === "Identifier" &&
        typeof expression.name === "string"
      ) {
        if (!isReferenceIdentifier(expression, bindings)) return;
        const binding = bindings.resolve(expression.name, expression);
        if (!binding) return;
        if (
          isTransactionClient(binding, bindings, transactionClients, new Set())
        ) {
          unsafeAliases.add(expression.name);
        } else if (binding.value && !activeBindings.has(binding)) {
          activeBindings.add(binding);
          visit(binding.value, called, pendingFunction);
          activeBindings.delete(binding);
        }
        return;
      }
      for (const child of syntaxChildren(expression))
        visit(child, called, pendingFunction);
    };
    visit(input);
  });
  return [...unsafeAliases].sort();
}

function isFunctionNode(node: SyntaxNode): boolean {
  return [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ].includes(node.type);
}

function unwrapExpression(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (
    [
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSTypeAssertion",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "TSInstantiationExpression",
      "ChainExpression",
    ].includes(current.type) &&
    isSyntaxNode(current.expression)
  ) {
    current = current.expression;
  }
  return current;
}

function transactionParameters(
  node: SyntaxNode,
  source: string,
  callback: boolean,
): SyntaxNode[] {
  const aliases: SyntaxNode[] = [];
  const parameters: unknown[] = Array.isArray(node.params) ? node.params : [];
  for (const [index, originalParameter] of parameters.entries()) {
    if (!isSyntaxNode(originalParameter)) continue;
    let parameter = originalParameter;
    let annotation = parameterAnnotation(parameter);
    while (
      ["AssignmentPattern", "RestElement", "TSParameterProperty"].includes(
        parameter.type,
      )
    ) {
      const unwrapped =
        parameter.type === "AssignmentPattern"
          ? parameter.left
          : parameter.type === "RestElement"
            ? parameter.argument
            : parameter.parameter;
      if (!isSyntaxNode(unwrapped)) break;
      parameter = unwrapped;
      annotation ??= parameterAnnotation(parameter);
    }
    if (parameter.type !== "Identifier" || typeof parameter.name !== "string")
      continue;
    const type =
      annotation &&
      typeof annotation.start === "number" &&
      typeof annotation.end === "number"
        ? source.slice(annotation.start, annotation.end)
        : "";
    if (
      parameter.name === "transaction" ||
      /(?:^|\.)TransactionClient\b/u.test(type) ||
      (index === 0 && callback)
    )
      aliases.push(parameter);
  }
  return aliases;
}

function parameterAnnotation(parameter: SyntaxNode): SyntaxNode | null {
  const wrapper = parameter.typeAnnotation;
  return isSyntaxNode(wrapper) && isSyntaxNode(wrapper.typeAnnotation)
    ? wrapper.typeAnnotation
    : null;
}

/** Local syntax bindings only: no inferred types or external module resolution. */
function localBindings(root: SyntaxNode): LocalBindings {
  const parents = new Map<SyntaxNode, SyntaxNode | null>();
  const declarations = new Map<SyntaxNode, LocalBinding>();
  const scopes = new Map<SyntaxNode, Map<string, LocalBinding>>();
  walkSourceAst(root, (node, parent) => {
    parents.set(node, parent);
    if (
      isFunctionNode(node) ||
      [
        "Program",
        "BlockStatement",
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "SwitchStatement",
        "CatchClause",
        "ClassExpression",
      ].includes(node.type)
    )
      scopes.set(node, new Map());
  });

  const scopeAt = (
    node: SyntaxNode,
    functionScope = false,
  ): Map<string, LocalBinding> => {
    let current: SyntaxNode | null = node;
    while (current) {
      const scope = scopes.get(current);
      if (
        scope &&
        (!functionScope ||
          isFunctionNode(current) ||
          current.type === "Program")
      )
        return scope;
      current = parents.get(current) ?? null;
    }
    return scopes.get(root)!;
  };
  const declare = (
    pattern: SyntaxNode,
    scope: Map<string, LocalBinding>,
    value: SyntaxNode | null,
    reuseExisting = false,
  ): void => {
    if (pattern.type === "Identifier" && typeof pattern.name === "string") {
      const binding = (reuseExisting ? scope.get(pattern.name) : undefined) ?? {
        value,
      };
      scope.set(pattern.name, binding);
      declarations.set(pattern, binding);
    } else if (
      pattern.type === "AssignmentPattern" &&
      isSyntaxNode(pattern.left)
    )
      declare(pattern.left, scope, null);
    else if (pattern.type === "RestElement" && isSyntaxNode(pattern.argument))
      declare(pattern.argument, scope, null);
    else if (
      pattern.type === "TSParameterProperty" &&
      isSyntaxNode(pattern.parameter)
    )
      declare(pattern.parameter, scope, null);
    else if (
      pattern.type === "ArrayPattern" &&
      Array.isArray(pattern.elements)
    ) {
      for (const item of pattern.elements)
        if (isSyntaxNode(item)) declare(item, scope, null);
    } else if (
      pattern.type === "ObjectPattern" &&
      Array.isArray(pattern.properties)
    ) {
      for (const item of pattern.properties) {
        if (!isSyntaxNode(item)) continue;
        const binding =
          item.type === "RestElement" ? item.argument : item.value;
        if (isSyntaxNode(binding)) declare(binding, scope, null);
      }
    }
  };
  walkSourceAst(root, (node, parent) => {
    if (node.type === "VariableDeclarator" && isSyntaxNode(node.id)) {
      const functionScoped =
        parent?.type === "VariableDeclaration" && parent.kind === "var";
      const initializer = isSyntaxNode(node.init) ? node.init : null;
      const value = initializer && unwrapExpression(initializer);
      declare(
        node.id,
        scopeAt(node, functionScoped),
        initializer,
        // Bare and self-initializing var redeclarations retain the binding.
        functionScoped &&
          (node.init === null ||
            (node.id.type === "Identifier" &&
              value?.type === "Identifier" &&
              node.id.name === value.name)),
      );
    }
    if (isFunctionNode(node)) {
      if (isSyntaxNode(node.id))
        declare(
          node.id,
          scopeAt(
            node.type === "FunctionDeclaration" ? (parent ?? root) : node,
          ),
          node,
        );
      if (Array.isArray(node.params))
        for (const parameter of node.params)
          if (isSyntaxNode(parameter)) declare(parameter, scopeAt(node), null);
    }
    if (
      (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
      isSyntaxNode(node.id)
    )
      declare(
        node.id,
        scopeAt(node.type === "ClassDeclaration" ? (parent ?? root) : node),
        node,
      );
    if (node.type === "CatchClause" && isSyntaxNode(node.param))
      declare(node.param, scopeAt(node), null);
    if (
      [
        "ImportSpecifier",
        "ImportDefaultSpecifier",
        "ImportNamespaceSpecifier",
      ].includes(node.type) &&
      isSyntaxNode(node.local)
    )
      declare(node.local, scopeAt(node), null);
  });
  return {
    parents,
    declarations,
    resolve(name, from) {
      let current: SyntaxNode | null = from;
      while (current) {
        const binding = scopes.get(current)?.get(name);
        if (binding) return binding;
        current = parents.get(current) ?? null;
      }
      return null;
    },
  };
}

function localValue(
  node: SyntaxNode,
  bindings: LocalBindings,
  visited: Set<LocalBinding>,
): SyntaxNode | null {
  const expression = unwrapExpression(node);
  if (expression.type !== "Identifier" || typeof expression.name !== "string")
    return expression;
  const binding = bindings.resolve(expression.name, expression);
  if (!binding?.value || visited.has(binding)) return null;
  visited.add(binding);
  return localValue(binding.value, bindings, visited);
}

function callbackFunction(
  node: SyntaxNode,
  bindings: LocalBindings,
  visited: Set<LocalBinding>,
): SyntaxNode | null {
  const expression = localValue(node, bindings, visited);
  if (!expression) return null;
  if (isFunctionNode(expression)) return expression;
  if (
    expression.type !== "MemberExpression" ||
    !isSyntaxNode(expression.object)
  )
    return null;
  const name = memberName(expression);
  const owner = localValue(expression.object, bindings, visited);
  if (!name || !owner) return null;
  const members: unknown[] =
    owner.type === "ObjectExpression" && Array.isArray(owner.properties)
      ? owner.properties
      : (owner.type === "ClassDeclaration" ||
            owner.type === "ClassExpression") &&
          isSyntaxNode(owner.body) &&
          Array.isArray(owner.body.body)
        ? owner.body.body
        : [];
  for (const member of members) {
    if (
      !isSyntaxNode(member) ||
      memberName(member) !== name ||
      !isSyntaxNode(member.value)
    )
      continue;
    if (member.type === "Property" && member.kind === "init")
      return callbackFunction(member.value, bindings, visited);
    if (
      member.type === "MethodDefinition" &&
      member.static === true &&
      member.kind === "method"
    )
      return callbackFunction(member.value, bindings, visited);
  }
  return null;
}

function memberName(node: SyntaxNode): string | null {
  const property = node.type === "MemberExpression" ? node.property : node.key;
  if (!isSyntaxNode(property)) return null;
  if (
    !node.computed &&
    property.type === "Identifier" &&
    typeof property.name === "string"
  )
    return property.name;
  return typeof property.value === "string" ? property.value : null;
}

function isTransactionClient(
  binding: LocalBinding,
  bindings: LocalBindings,
  clients: ReadonlySet<LocalBinding>,
  visited: Set<LocalBinding>,
): boolean {
  if (clients.has(binding)) return true;
  if (!binding.value || visited.has(binding)) return false;
  visited.add(binding);
  const value = unwrapExpression(binding.value);
  if (value.type !== "Identifier" || typeof value.name !== "string")
    return false;
  const target = bindings.resolve(value.name, value);
  return (
    target !== null && isTransactionClient(target, bindings, clients, visited)
  );
}

function isReferenceIdentifier(
  node: SyntaxNode,
  bindings: LocalBindings,
): boolean {
  if (bindings.declarations.has(node)) return false;
  const parent = bindings.parents.get(node);
  if (!parent) return true;
  if (
    parent.type === "MemberExpression" &&
    parent.property === node &&
    !parent.computed
  )
    return false;
  if (
    ["Property", "MethodDefinition", "PropertyDefinition"].includes(
      parent.type,
    ) &&
    parent.key === node &&
    !parent.computed &&
    !(parent.type === "Property" && parent.shorthand && parent.value === node)
  )
    return false;
  if (
    [
      "ImportSpecifier",
      "ImportDefaultSpecifier",
      "ImportNamespaceSpecifier",
    ].includes(parent.type)
  )
    return false;
  return !(
    ["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(
      parent.type,
    ) && parent.label === node
  );
}

function enclosingFunction(
  node: SyntaxNode,
  bindings: LocalBindings,
): SyntaxNode | null {
  let current = bindings.parents.get(node) ?? null;
  while (current) {
    if (isFunctionNode(current)) return current;
    current = bindings.parents.get(current) ?? null;
  }
  return null;
}

function* syntaxChildren(node: SyntaxNode): Generator<SyntaxNode> {
  for (const [key, value] of Object.entries(node)) {
    if (
      [
        "parent",
        "comments",
        "tokens",
        "typeAnnotation",
        "typeParameters",
        "typeArguments",
      ].includes(key)
    )
      continue;
    if (isSyntaxNode(value)) yield value;
    else if (Array.isArray(value))
      for (const child of value) if (isSyntaxNode(child)) yield child;
  }
}

function firstArgument(node: SyntaxNode): SyntaxNode | null {
  const args: unknown[] = Array.isArray(node.arguments) ? node.arguments : [];
  return isSyntaxNode(args[0]) ? args[0] : null;
}

function calleeMember(node: SyntaxNode): SyntaxNode | null {
  return node.type === "CallExpression" && isSyntaxNode(node.callee)
    ? unwrapExpression(node.callee)
    : null;
}

function isPrismaTransactionCall(node: SyntaxNode): boolean {
  const callee = calleeMember(node);
  return (
    callee?.type === "MemberExpression" && memberName(callee) === "$transaction"
  );
}

function isPromiseAllCall(node: SyntaxNode): boolean {
  const callee = calleeMember(node);
  return (
    callee?.type === "MemberExpression" &&
    isSyntaxNode(callee.object) &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Promise" &&
    memberName(callee) === "all" &&
    Array.isArray(node.arguments) &&
    node.arguments.length > 0
  );
}
