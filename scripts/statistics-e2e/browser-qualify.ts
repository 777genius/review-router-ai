/** Real Next SSR/API + PostgreSQL + Chromium; named loopback disposable data only. */
import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import type {
  StatisticsReport,
  StatisticsIssuePage,
} from "../../packages/features/review-statistics/src/domain/statistics.js";
import {
  seedHistoryFixtures,
  restoreHistoryCoverage,
  warmHistoryApis,
  qualifyHistory,
} from "./history-scenario.js";
import {
  createHistorySource,
  qualifyHistorySource,
  warmHistorySourceApis,
  type HistorySourceFixture,
} from "./history-source.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scenario = process.env.STATISTICS_E2E_SCENARIO ?? "full";
assert(
  ["full", "authorization-recovery", "history", "history-source"].includes(
    scenario,
  ),
  "Unknown statistics qualification scenario",
);
const databaseUrl = process.env.STATISTICS_E2E_DATABASE_URL ?? "";
const database = new URL(databaseUrl);
assert(
  ["postgres:", "postgresql:"].includes(database.protocol) &&
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(database.hostname) &&
    database.pathname === "/reviewrouter_statistics_test" &&
    !database.search &&
    !database.hash,
  "Use only the explicit loopback reviewrouter_statistics_test database without connection options.",
);
const executablePath = process.env.STATISTICS_E2E_BROWSER_EXECUTABLE ?? "";
assert(
  isAbsolute(executablePath),
  "STATISTICS_E2E_BROWSER_EXECUTABLE must be an absolute Chromium path.",
);
await access(executablePath);
for (const directory of [root, join(root, "apps/web")]) {
  for (const name of [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
  ]) {
    assert(
      !(await access(join(directory, name)).then(
        () => true,
        () => false,
      )),
      "Refusing local dotenv files; use the explicit synthetic test environment.",
    );
  }
}
const runId = randomBytes(6).toString("hex");
const prefix = `statistics-browser-${runId}`;
const outputDir = join(
  root,
  "tmp/statistics-e2e",
  `run-${new Date().toISOString().replaceAll(":", "-")}-${runId}`,
);
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const runtimeTmp = join(outputDir, "runtime-tmp");
await mkdir(runtimeTmp);
const previousTmpdir = process.env.TMPDIR;
process.env.TMPDIR = runtimeTmp;
const nextEnvPath = join(root, "apps/web/next-env.d.ts");
const originalNextEnv = await readFile(nextEnvPath, "utf8");
const role = `statistics_browser_${runId}`;
const password = randomBytes(24).toString("hex");
const authSecret = randomBytes(24).toString("hex");
const actor = {
  id: `${prefix}-user`,
  identity: `${prefix}-identity`,
  login: `statistics-${runId}`,
  externalId: String(
    950_000_000_000_000n + BigInt(`0x${randomBytes(4).toString("hex")}`),
  ),
};
const main = {
  id: `${prefix}-main`,
  slug: `${prefix}-main`,
  name: "Review statistics qualification",
};
const empty = {
  id: `${prefix}-empty`,
  slug: `${prefix}-empty`,
  name: "Empty statistics workspace",
};
const foreign = {
  id: `${prefix}-foreign`,
  slug: `${prefix}-foreign`,
  name: "Unauthorized source history workspace",
};
const dayMs = 86_400_000;
const fixtureUtcDay = new Date();
fixtureUtcDay.setUTCHours(0, 0, 0, 0);
const epoch = new Date(Date.now() - 200 * dayMs).toISOString();
const repositories = [
  "harbor",
  "observatory-for-security-and-engineering-metrics-examples",
  "telescope",
  "empty",
].map((name, index) => ({
  id: `${prefix}-repo-${index}`,
  scm: `${prefix}-scm-${index}`,
  name,
  fullName: `observatory/${name}`,
  workspaceId: index === 3 ? empty.id : main.id,
}));
const specialTitle =
  '<img src=x onerror="alert(1)"> is displayed as plain finding text';
const admin = new pg.Client({
  connectionString: databaseUrl,
  application_name: "statistics-browser-fixture",
});
let child: ChildProcess | undefined;
let browser: Browser | undefined;
let adminConnected = false;
let seeded = false;
let roleCreated = false;
let coverageChanged = false;
let originalCoverage: string | null = null;
let originalHistoryCoverage: string | null = null;
let historyCoverageChanged = false;
let historySource: HistorySourceFixture | undefined;
let failure: unknown;
let appStopRequested = false;
let appExit: {
  code: number | null;
  signal: string | null;
  phase: string;
} | null = null;
let appUrl = "",
  sessionToken = "",
  nextVersion = "",
  browserVersion = "",
  serverVersion = "";
const checks: string[] = [];
const requests: { path: string; status: number; phase: string }[] = [];
const screenshots: {
  name: string;
  width: number;
  height: number;
  theme: string;
  scrollWidth: number;
}[] = [];
const browserErrors: string[] = [],
  externalRequests: string[] = [],
  cleanupErrors: string[] = [];
const sourceFiles = [
  "apps/web/app/dashboard/dashboard-section.ts",
  "apps/web/app/dashboard/dashboard-workspace-page.tsx",
  "apps/web/app/dashboard/review-statistics-section.tsx",
  "apps/web/src/server/review-statistics.ts",
  "apps/web/app/api/dashboard/review-statistics/route.ts",
  "apps/web/app/api/dashboard/review-statistics/issues/route.ts",
  "apps/web/src/features/review-statistics/interface/statistics-view.tsx",
  "apps/web/src/features/review-statistics/interface/statistics-charts.tsx",
  "packages/features/review-statistics/src/infrastructure/prisma-statistics-reader.ts",
  "packages/platform/db/prisma/schema.prisma",
  "scripts/statistics-e2e/browser-qualify.ts",
  "scripts/statistics-e2e/dev-server.ts",
];
const isHistory = scenario === "history" || scenario === "history-source";
if (isHistory)
  sourceFiles.push(
    "apps/web/app/dashboard/review-history-section.tsx",
    "apps/web/src/server/review-history.ts",
    "apps/web/src/features/review-history/interface/history-view.tsx",
    "apps/web/src/features/review-history/interface/history-scope.tsx",
    "apps/web/src/features/review-history/interface/history-repository-filter.tsx",
    "apps/web/src/features/review-history/interface/history-runs.tsx",
    "apps/web/src/features/review-history/interface/history-row.tsx",
    "apps/web/src/features/review-history/interface/history.module.css",
    "apps/web/src/features/review-history/adapters/history-api.ts",
    "packages/ui/src/search-select-field/search-select-field.tsx",
    "packages/features/review-history/src/adapters/outbound/prisma-history-reader.ts",
    "packages/platform/db/prisma/migrations/000151_review_history/migration.sql",
    "scripts/statistics-e2e/history-scenario.ts",
  );
