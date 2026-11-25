import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  readFile,
  rename,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanupReleaseBundle, writeReleaseBundle } from "./install-bundle.ts";

const script = fileURLToPath(new URL("./install-bundle.ts", import.meta.url));

test("CLI streams exact JSON bytes to a private runtime-owned file and removes only that bundle", async () => {
  const bytes = '{"candidate":{"marker":"literal-$-value"}}\n';
  const result = spawnSync(process.execPath, [script], {
    input: bytes,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^\/[^\n]+\/release\.json\n$/u);
  const path = result.stdout.trim();
  try {
    assert.equal(await readFile(path, "utf8"), bytes);
    for (const [entry, mode] of [
      [path, 0o600],
      [dirname(path), 0o700],
    ] as const) {
      const metadata = await lstat(entry);
      assert.equal(metadata.uid, process.getuid?.());
      assert.equal(metadata.mode & 0o777, mode);
    }
  } finally {
    const cleanup = spawnSync(process.execPath, [script, "cleanup", path], {
      encoding: "utf8",
    });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.equal(cleanup.stdout, "");
  }
  await assert.rejects(lstat(dirname(path)), { code: "ENOENT" });
});

test("invalid, non-object and oversized stdin never produce a bundle path or echo input", () => {
  for (const input of [
    "private-not-json",
    "null",
    "[]",
    Buffer.alloc(1024 * 1024 + 1, 0x20),
  ]) {
    const result = spawnSync(process.execPath, [script], {
      input,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "self_hosted_release_bundle_failed\n");
  }
});

test("cleanup rejects unrelated paths, unsafe modes and symlinks without deleting their target", async () => {
  await assert.rejects(
    cleanupReleaseBundle("/tmp/release.json"),
    /cleanup_path_invalid/u,
  );
  const path = await writeReleaseBundle(
    Readable.from([Buffer.from('{"safe":true}')]),
  );
  const preserved = join(dirname(path), "preserved.json");
  try {
    await chmod(dirname(path), 0o755);
    await assert.rejects(cleanupReleaseBundle(path), /directory_unsafe/u);
    await chmod(dirname(path), 0o700);
    await chmod(path, 0o644);
    await assert.rejects(cleanupReleaseBundle(path), /file_unsafe/u);
    await chmod(path, 0o600);
    await rename(path, preserved);
    await symlink(preserved, path);
    await assert.rejects(cleanupReleaseBundle(path), /file_unsafe/u);
    assert.equal(await readFile(preserved, "utf8"), '{"safe":true}');
    await unlink(path);
    await rename(preserved, path);
  } finally {
    await cleanupReleaseBundle(path);
  }
});
