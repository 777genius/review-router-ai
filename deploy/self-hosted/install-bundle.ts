import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prefix = "reviewrouter-install-bundle-";
const maximumBytes = 1024 * 1024;

/** Run inside the API container so the private bundle belongs to its runtime user. */
export async function writeReleaseBundle(
  input: AsyncIterable<Uint8Array>,
): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of input) {
    length += chunk.byteLength;
    assert(length <= maximumBytes, "release_bundle_too_large");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "release_bundle_object_required",
  );
  const directory = await mkdtemp(join(await realpath(tmpdir()), prefix));
  const path = join(directory, "release.json");
  try {
    await chmod(directory, 0o700);
    const file = await open(path, "wx", 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(bytes);
    } finally {
      await file.close();
    }
    return path;
  } catch (error) {
    await unlink(path).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
    throw error;
  }
}

export async function cleanupReleaseBundle(path: string): Promise<void> {
  const directory = dirname(path);
  assert(
    path === resolve(path) &&
      basename(path) === "release.json" &&
      dirname(directory) === (await realpath(tmpdir())) &&
      new RegExp(`^${prefix}[A-Za-z0-9]{6}$`, "u").test(basename(directory)),
    "release_bundle_cleanup_path_invalid",
  );
  const folder = await lstat(directory);
  assert(
    folder.isDirectory() &&
      folder.uid === process.getuid?.() &&
      (folder.mode & 0o777) === 0o700,
    "release_bundle_directory_unsafe",
  );
  const file = await lstat(path);
  assert(
    file.isFile() &&
      file.uid === process.getuid?.() &&
      (file.mode & 0o777) === 0o600,
    "release_bundle_file_unsafe",
  );
  await unlink(path);
  await rmdir(directory);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0)
      process.stdout.write(`${await writeReleaseBundle(process.stdin)}\n`);
    else {
      assert(
        args.length === 2 && args[0] === "cleanup",
        "release_bundle_arguments_invalid",
      );
      await cleanupReleaseBundle(args[1]!);
    }
  } catch {
    process.stderr.write("self_hosted_release_bundle_failed\n");
    process.exitCode = 1;
  }
}
