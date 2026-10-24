/**
 * Provider setup visual qualification (plan S7): migrates and seeds the
 * dedicated database, starts the real web app with fixture-only secrets and
 * the network boundary, signs in the fixture users with real session
 * cookies, captures the scenario table (reseeding before each shot) and
 * writes `manifest.json`.
 *
 *   PROVIDER_VISUAL_DATABASE_URL=postgresql://user@127.0.0.1:PORT/reviewrouter_provider_setup_visual \
 *   pnpm provider-setup:visual [--out DIR] [--only REGEX] [--rotating] [--port N]
 *
 * Exit 0: every runnable shot captured cleanly. Exit 2: some shot failed or
 * is suspect (see manifest). Exit 1: setup failed before capturing.
 */
import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { defaultSetupBranch } from "../../packages/features/workflow-provisioning/src/index.js";
import { createPrismaClient } from "../../packages/platform/db/src/index.js";
import { captureScenarios, type ShotRecord } from "./capture.js";
import {
  entriesOf,
  VISUAL_USERS,
  VISUAL_WORKSPACES,
  visualGitHubFixtureDocument,
  visualSharedEnvironment,
  type VisualRunFlags,
  type VisualUserKey,
} from "./fixture-contract.js";
import { startNextApp, type NextApp } from "./next-app.js";
import { VISUAL_SCENARIOS } from "./scenarios.js";
import {
  assertVisualDatabaseUrl,
  seedProviderSetupVisualFixtures,
  type VisualSeedResult,
} from "./seed.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);

type RunOptions = Readonly<{
  databaseUrl: string;
  outDir: string;
  only: RegExp | null;
  port: number | null;
  flags: VisualRunFlags;
  browserExecutable: string | undefined;
}>;

async function main(): Promise<void> {
  const options = readOptions();
  await mkdir(options.outDir, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const scenarios = VISUAL_SCENARIOS.filter(
    (scenario) => !options.only || options.only.test(scenario.id),
  );
  if (scenarios.length === 0)
    throw new Error("provider_visual_no_scenario_matches");

  await migrate(options.databaseUrl, join(options.outDir, "migrate.log"));
  const prisma = createPrismaClient({
    databaseUrl: options.databaseUrl,
    poolMax: 4,
  });

  const secrets = {
    auth: randomBytes(32).toString("base64url"),
    githubClient: randomBytes(32).toString("base64url"),
    recoveryWitness: randomBytes(32).toString("base64url"),
    githubAppKey: generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).privateKey,
  };
  const fixturePath = join(options.outDir, "github-fixture.json");
  const networkLog = join(options.outDir, "network.jsonl");
  await writeJson(
    fixturePath,
    visualGitHubFixtureDocument(options.flags, defaultSetupBranch),
  );
  await writeFile(networkLog, "", { mode: 0o600 });

  const port = options.port ?? (await freeLoopbackPort());
  const appUrl = `http://127.0.0.1:${port}`;
  let app: NextApp | null = null;
  let shots: readonly ShotRecord[];
  // Screens may change providers (and the setup PR refresher records facts),
  // so every shot starts from a fresh seed of the data set.
  const reseed = (): Promise<VisualSeedResult> =>
    seedProviderSetupVisualFixtures(prisma, options.flags);
  try {
    await writeJson(join(options.outDir, "seed.json"), await reseed());
    app = await startNextApp({
      repoRoot,
      port,
      logPath: join(options.outDir, "next-app.log"),
      preload: join(repoRoot, "scripts/provider-setup-visual/preload.ts"),
      environment: {
        ...visualSharedEnvironment(options.flags),
        DATABASE_URL: options.databaseUrl,
        AUTH_SECRET: secrets.auth,
        NEXTAUTH_SECRET: secrets.auth,
        AUTH_TRUST_HOST: "true",
        NEXTAUTH_URL: appUrl,
        REVIEW_ROUTER_WEB_URL: appUrl,
        REVIEW_ROUTER_PUBLIC_WEB_URL: appUrl,
        REVIEW_ROUTER_API_URL: "https://api.reviewrouter.test",
        REVIEW_ROUTER_PUBLIC_API_URL: "https://api.reviewrouter.test",
        REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS: "1",
        REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS: secrets.recoveryWitness,
        GITHUB_APP_ID: "940001",
        GITHUB_APP_CLIENT_ID: "rr-visual-client",
        GITHUB_APP_CLIENT_SECRET: secrets.githubClient,
        GITHUB_APP_PRIVATE_KEY: secrets.githubAppKey,
        PROVIDER_VISUAL_GITHUB_FIXTURE: fixturePath,
        PROVIDER_VISUAL_NETWORK_LOG: networkLog,
      },
    });
    const sessionCookies = await createSessionCookies(secrets.auth);
    await warmUp(appUrl, sessionCookies.owner);
    shots = await captureScenarios({
      appUrl,
      outDir: options.outDir,
      flags: options.flags,
      scenarios,
      sessionCookies,
      beforeShot: async () => {
        await reseed();
      },
      ...(options.browserExecutable
        ? { browserExecutable: options.browserExecutable }
        : {}),
    });
  } finally {
    await app?.stop();
    await prisma.$disconnect();
  }

  const summary = countBy(shots.map((shot) => shot.status));
  await writeJson(join(options.outDir, "manifest.json"), {
    startedAt,
    finishedAt: new Date().toISOString(),
    revision: await gitRevision(),
    appUrl,
    flags: options.flags,
    summary,
    network: summarizeNetwork(await readFile(networkLog, "utf8")),
    shots,
  });
  process.stdout.write(
    `${JSON.stringify({ outDir: options.outDir, summary })}\n`,
  );
  if (summary.failed || summary.suspect) process.exitCode = 2;
}

