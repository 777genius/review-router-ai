import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as {
  optionalDependencies?: Record<string, string>;
};
const specifier =
  manifest.optionalDependencies?.["@777genius/subscription-runtime"];
const match =
  /^git\+https:\/\/github\.com\/777genius\/ar\.git#([a-f0-9]{40})$/u.exec(
    specifier ?? "",
  );
assert(
  match,
  "Subscription runtime must retain its reviewed exact source pin.",
);
// pnpm can create separate peer-context copies for root and feature consumers.
// Prepare every declared consumer, reusing one exact-source build.
const targets = new Set<string>();
for (const path of globSync(
  [
    "package.json",
    "apps/*/package.json",
    "packages/*/package.json",
    "packages/*/*/package.json",
  ],
  { cwd: root },
)) {
  const consumer = JSON.parse(readFileSync(join(root, path), "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const pin =
    consumer.dependencies?.["@777genius/subscription-runtime"] ??
    consumer.optionalDependencies?.["@777genius/subscription-runtime"];
  if (!pin) continue;
  assert.equal(
    pin,
    specifier,
    "Runtime consumers must share the reviewed exact source pin.",
  );
  const alias = join(
    root,
    dirname(path),
    "node_modules/@777genius/subscription-runtime",
  );
  if (existsSync(alias)) targets.add(realpathSync(alias));
}
let builtSource: string | undefined;
for (const target of targets) {
  const installed = JSON.parse(
    readFileSync(join(target, "package.json"), "utf8"),
  ) as {
    name: string;
    version: string;
    exports: Record<
      string,
      string | { import?: string; types?: string; default?: string }
    >;
  };
  const artifacts = Object.values(installed.exports).flatMap((entry) =>
    typeof entry === "string"
      ? [entry]
      : [entry.import, entry.types, entry.default].filter(
          (value): value is string => typeof value === "string",
        ),
  );
  if (artifacts.some((path) => !existsSync(join(target, path)))) {
    // Git dependencies fetched with --ignore-scripts are packed before prepack
    // can create dist. Rebuild from the exact owner source in a disposable clone;
    // no install lifecycle scripts or original source checkout are used.
    mkdirSync(join(root, "tmp"), { recursive: true });
    if (!builtSource) {
      const source = mkdtempSync(join(root, "tmp", "pinned-runtime-"));
      const run = (command: string, args: string[]) =>
        execFileSync(command, args, {
          cwd: source,
          stdio: "inherit",
          timeout: 300_000,
        });
      run("git", ["init", "-q"]);
      run("git", [
        "fetch",
        "--depth=1",
        "https://github.com/777genius/ar.git",
        match[1],
      ]);
      run("git", ["checkout", "--detach", "-q", "FETCH_HEAD"]);
      const commit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: source,
        encoding: "utf8",
      }).trim();
      assert.equal(commit, match[1]);
      const sourceManifest = JSON.parse(
        readFileSync(join(source, "package.json"), "utf8"),
      ) as { name: string; version: string };
      assert.equal(sourceManifest.name, installed.name);
      assert.equal(sourceManifest.version, installed.version);
      run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
      run("npm", ["run", "build"]);
      for (const path of artifacts)
        assert(
          existsSync(join(source, path)),
          `Missing owner-built runtime artifact: ${path}`,
        );
      builtSource = source;
      console.log(
        `Built subscription runtime ${commit} from its pinned owner source; retained ${source}.`,
      );
    }
    const built = JSON.parse(
      readFileSync(join(builtSource, "package.json"), "utf8"),
    );
    assert.equal(built.name, installed.name);
    assert.equal(built.version, installed.version);
    assert.deepEqual(built.exports, installed.exports);
    cpSync(join(builtSource, "dist"), join(target, "dist"), {
      recursive: true,
    });
  }
  for (const path of artifacts)
    assert(
      existsSync(join(target, path)),
      `Missing installed runtime artifact: ${path}`,
    );
}

console.log(
  `Verified subscription runtime artifacts in ${targets.size} installed peer contexts.`,
);
