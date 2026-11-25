import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { runInNewContext } from "node:vm";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

/** Execute semantic fixtures with the actual Action transformer and consumer profile. */
export function verifyNativeJestProfile(
  actionDirectory: string,
  configuration: unknown,
): void {
  const actionRoot = realpathSync(actionDirectory);
  const actionRequire = createRequire(resolve(actionRoot, "package.json"));
  assert(isRecord(configuration) && configuration.rootDir === actionRoot);
  const projectConfiguration = configuration;
  const transforms = projectConfiguration.transform;
  assert(isRecord(transforms));
  assert.deepEqual(Object.keys(transforms), ["^.+\\.tsx?$"]);
  const entry = transforms["^.+\\.tsx?$"];
  assert(isArray(entry) && entry.length === 2);
  const [transformerPath, transformerConfig] = entry;
  assert(typeof transformerPath === "string" && isRecord(transformerConfig));
  assert.equal(transformerPath, actionRequire.resolve("babel-jest"));
  const babelJest: unknown = actionRequire(transformerPath);
  assert(isRecord(babelJest) && isCallable(babelJest.createTransformer));
  const transformer: unknown = babelJest.createTransformer(transformerConfig);
  assert(isRecord(transformer) && isCallable(transformer.process));
  const processFixture = transformer.process.bind(transformer);
  let fixture = 0;

  function transform(source: string): string {
    const filename = resolve(
      actionRoot,
      `paired-action-transform-fixture-${fixture++}.ts`,
    );
    const result: unknown = processFixture(source, filename, {
      config: { ...projectConfiguration, cwd: actionRoot },
      configString: JSON.stringify(projectConfiguration),
      transformerConfig,
      cacheFS: new Map<string, string>(),
      instrument: false,
      supportsDynamicImport: false,
      supportsExportNamespaceFrom: false,
      supportsStaticESM: false,
      supportsTopLevelAwait: false,
    });
    assert(isRecord(result) && typeof result.code === "string");
    const map: unknown =
      typeof result.map === "string" ? JSON.parse(result.map) : result.map;
    assert(isRecord(map) && map.version === 3);
    assert(isArray(map.sources) && map.sources.length === 1);
    const [originalFilename] = map.sources;
    assert(typeof originalFilename === "string");
    assert.equal(basename(originalFilename), basename(filename));
    assert(isArray(map.sourcesContent));
    assert.deepEqual(map.sourcesContent, [source]);
    assert(typeof map.mappings === "string" && map.mappings.length > 0);
    return result.code;
  }

  function execute(source: string) {
    const exports: Record<string, unknown> = {};
    const events: string[] = [];
    let mocked: unknown;
    const jest = {
      mock(id: unknown, factory: unknown): void {
        assert.equal(id, "./dependency");
        assert.equal(mocked, undefined);
        assert(isCallable(factory));
        const replacement: unknown = factory();
        assert(isRecord(replacement) && replacement.value === "mocked");
        mocked = replacement;
        events.push("mock");
      },
    };
    function require(id: unknown): unknown {
      if (id === "@jest/globals") return { jest };
      if (id === "./interop") return { marker: "commonjs" };
      assert.equal(id, "./dependency", "Unexpected runtime fixture dependency");
      events.push("require");
      assert(isRecord(mocked), "Dependency loaded before its Jest mock");
      return mocked;
    }
    runInNewContext(
      transform(source),
      { exports, require, jest },
      { timeout: 1_000 },
    );
    return { exports, events };
  }

  // Imports deliberately precede every mock: execution must prove official hoisting.
  for (const mock of [
    'jest.mock("./dependency", () => ({ value: "mocked" }));',
    'import { jest } from "@jest/globals"; jest.mock("./dependency", () => ({ value: "mocked" }));',
    'import { jest as testing } from "@jest/globals"; testing.mock("./dependency", () => ({ value: "mocked" }));',
    'import * as testing from "@jest/globals"; testing.jest.mock("./dependency", () => ({ value: "mocked" }));',
  ]) {
    const result = execute(
      `import value from "./dependency";\n${mock}\nexport const observed = value.value;`,
    );
    assert.equal(result.exports.observed, "mocked");
    assert.deepEqual(result.events, ["mock", "require"]);
  }

  const semantics = execute(`
    import value from "./interop";
    import type { Missing } from "./type-only";
    import { OnlyType } from "./only-type-use";
    let erased: Missing | OnlyType | undefined;
    void erased;
    enum Mode { Ready = 4, Next }
    class Example {
      uninitialized: unknown;
      value = 7;
      declare erased: string;
      constructor(public readonly parameter: number) {}
    }
    Object.defineProperty(Example.prototype, "value", {
      set(_value: unknown) { throw new Error("assignment semantics"); },
    });
    const item = new Example(Mode.Next);
    export const parameter = item.parameter;
    export const enumForward = Mode.Next;
    export const enumReverse = Mode[5];
    export const definedField = Object.hasOwn(item, "value") && item.value === 7;
    export const uninitializedField = Object.hasOwn(item, "uninitialized");
    export const uninitializedValue = item.uninitialized;
    export const declaredErased = !Object.hasOwn(item, "erased");
    export const interop = value.marker;
  `);
  assert.deepEqual(semantics.exports, {
    parameter: 5,
    enumForward: 5,
    enumReverse: "Next",
    definedField: true,
    uninitializedField: true,
    uninitializedValue: undefined,
    declaredErased: true,
    interop: "commonjs",
  });
  assert.deepEqual(semantics.events, []);
  assert.throws(
    () => transform("const broken: = 1;"),
    (error: unknown) => isRecord(error) && error.code === "BABEL_PARSE_ERROR",
  );
  assert.throws(
    () =>
      transform(
        'const outside = Math.random(); jest.mock("./dependency", () => outside);',
      ),
    (error: unknown) =>
      error instanceof Error && /out-of-scope variables/.test(error.message),
  );
}
