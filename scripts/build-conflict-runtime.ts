import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildConflictRuntime(
  options: {
    readonly root?: string;
    readonly outfile?: string;
    readonly tsconfig?: string;
  } = {},
): Promise<void> {
  const root = options.root ?? process.cwd();
  const outfile =
    options.outfile ?? resolve(root, "action-dist/conflict-runtime.cjs");
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [
      "packages/features/conflict-runtime/src/interface/cli/reviewrouter-conflict-runtime.ts",
    ],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    minify: true,
    legalComments: "inline",
    ...(options.tsconfig ? { tsconfig: options.tsconfig } : {}),
  });
}

export async function assertConflictRuntimeBundleMatchesSource(
  options: Parameters<typeof buildConflictRuntime>[0] = {},
): Promise<void> {
  const root = options.root ?? process.cwd();
  const committed = await readFile(
    options.outfile ?? resolve(root, "action-dist/conflict-runtime.cjs"),
  );
  const temporary = await mkdtemp(join(tmpdir(), "rr-conflict-parity-"));
  try {
    const outfile = join(temporary, "conflict-runtime.cjs");
    await buildConflictRuntime({ ...options, root, outfile });
    if (!committed.equals(await readFile(outfile))) {
      throw new Error("conflict_runtime_bundle_stale: run pnpm action:build");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv[2] === "--check") {
    await assertConflictRuntimeBundleMatchesSource();
  } else if (process.argv.length === 2) {
    await buildConflictRuntime();
  } else {
    throw new Error("usage: build-conflict-runtime.ts [--check]");
  }
}
