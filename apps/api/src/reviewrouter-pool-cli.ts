import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const commands = {
  "pool status": [],
  "pool accounts import": ["label", "auth-file"],
  "pool accounts login": ["label", "auth-home"],
  "pool accounts replace": [
    "account-id",
    "expected-generation",
    "expected-health-version",
    "auth-file",
  ],
  "pool accounts pause": ["account-id", "expected-health-version"],
  "pool accounts resume": ["account-id", "expected-health-version"],
  "pool repositories connect": ["repo", "all", "dry-run"],
} as const;

export const CODEX_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device";
const DEVICE_CODE = /\b([A-Z0-9]{4}-[A-Z0-9]{5})\b/i;
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const LOGIN_POLL_MS = 3_000;
const AUTH_FILE_MAX_BYTES = 1024 * 1024;

export type PoolLoginProcess = {
  readonly chunks: string[];
  wait(): Promise<number>;
  kill(): void;
};

export type PoolAccountsLoginHooks = {
  readonly spawnCodexLogin?: (authHome: string) => PoolLoginProcess;
  readonly openBrowser?: (url: string) => Promise<void> | void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly write?: (text: string) => void;
  readonly ensureAuthHome?: (authHome: string) => Promise<void>;
  readonly isAuthReady?: (authFile: string) => Promise<boolean>;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly platform?: NodeJS.Platform;
};
export function poolCliOptions(command: string): readonly string[] | null {
  const options = commands[command as keyof typeof commands];
  return options ? ["workspace", "profile", "api-url", ...options] : null;
}

/** Read at most limit+1 bytes even if the file grows after stat. No remote paths. */
export async function readPoolAuthFile(filename: string): Promise<Buffer> {
  const file = await open(filename, "r").catch(() => {
    throw new Error("hosted_pool_auth_file_invalid");
  });
  const bytes = Buffer.alloc(1024 * 1024 + 1);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 1024 * 1024)
      throw new Error("hosted_pool_auth_file_invalid");
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length === 0 || length > 1024 * 1024)
      throw new Error("hosted_pool_auth_file_invalid");
    return Buffer.from(bytes.subarray(0, length));
  } catch {
    throw new Error("hosted_pool_auth_file_invalid");
  } finally {
    bytes.fill(0);
    await file.close();
  }
}

export function parseCodexDeviceAuthOutput(text: string): {
  readonly url?: string;
  readonly code?: string;
} {
  const url = text.includes(CODEX_DEVICE_AUTH_URL)
    ? CODEX_DEVICE_AUTH_URL
    : undefined;
  const code = DEVICE_CODE.exec(text)?.[1];
  return { ...(url ? { url } : {}), ...(code ? { code } : {}) };
}

