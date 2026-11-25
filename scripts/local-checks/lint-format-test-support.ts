import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const toolVersions = {
  oxlint: "1.87.0",
  oxfmt: "0.72.0",
  eslint: "10.3.0",
  prettier: "3.8.3",
  typescript: "7.0.2",
  "stack-toolchain": "0.3.0",
  "@eslint/js": "10.0.1",
  "@prettier/plugin-oxc": "0.2.4",
  esbuild: "0.28.1",
  vitest: "4.1.10",
} as const;

function admitPackage(path: string, name: string, version: string): void {
  const pkg: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(
    typeof pkg === "object" && pkg !== null && !Array.isArray(pkg),
    `Invalid package manifest: ${name}`,
  );
  assert.ok(
    "name" in pkg && "version" in pkg,
    `Missing package identity: ${name}`,
  );
  assert.equal(pkg.name, name);
  assert.equal(pkg.version, version, `Expected qualified ${name} ${version}`);
}

function admitSyntaxRuntime(root: string): void {
  // Resolve from the physical owning package, so strict pnpm isolation does not
  // depend on hoisting these transitive packages into the consumer root.
  const toolchain = createRequire(
    realpathSync(join(root, "node_modules/stack-toolchain/package.json")),
  );
  const parser = createRequire(toolchain.resolve("eslint-parser-oxc"));
  for (const [name, version] of [
    ["eslint-parser-oxc", "0.1.1"],
    ["@typescript-eslint/scope-manager", "8.73.0"],
    ["typescript", "7.0.2"],
  ] as const) {
    admitPackage(toolchain.resolve(`${name}/package.json`), name, version);
  }
  admitPackage(
    parser.resolve("@typescript-eslint/scope-manager/package.json"),
    "@typescript-eslint/scope-manager",
    "8.73.0",
  );
  assert.equal(
    realpathSync(parser.resolve("@typescript-eslint/scope-manager")),
    realpathSync(toolchain.resolve("@typescript-eslint/scope-manager")),
    "Parser and retained rules must resolve the same qualified scope-manager",
  );
  const scope = createRequire(
    toolchain.resolve("@typescript-eslint/scope-manager/package.json"),
  );
  for (const [issuer, name] of [
    [parser, "@typescript-eslint/visitor-keys"],
    [scope, "@typescript-eslint/types"],
    [scope, "@typescript-eslint/visitor-keys"],
  ] as const) {
    admitPackage(issuer.resolve(`${name}/package.json`), name, "8.73.0");
  }
  // These are metadata reads only. No implementation is initialized before
  // the dependency identities and private TEST fixture allocation are admitted.
}

// Reject even a symlink in an ancestor. This is containment for a private TEST
// root, not a claim of atomic protection against hostile concurrent writers.
export function assertNoSymlinks(path: string): void {
  const absolute = resolve(path);
  let component = resolve(sep);
  for (const part of absolute.split(sep).filter(Boolean)) {
    component = join(component, part);
    assert.equal(
      lstatSync(component).isSymbolicLink(),
      false,
      `Symlink component: ${component}`,
    );
  }
}

export function admitTools(
  root: string,
  expected: Readonly<Record<string, string>> = toolVersions,
): void {
  assertNoSymlinks(root);
  for (const [name, version] of Object.entries(expected)) {
    // Package-manager links inside the admitted dependency closure are allowed;
    // none of the fixture writer paths traverse that closure.
    admitPackage(
      join(root, "node_modules", name, "package.json"),
      name,
      version,
    );
  }
  if (Object.hasOwn(expected, "stack-toolchain")) admitSyntaxRuntime(root);
}

export function writeFixture(
  root: string,
  local: string,
  bytes: string | Buffer,
): string {
  assertNoSymlinks(root);
  const path = resolve(root, local);
  const rel = relative(root, path);
  assert.ok(
    rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`),
    "Fixture path escapes TEST root",
  );
  let parent = root;
  for (const part of rel.split(sep).slice(0, -1)) {
    parent = join(parent, part);
    try {
      mkdirSync(parent);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      )
        throw error;
    }
    assertNoSymlinks(parent);
    assert.ok(lstatSync(parent).isDirectory());
  }
  // Exclusive creation prevents overwriting even a regular existing file.
  writeFileSync(path, bytes, { flag: "wx" });
  return path;
}

export function createTestSubject(
  root: string,
  scratch: string,
  expected: Readonly<Record<string, string>> = toolVersions,
): string {
  // Admission precedes mkdir, copy, test registration and fixture tool calls.
  admitTools(root, expected);
  assertNoSymlinks(scratch);
  const owner = process.getuid?.();
  assert.notEqual(owner, undefined, "Cannot verify TEST directory ownership");
  for (const directory of [root, scratch]) {
    const stats = lstatSync(directory);
    assert.ok(stats.isDirectory(), "TEST root and scratch must be directories");
    assert.equal(stats.uid, owner, "Use job-owned TEST root and scratch");
    assert.equal(
      stats.mode & 0o022,
      0,
      "TEST root and scratch must not be writable by other users",
    );
  }
  const localScratch = relative(root, scratch);
  assert.ok(
    localScratch &&
      !isAbsolute(localScratch) &&
      localScratch !== ".." &&
      !localScratch.startsWith(`..${sep}`),
    "Scratch must be beneath the TEST dependency root",
  );
  assert.equal(lstatSync(scratch).dev, lstatSync(root).dev);
  const configs = [
    "eslint.config.mjs",
    "eslint.native-fallback.config.mjs",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    ".prettierignore",
    ".prettierrc.json",
    "scripts/local-checks/lint-format-native.ts",
  ];
  const copies = configs.map((name) => {
    assertNoSymlinks(join(root, name));
    return [name, readFileSync(join(root, name), "utf8")] as const;
  });
  const subject = mkdtempSync(join(scratch, "n1-test-"));
  for (const [name, bytes] of copies) writeFixture(subject, name, bytes);
  writeFixture(subject, "package.json", '{"private":true,"type":"module"}\n');
  return subject;
}
