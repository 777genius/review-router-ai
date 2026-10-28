import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";

// Consumer-owned lint adapter, not a formatter/apply engine or tree selector.
// Caller supplies the complete selected file list. Directories cannot preserve
// ESLint's scope because Oxlint traversal additionally respects Git ignores.
export async function lintNativeFiles(root: string, paths: readonly string[]) {
  const cwd = realpathSync(root);
  if (paths.length === 0 || paths.length > 128)
    throw new Error(
      "Supply 1–128 explicit files; use the baseline full lint gate for broader scope",
    );
  const engine = new ESLint({
    cwd,
    overrideConfigFile: join(cwd, "eslint.native-fallback.config.mjs"),
  });
  const selected: string[] = [];
  const skipped: string[] = [];
  for (const input of paths) {
    const path = resolve(cwd, input);
    const local = relative(cwd, path);
    if (
      isAbsolute(local) ||
      local === ".." ||
      local.startsWith(`..${sep}`) ||
      local === ""
    )
      throw new Error("Lint input must be a file within the subject");
    let segment = cwd;
    for (const part of local.split(sep)) {
      segment = join(segment, part);
      if (lstatSync(segment).isSymbolicLink())
        throw new Error("Symlink lint inputs are not admitted");
    }
    if (!lstatSync(path).isFile())
      throw new Error("Supply explicit files, not directories");
    if (await engine.isPathIgnored(path)) {
      skipped.push(local);
      continue;
    }
    if (!/\.(?:js|mjs|cjs|ts|mts|cts|tsx)$/.test(local))
      throw new Error("Unsupported lint extension: use the baseline gate");
    selected.push(path);
  }
  if (selected.length === 0)
    return {
      status: "not-checked" as const,
      checkedFiles: [],
      skippedFiles: skipped,
      exitCode: 0,
    };
  const nativePackage = resolve(
    createRequire(join(cwd, "package.json")).resolve("oxlint/package.json"),
    "..",
  );
  if (
    JSON.parse(readFileSync(join(nativePackage, "package.json"), "utf8"))
      .version !== "1.87.0"
  )
    throw new Error("Expected qualified oxlint 1.87.0");
  const native = spawnSync(
    process.execPath,
    [
      join(nativePackage, "bin/oxlint"),
      "--config",
      join(cwd, ".oxlintrc.json"),
      "--no-ignore",
      "--disable-nested-config",
      "--threads",
      "1",
      "--",
      ...new Set(selected),
    ],
    {
      cwd,
      shell: false,
      stdio: "inherit",
      timeout: 30_000,
    },
  );
  if (native.error) throw native.error;
  if (native.signal || native.status === null)
    throw new Error("Native lint did not complete");
  const results = await engine.lintFiles(selected);
  const output = await engine.loadFormatter("stylish");
  const rendered = await output.format(results);
  if (rendered) process.stdout.write(rendered);
  const failed =
    native.status !== 0 ||
    results.some(
      (result) => result.errorCount > 0 || result.fatalErrorCount > 0,
    );
  return {
    status: failed ? ("failed" as const) : ("feedback-only" as const),
    checkedFiles: selected,
    skippedFiles: skipped,
    exitCode: native.status || (failed ? 1 : 0),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await lintNativeFiles(process.cwd(), process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exitCode = result.exitCode;
}