export async function executePoolCli(input: {
  readonly command: string;
  readonly options: Readonly<Record<string, string | true>>;
  request(
    method: "GET" | "POST",
    pathname: string,
    body?: unknown,
  ): Promise<unknown>;
  readonly readAuthFile?: typeof readPoolAuthFile;
  readonly homeDirectory?: string;
  readonly login?: PoolAccountsLoginHooks;
}) {
  const required = (name: string) => {
    const value = input.options[name];
    if (typeof value !== "string" || !value.trim())
      throw new Error(`reviewrouter_operator_option_required:${name}`);
    return value.trim();
  };
  const integer = (name: string) => {
    const text = required(name);
    const value = Number(text);
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(value))
      throw new Error("hosted_pool_version_invalid");
    return value;
  };
  const workspace = required("workspace");
  const base = "/api/operator/v1/hosted-pool";
  const status = () =>
    input.request("GET", `${base}?workspace=${encodeURIComponent(workspace)}`);
  if (input.command === "pool status") return status();
  if (input.command === "pool repositories connect") {
    const all = input.options.all === true;
    const repo = input.options.repo;
    if (
      (all && repo !== undefined) ||
      (!all && typeof repo !== "string") ||
      (input.options.all !== undefined && !all) ||
      (input.options["dry-run"] !== undefined &&
        input.options["dry-run"] !== true)
    )
      throw new Error("hosted_pool_repository_selection_required");
    const current = (await status()) as {
      repositories: readonly {
        fullName: string;
        eligible: boolean;
        bindingRevision: number | null;
      }[];
    };
    const selected = all
      ? current.repositories.filter((r) => r.eligible)
      : current.repositories.filter((r) => r.fullName === repo);
    if (!all && selected.length !== 1)
      throw new Error("hosted_pool_repository_unavailable");
    const results = [];
    // Bounded one-request-at-a-time orchestration; subsequent runs reread revisions.
    for (const repository of selected) {
      if (input.options["dry-run"] === true) {
        results.push({
          repository: repository.fullName,
          status: "dry_run",
          expectedRevision: repository.bindingRevision,
        });
        continue;
      }
      try {
        results.push({
          repository: repository.fullName,
          result: await input.request("POST", `${base}/connect`, {
            workspace,
            repository: repository.fullName,
            expectedRevision: repository.bindingRevision,
          }),
        });
      } catch (error) {
        const conflict =
          error instanceof Error && error.message === "hosted_pool_conflict";
        const permissions =
          error instanceof Error &&
          error.message === "hosted_pool_github_app_permissions_required";
        results.push({
          repository: repository.fullName,
          status: conflict ? "conflict" : "failed",
          code: conflict
            ? "hosted_pool_conflict"
            : permissions
              ? "hosted_pool_github_app_permissions_required"
              : "hosted_pool_connect_failed",
        });
      }
    }
    return {
      status: results.some(
        (r) => r.status === "failed" || r.status === "conflict",
      )
        ? "partial_failure"
        : "complete",
      results,
    };
  }
  const login = input.command === "pool accounts login";
  const action = login ? "import" : input.command.split(" ")[2]!;
  const body: Record<string, unknown> = { workspace };
  if (action === "import") body.label = required("label");
  else {
    body.accountId = required("account-id");
    body.expectedHealthVersion = integer("expected-health-version");
  }
  if (action === "replace")
    body.expectedGeneration = integer("expected-generation");
  const authFile = login
    ? path.join(
        await completeCodexDeviceLogin({
          authHome: input.options["auth-home"],
          ...(input.homeDirectory === undefined
            ? {}
            : { homeDirectory: input.homeDirectory }),
          ...(input.login === undefined ? {} : { hooks: input.login }),
        }),
        "auth.json",
      )
    : action === "import" || action === "replace"
      ? required("auth-file")
      : undefined;
  let auth: Buffer | undefined;
  try {
    if (authFile) {
      auth = await (input.readAuthFile ?? readPoolAuthFile)(authFile);
      body.authBase64 = auth.toString("base64");
    }
    try {
      const result = await input.request(
        "POST",
        `${base}/accounts/${action}`,
        body,
      );
      return login ? safePoolImportResult(result) : result;
    } catch {
      // Never retry enrollment or relogin blindly after an uncertain response.
      if (auth)
        return login
          ? { status: "reconcile_required" }
          : { status: "reconcile_required", observed: await status() };
      throw new Error("hosted_pool_account_mutation_failed");
    }
  } finally {
    auth?.fill(0);
    delete body.authBase64;
  }
}

async function completeCodexDeviceLogin(input: {
  readonly authHome: string | true | undefined;
  readonly homeDirectory?: string;
  readonly hooks?: PoolAccountsLoginHooks;
}): Promise<string> {
  const hooks = input.hooks ?? {};
  const home = input.homeDirectory ?? homedir();
  const authHome = resolvePoolLoginAuthHome(input.authHome, home);
  await (hooks.ensureAuthHome ?? defaultEnsureAuthHome)(authHome);
  const authFile = path.join(authHome, "auth.json");
  if (await authFileExists(authFile))
    throw new Error("hosted_pool_auth_file_already_exists");
  const child = (hooks.spawnCodexLogin ?? defaultSpawnCodexLogin)(authHome);
  const write = hooks.write ?? ((text: string) => process.stdout.write(text));
  const now = hooks.now ?? Date.now;
  const sleep = hooks.sleep ?? defaultSleep;
  const isAuthReady = hooks.isAuthReady ?? defaultIsAuthReady;
  const timeoutMs = hooks.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const pollIntervalMs = hooks.pollIntervalMs ?? LOGIN_POLL_MS;
  const deadline = now() + timeoutMs;
  let exitCode: number | undefined;
  const exited = child.wait().then((code) => {
    exitCode = code;
    return code;
  });
  const printed = { url: false, code: false, pending: "" };
  try {
    while (now() < deadline) {
      await announceDeviceAuth(child.chunks, printed, write, (url) =>
        openDeviceAuthUrl(url, hooks),
      );
      if (await isAuthReady(authFile)) {
        child.kill();
        return authHome;
      }
      if (exitCode !== undefined) {
        if (exitCode !== 0 || !(await isAuthReady(authFile)))
          throw new Error("hosted_pool_login_failed");
        return authHome;
      }
      await Promise.race([sleep(pollIntervalMs), exited]);
    }
    child.kill();
    if (await isAuthReady(authFile)) return authHome;
    throw new Error("hosted_pool_login_timeout");
  } catch (error) {
    child.kill();
    throw error;
  }
}

