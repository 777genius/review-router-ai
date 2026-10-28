import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const toolVersions = {
  oxlint: "1.87.0",
  oxfmt: "0.72.0",
  eslint: "10.3.0",
  prettier: "3.8.3",
  typescript: "6.0.3",
  "typescript-eslint": "8.59.1",
  "@eslint/js": "10.0.1",
} as const;

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
    const pkg = JSON.parse(
      readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
    ) as { name: string; version: string };
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, version, `Expected qualified ${name} ${version}`);
  }
}

export function writeFixture(
  root: string,
  local: string,
  bytes: string,
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
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
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
  assert.ok(
    scratch.startsWith("/srv/workers/"),
    "Use job-owned /srv/workers scratch",
  );
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