if (scenario === "history-source")
  sourceFiles.push(
    "scripts/statistics-e2e/history-source.ts",
    "scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness.ts",
    "scripts/review-action-v2-production-e2e/support/fake-github.ts",
    "apps/api/src/review-v2-request-ingress-outbox.ts",
    "apps/api/src/review-action-v2-production-composition.ts",
    "apps/worker/src/review-v2-production-runtime.ts",
    "apps/worker/src/review-v2-worker-runtime.ts",
    "apps/worker/src/review-history-worker-runtime.ts",
    "packages/features/review-history/src/adapters/outbound/history-source-snapshots.ts",
    "packages/features/review-history/src/adapters/outbound/prisma-history-writer.ts",
    "packages/features/review-history/src/adapters/outbound/prisma-history-projector.ts",
    "packages/features/review-history/src/domain/status-policy.ts",
  );
const migrations = (
  await readdir(join(root, "packages/platform/db/prisma/migrations"))
).filter((name) => name.endsWith("_review_statistics"));
assert.equal(
  migrations.length,
  1,
  "Exactly one statistics migration must be present",
);
sourceFiles.push(
  `packages/platform/db/prisma/migrations/${migrations[0]}/migration.sql`,
);
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex"),
    ]),
  ),
);
const sourceCommit = (
  await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })
).stdout.trim();
const logPath = join(outputDir, "next-app.log");

