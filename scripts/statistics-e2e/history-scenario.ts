/** Reviews extends the existing real-session/Next/PostgreSQL browser harness. */
import assert from "node:assert/strict";
import pg from "pg";
import type { BrowserContext, Page } from "playwright-core";
import type {
  HistoryPullRequestPage,
  HistoryRepositoryPage,
  HistoryRunPage,
} from "../../packages/features/review-history/src/index.js";

type Workspace = { id: string; slug: string };
export async function seedHistoryFixtures(
  admin: pg.Client,
  prefix: string,
  workspaceId: string,
  epoch: string,
) {
  const previous =
    (
      await admin.query<{ value: string }>(
        'SELECT "coverageSince"::text AS value FROM "ReviewHistoryCoverage" WHERE id=\'capture_v1\'',
      )
    ).rows[0]?.value ?? null;
  await admin.query("BEGIN");
  try {
    await admin.query(
      'INSERT INTO "ReviewHistoryCoverage" (id,"coverageSince") VALUES (\'capture_v1\',$1) ON CONFLICT(id) DO UPDATE SET "coverageSince"=EXCLUDED."coverageSince"',
      [epoch],
    );
    const statuses = [
      "completed",
      "queued",
      "running",
      "publishing",
      "failed",
      "incomplete",
      "stopped",
      "unconfirmed",
    ];
    for (let index = 0; index < 35; index++) {
      const id = `${prefix}-history-pr-${index}`;
      const scm = `${prefix}-history-scm-${index % 30}`;
      const name = `observatory/history-${String(index % 30).padStart(2, "0")}`;
      const title =
        index === 0
          ? 'Improve account access <img src=x onerror="alert(1)">'
          : index === 1
            ? null
            : `Review boundary ${index}: ${index === 3 ? "very-long-title-".repeat(16) : "handle repository changes safely"}`;
      const runs = index === 0 ? 7 : 1;
      const when = new Date(
        Date.now() -
          (index < 30
            ? 60_000 + index * 3_600_000
            : 45 * 86_400_000 + index * 60_000),
      ).toISOString();
      const root = `${id}-run-${runs}`;
      await admin.query(
        'INSERT INTO "ReviewHistoryPullRequest" (id,"workspaceId","scmRepositoryIdentityId","pullRequestNumber","lastAllocatedRunSequence","latestRootRequestId","latestRunSequence","latestRequestedAt","latestStatus","repositoryFullName","pullRequestTitle","sourceBaseUrl","projectedAt") VALUES ($1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,\'https://github.com\',NOW())',
        [
          id,
          workspaceId,
          scm,
          index + 100,
          runs,
          root,
          when,
          statuses[index % statuses.length],
          name,
          title,
        ],
      );
      for (let sequence = 1; sequence <= runs; sequence++) {
        const requestedAt = new Date(
          Date.parse(when) - (runs - sequence) * 3_600_000,
        ).toISOString();
        await admin.query(
          'INSERT INTO "ReviewHistoryRun" ("rootRequestId","pullRequestId","workspaceId","scmRepositoryIdentityId","pullRequestNumber","originalRepositoryConnectionId","runSequence","requestedAt","triggerKind","headSha","reviewRevisionHash","repositoryFullName","pullRequestTitle","sourceBaseUrl",status,"projectedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'manual_command\',$9,$10,$11,$12,\'https://github.com\',$13,NOW(),NOW())',
          [
            `${id}-run-${sequence}`,
            id,
            workspaceId,
            scm,
            index + 100,
            `${prefix}-history-original`,
            sequence,
            requestedAt,
            "a".repeat(40),
            "b".repeat(64),
            name,
            title,
            sequence === runs ? statuses[index % statuses.length] : "failed",
          ],
        );
      }
    }
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
  return previous;
}
export async function restoreHistoryCoverage(
  admin: pg.Client,
  previous: string | null,
) {
  if (previous)
    await admin.query(
      'INSERT INTO "ReviewHistoryCoverage" (id,"coverageSince") VALUES (\'capture_v1\',$1) ON CONFLICT(id) DO UPDATE SET "coverageSince"=EXCLUDED."coverageSince"',
      [previous],
    );
  else
    await admin.query(
      "DELETE FROM \"ReviewHistoryCoverage\" WHERE id='capture_v1'",
    );
  const restored =
    (
      await admin.query<{ value: string }>(
        'SELECT "coverageSince"::text AS value FROM "ReviewHistoryCoverage" WHERE id=\'capture_v1\'',
      )
    ).rows[0]?.value ?? null;
  assert.equal(restored, previous, "History coverage restored exactly");
}
type Scenario = {
  page: Page;
  context: BrowserContext;
  admin: pg.Client;
  appUrl: string;
  main: Workspace;
  empty: Workspace;
  actorId: string;
  role: string;
  prefix: string;
  checks: string[];
  snapshot: (page: Page, name: string) => Promise<void>;
  selectTheme: (page: Page, theme: "dark" | "light") => Promise<void>;
  addMember: (workspaceId: string) => Promise<void>;
};
export async function warmHistoryApis(
  warmApi: (path: string) => Promise<Response>,
  workspaceId: string,
) {
  const list = await warmApi(
    `/api/dashboard/review-history?workspaceId=${workspaceId}`,
  );
  const page = (await list.json()) as HistoryPullRequestPage;
  assert.equal(page.items.length, 25);
  assert(page.nextCursor && page.windowToken);
  assert.equal(page.items[0]?.pullRequestNumber, 100);
  const options = (await (
    await warmApi(
      `/api/dashboard/review-history/repositories?workspaceId=${workspaceId}`,
    )
  ).json()) as HistoryRepositoryPage;
  assert.equal(options.items.length, 25);
  assert(options.nextCursor);
  const history = (await (
    await warmApi(
      `/api/dashboard/review-history/runs?workspaceId=${workspaceId}&pullRequestId=${page.items[0]!.id}`,
    )
  ).json()) as HistoryRunPage;
  assert.equal(history.items.length, 5);
  assert(history.nextCursor);
}
export async function qualifyHistory(input: Scenario) {
  const {
    page,
    context,
    admin,
    appUrl,
    main,
    empty,
    actorId,
    role,
    prefix,
    checks,
    snapshot,
    selectTheme,
    addMember,
  } = input;
  const list = () =>
    page.getByRole("list", { name: "Reviewed pull requests", exact: true });
  const open = async (workspace: Workspace, query = "") => {
    const response = await page.goto(
      `${appUrl}/dashboard?section=reviews&workspace=${workspace.slug}${query}`,
      { waitUntil: "domcontentloaded", timeout: 180_000 },
    );
    assert.equal(response?.status(), 200);
    await page
      .getByRole("heading", { name: "Reviews", exact: true, level: 1 })
      .waitFor({ timeout: 120_000 });
    await page.waitForFunction(
      () => document.documentElement.dataset.dashboardLayoutReady === "true",
    );
  };
  const settled = async () => {
    await list().waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          'section[aria-label="Review history"] [aria-busy="true"]',
        ),
    );
  };
  const choose = async (name: string, option: string) => {
    await page
      .getByRole("combobox", { name: new RegExp(`^${name}`, "i") })
      .click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await settled();
  };
  for (const theme of ["dark", "light"] as const)
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await open(main);
      await selectTheme(page, theme);
      await settled();
      assert.equal(await list().locator(":scope > li").count(), 25);
      assert.equal(
        await list().locator("img").count(),
        0,
        "Untrusted title remains escaped text",
      );
      assert(
        await page.getByText("Pull request #101", { exact: true }).count(),
      );
      const size = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(size.scroll <= size.width + 1, `History overflow at ${width}`);
      await snapshot(page, `history-${theme}-${width}.png`);
    }
  checks.push(
    "Reviews: six viewport/theme captures, 25 SSR-seeded PR rows, missing/long/escaped titles and no viewport overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(main);
  await selectTheme(page, "dark");
  await settled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Page 2", { exact: true }).waitFor();
  await settled();
  assert.equal(await list().locator(":scope > li").count(), 10);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByText("Page 1", { exact: true }).waitFor();
  await settled();
  await choose("Status", "Completed");
  assert((await list().getByText("Completed", { exact: true }).count()) > 0);
  assert.equal(
    await list().getByText("In progress", { exact: true }).count(),
    0,
  );
  await choose("Status", "All statuses");
  await choose("Period", "Last 7 days");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await settled();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("#100");
  await page.waitForURL(/reviewSearch=/);
  await settled();
  await page.waitForFunction(
    () =>
      document.querySelector('ul[aria-label="Reviewed pull requests"]')
        ?.children.length === 1,
  );
  assert.equal(await list().locator(":scope > li").count(), 1);
  await page.goBack();
  await settled();
  await page.waitForFunction(
    () =>
      document.querySelector('ul[aria-label="Reviewed pull requests"]')
        ?.children.length === 25,
  );
  assert.equal(await search.inputValue(), "");
  const disclosure = page.getByRole("button", {
    name: "Show review history for observatory/history-00 #100",
    exact: true,
  });
  await disclosure.focus();
  await disclosure.press("Enter");
  const runs = page.getByRole("list", { name: "Previous review runs" });
  await runs.waitFor();
  assert.equal(await runs.locator(":scope > li").count(), 5);
  await page
    .getByRole("button", { name: "Show older reviews", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('ol[aria-label="Previous review runs"]')?.children
        .length === 7,
  );
  await snapshot(page, "history-expanded.png");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await settled();
  assert.equal(await runs.count(), 0);
  const repository = page.getByRole("combobox", { name: /^Repository/ });
  await repository.click();
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await page
    .getByRole("option", { name: "observatory/history-29", exact: true })
    .click();
  await settled();
  assert.equal(await list().locator(":scope > li").count(), 1);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 150_000 });
  await settled();
  assert(
    (await page
      .getByRole("combobox", { name: /Repository observatory\/history-29/ })
      .count()) > 0,
    "Selected repository outside first25 remains pinned after SSR",
  );
  checks.push(
    "Reviews: real list page2/Previous, status/date/search, browser Back, keyboard disclosure5+2 and canonical repository26+ selection retained through SSR",
  );
  await open(main, "&reviewSearch=doesnotexistunique");
  await page.getByText("No matching reviews.", { exact: true }).waitFor();
  await snapshot(page, "history-no-results.png");
  await open(
    main,
    "&reviewSearch=one%20two%20three%20four%20five%20six%20seven%20eight%20nine",
  );
  await page.getByText("Try a shorter search.", { exact: true }).waitFor();
  assert.equal(
    await search.inputValue(),
    "one two three four five six seven eight nine",
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await settled();
  const failRuns = "**/api/dashboard/review-history/runs?*";
  await context.route(failRuns, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"history_unavailable"}',
    });
  });
  await page
    .getByRole("button", {
      name: "Show review history for observatory/history-00 #100",
      exact: true,
    })
    .click();
  await page
    .getByText("History could not be loaded.", { exact: false })
    .waitFor();
  assert.equal(await list().locator(":scope > li").count(), 25);
  await snapshot(page, "history-run-error.png");
  await context.unroute(failRuns);
  await page
    .getByRole("button", { name: "Try loading again", exact: true })
    .click();
  await runs.waitFor();
  checks.push(
    "Reviews: invalid URL preserves controls and input; filtered empty differs from missing history; lazy history503 stays local and retries real API",
  );
  await open(empty);
  await page.getByText("No reviews yet.", { exact: true }).waitFor();
  await snapshot(page, "history-empty.png");
  await admin.query(
    "DELETE FROM \"ReviewHistoryCoverage\" WHERE id='capture_v1'",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText("Review history is not available yet for this workspace.", {
      exact: true,
    })
    .waitFor();
  await snapshot(page, "history-unavailable.png");
  await admin.query(
    'INSERT INTO "ReviewHistoryCoverage" (id,"coverageSince") VALUES (\'capture_v1\',$1)',
    [new Date(Date.now() - 200 * 86_400_000).toISOString()],
  );
  await open(main);
  await settled();
  await admin.query(
    `REVOKE SELECT ON "ReviewHistoryPullRequest" FROM ${pg.escapeIdentifier(role)}`,
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 150_000 });
  await page
    .getByText("Reviews could not be loaded.", { exact: false })
    .waitFor();
  await snapshot(page, "history-read-failure.png");
  await admin.query(
    `GRANT SELECT ON "ReviewHistoryPullRequest" TO ${pg.escapeIdentifier(role)}`,
  );
  await page
    .getByRole("button", { name: "Try loading again", exact: true })
    .click();
  await settled();
  await admin.query(
    'DELETE FROM "WorkspaceMember" WHERE "workspaceId"=$1 AND "userId"=$2',
    [main.id, actorId],
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText(/Review history access is no longer available/)
    .waitFor();
  assert.equal(await list().count(), 0);
  await snapshot(page, "history-access-denied.png");
  const denied = await context.request.get(
    `${appUrl}/api/dashboard/review-history?workspaceId=${main.id}`,
  );
  assert.equal(denied.status(), 403);
  assert.equal(denied.headers()["cache-control"], "private, no-store");
  await addMember(main.id);
  assert.equal(
    await list().count(),
    0,
    "Membership restoration does not restore rejected client seed",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await settled();
  await snapshot(page, "history-access-restored.png");
  const switched = page.getByRole("link", {
    name: new RegExp(empty.slug, "i"),
  });
  // A real route navigation reuses the persistent dashboard shell and its auth gate.
  if (await switched.count()) await switched.first().click();
  else await open(empty);
  await page.getByText("No reviews yet.", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText('Improve account access <img src=x onerror="alert(1)">', {
        exact: true,
      })
      .count(),
    0,
  );
  checks.push(
    `Reviews: empty/unavailable distinction; real SELECT revocation/retry; real membership403 evicts all rows; only a fresh SSR seed restores; workspace switch isolates data (${prefix})`,
  );
}
