import { seedSkillsFixtures } from "./skills-fixtures.ts";
import { warmNextClientScripts } from "./warm-next-client-scripts.ts";
import { startSkillCatalogFixture } from "./skill-catalog-fixture.ts";
import { seedSkillsReadinessFixtures } from "./skills-readiness-fixture.ts";
import {
  startSkillsGitHubFixture,
  SKILLS_MANAGER_EXTERNAL_ID,
} from "./skills-github-fixture.ts";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpus, freemem, totalmem } from "node:os";
import { statfs, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseCliOptions } from "./cli.ts";
import {
  BASELINE_REVISION,
  SKILLS_FIXTURE_BOUNDARY,
  SKILL_CATALOG_FIXTURE_BOUNDARY,
  PROBE_FIXTURE_BOUNDARY,
  ACCOUNT_MODELS_FIXTURE_BOUNDARY,
  LIMITS_FIXTURE_BOUNDARY,
  SUBSCRIPTION_FIXTURE_BOUNDARY,
  API_KEY_STORAGE_FIXTURE_BOUNDARY,
  FIXTURES,
  type FixtureSecrets,
  type RuntimeDescriptor,
} from "./contracts.ts";
import { createDatabaseFixture } from "./database.ts";
import { startGatewayFixture } from "./gateway-fixture.ts";
import { startNextApp } from "./app.ts";
import { createSessionCookie, otherIdentity, viewerIdentity } from "./auth.ts";

const execFileAsync = promisify(execFile);
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type TestSummary = {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failures: readonly string[];
};

