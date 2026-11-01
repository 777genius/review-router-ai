import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readSourceRevision(
  repoRoot: string,
  expectedRevision: string | null,
): Promise<string> {
  let revision = "unknown";
  try {
    const { stdout: topLevel } = await execFileAsync("git", [
      "-C",
      repoRoot,
      "rev-parse",
      "--show-toplevel",
    ]);
    if (realpathSync(topLevel.trim()) === realpathSync(repoRoot)) {
      const { stdout: head } = await execFileAsync("git", [
        "-C",
        repoRoot,
        "rev-parse",
        "--verify",
        "HEAD",
      ]);
      if (/^[a-f0-9]{40}$/u.test(head.trim())) revision = head.trim();
    }
  } catch {
    // Source copies without their own readable Git identity stay unknown.
  }
  if (expectedRevision !== null) {
    if (revision !== expectedRevision) {
      throw new Error(
        `accounts_reference_e2e_revision_mismatch:expected=${expectedRevision}:actual=${revision}`,
      );
    }
    // A SHA receipt is valid only for the bytes actually executed.
    const { stdout } = await execFileAsync("git", [
      "-C",
      repoRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (stdout.length > 0) {
      throw new Error("accounts_reference_e2e_expected_revision_dirty_checkout");
    }
  }
  return revision;
}
