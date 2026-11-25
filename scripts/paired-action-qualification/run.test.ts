import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkNativeActionProject, nativeJestConfiguration } from "./run.ts";

const ownedDirectories: string[] = [];

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), "paired-native-profile-"));
  ownedDirectories.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

afterEach(() => {
  for (const root of ownedDirectories.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("paired Action native qualification", () => {
  it("preserves the producer's test selection, setup and assertions without loading its transformer", () => {
    const root = directory();
    writeJson(join(root, "package.json"), { type: "commonjs" });
    for (const [name, version] of [
      ["jest", "29.7.0"],
      ["babel-jest", "29.7.0"],
      ["@babel/core", "7.29.7"],
    ] as const) {
      const packageRoot = join(root, "node_modules", name);
      mkdirSync(packageRoot, { recursive: true });
      writeJson(join(packageRoot, "package.json"), {
        name,
        version,
        main: "index.js",
      });
      // An inert module-resolution fixture: configuration must not initialize it.
      writeFileSync(
        join(packageRoot, "index.js"),
        'throw Error("unexpected load");',
      );
    }
    const producer = {
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/__tests__"],
      testMatch: ["**/__tests__/**/*.test.ts", "!**/__tests__/helpers/**"],
      moduleFileExtensions: ["ts", "js", "json"],
      moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
      collectCoverageFrom: ["src/**/*.ts"],
      coverageDirectory: "coverage",
      clearMocks: true,
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
      testTimeout: 10000,
    };
    const configPath = join(root, "jest.config.js");
    const source = `module.exports = ${JSON.stringify(producer)};\n`;
    writeFileSync(configPath, source);

    const result = nativeJestConfiguration(root);
    const { rootDir, cache, transform, ...retained } = result;
    expect({ ...retained, preset: "ts-jest" }).toEqual(producer);
    expect(rootDir).toBe(realpathSync(root));
    expect(cache).toBe(false);
    expect(Object.keys(transform)).toEqual(["^.+\\.tsx?$"]);
    expect(readFileSync(configPath, "utf8")).toBe(source);
  });

  it("rejects a project without effective explicit strict checking", () => {
    const root = directory();
    writeJson(join(root, "tsconfig.json"), {
      compilerOptions: { strict: false },
    });
    expect(() => checkNativeActionProject(root)).toThrow();
  });

  it("checks the complete project with the native compiler and rejects a type error", () => {
    const root = directory();
    const sourcePath = join(root, "fixture.ts");
    writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "commonjs",
        moduleResolution: "node",
        types: [],
      },
      files: ["fixture.ts"],
    });
    writeFileSync(sourcePath, 'export const value: number = "not a number";\n');
    expect(checkNativeActionProject(root)).not.toBe(0);
    writeFileSync(sourcePath, "export const value: number = 42;\n");
    expect(checkNativeActionProject(root)).toBe(0);
    expect(readFileSync(sourcePath, "utf8")).toBe(
      "export const value: number = 42;\n",
    );
  });
});
