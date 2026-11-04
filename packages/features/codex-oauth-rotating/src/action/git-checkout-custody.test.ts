import { mkdtemp, mkdir, realpath, rm, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertForkSandboxWorkspace,
  makeGitHubWorkspaceCodexHomeDirectory,
  resolveForkSandboxWorkspace,
} from "./git-checkout-custody";

describe("GitHub Action checkout workspace custody", () => {
  it.skipIf(process.platform === "win32")(
    "refuses a fork sandbox outside the trusted GitHub workspace",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "reviewrouter-custody-test-"));
      try {
        const rootPath = await realpath(root);
        const sandbox = join(rootPath, "sandbox");
        await mkdir(sandbox);
        expect(
          await resolveForkSandboxWorkspace({
            GITHUB_WORKSPACE: rootPath,
            REVIEW_ROUTER_PR_WORKSPACE: sandbox,
          }),
        ).toBe(await realpath(sandbox));
        await expect(
          resolveForkSandboxWorkspace({
            GITHUB_WORKSPACE: sandbox,
            REVIEW_ROUTER_PR_WORKSPACE: rootPath,
          }),
        ).rejects.toThrow("fork_sandbox_workspace_outside_github_workspace");
        await expect(
          resolveForkSandboxWorkspace({
            GITHUB_WORKSPACE: rootPath,
            REVIEW_ROUTER_PR_WORKSPACE: rootPath,
          }),
        ).rejects.toThrow("fork_sandbox_workspace_invalid");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects a workspace with credential-bearing git configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewrouter-git-config-test-"));
    try {
      await mkdir(join(root, ".git"));
      await writeFile(
        join(root, ".git", "config"),
        "[core]\n  repositoryformatversion = 0\n[http]\n  extraheader = AUTHORIZATION: Basic dG9rZW4=\n",
      );
      await expect(assertForkSandboxWorkspace(root)).rejects.toThrow(
        "checkout_persisted_credentials_detected",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "creates a private Codex HOME beneath the trusted workspace",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "reviewrouter-codex-home-test-"));
      try {
        const trustedRoot = await realpath(root);
        const home = await makeGitHubWorkspaceCodexHomeDirectory({
          GITHUB_WORKSPACE: trustedRoot,
        });
        const stats = await lstat(home);
        expect(stats.isDirectory()).toBe(true);
        expect(stats.isSymbolicLink()).toBe(false);
        expect(home.startsWith(trustedRoot + "/")).toBe(true);
        expect(home.includes("/.reviewrouter-codex-home/run-")).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
