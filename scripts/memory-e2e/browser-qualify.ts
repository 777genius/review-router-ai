import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium, type Browser, type Page } from "playwright-core";

const root = fileURLToPath(new URL("../../", import.meta.url));
const databaseUrl = process.env.MEMORY_E2E_BROWSER_DATABASE_URL ?? "";
const parsedDatabaseUrl = new URL(databaseUrl);
assert(
  ["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) &&
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      parsedDatabaseUrl.hostname,
    ) &&
    parsedDatabaseUrl.pathname === "/reviewrouter_memory_browser_test" &&
    !parsedDatabaseUrl.search &&
    !parsedDatabaseUrl.hash,
  "Use an explicit loopback reviewrouter_memory_browser_test database URL without connection options.",
);
const executablePath = process.env.MEMORY_E2E_BROWSER_EXECUTABLE ?? "";
assert(
  isAbsolute(executablePath),
  "MEMORY_E2E_BROWSER_EXECUTABLE must identify an installed Chromium executable.",
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
      "Browser qualification refuses local dotenv files; provide only the explicit test environment.",
    );
  }
}

const runId = randomBytes(8).toString("hex");
const outputDir = join(
  process.env.MEMORY_E2E_OUTPUT_DIR ?? join(root, "tmp/memory-e2e/browser"),
  `run-${new Date().toISOString().replaceAll(":", "-")}-${runId}`,
);
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const sourceFiles = [
  "apps/web/app/dashboard/memory-development-notice.tsx",
  "apps/web/app/dashboard/memory-preview/page.tsx",
  "apps/web/app/dashboard/dashboard-workspace-page.tsx",
  "apps/web/app/dashboard/actions.ts",
  "apps/web/app/globals.css",
  "apps/web/app/layout.tsx",
  "apps/web/app/dashboard-aware-footer.tsx",
  "apps/web/app/theme-toggle.tsx",
  "packages/ui/src/tokens/tokens.css",
  "packages/platform/db/prisma/schema.prisma",
];
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
const fixture = {
  userId: `memory-browser-user-${runId}`,
  identityId: `memory-browser-identity-${runId}`,
  workspaceId: `memory-browser-workspace-${runId}`,
  workspaceSlug: `memory-browser-${runId}`,
  memberId: `memory-browser-member-${runId}`,
  login: `memory-browser-${runId}`,
  externalId: String(
    940_000_000_000_000n + BigInt(`0x${randomBytes(5).toString("hex")}`),
  ),
};
const role = `memory_browser_${runId}`;
const rolePassword = randomBytes(32).toString("hex");
const authSecret = randomBytes(32).toString("hex");
const admin = new pg.Client({
  connectionString: databaseUrl,
  application_name: "reviewrouter-memory-browser-fixture",
});
let roleCreated = false;
let seedCreated = false;
let child: ChildProcess | undefined;
let browser: Browser | undefined;
let deniedMemoryTables: string[] = [];
type MemoryColorEvidence = {
  bodyBackground: string;
  pageBackgroundToken: string;
  footerBaseBackground: string;
  footerBackgroundToken: string;
  text: {
    label: string;
    foreground: string;
    foregroundRgb: number[];
    backgroundRgb: number[];
    contrast: number;
  }[];
};
const results: {
  route: string;
  theme: "dark" | "light";
  viewport: { width: number; height: number };
  screenshot: string | null;
  clientWidth: number;
  scrollWidth: number;
  colors: MemoryColorEvidence;
}[] = [];
const memoryApiRequests: string[] = [];
const externalRequests: string[] = [];
const browserErrors: string[] = [];
const cleanupErrors: unknown[] = [];
let browserVersion: string;
const logPath = join(outputDir, "next-app.log");

