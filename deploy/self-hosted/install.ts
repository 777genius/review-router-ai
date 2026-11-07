import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { acquireDeploymentLock } from "../../scripts/hindsight-e2e/deployment-lock.ts";
import {
  assertEnvironmentBinding,
  assertPrivateInstallLocation,
  createEnvironment,
  defaultActionCommit,
  parseEnvironment,
  prepareRepositoryEnvironment,
  privateDirectory,
  publicOrigin,
  readPrivate,
  readSettings,
  renderEnvironment,
  writePrivate,
  type InstallSettings,
} from "./install-config.ts";
import { buildSelfHostedDatabasePlan } from "./install-database.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const help = `ReviewRouter guided self-hosted installation

  bash scripts/install-self-hosted.sh [options]

Requires a Linux Docker host, Docker Compose v2, Git and Node 24.21+ or 26.10+.
Point two public domains to this host and allow inbound TCP 80/443.
The wizard generates credentials, installs HTTPS, Memory and services, and
guides you through GitHub App and provider setup. Repeat the same command to
resume. Existing credentials and data are preserved; this is not an upgrader.

  --web-url https://review.example.com   Dashboard domain
  --api-url https://api.review.example.com API domain
  --app-name NAME                       GitHub App name
  --github-org ORGANIZATION             Create the App in an organization
  --app-profile /private/app.env        Import an existing App manifest profile
  --directory /private/install          Installation state and credentials
  --external-proxy                      Use your existing HTTPS reverse proxy
  --review-only                         Manage repository workflows manually
  --without-memory                      Explicitly omit the Memory backend
  --repo OWNER/REPO                      First repository to initialize
  --repository-setup-complete           Resume after App/provider/workflow approval
  --external-proxy-ready                Resume after HTTPS proxy routing is configured
  --status                             Print last agent status (no changes)
  --interactive                        Opt in to the human prompt-based wizard
  --help                               Show this help

Agent mode is the default (no TTY required). It returns a single JSON result on
stdout and sends progress to stderr. States such as approval_required and
verification_required do NOT mean a completed review; perform the indicated
action and resume with the saved checkout.
Remote App creation uses a loopback callback. Connect with:
  ssh -L 45731:127.0.0.1:45731 USER@SERVER
