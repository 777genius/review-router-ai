import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function flock(descriptor: number): Promise<number> {
  return await new Promise<number>((done, reject) => {
    const child = spawn("flock", ["--exclusive", "--nonblock", "3"], {
      stdio: ["ignore", "ignore", "ignore", descriptor],
    });
    child.once("error", reject);
    child.once("exit", (code) => done(code ?? -1));
  });
}

/** All qualified standalone Docker launchers and cleanup share this OS lock. */
export async function acquireDeploymentLock(path: string) {
  assert(
    process.platform === "linux" && isAbsolute(path),
    "Standalone Docker profile requires an absolute Linux flock file",
  );
  const directory = await stat(dirname(path));
  assert(
    directory.isDirectory() &&
      (directory.mode & 0o022) === 0 &&
      directory.uid === process.getuid?.(),
    "Deployment lock directory must be owned by the operator and deny group/other writes",
  );
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const initial = await handle.stat();
    assert(
      initial.isFile() &&
        initial.uid === process.getuid?.() &&
        (initial.mode & 0o077) === 0,
      "Deployment lock must be an operator-owned mode0600 regular file",
    );
    assert.equal(
      await flock(handle.fd),
      0,
      "Another qualified deployment operation holds the deployment lock",
    );
    let closed = false;
    return {
      path,
      async assertHeld() {
        assert(!closed, "Deployment lock is no longer held");
        const current = await stat(path);
        assert(
          current.dev === initial.dev &&
            current.ino === initial.ino &&
            current.nlink === 1,
          "Deployment lock file was replaced",
        );
        const probe = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
        try {
          assert.equal(await flock(probe.fd), 1, "Deployment OS lock was lost");
        } finally {
          await probe.close();
        }
      },
      async close() {
        if (!closed) {
          closed = true;
          await handle.close();
        }
      },
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** Executable launch procedure: every deployment mutation must use this wrapper. */
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  (async () => {
    const [lockPath, command, ...arguments_] = process.argv.slice(2);
    assert(
      lockPath && command === "docker" && arguments_.length,
      "Usage: node deployment-lock.ts /private/deployment.lock docker ARGS...",
    );
    const lock = await acquireDeploymentLock(lockPath);
    try {
      await lock.assertHeld();
      const code = await new Promise<number>((done, reject) => {
        const child = spawn(command, arguments_, { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (status) => done(status ?? 1));
      });
      process.exitCode = code;
    } finally {
      await lock.close();
    }
  })().catch(() => {
    process.stderr.write(
      "Deployment operation could not acquire its exclusive host fence.\n",
    );
    process.exitCode = 1;
  });
}