async function main(): Promise<void> {
  const fixtureBoundary = process.argv.includes("--skill-catalog-fixture")
    ? SKILL_CATALOG_FIXTURE_BOUNDARY
    : process.argv.includes("--api-key-storage-fixture")
      ? API_KEY_STORAGE_FIXTURE_BOUNDARY
      : process.argv.includes("--skills-fixture")
        ? SKILLS_FIXTURE_BOUNDARY
        : process.argv.includes("--account-models-fixture")
          ? ACCOUNT_MODELS_FIXTURE_BOUNDARY
          : process.argv.includes("--subscription-fixture")
            ? SUBSCRIPTION_FIXTURE_BOUNDARY
            : process.argv.includes("--limits-fixture")
              ? LIMITS_FIXTURE_BOUNDARY
              : process.argv.includes("--probe-fixture")
                ? PROBE_FIXTURE_BOUNDARY
                : "UI/read contract and authorization checks only; no native suspend, resume, erasure, or lifecycle proof";
  const options = parseCliOptions(process.argv);
  await ensureWorkDir(options.workDir);
  const revision = await readRevision(options.repoRoot);
  const sourceDelta = await execFileAsync(
    "git",
    [
      "-C",
      options.repoRoot,
      "diff",
      "--binary",
      "HEAD",
      "--",
      "apps/web",
      "packages/features/provider-accounts",
      "packages/platform/db",
      "scripts/accounts-reference-e2e/src",
      ...(process.argv.includes("--skill-catalog-fixture")
        ? [
            "packages/features/review-skills",
            "packages/features/rate-limits",
            "packages/features/outbox",
            "apps/worker",
            "services/skill-scanner",
          ]
        : []),
    ],
    { maxBuffer: 256 * 1024 * 1024, encoding: "buffer" },
  )
    .then(({ stdout }) => createHash("sha256").update(stdout).digest("hex"))
    .catch(() => "unknown");
  const secrets: FixtureSecrets = {
    authSecret: randomBytes(32).toString("base64url"),
    gatewayAccountsContextSecret: randomBytes(32).toString("base64url"),
    githubClientId: `rr-e2e-unused-${randomBytes(8).toString("hex")}`,
    githubClientSecret: randomBytes(32).toString("base64url"),
    managementToken: randomBytes(32).toString("base64url"),
    personalControlToken: randomBytes(32).toString("base64url"),
  };
  const resources = await inspectResources(options.repoRoot, options.workDir);
  let skillsGitHub: Awaited<
    ReturnType<typeof startSkillsGitHubFixture>
  > | null = null;
  let database: Awaited<ReturnType<typeof createDatabaseFixture>> | null = null;
  let gateway: Awaited<ReturnType<typeof startGatewayFixture>> | null = null;
  let app: Awaited<ReturnType<typeof startNextApp>> | null = null;
  let skillCatalog: Awaited<
    ReturnType<typeof startSkillCatalogFixture>
  > | null = null;
  let summary: TestSummary = { passed: 0, failed: 0, skipped: 0, failures: [] };
  let failure: string | null = null;
  try {
    database = await createDatabaseFixture({
      repoRoot: options.repoRoot,
      workDir: options.workDir,
      databaseUrl: options.databaseUrl,
      isolatedPglite: options.isolatedPglite,
    });
    if (process.argv.includes("--skills-fixture")) {
      if (!process.argv.includes("--resume-own-fixtures")) {
        await seedSkillsFixtures(database.databaseUrl);
        await seedSkillsReadinessFixtures(database.databaseUrl);
      }
      skillsGitHub = await startSkillsGitHubFixture();
    }
    gateway = await startGatewayFixture({
      repoRoot: options.repoRoot,
      databaseUrl: database.databaseUrl,
      workDir: options.workDir,
      secrets,
    });
    if (process.argv.includes("--skill-catalog-fixture")) {
      skillCatalog = await startSkillCatalogFixture({
        repoRoot: options.repoRoot,
        workDir: options.workDir,
        databaseUrl: database.databaseUrl,
      });
    }
    app = await startNextApp({
      repoRoot: options.repoRoot,
      workDir: options.workDir,
      databaseUrl: database.databaseUrl,
      gatewayUrl: gateway.url,
      secrets,
      browserExecutable: options.browserExecutable,
      ...(skillsGitHub ? { skillsGitHub } : {}),
      ...(skillCatalog ? { skillCatalog } : {}),
    });
    const viewer = await createSessionCookie(
      viewerIdentity(),
      secrets,
      app.url,
    );
    const other = await createSessionCookie(otherIdentity(), secrets, app.url);
    const manager = skillsGitHub
      ? await createSessionCookie(
          {
            userId: FIXTURES.users.foreign,
            sourceProvider: "github",
            externalUserId: SKILLS_MANAGER_EXTERNAL_ID,
            sourceLogin: FIXTURES.identities.foreign.login,
            sourceAvatarUrl: null,
          },
          secrets,
          app.url,
        )
      : null;
    const descriptor: RuntimeDescriptor = {
      appUrl: app.url,
      gatewayUrl: gateway.url,
      databaseMode: database.descriptor.databaseMode,
      databaseName: database.descriptor.databaseName,
      workDir: options.workDir,
      repoRoot: options.repoRoot,
      revision,
      baselineExpected: options.expectedRevision,
      secretsGenerated: true,
      externalNetworkAllowed: false,
      fixtureBoundary,
    };
    await writeJson(join(options.workDir, "runtime.json"), descriptor);
    const boot = await verifyBoot(app.url, viewer.header, options.workDir);
    await writeJson(join(options.workDir, "boot-report.json"), boot);
    if (options.runBrowserTests) {
      summary = await runPlaywright({
        appUrl: app.url,
        gatewayUrl: gateway.url,
        databaseUrl: database.databaseUrl,
        resultJson: join(options.workDir, "playwright-result.json"),
        viewerCookie: viewer.header,
        otherCookie: other.header,
        managerCookie: manager?.header ?? "",
        browserExecutable: options.browserExecutable,
        ...(skillCatalog
          ? {
              skillCatalog: {
                origin: skillCatalog.origin,
                controlToken: skillCatalog.controlToken,
              },
            }
          : {}),
      });
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    await app?.stop().catch(() => undefined);
    if (skillCatalog) {
      await writeJson(
        join(options.workDir, "skill-catalog-receipts.json"),
        skillCatalog.snapshot(),
      );
      await skillCatalog.stop().catch(() => undefined);
    }
    if (skillsGitHub)
      await writeJson(
        join(options.workDir, "skills-github-requests.json"),
        skillsGitHub.requests,
      );
    await skillsGitHub?.stop().catch(() => undefined);
    await gateway?.stop().catch(() => undefined);
    await database?.close().catch(() => undefined);
  }
  const final = {
    outcome: failure ? "failed" : summary.failed ? "partial" : "done",
    baselineRevision: BASELINE_REVISION,
    actualRevision: revision,
    sourceDeltaSha256: sourceDelta,
    databaseBaseline:
      process.argv.includes("--restored-empty-baseline") ||
      process.argv.includes("--resume-own-fixtures")
        ? "schema-only restored checked source roster; not fresh migration proof"
        : database
          ? "fresh migrated"
          : "migration/boot incomplete",
    databaseMode: database?.descriptor.databaseMode ?? "unknown",
    fixtureBoundary,
    externalNetworkAllowed: false,
    secretsGenerated: true,
    secretsLogged: false,
    resources,
    boot: failure ? { ok: false, error: failure } : { ok: true },
    tests: summary,
  };
  await writeJson(join(options.workDir, "result.json"), final);
  process.stdout.write(
    `${JSON.stringify({
      outcome: final.outcome,
      workDir: options.workDir,
      actualRevision: revision,
      databaseMode: final.databaseMode,
      tests: summary,
      fixtureBoundary: final.fixtureBoundary,
    })}\n`,
  );
  if (failure) throw new Error(failure);
  if (summary.failed) process.exitCode = 2;
}

async function verifyBoot(
  appUrl: string,
  viewerCookie: string,
  workDir: string,
): Promise<{ readonly ok: true; readonly checks: readonly string[] }> {
  const checks: string[] = [];
  const health = await fetch(`${appUrl}/api/health`);
  if (!health.ok)
    throw new Error(`accounts_reference_e2e_health_status_${health.status}`);
  checks.push("health-ok");
  const signedOut = await fetch(
    `${appUrl}/dashboard/setup?workspace=rr-e2e-personal-viewer`,
    {
      redirect: "manual",
    },
  );
  if (![307, 308, 302].includes(signedOut.status)) {
    const html = await signedOut.text();
    if (
      signedOut.status !== 200 ||
      !html.includes("NEXT_REDIRECT") ||
      html.includes(FIXTURES.sourceLabels.viewerPrimary)
    ) {
      throw new Error(
        `accounts_reference_e2e_signed_out_status_${signedOut.status}`,
      );
    }
  }
  checks.push("signed-out-redirect");
  const viewer = await fetch(
    `${appUrl}/dashboard/setup?workspace=rr-e2e-personal-viewer`,
    {
      headers: { cookie: viewerCookie },
      redirect: "manual",
    },
  );
  if (!viewer.ok)
    throw new Error(`accounts_reference_e2e_viewer_status_${viewer.status}`);
  const viewerHtml = await viewer.text();
  await writeFile(join(workDir, "boot-viewer.html"), viewerHtml, {
    mode: 0o600,
  });
  // Section content may stream only after browser hydration. The authorized
  // shell proves the generated identity here; browser tests assert inventory.
  const visibleShell = viewerHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ");
  if (
    viewerHtml.includes("NEXT_REDIRECT") ||
    !visibleShell.includes(FIXTURES.workspaceNames.personalViewer) ||
    !visibleShell.includes(FIXTURES.workspaceNames.orgAlpha)
  )
    throw new Error("accounts_reference_e2e_generated_session_not_authorized");
  checks.push("generated-session-ok");
  if (process.argv.includes("--skills-fixture")) {
    // Warm both authenticated Skills entry points during bounded fixture setup;
    // browser navigation and acceptance assertions retain their own timeouts.
    const warmedScripts = new Set<string>();
    for (const [section, ready] of [
      [
        "skills",
        /<h2\b[^>]*\bid="review-skills-title"[^>]*>\s*Skills\s*<\/h2>/u,
      ],
      ["repositories", /<section\b[^>]*\bdata-repository-live-search\b/u],
    ] as const) {
      const signal = AbortSignal.timeout(120_000);
      const response = await fetch(
        `${appUrl}/dashboard?section=${section}&workspace=rr-e2e-personal-viewer`,
        {
          headers: { cookie: viewerCookie },
          redirect: "manual",
          signal,
        },
      );
      const html = await response.text();
      if (
        response.status !== 200 ||
        html.includes("NEXT_REDIRECT") ||
        !ready.test(html)
      )
        throw new Error(
          `accounts_reference_e2e_${section}_warmup_not_authorized`,
        );
      checks.push(`${section}-authenticated-render-warmed`);
      await warmNextClientScripts(html, appUrl, signal, warmedScripts);
      checks.push(`${section}-client-scripts-warmed`);
    }
  }
  return { ok: true, checks };
}

async function runPlaywright(input: {
  appUrl: string;
  gatewayUrl: string;
  databaseUrl: string;
  resultJson: string;
  viewerCookie: string;
  otherCookie: string;
  managerCookie: string;
  browserExecutable: string | null;
  skillCatalog?: { readonly origin: string; readonly controlToken: string };
}): Promise<TestSummary> {
  const playwrightBin = join(harnessRoot, "node_modules", ".bin", "playwright");
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = execFile(
      playwrightBin,
      ["test", "-c", join(harnessRoot, "playwright.config.ts")],
      {
        cwd: harnessRoot,
        env: {
          ...process.env,
          ACCOUNTS_REFERENCE_E2E_BASE_URL: input.appUrl,
          ACCOUNTS_REFERENCE_E2E_GATEWAY_URL: input.gatewayUrl,
          ACCOUNTS_REFERENCE_E2E_API_KEY_STORAGE: process.argv.includes(
            "--api-key-storage-fixture",
          )
            ? "1"
            : "0",
          ACCOUNTS_REFERENCE_E2E_SUBSCRIPTIONS: process.argv.includes(
            "--subscription-fixture",
          )
            ? "1"
            : "0",
          ACCOUNTS_REFERENCE_E2E_LIMITS: process.argv.includes(
            "--limits-fixture",
          )
            ? "1"
            : "0",
          ACCOUNTS_REFERENCE_E2E_ACCOUNT_MODELS: process.argv.includes(
            "--account-models-fixture",
          )
            ? "1"
            : "0",
          ACCOUNTS_REFERENCE_E2E_CATALOG: process.argv.includes(
            "--catalog-fixture",
          )
            ? "1"
            : "0",
          ACCOUNTS_REFERENCE_E2E_PROBE: process.argv.includes("--probe-fixture")
            ? "1"
            : "0",
          ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL: input.databaseUrl,
          ACCOUNTS_REFERENCE_E2E_RESULT_JSON: input.resultJson,
          ACCOUNTS_REFERENCE_E2E_VIEWER_COOKIE: input.viewerCookie,
          ACCOUNTS_REFERENCE_E2E_OTHER_COOKIE: input.otherCookie,
          ACCOUNTS_REFERENCE_E2E_MANAGER_COOKIE: input.managerCookie,
          ACCOUNTS_REFERENCE_E2E_SKILLS: process.argv.includes(
            "--skills-fixture",
          )
            ? "1"
            : "0",
          ACCOUNTS_REFERENCE_E2E_SKILL_CATALOG: input.skillCatalog ? "1" : "0",
          ...(input.skillCatalog
            ? {
                ACCOUNTS_REFERENCE_E2E_SKILL_CATALOG_URL:
                  input.skillCatalog.origin,
                ACCOUNTS_REFERENCE_E2E_SKILL_CATALOG_CONTROL:
                  input.skillCatalog.controlToken,
              }
            : {}),
          ...(input.browserExecutable
            ? {
                ACCOUNTS_REFERENCE_E2E_BROWSER_EXECUTABLE:
                  input.browserExecutable,
              }
            : {}),
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0",
        },
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        process.stdout.write(stdout);
        process.stderr.write(stderr);
        if (
          error &&
          !(
            typeof (error as NodeJS.ErrnoException).code === "number" &&
            String((error as NodeJS.ErrnoException).code) === "1"
          )
        ) {
          rejectRun(error);
          return;
        }
        resolveRun();
      },
    );
    child.on("error", rejectRun);
  });
  return readTestSummary(input.resultJson);
}

