/** Additional reliability cases in the existing real PostgreSQL/Next browser fixture. */
import assert from "node:assert/strict";
import type pg from "pg";
import type { BrowserContext, Page, Route } from "playwright-core";

type Fixture = { prefix: string; workspaceId: string; actorId: string };
export async function seedReliabilityFixtures(
  admin: pg.Client,
  input: Fixture,
) {
  const workspaces = Array.from(
    { length: 11 },
    (_, index) => `${input.prefix}-recent-${index}`,
  );
  for (const [index, id] of workspaces.entries()) {
    await admin.query(
      'INSERT INTO "Workspace" ("id","slug","name","createdAt","updatedAt") VALUES ($1,$1,$2,NOW(),NOW())',
      [id, `Recent workspace ${index + 1}`],
    );
    await admin.query(
      'INSERT INTO "WorkspaceMember" ("id","workspaceId","userId","role","updatedAt") VALUES ($1,$2,$3,\'member\',NOW())',
      [`${id}-member`, id, input.actorId],
    );
  }
  const foreign = `${input.prefix}-reliability-foreign`;
  await admin.query(
    'INSERT INTO "Workspace" ("id","slug","name","updatedAt") VALUES ($1,$1,\'Unshared workspace\',NOW())',
    [foreign],
  );
  await admin.query(
    `INSERT INTO "ProviderUsageGrant" ("id","tokenHash","workspaceId","invocationId","repositoryId","runId","runAttempt","authorizationId","actorId","producerDigest","workflowIdentity","jobIdentity","publicKey","issuedAt","expiresAt","producerCoverage")
    SELECT $1||'-grant-'||lpad(n::text,3,'0'),$1||'-hash-'||n,$2,$1||'-invocation-'||n,'fixture-repository','fixture-run',1,'fixture-authorization',$3,repeat('a',64),'fixture-workflow','fixture-job','fixture-public-key',NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day',
      jsonb_build_object('schemaVersion',1,'revision',1,'state','partial','reason','spool_overflow','droppedEvents',1,'occurredAt',$4::text)
    FROM generate_series(1,101) n`,
    [input.prefix, input.workspaceId, input.actorId, new Date().toISOString()],
  );
  return { workspaces, foreign };
}

export async function cleanupReliabilityFixtures(
  admin: pg.Client,
  input: Fixture,
) {
  await admin.query(
    'DELETE FROM "ProviderUsageGrant" WHERE "workspaceId"=$1 AND "id" LIKE $2',
    [input.workspaceId, `${input.prefix}-grant-%`],
  );
  await admin.query('DELETE FROM "Workspace" WHERE "id" LIKE $1 OR "id"=$2', [
    `${input.prefix}-recent-%`,
    `${input.prefix}-reliability-foreign`,
  ]);
}

