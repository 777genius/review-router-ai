import { describe, expect, it } from "vitest";
import { compileProductionDeclarations } from "./actions-hosted-workflow-recovery.test-support";

function evaluate(
  source: string,
  names: readonly string[],
  dependencies: Record<string, unknown> = {},
): Record<string, unknown> {
  const exports = {};
  const module = { exports };
  const value: unknown = new Function(
    "exports",
    "module",
    ...Object.keys(dependencies),
    compileProductionDeclarations(source, names) +
      `\nreturn { ${names.join(", ")} };`,
  )(exports, module, ...Object.values(dependencies));
  if (value === null || typeof value !== "object") {
    throw new Error("expected_declaration_exports");
  }
  return Object.fromEntries(Object.entries(value));
}

function invoke(value: unknown, ...arguments_: unknown[]): unknown {
  if (typeof value !== "function") throw new Error("expected_function");
  const result: unknown = Reflect.apply(value, undefined, arguments_);
  return result;
}

describe("production declaration loader", () => {
  it("runs selected production functions and injected dependencies, not module construction", () => {
    const calls: string[] = [];
    const result = evaluate(
      `
      import { unavailable } from "not-installed-construction-adapter";
      throw new Error("construction_must_not_run");
      export function switchSource(value: string): string {
        return persist(value + ":production");
      }
      export function unrelated() { throw new Error("unselected"); }
      `,
      ["switchSource", "persist"],
      {
        persist(value: string) {
          calls.push(value);
          return value + ":persisted";
        },
      },
    );
    expect(invoke(result.switchSource, "repository")).toBe(
      "repository:production:persisted",
    );
    expect(calls).toEqual(["repository:production"]);
    expect(invoke(result.persist, "direct")).toBe("direct:persisted");
  });

  it("retains class parameter properties, inheritance and method bodies", () => {
    const result = evaluate(
      `
      class Base { prefix() { return "binding:"; } }
      export class Binding extends Base {
        constructor(private readonly id: string) { super(); }
        current(): string { return this.prefix() + this.id; }
      }
      export function read(): string { return new Binding("42").current(); }
      `,
      ["Base", "Binding", "read"],
    );
    expect(invoke(result.read)).toBe("binding:42");
  });

  it("retains named default exports and non-exported dependencies", () => {
    const result = evaluate(
      "function offset(value: number) { return value + 1; }\n" +
        "export default function selected() { return offset(4); }",
      ["offset", "selected"],
    );
    expect(invoke(result.selected)).toBe(5);
  });

  it("uses source ranges correctly after Unicode text and CRLF", () => {
    const result = evaluate(
      'const marker = "🧭";\r\n// комментарий\r\n' +
        'export function selected(): string { return "🍋"; }\r\n',
      ["selected"],
    );
    expect(invoke(result.selected)).toBe("🍋");
  });

  it("preserves function overload implementations", () => {
    const result = evaluate(
      "function selected(value: number): number;\n" +
        "function selected(value: string): string;\n" +
        "function selected(value: unknown) { return value; }",
      ["selected"],
    );
    expect(invoke(result.selected, "body-result")).toBe("body-result");
  });

  it("propagates a rejection from the selected real body", () => {
    const result = evaluate(
      'export function selected() { throw new Error("authority_rejected"); }',
      ["selected"],
    );
    expect(() => invoke(result.selected)).toThrow("authority_rejected");
  });

  it("retains strict module execution for a selected function", () => {
    const result = evaluate(
      "export function selected(this: void) { return this; }",
      ["selected"],
    );
    expect(invoke(result.selected)).toBeUndefined();
  });

  it.each([
    'const text = "function selected() { return 1; }";',
    "// function selected() { return 1; }\n",
    "function outer() { function selected() { return 1; } }",
    "function selectedSibling() { return 1; }",
    "interface selected { value: number }",
    "export default function () { return 1; }",
  ])(
    "does not treat an unselected or non-declaration occurrence as a top-level declaration: %s",
    (source) => {
      expect(() => evaluate(source, ["selected"])).toThrow(ReferenceError);
    },
  );

  it("rejects malformed production syntax before evaluating any body", () => {
    expect(() =>
      compileProductionDeclarations(
        "export function selected(value: ) { return value; }",
        ["selected"],
      ),
    ).toThrow("production_declarations_parse_failed");
  });
});