export function resolvePoolLoginAuthHome(
  authHome: string | true | undefined,
  homeDirectory: string,
): string {
  if (authHome === true || (typeof authHome === "string" && !authHome.trim()))
    throw new Error("reviewrouter_operator_option_required:auth-home");
  const resolved = path.resolve(
    typeof authHome === "string"
      ? authHome.trim()
      : path.join(
          homeDirectory,
          ".reviewrouter",
          "codex-homes",
          `login-${randomBytes(8).toString("hex")}`,
        ),
  );
  if (resolved === path.resolve(homeDirectory, ".codex"))
    throw new Error("hosted_pool_auth_home_invalid");
  return resolved;
}

function safePoolImportResult(result: unknown): {
  readonly status: string;
  readonly accountId?: string;
  readonly generation?: number;
} {
  if (!result || typeof result !== "object")
    throw new Error("hosted_pool_account_mutation_failed");
  const value = result as Record<string, unknown>;
  if (typeof value.status !== "string")
    throw new Error("hosted_pool_account_mutation_failed");
  return {
    status: value.status,
    ...(typeof value.accountId === "string"
      ? { accountId: value.accountId }
      : {}),
    ...(typeof value.generation === "number" &&
    Number.isSafeInteger(value.generation)
      ? { generation: value.generation }
      : {}),
  };
}

async function announceDeviceAuth(
  chunks: string[],
  printed: { url: boolean; code: boolean; pending: string },
  write: (text: string) => void,
  openUrl: (url: string) => Promise<void>,
): Promise<void> {
  if (chunks.length > 0) printed.pending += chunks.splice(0).join("");
  const parsed = parseCodexDeviceAuthOutput(printed.pending);
  if (parsed.url && !printed.url) {
    printed.url = true;
    write(`Open this URL to continue Codex device login:\n${parsed.url}\n`);
    await openUrl(parsed.url);
  }
  if (parsed.code && !printed.code) {
    printed.code = true;
    write(`One-time code: ${parsed.code}\n`);
  }
  if (printed.pending.length > 8_192)
    printed.pending = printed.pending.slice(-512);
}

async function openDeviceAuthUrl(
  url: string,
  hooks: PoolAccountsLoginHooks,
): Promise<void> {
  try {
    await (hooks.openBrowser ?? defaultOpenBrowser(hooks.platform))(url);
  } catch {
    // Browser launch is best-effort; the operator can open the printed URL.
  }
}

function defaultOpenBrowser(
  platform = process.platform,
): (url: string) => Promise<void> {
  return async (url) => {
    const command =
      platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;
    if (!command) return;
    await new Promise<void>((resolve) => {
      const child = spawn(command, [url], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      child.once("error", () => resolve());
      child.once("spawn", () => resolve());
    });
  };
}

function defaultSpawnCodexLogin(authHome: string): PoolLoginProcess {
  const child = spawn("codex", ["login", "--device-auth"], {
    env: { ...process.env, CODEX_HOME: authHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return wrapCodexLoginProcess(child);
}

function wrapCodexLoginProcess(child: ChildProcess): PoolLoginProcess {
  const chunks: string[] = [];
  const onData = (data: Buffer | string) =>
    chunks.push(typeof data === "string" ? data : data.toString("utf8"));
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const exit = new Promise<number>((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
  return {
    chunks,
    wait: () => exit,
    kill() {
      child.kill("SIGTERM");
    },
  };
}

async function defaultEnsureAuthHome(authHome: string): Promise<void> {
  await mkdir(authHome, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      path.join(authHome, "config.toml"),
      'cli_auth_credentials_store = "file"\n',
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
  }
}

async function defaultIsAuthReady(authFile: string): Promise<boolean> {
  try {
    const metadata = await stat(authFile);
    return (
      metadata.isFile() &&
      metadata.size > 0 &&
      metadata.size <= AUTH_FILE_MAX_BYTES
    );
  } catch {
    return false;
  }
}

async function authFileExists(authFile: string): Promise<boolean> {
  try {
    await lstat(authFile);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return false;
    throw error;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