await admin.connect();
try {
  await seed();
  const appDatabaseUrl = await createReadOnlyAppRole();
  const port = await loopbackPort();
  const appUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...cleanEnvironment(),
    NODE_ENV: "development",
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
    REVIEW_ROUTER_ENABLE_MEMORY_PREVIEW: "1",
    GITHUB_APP_CLIENT_ID: "memory-browser-synthetic-client",
    GITHUB_APP_CLIENT_SECRET: "memory-browser-synthetic-secret",
  };
  const log = await open(logPath, "wx", 0o600);
  child = spawn(
    process.execPath,
    [
      join(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: join(root, "apps/web"),
      env: environment,
      detached: process.platform !== "win32",
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  let startupError: Error | undefined;
  child.once("error", (error) => {
    startupError = error;
  });
  await log.close();
  const deadline = Date.now() + 120_000;
  while (true) {
    if (startupError) throw startupError;
    assert(child.exitCode === null, "Next exited before becoming healthy.");
    const healthy = await fetch(`${appUrl}/api/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(2_000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) break;
    assert(
      Date.now() < deadline,
      "Next readiness timeout; inspect next-app.log.",
    );
    await delay(250);
  }

  // Resolve the application's declared NextAuth implementation, as the existing
  // accounts harness does. The actual NextAuth session callback and DB membership
  // authorization run unchanged; no OAuth/provider network call is required.
  const webRequire = createRequire(join(root, "apps/web/package.json"));
  const { encode } = webRequire("next-auth/jwt") as {
    encode(input: {
      secret: string;
      maxAge: number;
      token: Record<string, string | null>;
    }): Promise<string>;
  };
  const sessionToken = await encode({
    secret: authSecret,
    maxAge: 600,
    token: {
      sub: fixture.userId,
      name: fixture.login,
      email: `${fixture.login}@invalid.test`,
      picture: null,
      sourceProvider: "github",
      externalUserId: fixture.externalId,
      sourceLogin: fixture.login,
      sourceAvatarUrl: null,
      githubUserId: fixture.externalId,
      githubLogin: fixture.login,
      githubAvatarUrl: null,
    },
  });
  browser = await chromium.launch({
    executablePath,
    headless: true,
    env: cleanEnvironment(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  browserVersion = browser.version();
  const routes = [
    { name: "memory", path: "/dashboard?section=memory", screenshot: true },
    {
      name: "knowledge",
      path: "/dashboard?section=memory&memory_mode=knowledge",
      screenshot: false,
    },
    {
      name: "suggestions",
      path: "/dashboard?section=memory&memory_mode=suggestions&memory_suggestion=stale",
      screenshot: false,
    },
    {
      name: "table",
      path: "/dashboard?section=memory&memory_mode=table&memory_item=stale",
      screenshot: false,
    },
    {
      name: "preview",
      path: "/dashboard/memory-preview?memory_mode=suggestions&mode=table&scenario=populated",
      screenshot: true,
    },
  ];
  for (const theme of ["dark", "light"] as const) {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 900, height: 1100 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, baseURL: appUrl });
      try {
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
            externalRequests.push(
              `${route.request().method()} ${url.origin}${url.pathname}`,
            );
            await route.abort();
            return;
          }
          await route.continue();
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => browserErrors.push(error.message));
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (/^\/api\/.*memory(?:\/|$)/u.test(url.pathname)) {
            memoryApiRequests.push(`${request.method()} ${url.pathname}`);
          }
        });
        for (const route of routes) {
          const target = new URL(route.path, appUrl);
          if (route.name !== "preview") {
            target.searchParams.set("workspace", fixture.workspaceSlug);
          }
          const response = await page.goto(target.toString(), {
            waitUntil: "networkidle",
            timeout: 120_000,
          });
          assert.equal(response?.status(), 200, route.name);
          assert.equal(new URL(page.url()).pathname, target.pathname);
          if (route.name === "memory") {
            await selectThemeThroughHeader(page, theme);
          }
          await page.waitForFunction(
            (expected) =>
              document.documentElement.dataset.theme === expected &&
              document.documentElement.dataset.themePreference === expected,
            theme,
          );
          assert.deepEqual(
            await page.evaluate(() => ({
              resolved: document.documentElement.dataset.theme,
              preference: document.documentElement.dataset.themePreference,
              stored: localStorage.getItem("reviewrouter-theme"),
              colorScheme: getComputedStyle(document.documentElement)
                .colorScheme,
            })),
            {
              resolved: theme,
              preference: theme,
              stored: theme,
              colorScheme: theme,
            },
            "The application must apply and retain the selected theme.",
          );
          const notice = page.getByRole("region", {
            name: "Memory",
            exact: true,
          });
          await notice.waitFor({ state: "visible", timeout: 15_000 });
          assert.equal(
            (await notice.innerText())
              .replace(/\s+/gu, " ")
              .trim()
              .toLowerCase(),
            "memory in development saved knowledge for your workspace’s code reviews. this section isn’t available yet. there’s nothing to set up here while we’re working on it.",
          );
          await notice
            .getByRole("heading", { name: "Memory", level: 1, exact: true })
            .waitFor({ state: "visible" });
          assert.equal(
            await page.locator("h1").count(),
            1,
            "Memory must have one page heading in either shell.",
          );
          assert.equal(
            await notice.locator("button,form,input,select,textarea,a").count(),
            0,
            "The Memory notice must have no functional controls.",
          );
          assert.equal(
            await page.locator("form").count(),
            0,
            "No memory form may return via an old route.",
          );
          const colors = await assertMemoryColors(page, theme);
          const dimensions = await page.evaluate(async () => {
            await document.fonts.ready;
            return {
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
            };
          });
          assert(
            dimensions.scrollWidth <= dimensions.clientWidth + 1,
            `Horizontal overflow on ${route.name} at ${viewport.width}px: ${JSON.stringify(dimensions)}`,
          );
          const screenshot = route.screenshot
            ? `${route.name}-${theme}-${viewport.width}x${viewport.height}.png`
            : null;
          if (screenshot) {
            await page.screenshot({
              path: join(outputDir, screenshot),
              fullPage: true,
            });
          }
          results.push({
            route: route.path,
            theme,
            viewport,
            screenshot,
            colors,
            ...dimensions,
          });
        }
      } finally {
        await context.close();
      }
    }
  }
  assert.deepEqual(memoryApiRequests, [], "Memory API requests occurred.");
  assert.deepEqual(
    externalRequests,
    [],
    "The browser attempted an external request.",
  );
  assert.deepEqual(browserErrors, [], "Browser runtime errors occurred.");
  assert(
    !/permission denied for table Memory|PrismaClientKnownRequestError/u.test(
      await readFile(logPath, "utf8"),
    ),
    "The real app attempted forbidden database IO; inspect next-app.log.",
  );
  for (const path of sourceFiles) {
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex"),
      sourceSha256[path],
      `Source changed during browser qualification: ${path}`,
    );
  }
} finally {
  // Always attempt every cleanup even if an earlier process/connection has
  // already failed. Every database target belongs exclusively to this run.
  for (const cleanup of [
    async () => await browser?.close(),
    async () => {
      if (child) await stopApp(child);
    },
    async () => {
      if (seedCreated)
        await admin.query('DELETE FROM "Workspace" WHERE id = $1', [
          fixture.workspaceId,
        ]);
    },
    async () => {
      if (seedCreated)
        await admin.query('DELETE FROM "User" WHERE id = $1', [fixture.userId]);
    },
    async () => {
      if (roleCreated)
        await admin.query(`DROP OWNED BY ${pg.escapeIdentifier(role)}`);
    },
    async () => {
      if (roleCreated)
        await admin.query(`DROP ROLE ${pg.escapeIdentifier(role)}`);
    },
    async () => await admin.end(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    await writeFile(
      join(outputDir, "cleanup-failed.txt"),
      "Fixture cleanup failed; inspect this run's unique role and records.\n",
    );
  }
}
if (cleanupErrors.length > 0) {
  throw new AggregateError(
    cleanupErrors,
    "Memory browser fixture cleanup failed.",
  );
}
await writeFile(
  join(outputDir, "result.json"),
  `${JSON.stringify(
    {
      outcome: "passed",
      checkedAt: new Date().toISOString(),
      nextMode: "development-webpack",
      session: "synthetic-signed-nextauth-jwt-real-membership-authorization",
      database: "explicit-loopback-browser-database-prepared-separately",
      appRole: "temporary-read-only-no-memory-table-privileges",
      fixtureCleanup: "passed",
      deniedMemoryTables,
      sourceSha256,
      browserVersion,
      themeSelection:
        "native-header-control-with-persisted-preference-and-applied-css",
      memoryApiRequests,
      externalRequests,
      browserErrors,
      cases: results,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Memory browser qualification passed: ${results.length} cases. Evidence: ${outputDir}`,
);

async function selectThemeThroughHeader(
  page: Page,
  theme: "dark" | "light",
): Promise<void> {
  // Every context starts with the application's default dark preference. Use
  // the real control even for dark so persistence, not the OS preference or
  // a manually assigned data attribute, establishes the qualified theme.
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page
    .getByRole("button", { name: "Light theme", exact: true })
    .waitFor();
  if (theme === "dark") {
    await page
      .getByRole("button", { name: "Light theme", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use system theme", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Use system theme", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Dark theme", exact: true })
      .waitFor();
  }
}

async function assertMemoryColors(
  page: Page,
  theme: "dark" | "light",
): Promise<MemoryColorEvidence> {
  const paint = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const notice = document.getElementById("dashboard-section-content");
    const footer = document.querySelector(
      'footer[aria-label="Dashboard footer"]',
    );
    if (!notice || !footer) throw new Error("Missing Memory page surfaces.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const drawing = canvas.getContext("2d", {
      colorSpace: "srgb",
      willReadFrequently: true,
    });
    if (!drawing) throw new Error("Missing native sRGB color measurement.");
    const painter = {
      colors(colors: readonly string[]): number[] {
        drawing.clearRect(0, 0, 1, 1);
        drawing.globalCompositeOperation = "source-over";
        for (const color of colors) {
          // Invalid Canvas colors retain the previous fill. Two sentinels make
          // unsupported CSS colors fail instead of silently measuring black.
          drawing.fillStyle = "#000001";
          drawing.fillStyle = color;
          const parsed = drawing.fillStyle;
          drawing.fillStyle = "#000002";
          drawing.fillStyle = color;
          if (drawing.fillStyle !== parsed)
            throw new Error(`Unsupported Canvas color: ${color}`);
          drawing.fillRect(0, 0, 1, 1);
        }
        return Array.from(drawing.getImageData(0, 0, 1, 1).data);
      },
    };
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const pageBackgroundToken = rootStyle
      .getPropertyValue("--rr-page-bg")
      .trim();
    const footerBaseBackground = getComputedStyle(footer).backgroundColor;
    const footerBackgroundToken = rootStyle
      .getPropertyValue("--rr-footer-bg")
      .trim();
    return {
      bodyBackground,
      pageBackgroundToken,
      footerBaseBackground,
      footerBackgroundToken,
      bodyRgba: painter.colors([bodyBackground]),
      pageTokenRgba: painter.colors([pageBackgroundToken]),
      footerRgba: painter.colors([footerBaseBackground]),
      footerTokenRgba: painter.colors([footerBackgroundToken]),
      text: Array.from(
        notice.querySelectorAll("h1, p, header span"),
        (element) => {
          const layers = [];
          for (
            let ancestor: Element | null = element;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            const style = getComputedStyle(ancestor);
            layers.push({
              background: style.backgroundColor,
              image: style.backgroundImage,
              opacity: Number(style.opacity),
            });
          }
          if (
            layers.some(
              (layer) => layer.opacity !== 1 || layer.image !== "none",
            )
          ) {
            throw new Error(
              "Memory contrast requires solid ancestor backgrounds and unmodified group opacity; inspect new effects visually.",
            );
          }
          const backgrounds = layers.map((layer) => layer.background).reverse();
          const foreground = getComputedStyle(element).color;
          const backgroundRgba = painter.colors(backgrounds);
          if (backgroundRgba[3] !== 255)
            throw new Error("Memory text requires a resolved opaque underlay.");
          return {
            label: element.textContent?.trim() ?? element.tagName,
            foreground,
            foregroundRgb: painter
              .colors([...backgrounds, foreground])
              .slice(0, 3),
            backgroundRgb: backgroundRgba.slice(0, 3),
          };
        },
      ),
    };
  });
  if (theme === "light") {
    assert.deepEqual(
      paint.bodyRgba,
      paint.pageTokenRgba,
      "Light Memory must use the actual light page surface.",
    );
    assert.deepEqual(
      paint.footerRgba,
      paint.footerTokenRgba,
      "Light footer must retain its light base surface.",
    );
  }
  assert.equal(
    paint.text.length,
    5,
    "Check the title, badge, description, state and help text.",
  );
  const text = paint.text.map((sample) => {
    const luminances = [
      luminance(sample.foregroundRgb),
      luminance(sample.backgroundRgb),
    ];
    const contrast =
      (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
    assert(
      contrast >= 4.5,
      `Memory text contrast below 4.5: ${sample.label} (${contrast.toFixed(2)}).`,
    );
    return {
      ...sample,
      contrast: Number(contrast.toFixed(4)),
    };
  });
  return {
    bodyBackground: paint.bodyBackground,
    pageBackgroundToken: paint.pageBackgroundToken,
    footerBaseBackground: paint.footerBaseBackground,
    footerBackgroundToken: paint.footerBackgroundToken,
    text,
  };
}

function luminance(color: readonly number[]): number {
  const linear = (byte: number): number => {
    const channel = byte / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(color[0]!) +
    0.7152 * linear(color[1]!) +
    0.0722 * linear(color[2]!)
  );
}

async function seed(): Promise<void> {
  await admin.query("BEGIN");
  try {
    await admin.query(
      'INSERT INTO "User" (id, "githubUserId", "githubLogin", "primaryEmail", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [
        fixture.userId,
        fixture.externalId,
        fixture.login,
        `${fixture.login}@invalid.test`,
      ],
    );
    await admin.query(
      'INSERT INTO "UserExternalIdentity" (id, "userId", provider, "externalUserId", login, "updatedAt") VALUES ($1, $2, \'github\', $3, $4, CURRENT_TIMESTAMP)',
      [fixture.identityId, fixture.userId, fixture.externalId, fixture.login],
    );
    await admin.query(
      'INSERT INTO "Workspace" (id, slug, name, "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
      [
        fixture.workspaceId,
        fixture.workspaceSlug,
        "Memory Browser Qualification",
      ],
    );
    await admin.query(
      'INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", "githubLogin", role, "updatedAt") VALUES ($1, $2, $3, $4, \'owner\', CURRENT_TIMESTAMP)',
      [fixture.memberId, fixture.workspaceId, fixture.userId, fixture.login],
    );
    await admin.query("COMMIT");
    seedCreated = true;
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

async function createReadOnlyAppRole(): Promise<string> {
  const quotedRole = pg.escapeIdentifier(role);
  await admin.query(
    `CREATE ROLE ${quotedRole} LOGIN PASSWORD ${pg.escapeLiteral(rolePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  roleCreated = true;
  await admin.query(
    `ALTER ROLE ${quotedRole} SET default_transaction_read_only = on`,
  );
  await admin.query(
    `GRANT CONNECT ON DATABASE reviewrouter_memory_browser_test TO ${quotedRole}`,
  );
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
  const tables = (
    await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    )
  ).rows.map(({ tablename }) => tablename);
  deniedMemoryTables = tables.filter((name) => name.startsWith("Memory"));
  assert(
    deniedMemoryTables.includes("MemoryItem") &&
      deniedMemoryTables.includes("MemoryProjectionReceipt"),
    "Prepare the current Prisma schema and memory migration before browser qualification.",
  );
  const allowedTables = tables.filter((name) => !name.startsWith("Memory"));
  await admin.query(
    `GRANT SELECT ON ${allowedTables.map((name) => `public.${pg.escapeIdentifier(name)}`).join(", ")} TO ${quotedRole}`,
  );
  for (const table of deniedMemoryTables) {
    const privileges = (
      await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') AS allowed",
        [role, `public.${pg.escapeIdentifier(table)}`],
      )
    ).rows[0];
    assert.equal(
      privileges?.allowed,
      false,
      `Memory table privileges must be absent: ${table}`,
    );
  }
  const appUrl = new URL(databaseUrl);
  appUrl.username = role;
  appUrl.password = rolePassword;
  return appUrl.toString();
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
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
        reject(new Error("Loopback port allocation failed."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function stopApp(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null || app.signalCode !== null || !app.pid) return;
  const signal = (name: NodeJS.Signals) => {
    if (process.platform !== "win32" && app.pid) process.kill(-app.pid, name);
    else app.kill(name);
  };
  signal("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (
    app.exitCode === null &&
    app.signalCode === null &&
    Date.now() < deadline
  ) {
    await delay(100);
  }
  if (app.exitCode === null && app.signalCode === null) signal("SIGKILL");
}