async function readTestSummary(path: string): Promise<TestSummary> {
  try {
    const raw = JSON.parse(
      await (await import("node:fs/promises")).readFile(path, "utf8"),
    );
    const tests: { title: string; status: string }[] = [];
    const walk = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (Array.isArray(object.specs)) {
        for (const spec of object.specs) {
          const record = spec as Record<string, unknown>;
          const specTests = record.tests as unknown[] | undefined;
          const test = specTests?.[0] as Record<string, unknown> | undefined;
          if (test) {
            const results = test.results as unknown[] | undefined;
            const firstResult = results?.[0] as
              | Record<string, unknown>
              | undefined;
            tests.push({
              title: String(record.title ?? "unknown"),
              status: String(test.status ?? firstResult?.status ?? "unknown"),
            });
          }
        }
      }
      for (const child of Object.values(object)) {
        if (Array.isArray(child)) child.forEach(walk);
      }
    };
    walk(raw);
    const failures = tests
      .filter(
        (test) =>
          test.status !== "expected" &&
          test.status !== "passed" &&
          test.status !== "skipped",
      )
      .map((test) => test.title);
    if (tests.length === 0 || tests.every((test) => test.status === "skipped"))
      failures.push("playwright-no-executed-tests");
    if (Array.isArray(raw.errors) && raw.errors.length > 0)
      failures.push("playwright-run-errors");
    return {
      passed: tests.filter(
        (test) => test.status === "expected" || test.status === "passed",
      ).length,
      failed: failures.length,
      skipped: tests.filter((test) => test.status === "skipped").length,
      failures,
    };
  } catch {
    return {
      passed: 0,
      failed: 1,
      skipped: 0,
      failures: ["playwright-result-unreadable"],
    };
  }
}

async function inspectResources(
  repoRoot: string,
  workDir: string,
): Promise<Record<string, unknown>> {
  const filesystem = await statfs(workDir);
  return {
    repoRoot,
    workDir,
    cpuCount: cpus().length,
    memoryFreeBytes: freemem(),
    memoryTotalBytes: totalmem(),
    filesystemFreeBytes: Number(filesystem.bavail) * Number(filesystem.bsize),
    filesystemTotalBytes: Number(filesystem.blocks) * Number(filesystem.bsize),
    node: process.version,
  };
}

async function ensureWorkDir(path: string): Promise<void> {
  await (
    await import("node:fs/promises")
  ).mkdir(path, { recursive: true, mode: 0o700 });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await (
    await import("node:fs/promises")
  ).writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function readRevision(repoRoot: string): Promise<string> {
  for (const cwd of [repoRoot, process.cwd()]) {
    try {
      const { stdout } = await execFileAsync("git", [
        "-C",
        cwd,
        "rev-parse",
        "HEAD",
      ]);
      return stdout.trim();
    } catch {
      // A staged copy may not carry .git; retain the baseline in the report.
    }
  }
  return "unknown";
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
