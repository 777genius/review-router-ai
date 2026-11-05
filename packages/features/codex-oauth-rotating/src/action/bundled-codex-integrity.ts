/** Verify bundled pinned Codex manifest and archive before execution. */
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  stat,
  statfs,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./process-runner.js";

declare const __dirname: string | undefined;

const bundledCodexPlatform = "linux-x64";
const bundledCodexVersion = "0.135.0";
const bundledCodexPackageName = ["@openai", "codex"].join("/");
const bundledCodexArchiveName = "codex-linux-x64.tgz";
const bundledCodexBinaryPathInArchive =
  "package/vendor/x86_64-unknown-linux-musl/bin/codex";

type CodexBinaryManifest = {
  readonly protocolVersion: 1;
  readonly packageName: string;
  readonly version: string;
  readonly platform: string;
  readonly archive: string;
  readonly archiveSize: number;
  readonly archiveSha256: string;
  readonly binaryPathInArchive: string;
  readonly binary: string;
  readonly size: number;
  readonly sha256: string;
};

export async function resolveCodexBinary(
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const actionPath = resolveGitHubActionPath(env);

  const bundleRoot = join(
    actionPath,
    "action-dist",
    "codex",
    bundledCodexPlatform,
  );
  const archivePath = join(bundleRoot, bundledCodexArchiveName);
  const manifestPath = join(bundleRoot, "manifest.json");

  let resolvedBundleRoot: string;
  let resolvedArchivePath: string;
  let resolvedManifestPath: string;
  try {
    [resolvedBundleRoot, resolvedArchivePath, resolvedManifestPath] =
      await Promise.all([
        realpath(bundleRoot),
        realpath(archivePath),
        realpath(manifestPath),
      ]);
  } catch (error) {
    throw new Error("codex_bundled_binary_missing", { cause: error });
  }

  if (
    !resolvedArchivePath.startsWith(`${resolvedBundleRoot}/`) ||
    !resolvedManifestPath.startsWith(`${resolvedBundleRoot}/`)
  ) {
    throw new Error("codex_bundled_binary_escape");
  }

  const [archiveLinkStats, manifestLinkStats, archiveStats, manifest] =
    await Promise.all([
      lstat(archivePath),
      lstat(manifestPath),
      stat(resolvedArchivePath),
      readCodexBinaryManifest(resolvedManifestPath),
    ]);
  if (archiveLinkStats.isSymbolicLink() || manifestLinkStats.isSymbolicLink()) {
    throw new Error("codex_bundled_binary_symlink");
  }
  if (!archiveStats.isFile()) {
    throw new Error("codex_bundled_binary_not_file");
  }
  validateCodexBinaryManifest(manifest, archiveStats.size);
  const archiveSha256 = await sha256File(resolvedArchivePath);
  if (archiveSha256 !== manifest.archiveSha256) {
    throw new Error("codex_bundled_archive_hash_mismatch");
  }

  const extractionRoot = await mkdtemp(
    join(env.RUNNER_TEMP ?? tmpdir(), "reviewrouter-codex-bundle-"),
  );
  await runProcess({
    command: "tar",
    args: ["-xzf", resolvedArchivePath, "-C", extractionRoot],
    cwd: extractionRoot,
    env: {
      PATH: env.PATH ?? process.env.PATH ?? "",
    },
    timeoutMs: 60_000,
  });
  const extractedBinaryPath = join(
    extractionRoot,
    manifest.binaryPathInArchive,
  );
  const resolvedExtractionRoot = await realpath(extractionRoot);
  const resolvedBinaryPath = await realpath(extractedBinaryPath);
  if (!resolvedBinaryPath.startsWith(`${resolvedExtractionRoot}/`)) {
    throw new Error("codex_bundled_binary_escape");
  }
  const binaryStats = await stat(resolvedBinaryPath);
  if (!binaryStats.isFile() || binaryStats.size !== manifest.size) {
    throw new Error("codex_bundled_binary_manifest_mismatch");
  }
  const binarySha256 = await sha256File(resolvedBinaryPath);
  if (binarySha256 !== manifest.sha256) {
    throw new Error("codex_bundled_binary_hash_mismatch");
  }
  await chmod(resolvedBinaryPath, 0o755);
  await access(resolvedBinaryPath, fsConstants.X_OK);
  return resolvedBinaryPath;
}

export function resolveGitHubActionPath(env: NodeJS.ProcessEnv): string {
  const explicitActionPath = env.GITHUB_ACTION_PATH;
  if (explicitActionPath) {
    return explicitActionPath;
  }

  if (typeof __dirname === "string" && __dirname.endsWith("action-dist")) {
    return join(__dirname, "..");
  }

  throw new Error("missing_github_action_path");
}

async function readCodexBinaryManifest(
  manifestPath: string,
): Promise<CodexBinaryManifest> {
  try {
    return JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as CodexBinaryManifest;
  } catch (error) {
    throw new Error("codex_bundled_binary_manifest_invalid", { cause: error });
  }
}

function validateCodexBinaryManifest(
  manifest: unknown,
  archiveSize: number,
): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("codex_bundled_binary_manifest_mismatch");
  }
  const candidate = manifest as Partial<CodexBinaryManifest>;
  if (
    candidate.protocolVersion !== 1 ||
    candidate.packageName !== bundledCodexPackageName ||
    candidate.version !== bundledCodexVersion ||
    candidate.platform !== bundledCodexPlatform ||
    candidate.archive !== bundledCodexArchiveName ||
    candidate.archiveSize !== archiveSize ||
    typeof candidate.archiveSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(candidate.archiveSha256) ||
    candidate.binaryPathInArchive !== bundledCodexBinaryPathInArchive ||
    candidate.binary !== "codex" ||
    typeof candidate.size !== "number" ||
    candidate.size <= 0 ||
    typeof candidate.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(candidate.sha256)
  ) {
    throw new Error("codex_bundled_binary_manifest_mismatch");
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function getAvailableDiskBytes(path: string): Promise<number> {
  try {
    const stats = await statfs(path);
    return stats.bavail * stats.bsize;
  } catch (error) {
    throw new Error("runner_disk_budget_unavailable", { cause: error });
  }
}