try {
  await admin.connect();
  adminConnected = true;
  serverVersion = (
    await admin.query<{ server_version: string }>("SHOW server_version")
  ).rows[0]!.server_version;
  if (scenario === "history-source") {
    await seedSourceIdentity();
    historySource = await createHistorySource(databaseUrl, {
      prefix: `${prefix}-source`,
      workspaceId: main.id,
    });
    // Keep synthetic installation avatars on an existing local asset so the
    // dashboard's GitHub avatar fallback cannot introduce external requests.
    const avatar = await admin.query(
      'UPDATE "GitHubInstallation" SET "accountAvatarUrl"=\'/service-icons/github.svg\' WHERE "id"=$1 AND "workspaceId"=$2',
      [`${historySource.harness.prefix}-installation`, main.id],
    );
    assert.equal(
      avatar.rowCount,
      1,
      "Only the owned source installation avatar changes",
    );
  } else await seed();
  if (scenario === "history") {
    originalHistoryCoverage = await seedHistoryFixtures(
      admin,
      prefix,
      main.id,
      epoch,
    );
    historyCoverageChanged = true;
  }
  console.log("statistics-e2e: real fixtures seeded");
  const appDatabaseUrl = await readOnlyRole();
  const port = await loopbackPort();
  appUrl = `http://127.0.0.1:${port}`;
  const log = await open(logPath, "wx", 0o600);
  child = spawn(
    process.execPath,
    [
      "--expose-gc",
      "--import",
      "tsx",
      join(root, "scripts/statistics-e2e/dev-server.ts"),
      String(port),
      join(outputDir, "next-build"),
    ],
    {
      cwd: join(root, "apps/web"),
      detached: process.platform !== "win32",
      stdio: ["ignore", log.fd, log.fd],
      env: {
        ...cleanEnvironment(),
        TMPDIR: runtimeTmp,
        NODE_ENV: "development",
        NODE_OPTIONS: "--max-old-space-size=1024",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PRIVATE_TEST_MODE: "1",
        DATABASE_URL: appDatabaseUrl,
        AUTH_SECRET: authSecret,
        NEXTAUTH_SECRET: authSecret,
        AUTH_TRUST_HOST: "true",
        NEXTAUTH_URL: appUrl,
        REVIEW_ROUTER_WEB_URL: appUrl,
        REVIEW_ROUTER_PUBLIC_WEB_URL: appUrl,
        REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS: "1",
        GITHUB_APP_CLIENT_ID: "statistics-synthetic-client",
        GITHUB_APP_CLIENT_SECRET: "statistics-synthetic-secret",
        REVIEW_ROUTER_DB_POOL_MAX: "3",
      },
    },
  );
  await log.close();
  child.once("error", (error) => {
    failure = error;
  });
  child.once("exit", (code, signal) => {
    appExit = {
      code,
      signal,
      phase: appStopRequested ? "cleanup" : "qualification",
    };
    if (!appStopRequested) {
      failure ??= new Error(
        `Next exited before owned shutdown: code=${code}, signal=${signal}`,
      );
    }
    console.log("statistics-e2e: Next child exit", JSON.stringify(appExit));
  });
  const deadline = Date.now() + 150_000;
  while (
    !(await fetch(`${appUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    }).then(
      (response) => response.ok,
      () => false,
    ))
  ) {
    assert(
      !failure &&
        child.exitCode === null &&
        child.signalCode === null &&
        Date.now() < deadline,
      "Next startup failed; inspect next-app.log",
    );
    await delay(300);
  }
  console.log("statistics-e2e: Next dev webpack ready");
  const webRequire = createRequire(join(root, "apps/web/package.json"));
  nextVersion = (webRequire("next/package.json") as { version: string })
    .version;
  const { encode } = webRequire("next-auth/jwt") as {
    encode(input: object): Promise<string>;
  };
  sessionToken = await encode({
    secret: authSecret,
    maxAge: 1800,
    token: {
      sub: actor.id,
      name: actor.login,
      email: `${actor.login}@invalid.test`,
      picture: null,
      sourceProvider: "github",
      externalUserId: actor.externalId,
      sourceLogin: actor.login,
      sourceAvatarUrl: null,
      githubUserId: actor.externalId,
      githubLogin: actor.login,
      githubAvatarUrl: null,
    },
  });
  const warm = await fetch(
    `${appUrl}/dashboard?section=${isHistory ? "reviews" : "statistics"}&workspace=${main.slug}`,
    {
      headers: { cookie: `next-auth.session-token=${sessionToken}` },
      signal: AbortSignal.timeout(180_000),
    },
  );
  assert.equal(warm.status, 200, "Warm real SSR request");
  const warmHtml = await warm.text();
  assert(
    warmHtml.includes(
      isHistory ? "Reviewed pull requests" : "All-severity review summary",
    ),
    "Initial HTML must contain the server-rendered report",
  );
  if (historySource)
    assert(
      warmHtml.includes(historySource.first.repositoryFullName) &&
        warmHtml.includes(historySource.first.pullRequestTitle ?? "") &&
        warmHtml.includes("Queued"),
      "Initial SSR must contain the source-produced queued review",
    );
  checks.push("authorized initial SSR HTML contains the real report");
  console.log("statistics-e2e: authorized SSR compiled before browser launch");
  await writeFile(
    join(outputDir, "ssr-evidence.json"),
    JSON.stringify({
      status: warm.status,
      containsReport: true,
      expectedFixtureTotals:
        scenario === "history-source"
          ? { pullRequests: 1, runs: 1, status: "queued" }
          : scenario === "history"
            ? { firstPage: 25, pullRequests: 35 }
            : [12, 90, 180],
      sourceCommit,
      sourceSha256,
      node: process.version,
      postgres: serverVersion,
    }) + "\n",
  );
  if (scenario === "history-source") {
    assert(historySource);
    await warmHistorySourceApis(warmApi, historySource, admin);
    checks.push(
      "source-produced queued PR is present in real SSR and all three private/no-store History GET warmups",
    );
  } else if (scenario === "history") {
    await warmHistoryApis(warmApi, main.id);
    checks.push(
      "all three actual protected history API warmups return200/private-no-store,25 PRs,25 repositories and5 runs",
    );
  } else {
    const warmedReport = await warmApi(
      `/api/dashboard/review-statistics?workspaceId=${main.id}&days=30&severity=all`,
    );
    const report = (await warmedReport.json()) as StatisticsReport;
    await writeFile(
      join(outputDir, "warm-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    assert.equal(report.totals.reviews, 90);
    assert.equal(report.totals.pullRequestsReviewed, 12);
    assert.equal(report.totals.issuesCaught, 180);
    const issuesQuery = new URLSearchParams({
      workspaceId: main.id,
      from: report.period.from,
      to: report.period.to,
      severity: "all",
    });
    const warmedIssues = await warmApi(
      `/api/dashboard/review-statistics/issues?${issuesQuery}`,
    );
    assert.equal(
      ((await warmedIssues.json()) as StatisticsIssuePage).items.length,
      25,
    );
    checks.push(
      "both actual protected API warmups return200/private-no-store with exact fixture totals and25 issues",
    );
    console.log(
      "statistics-e2e: both protected APIs compiled before browser launch",
    );
  }
  await fetch(`${appUrl}/api/health`, {
    signal: AbortSignal.timeout(30_000),
  }).then((response) => response.text());
  browser = await chromium.launch({
    executablePath,
    headless: true,
    env: {
      ...cleanEnvironment(),
      TMPDIR: runtimeTmp,
      LD_LIBRARY_PATH: `${dirname(executablePath)}:${process.env.LD_LIBRARY_PATH ?? ""}`,
    },
    args: [
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
      "--renderer-process-limit=1",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });
  browserVersion = browser.version();
  const context = await contextFor({ width: 1440, height: 1000 });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  observe(page);
  if (scenario === "history-source") {
    assert(historySource);
    await qualifyHistorySource({
      page,
      context,
      admin,
      appUrl,
      main,
      empty,
      foreign,
      source: historySource,
      checks,
      requests,
      snapshot,
      selectTheme,
    });
  } else if (scenario === "history") {
    await qualifyHistory({
      page,
      context,
      admin,
      appUrl,
      main,
      empty,
      actorId: actor.id,
      role,
      prefix,
      checks,
      snapshot,
      selectTheme,
      addMember,
    });
  } else if (scenario === "authorization-recovery") {
    await openWorkspace(page, main.slug);
    await selectTheme(page, "dark");
    await populated(page);
    await snapshot(page, "authorized-initial-seed.png");
    await membershipRecovery(page, context);
  } else {
    for (const theme of ["dark", "light"] as const) {
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 900, height: 1100 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await openWorkspace(page, main.slug);
        await selectTheme(page, theme);
        await populated(page);
        assert.equal(
          await page
            .getByRole("heading", { name: "Statistics", level: 1, exact: true })
            .count(),
          1,
        );
        assert.equal(await page.getByText(/merge time/i).count(), 0);
        await dailyRows(page, 30, true);
        const dimensions = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        assert(
          dimensions.scrollWidth <= dimensions.width + 1,
          `Page overflow at${viewport.width}: ${JSON.stringify(dimensions)}`,
        );
        await snapshot(page, `populated-${theme}-${viewport.width}.png`);
        console.log(`statistics-e2e: ${theme} ${viewport.width}px checked`);
      }
    }
    checks.push(
      "six viewport/theme screenshots with two real Recharts SVGs, exact summary/daily table, UTC labels and no horizontal overflow",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openWorkspace(page, main.slug);
    await selectTheme(page, "dark");
    await interactions(page, context);
  }
  assert.deepEqual(
    browserErrors,
    [],
    "No browser runtime errors may be hidden",
  );
  assert.deepEqual(
    externalRequests,
    [],
    "Fixture must not call external services",
  );
} catch (error) {
  failure = error;
} finally {
  for (const action of [
    async () => {
      await browser?.close();
    },
    async () => {
      if (child) await stopApp(child);
    },
    async () => {
      const current = await readFile(nextEnvPath, "utf8");
      if (current === originalNextEnv) return;
      const originalReference = originalNextEnv.match(
        /^import ".*types\/routes\.d\.ts";$/mu,
      )?.[0];
      assert(
        originalReference && current.includes(runId),
        "Next metadata changed outside this owned run; refusing overwrite",
      );
      const normalized = current.replace(
        /^import ".*next-build\/dev\/types\/routes\.d\.ts";$/mu,
        originalReference,
      );
      assert.equal(
        normalized,
        originalNextEnv,
        "Next metadata has additional changes; refusing overwrite",
      );
      await writeFile(nextEnvPath, originalNextEnv);
    },
    async () => {
      await rm(join(outputDir, "next-build"), { recursive: true, force: true });
      await rm(runtimeTmp, { recursive: true, force: true });
    },
    async () => {
      if (adminConnected && historyCoverageChanged)
        await restoreHistoryCoverage(admin, originalHistoryCoverage);
    },
    async () => {
      await historySource?.harness.cleanupHistoryFixtures();
    },
    async () => {
      await historySource?.harness.close();
    },
    async () => {
      if (!adminConnected || !coverageChanged) return;
      if (originalCoverage)
        await admin.query(
          'INSERT INTO "ReviewStatisticsCoverage" ("id","activatedAt") VALUES (\'capture_v1\',$1) ON CONFLICT ("id") DO UPDATE SET "activatedAt"=EXCLUDED."activatedAt"',
          [originalCoverage],
        );
      else
        await admin.query(
          'DELETE FROM "ReviewStatisticsCoverage" WHERE "id"=\'capture_v1\'',
        );
      const restored =
        (
          await admin.query<{ activatedAt: string }>(
            'SELECT "activatedAt"::text AS "activatedAt" FROM "ReviewStatisticsCoverage" WHERE "id"=\'capture_v1\'',
          )
        ).rows[0]?.activatedAt ?? null;
      assert.equal(
        restored,
        originalCoverage,
        "Capture boundary must be restored exactly",
      );
    },
    async () => {
      if (!adminConnected || !seeded) return;
      const identities = repositories.map((row) => row.scm);
      await admin.query(
        'UPDATE "ScmRepositoryIdentity" SET "currentWorkspaceId"=NULL,"currentRepositoryConnectionId"=NULL,"unboundAt"=NOW() WHERE "scmRepositoryIdentityId"=ANY($1::text[])',
        [identities],
      );
      await admin.query('DELETE FROM "Workspace" WHERE "id"=ANY($1::text[])', [
        scenario === "history-source"
          ? [main.id, empty.id, foreign.id]
          : [main.id, empty.id],
      ]);
      await admin.query(
        'DELETE FROM "ReviewMutationAuthority" WHERE "scmRepositoryIdentityId"=ANY($1::text[])',
        [identities],
      );
      await admin.query(
        'DELETE FROM "ScmRepositoryIdentity" WHERE "scmRepositoryIdentityId"=ANY($1::text[])',
        [identities],
      );
      await admin.query('DELETE FROM "User" WHERE "id"=$1', [actor.id]);
    },
    async () => {
      if (adminConnected && roleCreated) {
        await admin.query(`DROP OWNED BY ${pg.escapeIdentifier(role)}`);
        await admin.query(`DROP ROLE ${pg.escapeIdentifier(role)}`);
      }
    },
    async () => {
      if (adminConnected) await admin.end();
    },
  ]) {
    try {
      await action();
    } catch (error) {
      cleanupErrors.push(redactFailure(error));
    }
  }
  if (previousTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpdir;
}
const result = {
  outcome: failure || cleanupErrors.length ? "failed" : "passed",
  checkedAt: new Date().toISOString(),
  nextMode: "development-webpack-cache-disabled-test-server",
  scenario,
  sourceCommit,
  sourceSha256,
  statisticsMigration: migrations[0],
  appExit,
  nodeVersion: process.version,
  nextVersion,
  browserVersion,
  serverVersion,
  authentication:
    "synthetic signed NextAuth JWT with real user, identity and membership DB reads",
  data:
    scenario === "history-source"
      ? "real production ingress, intent dispatcher, Action v2/execution, publication/completion capture and registered History outbox handler on one PostgreSQL database; external GitHub/OIDC/provider adapters are synthetic"
      : "real migrated PostgreSQL; direct compact-fact fixtures; capture/projector qualification is separate",
  sourceHistoryEvidence: historySource?.evidence,
  appRole: "temporary SELECT-only role; writes never granted",
  checks,
  screenshots,
  requests,
  browserErrors,
  externalRequests,
  cleanup: cleanupErrors.length ? cleanupErrors : "passed",
  failure: failure ? redactFailure(failure) : null,
};
await writeFile(
  join(outputDir, "result.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(`statistics-e2e: ${result.outcome}; evidence ${outputDir}`);
if (failure) throw new Error(redactFailure(failure));
assert.equal(cleanupErrors.length, 0, "Fixture cleanup failed");

async function warmApi(path: string): Promise<Response> {
  const response = await fetch(appUrl + path, {
    headers: { cookie: `next-auth.session-token=${sessionToken}` },
    signal: AbortSignal.timeout(180_000),
  });
  requests.push({
    path: new URL(appUrl + path).pathname,
    status: response.status,
    phase: "warmup",
  });
  assert.equal(response.status, 200, "Protected API warmup");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}
function redactFailure(error: unknown): string {
  const description =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  return (
    sessionToken
      ? description.replaceAll(sessionToken, "[synthetic-session]")
      : description
  )
    .replaceAll(password, "[synthetic-role-secret]")
    .replaceAll(authSecret, "[synthetic-auth-secret]");
}
async function populated(page: Page) {
  await page.getByLabel("All-severity review summary").waitFor();
  assert.deepEqual(
    await page
      .getByLabel("All-severity review summary")
      .locator("dd")
      .allTextContents(),
    ["12", "90", "180"],
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".recharts-surface").length === 2,
  );
  await page.locator(".recharts-surface").nth(1).waitFor({ state: "visible" });
}
async function dailyRows(
  page: Page,
  expected: number,
  checkUtc: boolean,
): Promise<string[]> {
  const disclosure = page.getByText("Daily data · all severities", {
    exact: true,
  });
  await disclosure.click();
  const table = page.getByRole("region", {
    name: "Daily review data",
    exact: true,
  });
  assert.equal(await table.locator("tbody tr").count(), expected);
  assert.deepEqual(await table.getByRole("columnheader").allTextContents(), [
    "UTC day",
    "Coverage",
    "PRs reviewed",
    "Reviews",
    "Critical",
    "Major",
    "Minor",
    "Unknown",
  ]);
  if (checkUtc) {
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - (expected - 1));
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(from);
    assert.equal(
      await table
        .locator("tbody tr")
        .first()
        .getByRole("rowheader")
        .innerText(),
      label,
      "UTC midnight must not shift to the previous day in Honolulu",
    );
  }
  const observedDay = new Date();
  observedDay.setUTCHours(0, 0, 0, 0);
  assert.equal(
    observedDay.getTime(),
    fixtureUtcDay.getTime(),
    "Qualification crossed UTC midnight; rerun with a stable fixture period",
  );
  const actualCells = await table
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(
          row.querySelectorAll("th,td"),
          (cell) => cell.textContent?.trim() ?? "",
        ),
      ),
    );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const expectedCells = Array.from({ length: expected }, (_, index) => {
    const dayOffset = expected - 1 - index;
    const day = new Date(fixtureUtcDay.getTime() - dayOffset * dayMs);
    const active = dayOffset < 30;
    const issues = [0, 0, 0, 0];
    if (active)
      for (let issue = 0; issue < 6; issue++)
        issues[(dayOffset * 6 + issue) % 4]!++;
    // This fixture's capture/workspace/qualified-source boundaries predate all
    // presets. Coverage is Covered even today; in-progress is a separate label.
    return [
      formatter.format(day) + (dayOffset === 0 ? " · in progress" : ""),
      "Covered",
      active ? "3" : "0",
      active ? "3" : "0",
      ...issues.map(String),
    ];
  });
  assert.deepEqual(
    actualCells,
    expectedCells,
    "Every UTC day, coverage label and all-severity numeric cell must match the known immutable fixture",
  );
  const rows = await table.locator("tbody tr").allTextContents();
  await disclosure.click();
  return rows;
}
async function snapshot(page: Page, name: string) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({ path: join(outputDir, name), fullPage: true });
  const size = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    theme: document.documentElement.dataset.theme ?? "unknown",
    scrollWidth: document.documentElement.scrollWidth,
  }));
  screenshots.push({ name, ...size });
}
async function interactions(page: Page, context: BrowserContext) {
  const response = await context.request.get(
    `${appUrl}/api/dashboard/review-statistics?workspaceId=${main.id}&days=30&severity=all`,
    { timeout: 180_000 },
  );
  requests.push({
    path: "/api/dashboard/review-statistics",
    status: response.status(),
    phase: "actual-api",
  });
  assert.equal(response.status(), 200);
  assert.equal(response.headers()["cache-control"], "private, no-store");
  const report = (await response.json()) as StatisticsReport;
  assert.equal(report.totals.pullRequestsReviewed, 12);
  assert.equal(
    report.daily.reduce((sum, row) => sum + row.pullRequestsReviewed, 0),
    90,
    "Daily PRs are deliberately nonadditive across days",
  );
  await choose(page, "Chart metric", "Total reviews", true);
  await page.getByLabel("Daily reviews", { exact: true }).waitFor();
  await choose(page, "Period", "Last 7 days", true);
  await dailyRows(page, 7, false);
  await choose(page, "Period", "Last 90 days");
  await dailyRows(page, 90, false);
  await choose(page, "Period", "Last 30 days");
  const ranking = page.getByRole("region", {
    name: "Top repositories by reviews",
    exact: true,
  });
  const reviewRanks = await ranking.locator("li").allTextContents();
  const allDailyRows = await dailyRows(page, 30, false);
  await choose(page, "Severity", "Major", true);
  await page.waitForFunction(
    () =>
      document.activeElement ===
      document
        .querySelector('[name="statistics-severity"]')
        ?.closest("label")
        ?.querySelector('[role="combobox"], select'),
  );
  await page
    .getByText("Repositories with the most major issues", { exact: true })
    .waitFor();
  assert.deepEqual(
    await page
      .getByLabel("All-severity review summary")
      .locator("dd")
      .allTextContents(),
    ["12", "90", "180"],
  );
  assert.deepEqual(
    await ranking.locator("li").allTextContents(),
    reviewRanks,
    "Review ranking remains all-severity",
  );
  assert.deepEqual(
    await dailyRows(page, 30, false),
    allDailyRows,
    "Accessible daily table remains all-severity",
  );
  await page
    .getByRole("button", { name: "View issues caught →", exact: true })
    .click();
  const issues = page.getByRole("region", {
    name: "Recorded issues",
    exact: true,
  });
  await issues.locator("li").first().waitFor();
  assert.equal(await issues.locator("li").count(), 25);
  assert(
    await issues.evaluate((element) => element === document.activeElement),
    "Explicit issue opening focuses the panel",
  );
  assert.equal(
    await issues.locator("li").getByText("Major", { exact: true }).count(),
    25,
  );
  const firstPageRows = new Set(await issues.locator("li").allTextContents());
  assert.equal(firstPageRows.size, 25);
  await issues.getByRole("button", { name: "Next", exact: true }).click();
  await issues.getByText("Page 2", { exact: true }).waitFor();
  assert.equal(await issues.locator("li").count(), 20);
  assert.equal(
    await issues.locator("li").getByText("Major", { exact: true }).count(),
    20,
  );
  const secondPageRows = new Set(await issues.locator("li").allTextContents());
  assert.equal(secondPageRows.size, 20);
  assert.equal(new Set([...firstPageRows, ...secondPageRows]).size, 45);
  assert(
    [...secondPageRows].every((row) => !firstPageRows.has(row)),
    "Keyset pages must contain distinct Major findings",
  );
  await issues
    .getByRole("button", { name: "Close issues", exact: true })
    .click();
  await choose(page, "Severity", "All severities");
  await page
    .getByRole("button", {
      name: "View issues in observatory/harbor",
      exact: true,
    })
    .click();
  await issues.locator("li").first().waitFor();
  assert.equal(await issues.locator("li").count(), 25);
  assert.equal(
    await issues
      .locator("li")
      .getByText("observatory/harbor", { exact: true })
      .count(),
    await issues.locator("li").count(),
    "Every displayed repository-scoped issue must belong to Harbor",
  );
  assert(
    await issues.evaluate((element) => element === document.activeElement),
    "Repository navigation focuses the panel",
  );
  await issues
    .getByRole("button", { name: "All repositories", exact: true })
    .click();
  await issues.locator("li").first().waitFor();
  assert.equal(
    await issues.getByText(specialTitle, { exact: true }).count(),
    1,
    "Untrusted title must be plain text",
  );
  assert.equal(await issues.locator("img").count(), 0);
  let failIssuePage = true;
  await page.route(
    "**/api/dashboard/review-statistics/issues?**",
    async (route) => {
      if (
        new URL(route.request().url()).searchParams.has("cursor") &&
        failIssuePage
      ) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"fixture_page_failure"}',
          headers: { "cache-control": "private, no-store" },
        });
      } else await route.continue();
    },
  );
  await issues.getByRole("button", { name: "Next", exact: true }).click();
  await issues
    .getByRole("button", { name: "Retry issues", exact: true })
    .waitFor();
  await page.getByLabel("All-severity review summary").waitFor();
  failIssuePage = false;
  await issues
    .getByRole("button", { name: "Retry issues", exact: true })
    .click();
  await issues.getByText("Page 2", { exact: true }).waitFor();
  const topRefresh = page.getByRole("button", { name: "Refresh", exact: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await topRefresh.focus();
  const beforeRefreshScroll = await page.evaluate(() => window.scrollY);
  await topRefresh.click();
  await issues.getByText("Page 1", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Refresh",
  );
  assert.equal(
    await page.evaluate(() => window.scrollY),
    beforeRefreshScroll,
    "Report refresh must not jump to issues",
  );
  assert(
    await topRefresh.evaluate((element) => element === document.activeElement),
    "Refresh keeps initiating control focus after issue remount",
  );
  await snapshot(page, "issues-drilldown.png");
  await page.unroute("**/api/dashboard/review-statistics/issues?**");
  checks.push(
    "real API totals/nonadditive daily PRs; keyboard metric/preset/severity;7/30/90 presets; fixed review ranking/all-severity KPI+table; real25-to20 keyset page; repo scope/reset; escaped text;503 page-only retry",
  );
  await openWorkspace(page, empty.slug);
  await page
    .getByText("No published reviews in this period yet.", { exact: true })
    .waitFor();
  assert.deepEqual(
    await page
      .getByLabel("All-severity review summary")
      .locator("dd")
      .allTextContents(),
    ["0", "0", "0"],
  );
  await snapshot(page, "empty-workspace.png");
  checks.push("authorized empty workspace shows measured zero totals");
  await admin.query(
    'DELETE FROM "ReviewStatisticsCoverage" WHERE "id"=\'capture_v1\'',
  );
  await openWorkspace(page, main.slug);
  await page
    .getByText("Statistics are not available yet for this workspace.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByLabel("All-severity review summary").count(), 0);
  await snapshot(page, "missing-activation.png");
  checks.push(
    "missing capture boundary shows unavailable without measured-zero cards",
  );
  await admin.query(
    'INSERT INTO "ReviewStatisticsCoverage" ("id","activatedAt") VALUES (\'capture_v1\',$1)',
    [epoch],
  );
  await admin.query(
    `REVOKE SELECT ON "ReviewStatisticsReviewFact" FROM ${pg.escapeIdentifier(role)}`,
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 150_000 });
  await page
    .getByRole("button", { name: "Retry statistics", exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("All-severity review summary").count(), 0);
  await snapshot(page, "initial-read-failure.png");
  await admin.query(
    `GRANT SELECT ON "ReviewStatisticsReviewFact" TO ${pg.escapeIdentifier(role)}`,
  );
  await page
    .getByRole("button", { name: "Retry statistics", exact: true })
    .click();
  await populated(page);
  checks.push(
    "actual read-role SELECT revocation causes feature-local initial SSR failure and successful real retry after grant restoration",
  );
  await membershipRecovery(page, context);
}
async function membershipRecovery(page: Page, context: BrowserContext) {
  await admin.query(
    'DELETE FROM "WorkspaceMember" WHERE "workspaceId"=$1 AND "userId"=$2',
    [main.id, actor.id],
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText(/Statistics access is no longer available/).waitFor();
  assert.equal(await page.getByLabel("All-severity review summary").count(), 0);
  assert.equal(await page.locator(".recharts-surface").count(), 0);
  await snapshot(page, "membership-revoked.png");
  const denied = await context.request.get(
    `${appUrl}/api/dashboard/review-statistics?workspaceId=${main.id}&days=30&severity=all`,
    { timeout: 180_000 },
  );
  requests.push({
    path: "/api/dashboard/review-statistics",
    status: denied.status(),
    phase: "membership-denied",
  });
  assert.equal(denied.status(), 403);
  assert.equal(denied.headers()["cache-control"], "private, no-store");
  await addMember(main.id);
  assert.equal(
    await page.getByLabel("All-severity review summary").count(),
    0,
    "Membership restoration cannot revive rejected client seed",
  );
  checks.push(
    "actual membership removal/report403 hides entire dataset; restored membership does not revive rejected old client seed",
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 150_000 });
  await populated(page);
  await snapshot(page, "authorized-fresh-seed-recovery.png");
  checks.push(
    "fresh authorized server reload supplies a new seed, exact12/90/180 totals and two measured real chart SVGs",
  );
}
async function choose(
  page: Page,
  label: string,
  option: string,
  keyboard = false,
) {
  const target = page.getByRole("combobox", { name: new RegExp(label, "i") });
  if (keyboard) {
    await target.focus();
    await target.press("ArrowDown");
  } else await target.click();
  const selected = page.getByRole("option", { name: option, exact: true });
  await selected.waitFor();
  if (keyboard) {
    await selected.focus();
    await selected.press("Enter");
  } else await selected.click();
  if (label !== "Chart metric") {
    await page.getByRole("button", { name: "Refresh", exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          'section[aria-label="Review statistics"] [aria-busy="true"]',
        ),
    );
  }
}
async function openWorkspace(page: Page, slug: string) {
  const response = await page.goto(
    `${appUrl}/dashboard?section=statistics&workspace=${slug}`,
    { waitUntil: "domcontentloaded", timeout: 180_000 },
  );
  assert.equal(response?.status(), 200);
  await page
    .getByRole("heading", { name: "Statistics", level: 1, exact: true })
    .waitFor({ timeout: 120_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.dashboardLayoutReady === "true",
    undefined,
    { timeout: 30_000 },
  );
}
async function contextFor(viewport: {
  width: number;
  height: number;
}): Promise<BrowserContext> {
  const context = await browser!.newContext({
    viewport,
    baseURL: appUrl,
    timezoneId: "Pacific/Honolulu",
    serviceWorkers: "block",
  });
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      url: appUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== appUrl) {
      externalRequests.push(`${url.origin}${url.pathname}`);
      await route.abort();
    } else await route.continue();
  });
  return context;
}
function observe(page: Page) {
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.pathname.startsWith("/api/dashboard/review-statistics") ||
      url.pathname.startsWith("/api/dashboard/review-history")
    )
      requests.push({
        path: url.pathname,
        status: response.status(),
        phase: "browser",
      });
  });
}
async function selectTheme(page: Page, theme: "dark" | "light") {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (
      await page.evaluate(
        (expected) =>
          document.documentElement.dataset.theme === expected &&
          document.documentElement.dataset.themePreference === expected &&
          localStorage.getItem("reviewrouter-theme") === expected,
        theme,
      )
    )
      return;
    await page
      .getByRole("button", {
        name: /^(Dark theme|Light theme|Use system theme)$/,
      })
      .first()
      .click();
  }
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    theme,
  );
}
async function seedSourceIdentity() {
  // Source runs use the production harness's control-plane fixtures. Seed the
  // browser identity, memberships and empty workspace's connection here.
  await admin.query("BEGIN");
  try {
    await admin.query(
      'INSERT INTO "User" ("id","githubUserId","githubLogin","primaryEmail","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
      [actor.id, actor.externalId, actor.login, `${actor.login}@invalid.test`],
    );
    await admin.query(
      'INSERT INTO "UserExternalIdentity" ("id","userId","provider","externalUserId","login","updatedAt") VALUES ($1,$2,\'github\',$3,$4,NOW())',
      [actor.identity, actor.id, actor.externalId, actor.login],
    );
    for (const workspace of [main, empty, foreign]) {
      await admin.query(
        'INSERT INTO "Workspace" ("id","slug","name","createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
        [workspace.id, workspace.slug, workspace.name, epoch],
      );
      if (workspace !== foreign) await addMember(workspace.id);
    }
    // Dashboard navigation includes actionable workspaces. A connected source
    // with no repositories keeps the authorized empty workspace selectable.
    await admin.query(
      'INSERT INTO "GitHubInstallation" ("id","workspaceId","githubInstallationId","accountLogin","accountType","accountAvatarUrl","repositorySelection","updatedAt") VALUES ($1,$2,$3,$4,\'Organization\',\'/service-icons/github.svg\',\'selected\',NOW())',
      [`${prefix}-empty-installation`, empty.id, actor.externalId, empty.slug],
    );
    await admin.query("COMMIT");
    seeded = true;
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}
async function seed() {
  await admin.query("BEGIN");
  try {
    originalCoverage =
      (
        await admin.query<{ activatedAt: string }>(
          'SELECT "activatedAt"::text AS "activatedAt" FROM "ReviewStatisticsCoverage" WHERE "id"=\'capture_v1\'',
        )
      ).rows[0]?.activatedAt ?? null;
    await admin.query(
      'INSERT INTO "ReviewStatisticsCoverage" ("id","activatedAt") VALUES (\'capture_v1\',$1) ON CONFLICT ("id") DO UPDATE SET "activatedAt"=EXCLUDED."activatedAt"',
      [epoch],
    );
    await admin.query(
      'INSERT INTO "User" ("id","githubUserId","githubLogin","primaryEmail","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
      [actor.id, actor.externalId, actor.login, `${actor.login}@invalid.test`],
    );
    await admin.query(
      'INSERT INTO "UserExternalIdentity" ("id","userId","provider","externalUserId","login","updatedAt") VALUES ($1,$2,\'github\',$3,$4,NOW())',
      [actor.identity, actor.id, actor.externalId, actor.login],
    );
    for (const workspace of [main, empty]) {
      await admin.query(
        'INSERT INTO "Workspace" ("id","slug","name","createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
        [workspace.id, workspace.slug, workspace.name, epoch],
      );
      await addMember(workspace.id);
    }
    for (const [index, row] of repositories.entries()) {
      // Binding has a compound FK on the fully migrated schema. Create it
      // unbound, insert the repository, then establish its current binding.
      await admin.query(
        'INSERT INTO "ScmRepositoryIdentity" ("scmRepositoryIdentityId","provider","normalizedSourceBaseUrl","externalRepositoryId","createdAt") VALUES ($1,\'github\',\'https://github.com\',$2,$3)',
        [row.scm, `${prefix}-${index}`, epoch],
      );
      await admin.query(
        'INSERT INTO "RepositoryConnection" ("id","workspaceId","provider","sourceBaseUrl","externalRepositoryId","scmRepositoryIdentityId","owner","name","fullName","defaultBranch","visibility","updatedAt") VALUES ($1,$2,\'github\',\'https://github.com\',$3,$4,\'observatory\',$5,$6,\'main\',\'private\',NOW())',
        [
          row.id,
          row.workspaceId,
          `${prefix}-${index}`,
          row.scm,
          row.name,
          row.fullName,
        ],
      );
      await admin.query(
        'UPDATE "ScmRepositoryIdentity" SET "currentWorkspaceId"=$2,"currentRepositoryConnectionId"=$3,"boundAt"=$4 WHERE "scmRepositoryIdentityId"=$1',
        [row.scm, row.workspaceId, row.id, epoch],
      );
      await admin.query(
        'INSERT INTO "ReviewMutationAuthority" ("scmRepositoryIdentityId","laneKind","mode","initializedAt","activatedAt") VALUES ($1,\'hosted_reviewrouter_app\',\'v2_active\',$2,$2)',
        [row.scm, epoch],
      );
      await admin.query(
        'INSERT INTO "WorkflowProvisioning" ("id","attemptId","workspaceId","repositoryId","status","branch","workflowPath","actionVersion","updatedAt") VALUES ($1,$2,$3,$4,\'configured\',$5,\'.github/workflows/reviewrouter-review.yml\',$6,NOW())',
        [
          `${prefix}-workflow-${index}`,
          `${prefix}-workflow-attempt-${index}`,
          row.workspaceId,
          row.id,
          `${prefix}-setup`,
          "a".repeat(40),
        ],
      );
    }
    const today = fixtureUtcDay;
    // Today's observation must be in the past even when qualification runs
    // before16:00UTC, unlike a fixed afternoon timestamp fixture.
    const todayOffset = Math.max(
      0,
      Math.min(16 * 3_600_000, Date.now() - today.getTime() - 60_000),
    );
    const severities = ["critical", "major", "minor", "unknown"] as const;
    for (let day = 0; day < 30; day++) {
      const observed = new Date(
        today.getTime() -
          day * dayMs +
          (day === 0 ? todayOffset : 16 * 3_600_000),
      ).toISOString();
      for (let repositoryIndex = 0; repositoryIndex < 3; repositoryIndex++) {
        const repository = repositories[repositoryIndex]!;
        const reviewIndex = day * 3 + repositoryIndex;
        const executionId = `${prefix}-review-${String(reviewIndex).padStart(4, "0")}`;
        const pullRequestNumber = (day % 4) + 1;
        const payloadHash = createHash("sha256")
          .update(executionId)
          .digest("hex");
        await admin.query(
          'INSERT INTO "ReviewStatisticsReviewFact" ("executionId","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","settledAt","payloadHash") VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            executionId,
            main.id,
            repository.id,
            repository.scm,
            pullRequestNumber,
            observed,
            payloadHash,
          ],
        );
        for (let issue = 0; issue < 2; issue++) {
          const issueIndex = reviewIndex * 2 + issue;
          // Intentionally opaque, schema-valid IDs qualify cursor roundtrips;
          // production projector IDs are normally hashes.
          const id = `${prefix}-issue-${String(issueIndex).padStart(4, "0")}`;
          await admin.query(
            'INSERT INTO "ReviewStatisticsIssueFact" ("id","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","lineageId","severity","title","caughtAt","sourceExecutionId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [
              id,
              main.id,
              repository.id,
              repository.scm,
              pullRequestNumber,
              `${prefix}-lineage-${issueIndex}`,
              severities[issueIndex % 4],
              issueIndex === 0
                ? specialTitle
                : `Recorded finding ${issueIndex + 1}: safely handle the boundary condition`,
              observed,
              executionId,
            ],
          );
        }
      }
    }
    // Bind explicit UTC strings to TIMESTAMP WITHOUT TIME ZONE. node-postgres
    // otherwise formats Date parameters in the host's local timezone.
    const seedReceipt = (
      await admin.query<{
        reviews: number;
        issues: number;
        prs: number;
        future: number;
        futureIssues: number;
        earliest: string;
        latest: string;
      }>(
        `
      SELECT COUNT(*)::int AS reviews,
        COUNT(DISTINCT ("scmRepositoryIdentityId","pullRequestNumber"))::int AS prs,
        COUNT(*) FILTER (WHERE "settledAt">(clock_timestamp() AT TIME ZONE 'UTC'))::int AS future,
        MIN("settledAt")::text AS earliest, MAX("settledAt")::text AS latest,
        (SELECT COUNT(*)::int FROM "ReviewStatisticsIssueFact" WHERE "workspaceId"=$1) AS issues,
        (SELECT COUNT(*)::int FROM "ReviewStatisticsIssueFact" WHERE "workspaceId"=$1 AND "caughtAt">(clock_timestamp() AT TIME ZONE 'UTC')) AS "futureIssues"
      FROM "ReviewStatisticsReviewFact" WHERE "workspaceId"=$1
        AND "settledAt">=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')-INTERVAL '29 days'
    `,
        [main.id],
      )
    ).rows[0]!;
    assert.deepEqual(
      [
        seedReceipt.reviews,
        seedReceipt.prs,
        seedReceipt.issues,
        seedReceipt.future,
        seedReceipt.futureIssues,
      ],
      [90, 12, 180, 0, 0],
      "UTC fixture must be complete and in the past before starting Next",
    );
    await writeFile(
      join(outputDir, "seed-receipt.json"),
      JSON.stringify(
        {
          fixtureUtcDay: fixtureUtcDay.toISOString(),
          nodeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...seedReceipt,
        },
        null,
        2,
      ) + "\n",
    );
    await admin.query("COMMIT");
    seeded = true;
    coverageChanged = true;
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}
async function addMember(workspaceId: string) {
  await admin.query(
    'INSERT INTO "WorkspaceMember" ("id","workspaceId","userId","githubLogin","role","updatedAt") VALUES ($1,$2,$3,$4,\'member\',NOW()) ON CONFLICT ("workspaceId","userId") DO NOTHING',
    [`${workspaceId}-member`, workspaceId, actor.id, actor.login],
  );
}
async function readOnlyRole(): Promise<string> {
  await admin.query(
    `CREATE ROLE ${pg.escapeIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD ${pg.escapeLiteral(password)}`,
  );
  roleCreated = true;
  await admin.query(
    `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(database.pathname.slice(1))} TO ${pg.escapeIdentifier(role)}`,
  );
  await admin.query(
    `GRANT USAGE ON SCHEMA public TO ${pg.escapeIdentifier(role)}`,
  );
  await admin.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${pg.escapeIdentifier(role)}`,
  );
  await admin.query(
    `ALTER ROLE ${pg.escapeIdentifier(role)} SET default_transaction_read_only=on`,
  );
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}
function cleanEnvironment(): Record<string, string | undefined> {
  const output: Record<string, string | undefined> = {};
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "LD_LIBRARY_PATH",
    "FONTCONFIG_PATH",
  ]) {
    if (process.env[key] !== undefined) output[key] = process.env[key];
  }
  output.PATH = `${dirname(process.execPath)}:${output.PATH ?? ""}`;
  return output;
}
async function loopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Loopback port allocation failed"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
async function stopApp(app: ChildProcess): Promise<void> {
  if (!app.pid) return;
  const pid = app.pid;
  const unixGroup = process.platform !== "win32";
  const alive = () => {
    if (!unixGroup) return app.exitCode === null && app.signalCode === null;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const signal = (name: NodeJS.Signals) => {
    try {
      if (unixGroup) process.kill(-pid, name);
      else app.kill(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  // The only negative PID is the detached process group this run created.
  // Its leader may have exited while compiler/runtime descendants remain.
  if (!alive()) return;
  appStopRequested = true;
  signal("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (alive() && Date.now() < deadline) await delay(100);
  if (alive()) {
    signal("SIGKILL");
    const finalDeadline = Date.now() + 5000;
    while (alive() && Date.now() < finalDeadline) await delay(50);
    assert(!alive(), "Owned Next process group did not stop");
  }
}
