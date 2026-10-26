/**
 * Starts the real web app (`next dev --webpack`, as the other browser
 * harnesses do: Turbopack does not resolve the `.js` source imports) for one
 * visual run, with fixture-only secrets and the network fixture preload.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { access, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type NextApp = Readonly<{
  url: string;
  stop(): Promise<void>;
}>;

export async function startNextApp(input: {
  readonly repoRoot: string;
  readonly port: number;
  readonly environment: Readonly<Record<string, string>>;
  /** Module preloaded into every Node process of the app. */
  readonly preload: string;
  readonly logPath: string;
  /** Applied to the child itself; its inherited environment is sanitized. */
  readonly maxOldSpaceSizeMb?: number;
}): Promise<NextApp> {
  await refuseDotenvFiles(input.repoRoot);
  const url = `http://127.0.0.1:${input.port}`;
  const log = await open(input.logPath, "a", 0o600);
  const child: ChildProcess = spawn(
    process.execPath,
    [
      ...(input.maxOldSpaceSizeMb
        ? [`--max-old-space-size=${input.maxOldSpaceSizeMb}`]
        : []),
      "--import",
      input.preload,
      join(input.repoRoot, "node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "-H",
      "127.0.0.1",
      "-p",
      String(input.port),
    ],
    {
      cwd: join(input.repoRoot, "apps/web"),
      env: {
        ...baseProcessEnvironment(),
        ...input.environment,
        NODE_ENV: "development",
        NEXT_TELEMETRY_DISABLED: "1",
        // Bound native compiler concurrency in this resource-limited harness.
        RAYON_NUM_THREADS: "1",
      },
      // Own process group, so stop() also ends the forked dev server.
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  await log.close();
  // An interrupted run must not leave the detached dev server behind.
  const onSignal = (signal: NodeJS.Signals) => {
    signalProcessGroup(child, "SIGTERM");
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const stop = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await stopProcessGroup(child);
  };
  try {
    await waitForHealth(url, child);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, stop };
}

/** Only process plumbing; every app setting comes from the caller. */
function baseProcessEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "TMPDIR"]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.PATH = [dirname(process.execPath), process.env.PATH ?? ""].join(
    ":",
  );
  return environment;
}

/** Next would load them over the fixture environment, possibly real secrets. */
async function refuseDotenvFiles(repoRoot: string): Promise<void> {
  for (const directory of [repoRoot, join(repoRoot, "apps/web")])
    for (const name of [
      ".env",
      ".env.local",
      ".env.development",
      ".env.development.local",
    ])
      if (
        await access(join(directory, name)).then(
          () => true,
          () => false,
        )
      )
        throw new Error(`provider_visual_refuses_dotenv:${directory}/${name}`);
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("provider_visual_next_exited_before_ready");
    const healthy = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) return;
    await delay(500);
  }
  throw new Error("provider_visual_next_not_ready");
}

/** The whole group: the forked server can outlive the `next` CLI process. */
async function stopProcessGroup(child: ChildProcess): Promise<void> {
  signalProcessGroup(child, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    Date.now() < deadline
  )
    await delay(100);
  signalProcessGroup(child, "SIGKILL");
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
}