function readOptions(): RunOptions {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      only: { type: "string" },
      port: { type: "string" },
      rotating: { type: "boolean", default: false },
    },
  });
  return {
    databaseUrl: assertVisualDatabaseUrl(
      process.env.PROVIDER_VISUAL_DATABASE_URL,
    ),
    outDir: resolve(
      values.out ??
        join(
          repoRoot,
          "tmp/provider-setup-visual",
          `run-${new Date().toISOString().replaceAll(":", "-")}`,
        ),
    ),
    only: values.only ? new RegExp(values.only) : null,
    port: values.port ? Number(values.port) : null,
    flags: { rotating: values.rotating ?? false },
    browserExecutable: process.env.PROVIDER_VISUAL_BROWSER_EXECUTABLE,
  };
}

/** The repository's own migration runner; a migrated database is a no-op. */
async function migrate(databaseUrl: string, logPath: string): Promise<void> {
  const dbPackage = join(repoRoot, "packages/platform/db");
  const output: string[] = [];
  const code = await new Promise<number | null>((resolveExit, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate-deploy.mjs"], {
      cwd: dbPackage,
      env: {
        PATH: [
          join(dbPackage, "node_modules/.bin"),
          join(repoRoot, "node_modules/.bin"),
          dirname(process.execPath),
          process.env.PATH ?? "",
        ].join(":"),
        HOME: process.env.HOME ?? "",
        DATABASE_URL: databaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  await writeFile(logPath, output.join(""), { mode: 0o600 });
  if (code !== 0) throw new Error(`provider_visual_migrate_exit:${code}`);
}

/**
 * Real NextAuth session cookies for the fixture users, signed with this
 * run's secret, carrying the claims the app's auth options store.
 */
async function createSessionCookies(
  authSecret: string,
): Promise<Record<VisualUserKey, string>> {
  const { encode } = createRequire(join(repoRoot, "apps/web/package.json"))(
    "next-auth/jwt",
  ) as {
    encode(input: {
      token: Record<string, unknown>;
      secret: string;
      maxAge: number;
    }): Promise<string>;
  };
  const cookies = {} as Record<VisualUserKey, string>;
  for (const [key, user] of entriesOf(VISUAL_USERS)) {
    const token = await encode({
      secret: authSecret,
      maxAge: 60 * 60,
      token: {
        sub: user.id,
        name: user.login,
        email: `${user.login}@invalid.test`,
        picture: null,
        sourceProvider: "github",
        externalUserId: user.githubUserId,
        sourceLogin: user.login,
        sourceAvatarUrl: null,
        githubUserId: user.githubUserId,
        githubLogin: user.login,
        githubAvatarUrl: null,
      },
    });
    cookies[key] = `next-auth.session-token=${token}`;
  }
  return cookies;
}

/** The first request compiles the dashboard; it must render signed in. */
async function warmUp(appUrl: string, ownerCookie: string): Promise<void> {
  const response = await fetch(
    `${appUrl}/dashboard?workspace=${VISUAL_WORKSPACES.main.slug}`,
    {
      headers: { cookie: ownerCookie },
      redirect: "manual",
      signal: AbortSignal.timeout(300_000),
    },
  );
  const html = await response.text();
  if (response.status !== 200 || html.includes("NEXT_REDIRECT"))
    throw new Error(`provider_visual_warm_up_status_${response.status}`);
}

function summarizeNetwork(log: string) {
  const entries = log
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          method: string;
          origin: string;
          path: string;
          outcome: string;
        },
    );
  const distinct = (outcome: string) => [
    ...new Set(
      entries
        .filter((entry) => entry.outcome === outcome)
        .map((entry) => `${entry.method} ${entry.origin}${entry.path}`),
    ),
  ];
  return {
    githubFixtureRequests: entries.filter(
      (entry) => entry.outcome === "github_fixture",
    ).length,
    githubUnhandled: distinct("github_unhandled"),
    blocked: distinct("blocked"),
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {
    captured: 0,
    suspect: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
  };
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

async function gitRevision(): Promise<string> {
  try {
    const head = (
      await execFileAsync("git", ["-C", repoRoot, "rev-parse", "HEAD"])
    ).stdout.trim();
    const dirty = (
      await execFileAsync("git", ["-C", repoRoot, "status", "--porcelain"])
    ).stdout.trim();
    return dirty ? `${head}+dirty` : head;
  } catch {
    return "unknown";
  }
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === "object"
          ? resolvePort(address.port)
          : reject(new Error("provider_visual_port_unavailable")),
      );
    });
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`,
    { mode: 0o600 },
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
