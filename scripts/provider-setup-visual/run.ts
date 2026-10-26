/**
 * Provider setup visual qualification (plan S7): migrates and seeds the
 * dedicated database, starts the real web app with fixture-only secrets and
 * the network boundary, signs in the fixture users with real session
 * cookies, captures the scenario table (reseeding before each shot) and
 * writes `manifest.json`.
 *
 *   PROVIDER_VISUAL_DATABASE_URL=postgresql://user@127.0.0.1:PORT/reviewrouter_provider_setup_visual \
 *   pnpm provider-setup:visual [--out DIR] [--only REGEX] [--rotating] [--port N]
 *     [--flows | --flows-only] [--no-personal-sharing]
 *     [--require-onboarding] [--next-heap-mb 2048]
 *
 * `--flows` also runs the end-to-end flows after the screenshots;
 * `--flows-only` runs only the flows. `--only` filters both by ID.
 * `--no-personal-sharing` turns personal account sharing off and serves the
 * Account Gateway profile catalog from a loopback fixture.
 *
 * Exit 0: every runnable shot captured cleanly and every flow passed. Exit 2:
 * a shot failed or is suspect, or a flow failed (see manifest). Exit 1: setup
 * failed before capturing.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { defaultSetupBranch } from "../../packages/features/workflow-provisioning/src/index.js";
import { createPrismaClient } from "../../packages/platform/db/src/index.js";
import {
  captureScenarios,
  launchVisualBrowser,
  type ShotRecord,
} from "./capture.js";
import {
  entriesOf,
  VISUAL_USERS,
  VISUAL_WORKSPACES,
  visualGitHubFixtureDocument,
  visualSharedEnvironment,
  type GitHubFixtureState,
  type VisualRunFlags,
  type VisualUserKey,
} from "./fixture-contract.js";
import { runFlows, visualFlowSelected, type FlowRecord } from "./flows.js";
import {
  startGatewayCatalogFixture,
  type GatewayCatalogFixture,
} from "./gateway-catalog-fixture.js";
import { startNextApp, type NextApp } from "./next-app.js";
import {
  ONBOARDING_REQUIRED_SHOTS,
  onboardingQualificationProblems,
  type VisualSourceProvenance,
} from "./onboarding-qualification.js";
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
  shots: boolean;
  flows: boolean;
  browserExecutable: string | undefined;
  requireOnboarding: boolean;
  nextHeapMb: number | undefined;
}>;

async function main(): Promise<void> {
  const options = readOptions();
  await mkdir(options.outDir, { recursive: true, mode: 0o700 });
  const sourceBefore = await sourceProvenance();
  const startedAt = new Date().toISOString();
  const scenarios = options.shots
    ? VISUAL_SCENARIOS.filter(
        (scenario) => !options.only || options.only.test(scenario.id),
      )
    : [];
  // A run that would capture and check nothing is a mistake, such as a
  // misspelled `--only`.
  if (
    scenarios.length === 0 &&
    !(options.flows && visualFlowSelected(options.only))
  )
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
  const statePath = join(options.outDir, "github-state.json");
  const networkLog = join(options.outDir, "network.jsonl");
  const writeGitHubState = (state: GitHubFixtureState) =>
    writeJson(statePath, state);
  await writeJson(
    fixturePath,
    visualGitHubFixtureDocument(options.flags, defaultSetupBranch),
  );
  await writeFile(networkLog, "", { mode: 0o600 });

  const port = options.port ?? (await freeLoopbackPort());
  const appUrl = `http://127.0.0.1:${port}`;
  let app: NextApp | null = null;
  let gateway: GatewayCatalogFixture | null = null;
  let shots: readonly ShotRecord[] = [];
  let flows: readonly FlowRecord[] = [];
  // Screens and flows change providers (and the setup PR refresher records
  // facts), so each one starts from a fresh seed and its GitHub state.
  const reseed = async (): Promise<VisualSeedResult> => {
    const seed = await seedProviderSetupVisualFixtures(prisma, options.flags);
    await writeGitHubState(seed.github);
    return seed;
  };
  try {
    await writeJson(join(options.outDir, "seed.json"), await reseed());
    if (!options.flags.personalSharing)
      gateway = await startGatewayCatalogFixture();
    app = await startNextApp({
      repoRoot,
      port,
      logPath: join(options.outDir, "next-app.log"),
      preload: join(repoRoot, "scripts/provider-setup-visual/preload.ts"),
      ...(options.nextHeapMb ? { maxOldSpaceSizeMb: options.nextHeapMb } : {}),
      environment: {
        ...visualSharedEnvironment(options.flags),
        ...(gateway?.environment ?? {}),
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
        PROVIDER_VISUAL_GITHUB_STATE: statePath,
        PROVIDER_VISUAL_NETWORK_LOG: networkLog,
      },
    });
    const sessionCookies = await createSessionCookies(secrets.auth);
    await warmUp(appUrl, sessionCookies.owner);
    if (scenarios.length > 0)
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
    if (options.flows) {
      const browser = await launchVisualBrowser(options.browserExecutable);
      try {
        flows = await runFlows(
          {
            browser,
            appUrl,
            sessionCookies,
            prisma,
            flags: options.flags,
            outDir: options.outDir,
            reset: reseed,
            writeGitHubState,
          },
          options.only,
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await app?.stop();
    await gateway?.stop();
    await prisma.$disconnect();
  }

  const summary = countBy(shots.map((shot) => shot.status));
  const flowSummary = {
    pass: flows.filter((flow) => flow.status === "pass").length,
    fail: flows.filter((flow) => flow.status === "fail").length,
    skipped: flows.filter((flow) => flow.status === "skipped").length,
  };
  const sourceAfter = await sourceProvenance();
  const network = summarizeNetwork(await readFile(networkLog, "utf8"));
  const unavailableScreenshots = (
    await Promise.all(
      flows
        .flatMap((flow) => flow.screenshots)
        .map(async (file) => {
          const available = await stat(join(options.outDir, file)).then(
            (result) => result.isFile() && result.size > 0,
            () => false,
          );
          return available ? null : file;
        }),
    )
  ).filter((file): file is string => file !== null);
  const qualificationProblems = options.requireOnboarding
    ? onboardingQualificationProblems({
        flows,
        unavailableScreenshots,
        network,
        sourceBefore,
        sourceAfter,
      })
    : [];
  await writeJson(join(options.outDir, "manifest.json"), {
    startedAt,
    finishedAt: new Date().toISOString(),
    revision: sourceAfter.revision,
    sourceBefore,
    sourceAfter,
    runtime: { node: process.version, nextHeapMb: options.nextHeapMb ?? null },
    appUrl,
    flags: options.flags,
    summary,
    flowSummary,
    network,
    ...(options.requireOnboarding
      ? {
          qualification: {
            requiredFlows: Object.keys(ONBOARDING_REQUIRED_SHOTS),
            passed: qualificationProblems.length === 0,
            problems: qualificationProblems,
            boundary:
              "Real app/session/database and Claude GitHub metadata checks; Codex command/recovery responses are controlled, confirmation remains real and refuses an unprepared namespace. No native Codex login or rotation proof.",
          },
        }
      : {}),
    shots,
    flows,
  });
  process.stdout.write(
    `${JSON.stringify({ outDir: options.outDir, summary, flowSummary, qualificationProblems })}\n`,
  );
  if (
    summary.failed ||
    summary.suspect ||
    flowSummary.fail ||
    qualificationProblems.length
  )
    process.exitCode = 2;
}

function readOptions(): RunOptions {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      only: { type: "string" },
      port: { type: "string" },
      rotating: { type: "boolean", default: false },
      "no-personal-sharing": { type: "boolean", default: false },
      flows: { type: "boolean", default: false },
      "flows-only": { type: "boolean", default: false },
      "require-onboarding": { type: "boolean", default: false },
      "next-heap-mb": { type: "string" },
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
    flags: {
      rotating: values.rotating ?? false,
      personalSharing: !values["no-personal-sharing"],
    },
    shots: !values["flows-only"],
    flows: Boolean(values.flows || values["flows-only"]),
    requireOnboarding: values["require-onboarding"] ?? false,
    nextHeapMb:
      values["next-heap-mb"] === undefined
        ? undefined
        : readHeapSize(values["next-heap-mb"]),
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
        NODE_ENV: "development",
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
    developmentProbesBlocked: distinct("development_probe_blocked"),
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {
    captured: 0,
    suspect: 0,
    failed: 0,
    skipped: 0,
  };
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

async function sourceProvenance(): Promise<VisualSourceProvenance> {
  // `next dev` itself rewrites next-env.d.ts; it is not a source change.
  const paths = ["--", ".", ":(exclude)apps/web/next-env.d.ts"];
  const [head, tree, delta, untracked] = await Promise.all([
    execFileAsync("git", ["-C", repoRoot, "rev-parse", "HEAD"]),
    execFileAsync("git", ["-C", repoRoot, "rev-parse", "HEAD^{tree}"]),
    execFileAsync(
      "git",
      ["-C", repoRoot, "diff", "--binary", "HEAD", ...paths],
      { maxBuffer: 64 * 1024 * 1024 },
    ),
    execFileAsync("git", [
      "-C",
      repoRoot,
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      ...paths,
    ]),
  ]);
  const untrackedPaths = untracked.stdout.split("\0").filter(Boolean).sort();
  const hash = createHash("sha256").update(delta.stdout);
  for (const path of untrackedPaths)
    hash.update(`\0${path}\0`).update(await readFile(join(repoRoot, path)));
  return {
    revision: head.stdout.trim(),
    tree: tree.stdout.trim(),
    sourceDeltaSha256: hash.digest("hex"),
    untrackedPaths,
  };
}

function readHeapSize(value: string): number {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 256 || size > 8192)
    throw new Error("provider_visual_next_heap_must_be_256_to_8192_mb");
  return size;
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
