import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, open } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { applicationEnvironment } from "./database.ts";
import type { FixtureSecrets } from "./contracts.ts";
import { skillsReadinessFixtureEnv } from "./skills-readiness-fixture.ts";

export type AppFixture = {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
};

export async function startNextApp(input: {
  readonly repoRoot: string;
  readonly workDir: string;
  readonly databaseUrl: string;
  readonly gatewayUrl: string;
  readonly secrets: FixtureSecrets;
  readonly browserExecutable: string | null;
  readonly skillCatalog?: {
    readonly environment: Readonly<Record<string, string>>;
  };
  readonly skillsGitHub?: {
    readonly origin: string;
    readonly privateKey: string;
  };
}): Promise<AppFixture> {
  for (const directory of [input.repoRoot, join(input.repoRoot, "apps/web")]) {
    for (const name of [
      ".env",
      ".env.local",
      ".env.development",
      ".env.development.local",
    ]) {
      const exists = await access(join(directory, name)).then(
        () => true,
        () => false,
      );
      if (exists)
        throw new Error("accounts_reference_e2e_refuses_dotenv_files");
    }
  }
  await mkdir(join(input.workDir, "app-tmp"), { recursive: true, mode: 0o700 });
  const port = await allocateLoopbackPort();
  const appUrl = `http://127.0.0.1:${port}`;
  const log = await open(join(input.workDir, "next-app.log"), "a", 0o600);
  const logStream = log.createWriteStream();
  const environment = applicationEnvironment({
    databaseUrl: input.databaseUrl,
    appUrl,
    gatewayUrl: input.gatewayUrl,
    secrets: input.secrets,
    tmpDir: join(input.workDir, "app-tmp"),
  });
  if (input.skillCatalog)
    Object.assign(environment, input.skillCatalog.environment);
  if (input.skillsGitHub)
    Object.assign(environment, {
      ...skillsReadinessFixtureEnv(),
      REVIEW_ROUTER_SKILLS_E2E: "1",
      REVIEW_ROUTER_E2E_NEXT_PERF_LOG: join(
        input.workDir,
        "next-performance.jsonl",
      ),
      REVIEW_ROUTER_GITHUB_APP_TEST_ORIGIN: input.skillsGitHub.origin,
      GITHUB_APP_ID: "990001",
      GITHUB_APP_PRIVATE_KEY: input.skillsGitHub.privateKey,
      NODE_OPTIONS: [
        environment.NODE_OPTIONS,
        `--import=${join(input.repoRoot, "scripts/accounts-reference-e2e/src/skills-network-guard.ts")}`,
        `--import=${join(input.repoRoot, "scripts/accounts-reference-e2e/src/next-performance-diagnostics.mjs")}`,
      ]
        .filter(Boolean)
        .join(" "),
    });
  const nextBin = join(
    input.repoRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const child: ChildProcess = spawn(
    process.execPath,
    [
      ...(process.argv.includes("--catalog-fixture") ||
      process.argv.includes("--account-models-fixture") ||
      process.argv.includes("--api-key-storage-fixture")
        ? [
            "--import",
            join(
              input.repoRoot,
              "scripts/accounts-reference-e2e/src/catalog-fetch-fixture.ts",
            ),
          ]
        : []),
      nextBin,
      "dev",
      "--webpack",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: join(input.repoRoot, "apps", "web"),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  let stopped = false;
  child.once("exit", () => {
    stopped = true;
  });
  try {
    await waitForHealth(appUrl);
  } catch (error) {
    await stopChild(child);
    await log.close();
    throw error;
  }
  return {
    url: appUrl,
    port,
    async stop() {
      if (!stopped) await stopChild(child);
      await log.close();
    },
  };
}

async function waitForHealth(appUrl: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError = "not_started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/api/health`, {
        redirect: "manual",
      });
      if (response.ok) return;
      lastError = `status_${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.name : "fetch_error";
    }
    await delay(250);
  }
  throw new Error(`accounts_reference_e2e_next_not_ready:${lastError}`);
}

export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    Date.now() < deadline
  ) {
    await delay(100);
  }
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
}

export async function allocateLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("accounts_reference_e2e_port_allocation_failed"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}
