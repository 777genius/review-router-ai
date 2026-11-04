/** Trusted Git checkout and fork-workspace custody. Never persist token in git config. */
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pruneCodexRotatingChildEnv } from "../domain/codex-oauth-rotating";
import type { PullRequestEvent } from "./action-contract.js";
import { runProcess } from "./process-runner.js";

export async function safeCheckoutPullRequest(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly workspace: string;
  readonly event: PullRequestEvent;
  readonly checkoutToken: string;
  readonly previousReviewedHeadSha?: string | undefined;
}): Promise<boolean> {
  const askPass = join(input.workspace, ".reviewrouter-askpass.sh");
  await writeFile(
    askPass,
    [
      "#!/usr/bin/env bash",
      'case "$1" in',
      '*Username*) printf "%s\\n" "x-access-token" ;;',
      '*Password*) printf "%s\\n" "$REVIEWROUTER_CHECKOUT_TOKEN" ;;',
      '*) printf "\\n" ;;',
      "esac",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  await chmod(askPass, 0o700);
  const gitEnv = buildSafeCheckoutGitEnv({
    sourceEnv: input.env,
    workspace: input.workspace,
    askPass,
    checkoutToken: input.checkoutToken,
  });
  await runGit(["init", "."], input.workspace, gitEnv);
  await runGit(["config", "--local", "gc.auto", "0"], input.workspace, gitEnv);
  await runGit(
    ["config", "--local", "core.hooksPath", "/dev/null"],
    input.workspace,
    gitEnv,
  );
  await runGit(
    [
      "remote",
      "add",
      "origin",
      `https://github.com/${input.event.repository}.git`,
    ],
    input.workspace,
    gitEnv,
  );
  let previousHeadFetched = true;
  if (
    input.previousReviewedHeadSha &&
    input.previousReviewedHeadSha !== input.event.headSha &&
    input.previousReviewedHeadSha !== input.event.baseSha
  ) {
    try {
      await runGit(
        [
          "-c",
          "protocol.file.allow=never",
          "-c",
          "protocol.ext.allow=never",
          "fetch",
          "--no-tags",
          "--no-recurse-submodules",
          "--depth=1",
          "origin",
          input.previousReviewedHeadSha,
        ],
        input.workspace,
        gitEnv,
      );
    } catch {
      previousHeadFetched = false;
    }
  }
  await runGit(
    [
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.ext.allow=never",
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--depth=1",
      "origin",
      input.event.baseSha,
      input.event.headSha,
    ],
    input.workspace,
    gitEnv,
  );
  await runGit(
    [
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.ext.allow=never",
      "checkout",
      "--detach",
      input.event.headSha,
    ],
    input.workspace,
    gitEnv,
  );
  await assertCheckoutConfigDoesNotPersistCredentials({
    workspace: input.workspace,
    checkoutToken: input.checkoutToken,
  });
  return previousHeadFetched;
}

function buildSafeCheckoutGitEnv(input: {
  readonly sourceEnv: NodeJS.ProcessEnv;
  readonly workspace: string;
  readonly askPass: string;
  readonly checkoutToken: string;
}): Record<string, string> {
  return {
    ...pruneCodexRotatingChildEnv(input.sourceEnv),
    HOME: input.workspace,
    XDG_CONFIG_HOME: join(input.workspace, ".config"),
    GIT_ASKPASS: input.askPass,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_COUNT: "7",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "never",
    GIT_CONFIG_KEY_1: "protocol.ext.allow",
    GIT_CONFIG_VALUE_1: "never",
    GIT_CONFIG_KEY_2: "protocol.ssh.allow",
    GIT_CONFIG_VALUE_2: "never",
    GIT_CONFIG_KEY_3: "protocol.git.allow",
    GIT_CONFIG_VALUE_3: "never",
    GIT_CONFIG_KEY_4: "credential.helper",
    GIT_CONFIG_VALUE_4: "",
    GIT_CONFIG_KEY_5: "core.hooksPath",
    GIT_CONFIG_VALUE_5: "/dev/null",
    GIT_CONFIG_KEY_6: "advice.detachedHead",
    GIT_CONFIG_VALUE_6: "false",
    REVIEWROUTER_CHECKOUT_TOKEN: input.checkoutToken,
  };
}

async function assertCheckoutConfigDoesNotPersistCredentials(input: {
  readonly workspace: string;
  readonly checkoutToken: string;
}): Promise<void> {
  await assertGitConfigDoesNotPersistCredentials(input);
}

async function assertGitConfigDoesNotPersistCredentials(input: {
  readonly workspace: string;
  readonly checkoutToken?: string;
}): Promise<void> {
  let gitConfig: string;
  try {
    gitConfig = await readFile(join(input.workspace, ".git", "config"), "utf8");
  } catch (error) {
    throw new Error("checkout_config_missing", { cause: error });
  }
  const normalized = gitConfig.toLowerCase();
  if (
    (input.checkoutToken ? gitConfig.includes(input.checkoutToken) : false) ||
    normalized.includes("extraheader") ||
    normalized.includes("credential.helper") ||
    normalized.includes("insteadof") ||
    normalized.includes("reviewrouter_checkout_token") ||
    normalized.includes("x-access-token")
  ) {
    throw new Error("checkout_persisted_credentials_detected");
  }
}

export async function resolveForkSandboxWorkspace(
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const workspace = env.REVIEW_ROUTER_PR_WORKSPACE;
  if (!workspace) {
    throw new Error("missing_fork_sandbox_workspace");
  }
  const githubWorkspace = env.GITHUB_WORKSPACE;
  if (!githubWorkspace) {
    throw new Error("missing_github_workspace");
  }
  const resolvedWorkspace = await realpath(workspace);
  const resolvedRoot = await realpath(githubWorkspace);
  if (
    resolvedWorkspace !== resolvedRoot &&
    !resolvedWorkspace.startsWith(`${resolvedRoot}/`)
  ) {
    throw new Error("fork_sandbox_workspace_outside_github_workspace");
  }
  if (resolvedWorkspace === "/" || resolvedWorkspace === resolvedRoot) {
    throw new Error("fork_sandbox_workspace_invalid");
  }
  return resolvedWorkspace;
}

export async function assertForkSandboxWorkspace(workspace: string): Promise<void> {
  const stats = await lstat(workspace);
  if (!stats.isDirectory()) {
    throw new Error("fork_sandbox_workspace_not_directory");
  }
  await assertGitConfigDoesNotPersistCredentials({ workspace });
}

export async function makeGitHubWorkspaceCodexHomeDirectory(
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const githubWorkspace = env.GITHUB_WORKSPACE;
  if (!githubWorkspace) {
    throw new Error("missing_github_workspace");
  }

  const resolvedWorkspaceRoot = await realpath(githubWorkspace);
  const codexHomeRoot = join(resolvedWorkspaceRoot, ".reviewrouter-codex-home");
  await mkdir(codexHomeRoot, { recursive: true, mode: 0o700 });
  const codexHomeRootStats = await lstat(codexHomeRoot);
  if (
    !codexHomeRootStats.isDirectory() ||
    codexHomeRootStats.isSymbolicLink()
  ) {
    throw new Error("github_workspace_codex_home_root_invalid");
  }

  const resolvedCodexHomeRoot = await realpath(codexHomeRoot);
  if (
    resolvedCodexHomeRoot !== codexHomeRoot &&
    !resolvedCodexHomeRoot.startsWith(`${resolvedWorkspaceRoot}/`)
  ) {
    throw new Error("github_workspace_codex_home_root_escape");
  }

  const codexHome = await mkdtemp(join(resolvedCodexHomeRoot, "run-"));
  await chmod(codexHome, 0o700);
  const resolvedCodexHome = await realpath(codexHome);
  if (!resolvedCodexHome.startsWith(`${resolvedCodexHomeRoot}/`)) {
    throw new Error("github_workspace_codex_home_escape");
  }
  return resolvedCodexHome;
}


function runGit(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<void> {
  return runProcess({
    command: "git",
    args,
    cwd,
    env,
    timeoutMs: 5 * 60 * 1000,
  });
}

