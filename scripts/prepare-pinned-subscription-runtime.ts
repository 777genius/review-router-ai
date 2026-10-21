import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
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
const alias = join(root, "node_modules/@777genius/subscription-runtime");
if (existsSync(alias)) {
  const target = realpathSync(alias);
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
    cpSync(join(source, "dist"), join(target, "dist"), { recursive: true });
    console.log(
      `Prepared subscription runtime ${commit} from its pinned owner source; retained ${source}.`,
    );
  }
  for (const path of artifacts)
    assert(
      existsSync(join(target, path)),
      `Missing installed runtime artifact: ${path}`,
    );
}