Then open the printed localhost URL in your workstation browser.
`;

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  capture?: boolean;
  privateInput?: boolean;
};

export type AgentInstallStatus = {
  schemaVersion: 1;
  state:
    | "not_started"
    | "running"
    | "input_required"
    | "approval_required"
    | "repository_setup_required"
    | "server_ready"
    | "verification_required"
    | "failed";
  phase: string;
  message: string;
  repository?: string;
  webUrl?: string;
  next?: {
    action: string;
    argv?: string[];
    resume?: string[];
    url?: string;
    requiredOptions?: string[];
    requiresUserApproval?: boolean;
  };
};

export function parseAgentInstallStatus(raw: string): AgentInstallStatus {
  const value: unknown = JSON.parse(raw);
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Saved agent status must be a JSON object",
  );
  const record = value as Record<string, unknown>;
  assert(
    record.schemaVersion === 1 &&
      typeof record.phase === "string" &&
      typeof record.message === "string" &&
      [
        "not_started",
        "running",
        "input_required",
        "approval_required",
        "repository_setup_required",
        "server_ready",
        "verification_required",
        "failed",
      ].includes(String(record.state)),
    "Saved agent status has an invalid schema or state",
  );
  assert(
    (record.repository === undefined ||
      typeof record.repository === "string") &&
      (record.webUrl === undefined || typeof record.webUrl === "string"),
    "Saved agent status has invalid metadata",
  );
  if (record.next !== undefined) {
    assert(
      record.next !== null &&
        typeof record.next === "object" &&
        !Array.isArray(record.next),
      "Saved agent next action is invalid",
    );
    const next = record.next as Record<string, unknown>;
    assert(
      typeof next.action === "string" &&
        ["argv", "resume", "requiredOptions"].every(
          (field) =>
            next[field] === undefined ||
            (Array.isArray(next[field]) &&
              next[field].every((entry: unknown) => typeof entry === "string")),
        ) &&
        (next.url === undefined || typeof next.url === "string") &&
        (next.requiresUserApproval === undefined ||
          typeof next.requiresUserApproval === "boolean"),
      "Saved agent next action has invalid arguments",
    );
  }
  return record as AgentInstallStatus;
}

let machineOutput = false;
function log(message: string): void {
  (machineOutput ? process.stderr : process.stdout).write(message + "\n");
}

async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  return await new Promise<string>((done, reject) => {
    const capture = options.capture || options.privateInput;
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: {
        ...process.env,
        ...(machineOutput ? { GIT_TERMINAL_PROMPT: "0" } : {}),
        ...options.env,
      },
      stdio: [
        options.input === undefined
          ? machineOutput
            ? "ignore"
            : "inherit"
          : "pipe",
        capture ? "pipe" : machineOutput ? 2 : "inherit",
        capture ? "pipe" : machineOutput ? 2 : "inherit",
      ],
    });
    let output = "",
      errors = "";
    child.stdout?.on("data", (part: Buffer) => {
      output += part.toString();
    });
    child.stderr?.on("data", (part: Buffer) => {
      errors += part.toString();
    });
    child.once("error", () =>
      reject(
        new Error(
          `Could not start ${command}; check the installation prerequisites`,
        ),
      ),
    );
    child.once("close", (code) => {
      if (code === 0) done(output.trim());
      else
        reject(
          new Error(
            options.privateInput
              ? "Database setup failed. Credentials and data were preserved. Check the database role contract before resuming"
              : `${command} failed (${code ?? "signal"}). ${errors.trim()}`,
          ),
        );
    });
    if (options.input !== undefined) {
      child.stdin?.on("error", () => {
        /* Process close reports the failed command. */
      });
      child.stdin?.end(options.input);
    }
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function waitForHealth(url: string, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch {
      /* Services and certificate issuance can take a little time. */
    }
    if (attempt + 1 < attempts)
      await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error(
    `Health check failed: ${url}. Check DNS, TLS and service health, then run setup again`,
  );
}

export function repositoryName(value: string): string {
  assert(
    /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value),
    "Repository must be OWNER/REPO",
  );
  return value;
}

/** Persist explicit setup acknowledgment before actions that may fail or be retried. */
export function repositorySetupGate(
  acknowledgedRepository: string | undefined,
  previous: AgentInstallStatus | undefined,
  repository: string,
  confirmed: boolean,
): "request_approval" | "save_acknowledgment" | "approved" {
  assert(
    !acknowledgedRepository || acknowledgedRepository === repository,
    "Repository approval belongs to another repository; refuse to widen the approved scope",
  );
  if (acknowledgedRepository === repository) return "approved";
  if (!confirmed) return "request_approval";
  assert(
    previous?.state === "repository_setup_required" &&
      previous.repository === repository,
    "First receive repository_setup_required and complete App/provider/workflow approval before confirming",
  );
  return "save_acknowledgment";
}

export function repositoryActivation(status: unknown): "initialize" | "ready" {
  assert(status && typeof status === "object", "Invalid repository status");
  const value = status as {
    authority?: { mode?: unknown } | null;
    emergencyControls?: {
      global?: { stopped?: boolean } | null;
      repository?: { stopped?: boolean } | null;
    };
  };
  if (value.authority === null) return "initialize";
  assert(
    value.authority?.mode === "v2_active",
    "Existing repository authority needs the cutover runbook; setup will not reset it",
  );
  assert(
    value.emergencyControls?.global?.stopped === false &&
      value.emergencyControls?.repository?.stopped === false,
    "Repository is paused by an emergency control. Setup will not reopen an existing installation",
  );
  return "ready";
}

export function openInitialEmergencyStop(status: unknown): boolean {
  assert(status && typeof status === "object", "Invalid repository status");
  const controls = (
    status as {
      emergencyControls?: {
        global?: {
          stopped?: unknown;
          version?: unknown;
          reason?: unknown;
          updatedBy?: unknown;
        };
        repository?: { stopped?: unknown } | null;
      };
    }
  ).emergencyControls;
  assert(
    controls?.repository?.stopped !== true,
    "Repository emergency stop must be handled explicitly; setup will not reopen it",
  );
  if (controls?.global?.stopped === false) return false;
  assert(
    controls?.global?.stopped === true &&
      controls.global.version === 1 &&
      controls.global.reason === "review_v2_not_promoted" &&
      controls.global.updatedBy === "migration:000029",
    "Only the original migration stop can be opened by first setup; preserve the existing operator control",
  );
  return true;
}

export function assertRuntimePreflight(value: unknown): void {
  assert(
    value &&
      typeof value === "object" &&
      "ready" in value &&
      value.ready === true,
    "The installed API failed its environment preflight; server readiness was not recorded",
  );
}

export function assertReleaseRegistered(
  value: unknown,
  expected: {
    producerReleaseId: string;
    actionCommitSha: string;
    protocolLimitsProfileId: string;
    operationalSloProfileId: string;
  },
): void {
  assert(
    value && typeof value === "object",
    "Invalid release registration result",
  );
  const result = (
    value as {
      releaseResult?: {
        status?: unknown;
        value?: {
          producerReleaseId?: unknown;
          actionCommitSha?: unknown;
          revokedAt?: unknown;
          state?: unknown;
          protocolLimitsProfileId?: unknown;
          operationalSloProfileId?: unknown;
        };
      };
    }
  ).releaseResult;
  assert(
    result &&
      ["created", "restored"].includes(String(result.status)) &&
      result.value?.producerReleaseId === expected.producerReleaseId &&
      result.value.actionCommitSha === expected.actionCommitSha &&
      result.value.protocolLimitsProfileId ===
        expected.protocolLimitsProfileId &&
      result.value.operationalSloProfileId ===
        expected.operationalSloProfileId &&
      result.value.revokedAt === null &&
      result.value.state === "registered",
    "Release registration was not accepted for this reviewer; preserve the installation and reconcile the registry conflict",
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "web-url": { type: "string" },
      "api-url": { type: "string" },
      "app-name": { type: "string" },
      "github-org": { type: "string" },
      "app-profile": { type: "string" },
      directory: { type: "string" },
      "external-proxy": { type: "boolean" },
      "review-only": { type: "boolean" },
      "without-memory": { type: "boolean" },
      repo: { type: "string" },
      "repository-setup-complete": { type: "boolean" },
      "external-proxy-ready": { type: "boolean" },
      status: { type: "boolean" },
      interactive: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  machineOutput = !values.interactive;
  const directory = resolve(
    values.directory ?? join(root, "deploy/self-hosted/secrets/install"),
  );
  assertPrivateInstallLocation(root, directory);
  const statusPath = join(directory, "agent-status.json");
  if (values.status) {
    const saved = await readPrivate(statusPath);
    const status: AgentInstallStatus = saved
      ? parseAgentInstallStatus(saved)
      : {
          schemaVersion: 1,
          state: "not_started",
          phase: "configuration",
          message: "Provide --web-url (and optionally --api-url) to begin.",
        };
    process.stdout.write(JSON.stringify(status) + "\n");
    return;
  }
  assert(
    process.platform === "linux" && process.arch === "x64",
    "Guided installation requires a Linux x64 host",
  );
  if (values.interactive)
    assert(
      process.stdin.isTTY,
      "Interactive setup requires a terminal; omit --interactive for agent mode",
    );
  const ask = async (question: string, fallback = "") => {
    assert(!machineOutput, "Agent mode must not wait for terminal input");
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const abort = new AbortController();
    terminal.once("SIGINT", () => abort.abort());
    try {
      return (
        (
          await terminal.question(
            `${question}${fallback ? ` [${fallback}]` : ""}: `,
            { signal: abort.signal },
          )
        ).trim() || fallback
      );
    } finally {
      // Release raw-mode input before a child command owns the foreground terminal.
      terminal.close();
    }
  };
  await privateDirectory(directory);
  assertPrivateInstallLocation(await realpath(root), await realpath(directory));
  const lock = await acquireDeploymentLock(join(directory, "install.lock"));
  let previous: AgentInstallStatus | undefined;
  let statusReadable = false;
  const resumeCommand = (args: string[] = []) => [
    "bash",
    "scripts/install-self-hosted.sh",
    "--directory",
    directory,
    ...(values.repo && !args.includes("--repo") ? ["--repo", values.repo] : []),
    ...(values["web-url"] ? ["--web-url", values["web-url"]] : []),
    ...(values["api-url"] ? ["--api-url", values["api-url"]] : []),
    ...(values["external-proxy"] ? ["--external-proxy"] : []),
    ...(values["review-only"] ? ["--review-only"] : []),
    ...(values["without-memory"] ? ["--without-memory"] : []),
    ...(values["github-org"] ? ["--github-org", values["github-org"]] : []),
    ...(values["app-name"] ? ["--app-name", values["app-name"]] : []),
    ...(values["app-profile"] ? ["--app-profile", values["app-profile"]] : []),
    ...(values["external-proxy-ready"] ? ["--external-proxy-ready"] : []),
    ...args,
  ];
  const record = async (report: AgentInstallStatus, print = true) => {
    await writePrivate(statusPath, JSON.stringify(report, null, 2) + "\n");
    if (machineOutput && print)
      process.stdout.write(JSON.stringify(report) + "\n");
  };
  let phase = "configuration";
  try {
    const savedStatus = await readPrivate(statusPath);
    previous = savedStatus ? parseAgentInstallStatus(savedStatus) : undefined;
    statusReadable = true;
    const statePath = join(directory, "installation.json"),
      envFile = join(directory, ".env");
    if (
      machineOutput &&
      !(await readPrivate(statePath)) &&
      !values["web-url"]
    ) {
      await record({
        schemaVersion: 1,
        state: "input_required",
        phase,
        message:
          "Supply the public dashboard hostname with --web-url; --api-url defaults to api.<dashboard-hostname>. Configure both DNS records first.",
        next: {
          action: "provide_configuration",
          requiredOptions: ["--web-url"],
          argv: resumeCommand(),
        },
      });
      return;
    }
    await record(
      {
        schemaVersion: 1,
        state: "running",
        phase: "prerequisites",
        message: "Verifying pinned source and local Docker host.",
      },
      false,
    );
    phase = "prerequisites";
    log(
      "ReviewRouter self-hosted setup\nCredentials and progress stay in your private installation directory.",
    );
    const sourceCommit = await run("git", ["rev-parse", "HEAD"], {
      capture: true,
    });
    assert(
      /^[a-f0-9]{40}$/.test(sourceCommit),
      "Expected an immutable source commit",
    );
    assert(
      !(await run(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        {
          capture: true,
        },
      )),
      "Commit or remove source changes before installing; setup must build a clean recorded revision",
    );
    const endpoint = await run(
      "docker",
      ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      { capture: true },
    );
    assert(
      endpoint.startsWith("unix://") &&
        (!process.env.DOCKER_HOST ||
          process.env.DOCKER_HOST.startsWith("unix://")),
      "Use the local Docker host, not a remote Docker context",
    );
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
      capture: true,
    });
    const composeVersion = await run(
      "docker",
      ["compose", "version", "--short"],
      { capture: true },
    );
    assert(/^v?2\./.test(composeVersion), "Docker Compose v2 is required");
    const savedState = await readPrivate(statePath);
    let settings: InstallSettings;
    if (savedState) {
      settings = readSettings(JSON.parse(savedState), sourceCommit);
      assert(
        !values["web-url"] ||
          publicOrigin(values["web-url"]) === settings.webUrl,
        "Use the saved web domain to resume",
      );
      assert(
        !values["api-url"] ||
          publicOrigin(values["api-url"]) === settings.apiUrl,
        "Use the saved API domain to resume",
      );
      assert(
        !values["external-proxy"] || settings.proxy === "external",
        "Proxy mode cannot change during resume",
      );
      assert(
        !values["without-memory"] || settings.memory === "disabled",
        "Memory choice cannot change during resume",
      );
      assert(
        !values["review-only"] || settings.permissionProfile === "review-only",
        "App permissions cannot change during resume",
      );
      log(
        `Resuming ${settings.webUrl} at source ${settings.sourceCommit.slice(0, 12)}.`,
      );
    } else {
      assert(
        !(await readPrivate(envFile)),
        "Existing environment has no installation state; use the manual runbook to adopt it",
      );
      const webUrl = publicOrigin(
        values["web-url"] ?? (await ask("Dashboard HTTPS domain")),
      );
      const apiUrl = publicOrigin(
        values["api-url"] ??
          (machineOutput
            ? `https://api.${new URL(webUrl).hostname}`
            : await ask(
                "API HTTPS domain",
                `https://api.${new URL(webUrl).hostname}`,
              )),
      );
      settings = readSettings(
        {
          version: 1,
          sourceCommit,
          actionCommit: defaultActionCommit,
          installationId: randomBytes(8).toString("hex"),
          webUrl,
          apiUrl,
          proxy: values["external-proxy"] ? "external" : "caddy",
          memory: values["without-memory"] ? "disabled" : "hindsight",
          permissionProfile: values["review-only"]
            ? "review-only"
            : "provisioning",
        },
        sourceCommit,
      );
      await writePrivate(statePath, JSON.stringify(settings, null, 2) + "\n");
    }

    phase = "dependencies";
    await record(
      {
        schemaVersion: 1,
        state: "running",
        phase,
        message: "Preparing pinned dependencies and compiler output.",
      },
      false,
    );
    log("\n1/6 Installing the pinned workspace dependencies.");
    await run(process.execPath, [
      "scripts/install-private-dependencies.mjs",
      "--frozen-lockfile",
    ]);
    await run(process.execPath, [
      "scripts/local-checks/compiler-cli.ts",
      "--native",
      "-p",
      "packages/shared/tsconfig.build.json",
    ]);
    await run(process.execPath, ["scripts/rewrite-dist-esm-imports.mjs"]);

    const credentialPath = join(directory, "operator-credential");
    let credential = await readPrivate(credentialPath);
    let envText = await readPrivate(envFile);
    if (!credential) {
      assert(
        !envText,
        "Operator credential is missing; preserve the existing environment and recover the credential",
      );
      credential = randomBytes(32).toString("base64url");
      await writePrivate(credentialPath, credential);
    }
    phase = "github_app";
    await record(
      {
        schemaVersion: 1,
        state: "running",
        phase,
        message: "Checking GitHub App profile and private credentials.",
      },
      false,
    );
    log("\n2/6 Connecting your GitHub App.");
    if (!envText) {
      const profilesDirectory = join(directory, "github-app");
      await privateDirectory(profilesDirectory);
      let profilePath = values["app-profile"]
        ? resolve(values["app-profile"])
        : undefined;
      if (!profilePath) {
        const profiles = (await readdir(profilesDirectory)).filter((name) =>
          name.endsWith(".env"),
        );
        assert(
          profiles.length <= 1,
          "Several App profiles exist; choose one with --app-profile",
        );
        profilePath = profiles[0]
          ? join(profilesDirectory, profiles[0])
          : undefined;
      }
      if (!profilePath && machineOutput) {
        const name =
          values["app-name"] ?? `ReviewRouter ${settings.installationId}`;
        assert(
          name.length > 0 && name.length <= 34,
          "GitHub App names must contain 1–34 characters",
        );
        const appArgs = [
          process.execPath,
          "scripts/create-github-app-manifest.mjs",
          "--web-url",
          settings.webUrl,
          "--api-url",
          settings.apiUrl,
          "--name",
          name,
          "--permission-profile",
          settings.permissionProfile,
          "--output-dir",
          profilesDirectory,
          "--no-open",
        ];
        if (values["github-org"]) appArgs.push("--owner", values["github-org"]);
        await record({
          schemaVersion: 1,
          state: "approval_required",
          phase,
          webUrl: settings.webUrl,
          message:
            "Create and approve the GitHub App using the existing manifest helper (SSH tunnel port 45731 for remote hosts). Its credentials remain in the private installation directory. Then resume; no secrets are needed as CLI arguments.",
          next: {
            action: "approve_github_app",
            argv: appArgs,
            resume: resumeCommand(),
            requiresUserApproval: true,
          },
        });
        return;
      }
      if (!profilePath) {
        log(
          "Approve your App's permissions in GitHub. On a remote host, keep the SSH tunnel from --help open.",
        );
        const name =
          values["app-name"] ??
          (await ask(
            "GitHub App name",
            `ReviewRouter ${settings.installationId}`,
          ));
        assert(
          name.length > 0 && name.length <= 34,
          "GitHub App names must contain 1–34 characters",
        );
        const args = [
          "scripts/create-github-app-manifest.mjs",
          "--web-url",
          settings.webUrl,
          "--api-url",
          settings.apiUrl,
          "--name",
          name,
          "--permission-profile",
          settings.permissionProfile,
          "--output-dir",
          profilesDirectory,
          "--no-open",
        ];
        if (values["github-org"]) args.push("--owner", values["github-org"]);
        // The existing helper writes exactly one private profile after its state-bound callback.
        await run(process.execPath, args);
        const profiles = (await readdir(profilesDirectory)).filter((name) =>
          name.endsWith(".env"),
        );
        assert(
          profiles.length === 1,
          "GitHub App creation did not finish; rerun setup to resume",
        );
        profilePath = join(profilesDirectory, profiles[0]!);
      }
      assertPrivateInstallLocation(
        await realpath(root),
        await realpath(profilePath),
      );
      const profile = await readPrivate(profilePath);
      assert(profile, "GitHub App profile was not found");
      const app = parseEnvironment(profile);
      assert(
        !app.REVIEW_ROUTER_WEB_URL ||
          app.REVIEW_ROUTER_WEB_URL === settings.webUrl,
        "App callback domain does not match this installation",
      );
      assert(
        !app.REVIEW_ROUTER_API_URL ||
          app.REVIEW_ROUTER_API_URL === settings.apiUrl,
        "App webhook domain does not match this installation",
      );
      if (app.GITHUB_APP_PRIVATE_KEY_FILE)
        assertPrivateInstallLocation(
          await realpath(root),
          await realpath(
            resolve(dirname(profilePath), app.GITHUB_APP_PRIVATE_KEY_FILE),
          ),
        );
      const privateKey = app.GITHUB_APP_PRIVATE_KEY_FILE
        ? await readPrivate(
            resolve(dirname(profilePath), app.GITHUB_APP_PRIVATE_KEY_FILE),
          )
        : app.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
      assert(privateKey, "App profile must include a private key");
      const template = parseEnvironment(
        await readFile(join(root, "deploy/self-hosted/.env.example"), "utf8"),
      );
      envText = renderEnvironment(
        createEnvironment(template, settings, app, privateKey, credential),
      );
      await writePrivate(envFile, envText);
    }
    let env = parseEnvironment(envText);
    assertEnvironmentBinding(env, settings, credential);

    phase = "release";
    await record(
      {
        schemaVersion: 1,
        state: "running",
        phase,
        message: "Verifying immutable review Action and release configuration.",
      },
      false,
    );
    log(
      "\n3/6 Verifying the pinned reviewer and preparing its release configuration.",
    );
    const actionRepo = join(directory, "action"),
      actionBranch = `selfhost-${settings.actionCommit.slice(0, 12)}`;
    if (!(await exists(join(actionRepo, ".git")))) {
      await run("git", [
        "clone",
        "--no-checkout",
        "https://github.com/777genius/review-router.git",
        actionRepo,
      ]);
      await run("git", ["switch", "-c", actionBranch, settings.actionCommit], {
        cwd: actionRepo,
      });
    }
    const handoff = JSON.parse(
      await readFile(
        join(
          actionRepo,
          "src/control-plane/generated/review-action-v2/handoff-manifest.json",
        ),
        "utf8",
      ),
    ) as { saasSourceCommit?: string };
    assert(
      handoff.saasSourceCommit &&
        /^[a-f0-9]{40}$/.test(handoff.saasSourceCommit),
      "Invalid reviewer source handoff",
    );
    try {
      await run(
        "git",
        ["cat-file", "-e", `${handoff.saasSourceCommit}^{commit}`],
        { capture: true },
      );
    } catch {
      await run("git", [
        "fetch",
        "--no-tags",
        "origin",
        handoff.saasSourceCommit,
      ]);
    }
    const { generateSelfHostedRelease } = await import("./install-release.ts");
    const release = await generateSelfHostedRelease({
      repoRoot: root,
      actionRepo,
      expectedActionSha: settings.actionCommit,
      actionBranch,
      outputDir: join(directory, "release"),
      ownerRef: `self-hosted:${new URL(settings.webUrl).hostname}`,
    });
    env = { ...env, ...release.environment };
    await writePrivate(envFile, renderEnvironment(env));
    await run(process.execPath, ["scripts/check-self-hosted-readiness.mjs"], {
      env: { REVIEW_ROUTER_SELF_HOSTED_ENV_FILE: envFile },
    });
    await run(process.execPath, [
      "scripts/check-self-hosted-compose-contract.mjs",
    ]);

    const composeArgs = [
      "compose",
      "--project-name",
      `reviewrouter-${settings.installationId}`,
      "--env-file",
      envFile,
      "-f",
      join(root, "deploy/self-hosted/compose.yml"),
    ];
    if (settings.proxy === "caddy")
      composeArgs.push("-f", join(root, "deploy/self-hosted/compose.tls.yml"));
    const compose = (args: string[], options: RunOptions = {}) =>
      run("docker", [...composeArgs, ...args], {
        ...options,
        env: { ...options.env, REVIEW_ROUTER_SELF_HOSTED_ENV_FILE: envFile },
      });
    phase = "services";
    await record(
      {
        schemaVersion: 1,
        state: "running",
        phase,
        message: "Applying migrations, preparing Memory and starting services.",
      },
      false,
    );
    log(
      "\n4/6 Starting the database, Memory and application services. First builds can take several minutes.",
    );
    await compose(["up", "-d", "--wait", "postgres"]);
    const database = buildSelfHostedDatabasePlan(env);
    const psql = [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=terse",
      "-U",
      env.POSTGRES_USER!,
      "-d",
      env.POSTGRES_DB!,
    ];
    await compose(psql, {
      input: database.preMigrationSql,
      privateInput: true,
    });
    await run(process.execPath, [
      "deploy/self-hosted/setup-memory.ts",
      envFile,
      join(directory, "memory"),
    ]);
    await compose(["up", "-d", "--build", "--wait", "--wait-timeout", "300"]);
    await compose(psql, {
      input: database.postMigrationSql,
      privateInput: true,
    });
    if (settings.proxy === "external") {
      log(
        `Route ${settings.webUrl} to 127.0.0.1:3000 and ${settings.apiUrl} to 127.0.0.1:4000 with your HTTPS proxy.`,
      );
      if (
        machineOutput &&
        !values["external-proxy-ready"] &&
        !(await readPrivate(join(directory, "server-ready.json")))
      ) {
        await record({
          schemaVersion: 1,
          state: "approval_required",
          phase: "https",
          webUrl: settings.webUrl,
          message:
            "Configure the external HTTPS proxy and DNS routing, then resume with --external-proxy-ready. The next stage still verifies public TLS health.",
          next: {
            action: "configure_external_https",
            resume: resumeCommand(["--external-proxy-ready"]),
            requiresUserApproval: true,
          },
        });
        return;
      }
      if (!machineOutput) await ask("Press Enter when HTTPS routing is ready");
    }
    log("Checking public HTTPS endpoints.");
    await waitForHealth(`${settings.apiUrl}/health`);
    await waitForHealth(`${settings.webUrl}/api/health`);
    const worker = JSON.parse(
      await compose(["ps", "--format", "json", "worker"], { capture: true }),
    ) as { State?: string } | { State?: string }[];
    assert(
      (Array.isArray(worker) ? worker[0] : worker)?.State === "running",
      "Worker did not reach running state",
    );
    const admin = (args: string[], capture = false) =>
      compose(
        [
          "exec",
          "-T",
          "-e",
          "REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL",
          "api",
          "pnpm",
          "--silent",
          "review-v2:admin",
          ...args,
        ],
        {
          capture,
          env: { REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL: credential },
        },
      );
    assertRuntimePreflight(JSON.parse(await admin(["env-preflight"], true)));
    // Write as the API runtime user: docker cp would make this mode0600 file root-owned.
    const containerBundlePath = await compose(
      ["exec", "-T", "api", "node", "deploy/self-hosted/install-bundle.ts"],
      { input: JSON.stringify(release.bundle), capture: true },
    );
    try {
      assertReleaseRegistered(
        JSON.parse(
          await admin(
            [
              "release",
              "register",
              "--bundle",
              containerBundlePath,
              "--confirm",
              "release",
            ],
            true,
          ),
        ),
        release.runtimeAttestation,
      );
    } finally {
      await compose([
        "exec",
        "-T",
        "api",
        "node",
        "deploy/self-hosted/install-bundle.ts",
        "cleanup",
        containerBundlePath,
      ]);
    }
    await writePrivate(
      join(directory, "server-ready.json"),
      JSON.stringify(
        {
          sourceCommit,
          actionCommit: settings.actionCommit,
          webUrl: settings.webUrl,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );

    log(
      `\n5/6 Server ready: ${settings.webUrl}\nInstall your GitHub App: https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
    );
    if (settings.permissionProfile === "review-only")
      log(
        "Your review-only App cannot create workflow PRs. Follow the manual workflow section of the self-hosted guide.",
      );
    log(
      "Provider authentication stays in the existing provider onboarding flow; never paste provider secrets into this terminal.",
    );
    const activationPath = join(directory, "first-repository");
    const firstRepository = await readPrivate(activationPath);
    const requested =
      values.repo ??
      firstRepository ??
      (machineOutput
        ? ""
        : await ask(
            "Repository to connect (OWNER/REPO), or Enter to finish later",
          ));
    if (!requested) {
      if (machineOutput)
        await record({
          schemaVersion: 1,
          state: "server_ready",
          phase: "repository",
          webUrl: settings.webUrl,
          message:
            "Server is ready. Select the first repository with --repo OWNER/REPO; no live review has run.",
          next: {
            action: "select_repository",
            requiredOptions: ["--repo"],
            resume: resumeCommand(),
          },
        });
      else
        log(
          "Server installation complete. Repository connection and first review are pending. Repeat this command with --repo OWNER/REPO to continue.",
        );
      return;
    }
    const repository = repositoryName(requested);
    assert(
      !firstRepository || firstRepository === repository,
      "This installer is already bound to its first repository. Use the dashboard and cutover runbook to connect another repository",
    );
    // Memory setup has extended the saved env. Read it again before this narrow update.
    const currentEnvironment = await readPrivate(envFile);
    assert(currentEnvironment, "Saved environment disappeared");
    const configured = prepareRepositoryEnvironment(
      parseEnvironment(currentEnvironment),
      repository,
    );
    const configuredText = renderEnvironment(configured);
    if (configuredText !== currentEnvironment) {
      await writePrivate(envFile, configuredText);
      await compose([
        "up",
        "-d",
        "--no-build",
        "--wait",
        "--wait-timeout",
        "300",
        "web",
        "api",
        "worker",
      ]);
      await waitForHealth(`${settings.apiUrl}/health`);
      await waitForHealth(`${settings.webUrl}/api/health`);
      assertRuntimePreflight(JSON.parse(await admin(["env-preflight"], true)));
    }
    await writePrivate(activationPath, repository);
    log(
      `Open ${settings.webUrl}/setup, select ${repository} and connect your provider using GitHub Secrets setup. Merge the generated workflow pull request.`,
    );
    phase = "repository";
    if (
      machineOutput &&
      !values["repository-setup-complete"] &&
      previous?.state === "verification_required" &&
      previous.repository === repository
    ) {
      assert(
        repositoryActivation(
          JSON.parse(await admin(["status", "--repo", repository], true)),
        ) === "ready",
        "Saved reviewer authority is no longer active",
      );
      await record(previous);
      return;
    }
    const approvalPath = join(directory, "repository-setup-acknowledged");
    const approvalGate = machineOutput
      ? repositorySetupGate(
          await readPrivate(approvalPath),
          previous,
          repository,
          Boolean(values["repository-setup-complete"]),
        )
      : undefined;
    if (machineOutput && approvalGate === "request_approval") {
      await record({
        schemaVersion: 1,
        state: "repository_setup_required",
        phase,
        repository,
        webUrl: settings.webUrl,
        message:
          "Install/approve the GitHub App for this repository, finish provider sign-in in the dashboard and merge its generated workflow PR. Only after verifying those actions, rerun with --repository-setup-complete. This is not a live-review approval.",
        next: {
          action: "complete_repository_setup",
          url: `${settings.webUrl}/setup`,
          resume: resumeCommand([
            "--repo",
            repository,
            "--repository-setup-complete",
          ]),
          requiresUserApproval: true,
        },
      });
      return;
    }
    if (machineOutput) {
      if (approvalGate === "save_acknowledgment")
        await writePrivate(approvalPath, repository);
    } else {
      await ask(
        `Press Enter after ${repository} is connected and its setup PR is merged`,
      );
    }
    log("\n6/6 Verifying and initializing this repository.");
    const before: unknown = JSON.parse(
      await admin(["status", "--repo", repository], true),
    );
    if (repositoryActivation(before) === "initialize") {
      openInitialEmergencyStop(before);
      await writePrivate(activationPath, repository);
      await admin([
        "cohort",
        "stage",
        "--repo",
        repository,
        "--confirm",
        repository,
      ]);
      const staged: unknown = JSON.parse(
        await admin(["status", "--repo", repository], true),
      );
      if (openInitialEmergencyStop(staged))
        await admin([
          "emergency",
          "global",
          "open",
          "--confirm",
          "global",
          "--expected-version",
          "1",
        ]);
      await admin([
        "mutation",
        "initialize-direct-v2",
        "--repo",
        repository,
        "--confirm",
        repository,
      ]);
    }
    assert(
      repositoryActivation(
        JSON.parse(await admin(["status", "--repo", repository], true)),
      ) === "ready",
      "Repository initialization did not reach ready state",
    );
    await writePrivate(activationPath, repository);
    if (machineOutput) {
      await record({
        schemaVersion: 1,
        state: "verification_required",
        phase: "first_review",
        repository,
        webUrl: settings.webUrl,
        message:
          "Repository authority is active. Open a disposable PR, verify a completed provider review and App-authored comments, then push a second commit to verify revision fencing. This step has not been proven by the installer.",
        next: {
          action: "verify_first_live_review",
          url: `https://github.com/${repository}/pulls`,
          requiresUserApproval: false,
        },
      });
    } else
      log(
        `\nRepository ready: ${repository}. Open a small pull request to verify the first review.\nFirst review: pending (setup does not claim a live review has passed).\nPrivate installation files: ${directory}\nKeep a backup of these files and the database. Use the upgrade runbook when changing versions.`,
      );
  } catch (error) {
    if (machineOutput && statusReadable) {
      try {
        await record({
          schemaVersion: 1,
          state: "failed",
          phase,
          message:
            "Installation did not finish. Inspect the error on stderr and safely resume from the pinned checkout. No live review is claimed.",
          next: { action: "resume_after_fix", resume: resumeCommand() },
        });
      } catch {
        // Preserve the original error if the private status file is unavailable.
      }
    }
    throw error;
  } finally {
    await lock.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Installation failed",
    );
    process.exitCode = 1;
  });
}