export async function qualifyReliabilityUi(input: {
  page: Page;
  context: BrowserContext;
  admin: pg.Client;
  appUrl: string;
  main: { id: string; slug: string };
  actorId: string;
  prefix: string;
  checks: string[];
  snapshot: (page: Page, name: string) => Promise<void>;
  selectTheme: (page: Page, theme: "dark" | "light") => Promise<void>;
}) {
  const { page, admin, appUrl, main, checks, snapshot } = input;
  const recent = await admin.query<{ id: string }>(
    'SELECT w.id FROM "Workspace" w JOIN "WorkspaceMember" m ON m."workspaceId"=w.id WHERE m."userId"=$1 ORDER BY w."createdAt" DESC LIMIT 10',
    [input.actorId],
  );
  assert.equal(recent.rows.length, 10);
  assert(!recent.rows.some((row) => row.id === main.id));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${appUrl}/dashboard?section=usage&workspace=${main.id}`, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.documentElement.dataset.dashboardLayoutReady === "true",
  );
  await page
    .locator('section[aria-label="Provider usage"] .recharts-surface')
    .first()
    .waitFor({ state: "visible" });
  await page.getByLabel("Details", { exact: true }).click();
  const losses = page
    .getByRole("list", { name: "Producer delivery coverage" })
    .getByRole("listitem");
  await page
    .getByRole("button", { name: "Next delivery page", exact: true })
    .waitFor();
  assert.equal(await losses.count(), 100);
  assert.match(
    await page.locator("body").innerText(),
    /101 runtime sessions reported delivery loss/,
  );
  const next = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === appUrl &&
      url.pathname === "/api/dashboard/provider-usage" &&
      url.searchParams.get("workspace") === main.id &&
      url.searchParams.has("coverageAfter")
    );
  });
  await page
    .getByRole("button", { name: "Next delivery page", exact: true })
    .click();
  const nextResponse = await next;
  assert.equal(nextResponse.status(), 200);
  assert.equal(
    new URL(nextResponse.url()).searchParams.get("coverageAfter"),
    `${input.prefix}-grant-100`,
  );
  const nextJson = await nextResponse.json();
  assert.deepEqual(nextJson.scope, {
    actorId: input.actorId,
    workspaceId: main.id,
    effectiveAccess: "member",
  });
  assert.equal(nextJson.report.deliveryCoverage.length, 1);
  assert.equal(
    nextJson.report.deliveryCoverage[0].invocationId,
    `${input.prefix}-invocation-101`,
  );
  assert.equal(nextJson.report.nextCoverageCursor, null);
  assert.equal(nextJson.report.deliveryCoverageTotals.lossSessions, 101);
  await page
    .getByRole("button", { name: "Previous delivery page", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Producer delivery coverage"]')
        ?.children.length === 1,
  );
  assert.equal(await losses.count(), 1);
  await snapshot(page, "reliability-delivery-page-2.png");
  await page
    .getByRole("button", { name: "Previous delivery page", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Next delivery page", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Producer delivery coverage"]')
        ?.children.length === 100,
  );
  assert.equal(await losses.count(), 100);
  checks.push(
    "reliability: actual authenticated old workspace outside ten recent memberships opens; SQL delivery detail pages100+1 preserve exact101-session totals and Previous restores page1",
  );
  const denied = await page.goto(
    `${appUrl}/dashboard?section=usage&workspace=${input.prefix}-reliability-foreign`,
    { waitUntil: "domcontentloaded", timeout: 180_000 },
  );
  assert(denied, "The denied workspace navigation must return a response");
  assert(
    [200, 404].includes(denied.status()),
    "Next may stream a not-found boundary with HTTP200",
  );
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();
  await page
    .getByText("This page could not be found.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Provider usage", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("heading", { name: "Usage", exact: true }).count(),
    0,
  );
  await snapshot(page, "reliability-workspace-denied.png");
  checks.push(
    "reliability: an existing unshared workspace returns the actual Next not-found boundary without another workspace's usage",
  );
  await qualifyGitLabCredentialForm(input);
}

async function qualifyGitLabCredentialForm(
  input: Parameters<typeof qualifyReliabilityUi>[0],
) {
  const { page, appUrl, main, snapshot, checks } = input;
  const installationToken = "glpat-browser-install-fixture";
  const reviewToken = "glpat-browser-project-review-fixture";
  const calls: string[] = [];
  const handler = async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.push(path);
    if (path.endsWith("/discover")) {
      assert.equal(body.token, installationToken);
      assert.equal(body.reviewToken, undefined);
      await route.fulfill({
        json: {
          source: {
            inputPath: "fixture/team",
            resolvedKind: "group",
            baseUrl: "https://gitlab.com",
            parentGroupPath: "fixture",
          },
          projects: [
            {
              projectId: "101",
              fullName: "fixture/team/representative-repository",
              name: "representative-repository",
              defaultBranch: "main",
              webUrl:
                "https://gitlab.com/fixture/team/representative-repository",
              visibility: "private",
              archived: false,
            },
          ],
        },
      });
    } else if (path.endsWith("/install")) {
      assert.equal(body.token, installationToken);
      assert.equal(body.reviewToken, reviewToken);
      assert.deepEqual(body.selectedProjectIds, ["101"]);
      await route.fulfill({
        json: {
          installationId: "gitlab-browser-fixture",
          namespacePath: "fixture/team",
          requested: 1,
          succeeded: 1,
          failed: 0,
          setupMergeRequests: [],
        },
      });
    } else if (path.endsWith("/codex-command")) {
      assert.equal(body.token, undefined);
      assert.equal(body.reviewToken, undefined);
      await route.fulfill({
        json: {
          command: "fixture-command",
          secretName: "CODEX_AUTH_JSON",
          sendsSecretToReviewRouter: false,
          targetLabel: "GitLab group fixture/team",
        },
      });
    } else throw new Error(`unexpected GitLab fixture request: ${path}`);
  };
  await page.route("**/api/dashboard/gitlab/**", handler);
  try {
    await page.goto(`${appUrl}/setup/gitlab?workspaceId=${main.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
    await page
      .getByLabel("Paste your GitLab group or project URL")
      .fill("https://gitlab.com/fixture/team");
    await page
      .getByLabel("GitLab access token", { exact: true })
      .fill(installationToken);
    await page
      .getByRole("button", { name: "Discover repositories", exact: true })
      .click();
    const credential = page.getByLabel("Project or group review token", {
      exact: true,
    });
    await credential.waitFor();
    const install = page.getByRole("button", {
      name: "Install ReviewRouter",
      exact: true,
    });
    assert(await install.isDisabled());
    await credential.fill(installationToken);
    assert(await install.isDisabled());
    await credential.fill(reviewToken);
    assert(await install.isEnabled());
    assert.equal(await credential.getAttribute("type"), "password");
    await credential.focus();
    await page.keyboard.press("Tab");
    assert(
      await install.evaluate((element) => element === document.activeElement),
    );
    for (const theme of ["dark", "light"] as const) {
      await input.selectTheme(page, theme);
      for (const width of [1440, 900, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const size = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(
          size.scroll <= size.width + 1,
          `GitLab form overflow at ${width}px`,
        );
        await snapshot(page, `reliability-gitlab-${theme}-${width}.png`);
      }
    }
    await install.click();
    await page.getByText("GitLab is connected", { exact: true }).waitFor();
    await page.getByText("fixture-command", { exact: true }).waitFor();
    assert.deepEqual(
      calls.map((path) => path.split("/").at(-1)),
      ["discover", "install", "codex-command"],
    );
    assert(!(await page.locator("body").innerText()).includes(reviewToken));
    checks.push(
      "reliability: actual GitLab credential form/keyboard and six viewport/theme captures; fixture HTTP adapters verify separate installation/review secrets and no secret on Codex-command; backend HTTP+PG is qualified separately",
    );
  } finally {
    await page.unroute("**/api/dashboard/gitlab/**", handler);
  }
}
