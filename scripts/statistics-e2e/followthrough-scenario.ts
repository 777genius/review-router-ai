/** Bounded extension of the existing authenticated PostgreSQL/Next browser runner. */
import assert from "node:assert/strict";
import pg from "pg";
import type {
  APIResponse,
  BrowserContext,
  Page,
  Request,
  Response,
  Route,
} from "playwright-core";
import {
  selectProjection,
  type UsageFact,
} from "../../packages/features/provider-usage/src/domain/usage.js";

type Workspace = { id: string; slug: string };
type Repository = { id: string; scm: string; fullName: string };
const ownModel = "followthrough-member-owned-model";
const adminModel = "followthrough-other-actor-admin-only-model";
const dayMs = 86_400_000;
const heldCaptureMs = 30_000;
const heldReleaseMs = 120_000;
const heldDeliveryMs = 30_000;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function bounded<T>(
  work: Promise<T>,
  milliseconds: number,
  stage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${stage} timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function setTextSize(page: Page, fontSize: string) {
  await bounded(
    page.evaluate(async (value) => {
      document.documentElement.style.fontSize = value;
      // ResponsiveContainer observes the rem-sized layout asynchronously.
      // Measure after its ResizeObserver and React update have painted.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }, fontSize),
    5_000,
    "text-size layout settlement",
  );
}
async function assertSelectedLabelsFit(page: Page, region: string) {
  const labels = await page
    .getByRole("region", { name: region, exact: true })
    .getByRole("combobox")
    .evaluateAll((controls) =>
      controls.map((control) => {
        const selected = control.querySelector(".truncate");
        return {
          text: selected?.textContent,
          width: selected?.clientWidth ?? 0,
          scroll: selected?.scrollWidth ?? 0,
        };
      }),
    );
  assert(labels.length > 0, `${region} must expose actual filter controls`);
  assert(
    labels.every((label) => label.width > 0 && label.scroll <= label.width + 1),
    `${region} selected filter labels fit at200% text size: ${JSON.stringify(labels)}`,
  );
}
function cancelledInterception(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Invalid InterceptionId|Invalid interceptionId|Request was aborted|Target page, context or browser has been closed/u.test(
    message,
  );
}
async function deliverHeld(
  route: Route,
  response: APIResponse,
): Promise<"delivered" | "cancelled"> {
  try {
    await route.fulfill({ response });
    return "delivered";
  } catch (error) {
    if (cancelledInterception(error)) return "cancelled";
    throw error;
  }
}
async function holdUsageResponse(
  page: Page,
  pattern: string,
  status: number,
  validate?: (response: APIResponse) => Promise<void>,
) {
  const stage = `held Usage ${status}`;
  const captured = deferred<void>();
  const release = deferred<void>();
  // One non-rejecting observation carries every handler failure to the main
  // scenario, including failures occurring before its next await is attached.
  const outcome = deferred<
    | { ok: true; delivery: "delivered" | "cancelled" }
    | { ok: false; error: unknown }
  >();
  let started = false;
  const handler = async (route: Route) => {
    started = true;
    try {
      const response = await route.fetch({
        timeout: heldCaptureMs,
        maxRetries: 0,
      });
      assert.equal(
        response.status(),
        status,
        `${stage} must come from the actual API`,
      );
      if (validate)
        await bounded(validate(response), heldCaptureMs, `${stage} validation`);
      captured.resolve();
      await bounded(release.promise, heldReleaseMs, `${stage} release`);
      const delivery = await bounded(
        deliverHeld(route, response),
        heldDeliveryMs,
        `${stage} fulfillment`,
      );
      outcome.resolve({ ok: true, delivery });
    } catch (error) {
      let failure = error;
      try {
        await bounded(route.abort(), 5_000, `${stage} failed-request abort`);
      } catch (abortError) {
        if (!cancelledInterception(abortError))
          failure = new AggregateError(
            [error, abortError],
            `${stage} failed and abort failed`,
          );
      }
      outcome.resolve({ ok: false, error: failure });
    }
  };
  await bounded(
    page.route(pattern, handler, { times: 1 }),
    heldCaptureMs,
    `${stage} registration`,
  );
  const delivery = async () => {
    const result = await bounded(
      outcome.promise,
      heldDeliveryMs,
      `${stage} completion observation`,
    );
    if (!result.ok) throw result.error;
    return result.delivery;
  };
  return {
    capture: () =>
      bounded(
        Promise.race([
          captured.promise,
          outcome.promise.then((result) => {
            if (!result.ok) throw result.error;
            throw new Error(`${stage} completed without capture`);
          }),
        ]),
        heldCaptureMs,
        `${stage} capture observation`,
      ),
    release: () => release.resolve(),
    delivery,
    close: async () => {
      release.resolve();
      try {
        await bounded(
          page.unroute(pattern, handler),
          heldDeliveryMs,
          `${stage} handler removal`,
        );
      } finally {
        if (started) await delivery();
      }
    },
  };
}

export async function seedFollowthrough(
  admin: pg.Client,
  input: {
    prefix: string;
    workspaceId: string;
    actorId: string;
    repositories: readonly Repository[];
  },
) {
  const { prefix, workspaceId, actorId, repositories } = input;
  await admin.query("BEGIN");
  try {
    await admin.query(
      'UPDATE "WorkspaceMember" SET role=\'admin\' WHERE "workspaceId"=$1 AND "userId"=$2',
      [workspaceId, actorId],
    );
    for (const [index, repository] of repositories.slice(0, 2).entries()) {
      const id = `${prefix}-linked-pr-${index}`;
      const requested = new Date(
        Date.now() - (index + 1) * 60_000,
      ).toISOString();
      await admin.query(
        'INSERT INTO "ReviewHistoryPullRequest" (id,"workspaceId","scmRepositoryIdentityId","pullRequestNumber","lastAllocatedRunSequence","latestRootRequestId","latestRunSequence","latestRequestedAt","latestStatus","repositoryFullName","pullRequestTitle","sourceBaseUrl","projectedAt") VALUES ($1,$2,$3,1,2,$4,2,$5,\'failed\',$6,$7,\'https://github.com\',NOW())',
        [
          id,
          workspaceId,
          repository.scm,
          `${id}-2`,
          requested,
          repository.fullName,
          `Followthrough ${repository.fullName} #1`,
        ],
      );
      for (const sequence of [1, 2])
        await admin.query(
          'INSERT INTO "ReviewHistoryRun" ("rootRequestId","pullRequestId","workspaceId","scmRepositoryIdentityId","pullRequestNumber","originalRepositoryConnectionId","runSequence","requestedAt","triggerKind","headSha","reviewRevisionHash","repositoryFullName","pullRequestTitle","sourceBaseUrl",status,"projectedAt","updatedAt") VALUES ($1,$2,$3,$4,1,$5,$6,$7,\'manual_command\',$8,$9,$10,$11,\'https://github.com\',$12,NOW(),NOW())',
          [
            `${id}-${sequence}`,
            id,
            workspaceId,
            repository.scm,
            repository.id,
            sequence,
            new Date(
              Date.parse(requested) - (2 - sequence) * 3_600_000,
            ).toISOString(),
            "a".repeat(40),
            "b".repeat(64),
            repository.fullName,
            `Followthrough ${repository.fullName} #1`,
            sequence === 1 ? "completed" : "failed",
          ],
        );
    }
    const observed = new Date(Date.now() - dayMs).toISOString();
    for (const [index, model] of [ownModel, adminModel].entries()) {
      const identity: UsageFact["identity"] = {
        callId: `${prefix}-usage-${index}`,
        workspaceId,
        repositoryId: repositories[0]!.id,
        actorId: index === 0 ? actorId : `${prefix}-other-actor`,
        runId: `${prefix}-usage-run-${index}`,
        runAttempt: 1,
        invocationId: `${prefix}-usage-invocation-${index}`,
        attemptId: `${prefix}-usage-attempt-${index}`,
        bindingId: null,
        authorizationId: `${prefix}-usage-authorization-${index}`,
        route: "gateway",
        purpose: "review",
        provider: "openai",
        requestedModel: model,
        runtimeType: "fixture",
        parentScope: null,
        granularity: "call",
        occurredAt: observed,
      };
      const fact: UsageFact = {
        schemaVersion: 1,
        sourceInstance: `${prefix}-native`,
        eventId: `${prefix}-usage-event-${index}`,
        revision: 1,
        authority: "native",
        identity,
        actualProvider: "openai",
        actualModel: model,
        tokens: {
          inputTotal: 100,
          outputTotal: 30,
          cacheRead: 20,
          cacheWrite: 10,
          reasoning: 5,
          total: 130,
        },
        cost: {
          amount: "0.1",
          currency: "USD",
          basis: "source_reported",
          source: "native",
          asOf: observed,
          priceVersion: null,
        },
        completeness: "complete",
        state: "completed",
        dispatchEffect: "dispatched",
        durationMs: 100,
        ttftMs: 10,
        correctionReason: null,
        childCallIds: null,
      };
      const projection = selectProjection([fact]);
      await admin.query(
        'INSERT INTO "UsageCall" ("callId","workspaceId","actorId",provider,"actualModel",route,"runId",purpose,"occurredAt","identityHash",projection,"updatedAt") VALUES ($1,$2,$3,\'openai\',$4,\'gateway\',$5,\'review\',$6,$7,$8::jsonb,NOW())',
        [
          identity.callId,
          workspaceId,
          identity.actorId,
          model,
          identity.runId,
          observed,
          `fixture-${index}`,
          JSON.stringify(projection),
        ],
      );
    }
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

type Scenario = {
  page: Page;
  context: BrowserContext;
  admin: pg.Client;
  appUrl: string;
  main: Workspace;
  empty: Workspace;
  actorId: string;
  prefix: string;
  repositories: readonly Repository[];
  checks: string[];
  requests: { path: string; status: number; phase: string }[];
  snapshot: (page: Page, name: string) => Promise<void>;
  selectTheme: (page: Page, theme: "dark" | "light") => Promise<void>;
  choose: (
    page: Page,
    label: string,
    option: string,
    keyboard?: boolean,
  ) => Promise<void>;
  populated: (page: Page) => Promise<void>;
  openWorkspace: (page: Page, slug: string) => Promise<void>;
  addMember: (workspaceId: string) => Promise<void>;
};

export async function qualifyFollowthrough(input: Scenario) {
  const {
    page,
    context,
    admin,
    appUrl,
    main,
    actorId,
    prefix,
    repositories,
    checks,
    requests,
    snapshot,
    selectTheme,
    choose,
    populated,
  } = input;
  const heldResponses: {
    status: number;
    outcome: "delivered" | "cancelled";
  }[] = [];
  let retiredUsageRemount:
    | {
        responseStatus: 200;
        effectiveAccess: "member";
        outcome: "delivered" | "cancelled";
        dashboardRscRequestsBeforeValidationRelease: number;
        priorBrowserScopeChecks: {
          status: number;
          expectedAccess: "admin" | "member" | undefined;
          actualAccess: string | null;
          scopeMatches: boolean;
        }[];
        priorBrowserDenialMessages: string[];
      }
    | undefined;
  const statistics = () =>
    page.getByRole("region", { name: "Review statistics", exact: true });
  const issues = () =>
    page.getByRole("region", { name: "Recorded issues", exact: true });
  const usage = () =>
    page.getByRole("region", { name: "Provider usage", exact: true });
  const list = () =>
    page.getByRole("list", { name: "Reviewed pull requests", exact: true });
  const refresh = () =>
    page.getByRole("button", { name: "Refresh", exact: true });
  const api = async (path: string) => {
    const response = await context.request.get(`${appUrl}${path}`, {
      timeout: 180_000,
    });
    requests.push({
      path: new URL(`${appUrl}${path}`).pathname,
      status: response.status(),
      phase: "followthrough-api",
    });
    assert.equal(response.headers()["cache-control"], "private, no-store");
    return response;
  };
  const assertRuntime = async () =>
    assert.equal(
      await page.evaluate(
        () =>
          (window as Window & { followthroughRuntime?: string })
            .followthroughRuntime,
      ),
      prefix,
      "Next Link/Back navigation must preserve the app runtime and root layout QueryClient",
    );
  const navigate = async (section: "statistics" | "reviews" | "usage") => {
    const candidates = page.locator(`a[href*="section=${section}"]`);
    for (const candidate of await candidates.all()) {
      const href = await candidate.getAttribute("href");
      if (!href || !(await candidate.isVisible())) continue;
      const target = new URL(href, appUrl);
      if (
        target.searchParams.get("section") !== section ||
        ![main.id, main.slug].includes(
          target.searchParams.get("workspace") ?? "",
        )
      )
        continue;
      await candidate.click();
      await page.waitForURL(
        (url) => url.searchParams.get("section") === section,
      );
      await assertRuntime();
      return;
    }
    throw new Error(`No visible real dashboard navigation link for ${section}`);
  };
  await input.openWorkspace(page, main.slug);
  await statistics()
    .getByRole("combobox", { name: /Chart metric/ })
    .getByText("Published reviews", { exact: true })
    .waitFor();
  await page.evaluate((value) => {
    (
      window as Window & { followthroughRuntime?: string }
    ).followthroughRuntime = value;
  }, prefix);
  await populated(page);
  for (const theme of ["dark", "light"] as const)
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await selectTheme(page, theme);
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(
        dimensions.scroll <= dimensions.width + 1,
        `Followthrough Statistics overflow at ${width}`,
      );
      await snapshot(page, `followthrough-${theme}-${width}.png`);
    }
  checks.push(
    "followthrough: six actual Statistics viewport/theme captures, visible real charts, no horizontal overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectTheme(page, "dark");
  assert.match(await statistics().innerText(), /Report generated/);
  assert.match(await statistics().innerText(), /background processing/i);
  checks.push(
    "followthrough: generated-at wording and asynchronous processing explanation visible without a sync guarantee",
  );

  await choose(page, "Period", "Last 7 days", true);
  await page.waitForURL(
    (url) => url.searchParams.get("statisticsDays") === "7",
  );
  await choose(page, "Severity", "Major", true);
  await page.waitForURL(
    (url) => url.searchParams.get("statisticsSeverity") === "major",
  );
  await page.goBack();
  await assertRuntime();
  assert.equal(
    new URL(page.url()).searchParams.get("statisticsSeverity"),
    null,
  );
  await page.goForward();
  await assertRuntime();
  await statistics()
    .getByRole("combobox", { name: /Severity/ })
    .getByText("Major", { exact: true })
    .waitFor();
  await choose(page, "Chart metric", "Published reviews", true);
  await page.waitForURL(
    (url) => url.searchParams.get("statisticsMetric") === "reviews",
  );
  await page.goBack();
  await assertRuntime();
  assert.equal(new URL(page.url()).searchParams.get("statisticsMetric"), null);
  await page.goForward();
  await assertRuntime();
  await statistics()
    .getByRole("combobox", { name: /Chart metric/ })
    .getByText("Published reviews", { exact: true })
    .waitFor();
  const shared = page.url();
  const ssr = await context.request.get(shared);
  assert.equal(ssr.status(), 200);
  assert(
    (await ssr.text()).includes("All-severity review summary"),
    "Shared URL contains actual server-rendered report",
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
  await statistics()
    .getByRole("combobox", { name: /Period/ })
    .getByText("Last 7 days", { exact: true })
    .waitFor();
  await statistics()
    .getByRole("combobox", { name: /Severity/ })
    .getByText("Major", { exact: true })
    .waitFor();
  await statistics()
    .getByRole("combobox", { name: /Chart metric/ })
    .getByText("Published reviews", { exact: true })
    .waitFor();
  await page.evaluate((value) => {
    (
      window as Window & { followthroughRuntime?: string }
    ).followthroughRuntime = value;
  }, prefix);
  checks.push(
    "followthrough: period/severity/metric URL survives Back/Forward, shared SSR and reload",
  );

  await page.goto(
    `${appUrl}/dashboard?section=statistics&workspace=${main.slug}&statisticsDays=7&statisticsDays=30&statisticsMetric=bad&statisticsMetric=reviews&keep=fixture#dashboard-section-content`,
    { waitUntil: "domcontentloaded", timeout: 180_000 },
  );
  await page
    .getByRole("button", { name: "Reset statistics filters", exact: true })
    .click();
  await populated(page);
  const reset = new URL(page.url());
  assert.equal(reset.searchParams.getAll("statisticsDays").length, 0);
  assert.equal(reset.searchParams.getAll("statisticsMetric").length, 0);
  assert.equal(reset.searchParams.get("keep"), "fixture");
  assert.equal(reset.hash, "#dashboard-section-content");
  await page.evaluate((value) => {
    (
      window as Window & { followthroughRuntime?: string }
    ).followthroughRuntime = value;
  }, prefix);
  checks.push(
    "followthrough: duplicate SSR URL is rejected and Reset removes all invalid occurrences while preserving unrelated scope/hash",
  );

  const reportPattern = "**/api/dashboard/review-statistics?**";
  await page.route(reportPattern, async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("severity") === "critical"
    )
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"statistics_unavailable"}',
      });
    else await route.continue();
  });
  await choose(page, "Severity", "Critical");
  await page.getByText(/Statistics could not be loaded/).waitFor();
  assert(
    await statistics()
      .getByRole("combobox", { name: /Severity/ })
      .isEnabled(),
  );
  await snapshot(page, "followthrough-report-error-controls.png");
  await choose(page, "Severity", "Minor");
  await page.getByLabel("All-severity review summary").waitFor();
  await page.unroute(reportPattern);
  await choose(page, "Severity", "All severities");
  checks.push(
    "followthrough: severity503 preserves usable controls and another severity recovers through the real API",
  );

  await page
    .getByRole("button", { name: "View issues caught →", exact: true })
    .click();
  await issues().locator("li").first().waitFor();
  for (const theme of ["dark", "light"] as const)
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await selectTheme(page, theme);
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(
        dimensions.scroll <= dimensions.width + 1,
        `Issue links overflow at ${width}`,
      );
      await snapshot(page, `followthrough-issues-${theme}-${width}.png`);
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectTheme(page, "dark");
  await setTextSize(page, "200%");
  assert(
    await statistics()
      .getByRole("combobox", { name: /Severity/ })
      .isEnabled(),
  );
  await choose(page, "Chart metric", "Published reviews", true);
  await choose(page, "Chart metric", "Pull requests reviewed", true);
  await assertSelectedLabelsFit(page, "Review statistics");
  await snapshot(page, "followthrough-statistics-text-zoom.png");
  await setTextSize(page, "");
  checks.push(
    "followthrough: issue actions/escaped and long labels captured in all six viewport/theme cases, Statistics filter labels fit and chart metric remains keyboard-usable at200% text size",
  );
  let failPage = true;
  const attemptedIssuePages: string[] = [];
  const issuePattern = "**/api/dashboard/review-statistics/issues?**";
  await page.route(issuePattern, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) {
      attemptedIssuePages.push(url.search);
      if (failPage) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"fixture_page_failure"}',
        });
        return;
      }
    }
    await route.continue();
  });
  await issues().getByRole("button", { name: "Next", exact: true }).click();
  await issues()
    .getByRole("button", { name: "Retry issues", exact: true })
    .waitFor();
  await issues().getByRole("button", { name: "Previous", exact: true }).click();
  await issues().getByText("Page 1", { exact: true }).waitFor();
  await issues().locator("li").first().waitFor();
  await issues().getByRole("button", { name: "Next", exact: true }).click();
  await issues()
    .getByRole("button", { name: "Retry issues", exact: true })
    .waitFor();
  failPage = false;
  await issues()
    .getByRole("button", { name: "Retry issues", exact: true })
    .click();
  await issues().getByText("Page 2", { exact: true }).waitFor();
  await issues().locator("li").first().waitFor();
  assert.equal(
    new Set(attemptedIssuePages).size,
    1,
    "Issue retries/Previous retain the original report interval and cursor",
  );
  await page.unroute(issuePattern);
  await issues().getByRole("button", { name: "Previous", exact: true }).click();
  await issues().getByText("Page 1", { exact: true }).waitFor();
  checks.push(
    "followthrough: issue page2 503 leaves Previous usable; Retry preserves exact cursor/interval and returns real page2",
  );

  const links = issues().getByRole("link", {
    name: "Review history",
    exact: true,
  });
  await links.first().waitFor();
  for (const row of await issues().locator("li").all()) {
    const link = row.getByRole("link", { name: "Review history", exact: true });
    if (!(await link.count())) continue;
    const candidates = await Promise.all(
      repositories
        .slice(0, 2)
        .map(async (repository) =>
          (await row.getByText(repository.fullName, { exact: true }).count())
            ? repository
            : null,
        ),
    );
    const repository = candidates.find((item) => item !== null);
    assert(
      repository,
      "Every linked issue retains its source repository label",
    );
    assert.equal(
      new URL((await link.getAttribute("href"))!, appUrl).searchParams.get(
        "reviewRepository",
      ),
      repository.scm,
      "Each issue selects its own captured SCM, including equal PRnumbers",
    );
    assert.equal(
      await row.getByRole("link", { name: /^PR #1/ }).getAttribute("href"),
      `https://github.com/${repository.fullName}/pull/1`,
    );
  }
  const destinations = await links.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLAnchorElement).href),
  );
  for (const destination of destinations) {
    const url = new URL(destination);
    assert.equal(url.searchParams.get("reviewSearch"), "1");
    assert(
      [repositories[0]!.scm, repositories[1]!.scm].includes(
        url.searchParams.get("reviewRepository") ?? "",
      ),
    );
    assert.equal(url.searchParams.get("reviewDays"), null);
    assert.equal(url.searchParams.get("reviewStatus"), null);
  }
  assert.equal(
    new Set(
      destinations.map((href) =>
        new URL(href).searchParams.get("reviewRepository"),
      ),
    ).size,
    2,
    "Same PRnumber in two repositories has distinct canonical destinations",
  );
  assert(
    (await issues()
      .getByText("Review history not recorded yet", { exact: true })
      .count()) > 0,
    "Absent projection remains an explicit external-PR fallback",
  );
  const selectedHref = await links.first().getAttribute("href");
  assert(selectedHref);
  const selectedRepository = repositories.find(
    (repository) =>
      repository.scm ===
      new URL(selectedHref, appUrl).searchParams.get("reviewRepository"),
  );
  assert(selectedRepository);
  await links.first().click();
  await list().waitFor();
  await assertRuntime();
  assert.equal(await list().locator(":scope > li").count(), 1);
  assert.match(
    await list().innerText(),
    new RegExp(selectedRepository.fullName),
  );
  assert.match(await list().innerText(), /Failed/);
  await list()
    .getByRole("button", { name: /^Show review history for / })
    .click();
  const runs = page.getByRole("list", {
    name: "Previous review runs",
    exact: true,
  });
  await runs.waitFor();
  assert.equal(await runs.locator(":scope > li").count(), 2);
  assert.match(await runs.innerText(), /Completed/);
  assert.match(await runs.innerText(), /Failed/);
  await snapshot(page, "followthrough-linked-history.png");
  checks.push(
    "followthrough: authorized SCM+PR mapping distinguishes same-number repositories, retains absent fallback, shows newer failed and earlier completed runs",
  );

  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('ul[aria-label="Reviewed pull requests"]')
        ?.children.length === 25,
  );
  let failHistoryPage = true;
  const historyAttempts: string[] = [];
  const historyPattern = "**/api/dashboard/review-history?**";
  await page.route(historyPattern, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) {
      historyAttempts.push(url.search);
      if (failHistoryPage) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"history_unavailable"}',
        });
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText(/Reviews could not be loaded/).waitFor();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await list().waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText(/Reviews could not be loaded/).waitFor();
  failHistoryPage = false;
  await page
    .getByRole("button", { name: "Try loading again", exact: true })
    .click();
  await page.getByText("Page 2", { exact: true }).waitFor();
  await list().waitFor();
  assert.equal(
    new Set(historyAttempts).size,
    1,
    "History retry preserves exact frozen cursor/window",
  );
  await page.unroute(historyPattern);
  checks.push(
    "followthrough: Reviews page2 503 retains Previous and retries the identical frozen cursor/window",
  );

  await navigate("statistics");
  await page.getByLabel("All-severity review summary").waitFor();
  let expectedUsageAccess: "admin" | "member" = "admin";
  const expectedUsageRequests = new WeakMap<Request, "admin" | "member">();
  const priorBrowserUsageReads: Promise<{
    status: number;
    expectedAccess: "admin" | "member" | undefined;
    actualAccess: string | null;
    scopeMatches: boolean;
  }>[] = [];
  const observeUsageRequest = (request: Request) => {
    if (new URL(request.url()).pathname === "/api/dashboard/provider-usage")
      expectedUsageRequests.set(request, expectedUsageAccess);
  };
  const observeUsageResponse = (response: Response) => {
    if (new URL(response.url()).pathname !== "/api/dashboard/provider-usage")
      return;
    const expectedAccess = expectedUsageRequests.get(response.request());
    priorBrowserUsageReads.push(
      bounded(response.json(), 5_000, "prior Usage envelope observation").then(
        (
          envelope: {
            scope?: {
              actorId?: string;
              workspaceId?: string;
              effectiveAccess?: string;
            };
          } | null,
        ) => ({
          status: response.status(),
          expectedAccess,
          actualAccess: envelope?.scope?.effectiveAccess ?? null,
          scopeMatches:
            expectedAccess !== undefined &&
            envelope?.scope?.actorId === actorId &&
            envelope.scope?.workspaceId === main.id &&
            envelope.scope?.effectiveAccess === expectedAccess,
        }),
        () => ({
          status: response.status(),
          expectedAccess,
          actualAccess: null,
          scopeMatches: false,
        }),
      ),
    );
  };
  page.on("request", observeUsageRequest);
  page.on("response", observeUsageResponse);
  await page.evaluate(() => {
    const state = window as Window & {
      followthroughPriorUsageDenials?: string[];
      followthroughPriorUsageObserver?: MutationObserver;
    };
    state.followthroughPriorUsageDenials = [];
    state.followthroughPriorUsageObserver = new MutationObserver(() => {
      if (
        document
          .querySelector('section[aria-label="Provider usage"]')
          ?.textContent?.includes("Usage access is no longer available")
      )
        state.followthroughPriorUsageDenials!.push("Usage access denied");
    });
    state.followthroughPriorUsageObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await navigate("usage");
  await usage().waitFor();
  await page.goBack();
  await statistics().waitFor();
  await assertRuntime();
  // Finish Back's seed validation before revoking access and clicking Refresh.
  await page.getByLabel("All-severity review summary").waitFor();
  await refresh().and(page.locator(":enabled")).waitFor();
  await admin.query(
    'DELETE FROM "WorkspaceMember" WHERE "workspaceId"=$1 AND "userId"=$2',
    [main.id, actorId],
  );
  await refresh().click();
  await page.getByText(/Statistics access is no longer available/).waitFor();
  await snapshot(page, "followthrough-statistics-denied.png");
  await input.addMember(main.id);
  // Keep this Statistics-only denial journey from also changing Usage access.
  await admin.query(
    'UPDATE "WorkspaceMember" SET role=\'admin\' WHERE "workspaceId"=$1 AND "userId"=$2',
    [main.id, actorId],
  );
  await navigate("usage");
  await usage().waitFor();
  await page.goBack();
  await page.getByText(/Statistics access is no longer available/).waitFor();
  await assertRuntime();
  assert.equal(
    await page.getByLabel("All-severity review summary").count(),
    0,
    "Cached same-seed remount cannot resurrect forbidden SSR data after membership restoration",
  );
  await refresh().click();
  await page.getByLabel("All-severity review summary").waitFor();
  await assertRuntime();
  checks.push(
    "followthrough: real membership403, same-QueryClient cached Back/remount stays denied, fresh authorized router refresh recovers without document reload",
  );

  await admin.query(
    'UPDATE "WorkspaceMember" SET role=\'admin\' WHERE "workspaceId"=$1 AND "userId"=$2',
    [main.id, actorId],
  );
  await navigate("usage");
  await usage().waitFor();
  await refresh().click();
  await page.waitForFunction(
    (label) =>
      document
        .querySelector('section[aria-label="Provider usage"]')
        ?.textContent?.includes(label),
    adminModel,
  );
  const date = new Date(Date.now() - 2 * dayMs).toISOString().slice(0, 10);
  const through = new Date().toISOString().slice(0, 10);
  const custom = async () => {
    await choose(page, "Period", "Custom dates");
    await page.getByLabel("Usage from", { exact: true }).fill(date);
    await page.getByLabel("Usage to", { exact: true }).fill(through);
    await page
      .getByRole("button", { name: "Apply dates", exact: true })
      .click();
  };
  await custom();
  await page.waitForFunction(
    (label) =>
      document
        .querySelector('section[aria-label="Provider usage"]')
        ?.textContent?.includes(label),
    adminModel,
  );
  const interval = new URLSearchParams({
    workspace: main.id,
    purpose: "review",
    from: `${date}T00:00:00.000Z`,
    to: new Date(Date.parse(`${through}T00:00:00.000Z`) + dayMs).toISOString(),
  });
  const adminRead = await api(`/api/dashboard/provider-usage?${interval}`);
  assert.equal(adminRead.status(), 200);
  const adminEnvelope = (await adminRead.json()) as {
    scope: { actorId: string; workspaceId: string; effectiveAccess: string };
    report: { rows: { requestedModel: string }[] };
  };
  assert.deepEqual(adminEnvelope.scope, {
    actorId,
    workspaceId: main.id,
    effectiveAccess: "admin",
  });
  assert(
    adminEnvelope.report.rows.some((row) => row.requestedModel === adminModel),
  );
  await snapshot(page, "followthrough-usage-admin.png");

  const usagePattern = "**/api/dashboard/provider-usage?**";
  const heldAdmin = await holdUsageResponse(
    page,
    usagePattern,
    200,
    async (response) => {
      assert.equal(
        ((await response.json()) as { scope: { effectiveAccess: string } })
          .scope.effectiveAccess,
        "admin",
      );
    },
  );
  try {
    await refresh().click();
    await heldAdmin.capture();
    await navigate("statistics");
    await statistics().waitFor();
    await admin.query(
      'UPDATE "WorkspaceMember" SET role=\'member\' WHERE "workspaceId"=$1 AND "userId"=$2',
      [main.id, actorId],
    );
    expectedUsageAccess = "member";
    await navigate("usage");
    await usage().waitFor();
    await page.waitForFunction(
      ({ own, other }) => {
        const text =
          document.querySelector('section[aria-label="Provider usage"]')
            ?.textContent ?? "";
        return text.includes(own) && !text.includes(other);
      },
      { own: ownModel, other: adminModel },
    );
    await page.evaluate((secret) => {
      const state = window as Window & {
        followthroughLeaks?: string[];
        followthroughObserver?: MutationObserver;
      };
      state.followthroughLeaks = [];
      state.followthroughObserver = new MutationObserver(() => {
        if (
          document
            .querySelector('section[aria-label="Provider usage"]')
            ?.textContent?.includes(secret)
        )
          state.followthroughLeaks!.push(secret);
      });
      state.followthroughObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }, adminModel);
    await custom();
    await page.waitForFunction(
      (label) =>
        document
          .querySelector('section[aria-label="Provider usage"]')
          ?.textContent?.includes(label),
      ownModel,
    );
    heldAdmin.release();
    heldResponses.push({ status: 200, outcome: await heldAdmin.delivery() });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const memberRead = await api(`/api/dashboard/provider-usage?${interval}`);
    assert.equal(memberRead.status(), 200);
    const memberEnvelope = (await memberRead.json()) as {
      scope: { effectiveAccess: string };
      report: { rows: { requestedModel: string }[] };
    };
    assert.equal(memberEnvelope.scope.effectiveAccess, "member");
    assert.deepEqual(
      memberEnvelope.report.rows.map((row) => row.requestedModel),
      [ownModel],
    );
    await assertRuntime();
    assert(
      !(await usage().textContent())?.includes(adminModel),
      "A matching custom interval cannot reuse admin cache after downgrade",
    );
    const leaks = await page.evaluate(() => {
      const state = window as Window & {
        followthroughLeaks?: string[];
        followthroughObserver?: MutationObserver;
      };
      state.followthroughObserver?.disconnect();
      return state.followthroughLeaks ?? [];
    });
    assert.deepEqual(
      leaks,
      [],
      "No intermediate member render may contain another actor's previously cached Usage data",
    );
    await snapshot(page, "followthrough-usage-member.png");
    checks.push(
      "followthrough: actual DB admin→member downgrade preserves QueryClient, identical custom interval hides other actor, real API is member-scoped; retained old-admin response outcome is recorded separately",
    );
  } finally {
    await heldAdmin.close();
  }
  page.off("request", observeUsageRequest);
  page.off("response", observeUsageResponse);
  const priorBrowserScopeChecks = await Promise.all(priorBrowserUsageReads);
  const priorBrowserDenialMessages = await page.evaluate(() => {
    const state = window as Window & {
      followthroughPriorUsageDenials?: string[];
      followthroughPriorUsageObserver?: MutationObserver;
    };
    state.followthroughPriorUsageObserver?.disconnect();
    return state.followthroughPriorUsageDenials ?? [];
  });
  assert.deepEqual(
    priorBrowserDenialMessages,
    [],
    "No Usage denial or client scope-mismatch recovery may precede the retired-seed return",
  );
  assert(
    priorBrowserScopeChecks.some((read) => read.actualAccess === "admin") &&
      priorBrowserScopeChecks.some((read) => read.actualAccess === "member"),
    "Both actual browser Usage scopes must be observed before the retired-seed return",
  );
  assert(
    priorBrowserScopeChecks.every(
      (read) => read.status === 200 && read.scopeMatches,
    ),
    "The admin-to-member transition must retire the old seed without an earlier Usage access failure or mismatching envelope",
  );
  const heldRetiredValidation = await holdUsageResponse(
    page,
    usagePattern,
    200,
    async (response) => {
      const envelope = (await response.json()) as {
        scope: { effectiveAccess: string };
        report: { rows: { requestedModel: string }[] };
      };
      assert.equal(envelope.scope.effectiveAccess, "member");
      assert.deepEqual(
        envelope.report.rows.map((row) => row.requestedModel),
        [ownModel],
      );
    },
  );
  const dashboardRscRequests: string[] = [];
  const observeBackRequest = (request: Request) => {
    const url = new URL(request.url());
    if (
      url.origin === appUrl &&
      url.pathname === "/dashboard" &&
      request.headers()["rsc"] === "1"
    )
      dashboardRscRequests.push(url.pathname);
  };
  page.on("request", observeBackRequest);
  try {
    await page.evaluate((secret) => {
      const state = window as Window & {
        followthroughLeaks?: string[];
        followthroughObserver?: MutationObserver;
      };
      state.followthroughLeaks = [];
      state.followthroughObserver = new MutationObserver(() => {
        if (
          document
            .querySelector('section[aria-label="Provider usage"]')
            ?.textContent?.includes(secret)
        )
          state.followthroughLeaks!.push(secret);
      });
      state.followthroughObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }, adminModel);
    await page.goBack();
    await page.waitForURL(
      (url) => url.searchParams.get("section") === "statistics",
    );
    await statistics().waitFor();
    await assertRuntime();
    await page.goBack();
    await page.waitForURL((url) => url.searchParams.get("section") === "usage");
    await usage().waitFor();
    await heldRetiredValidation.capture();
    await assertRuntime();
    assert(
      !(await usage().textContent())?.includes(adminModel),
      "Returning to the earlier admin navigation cannot reveal its retired seed while API validation is held",
    );
    assert.equal(
      dashboardRscRequests.length,
      0,
      "The Back journey must use the earlier cached server component, not a new server render",
    );
    page.off("request", observeBackRequest);
    heldRetiredValidation.release();
    const outcome = await heldRetiredValidation.delivery();
    await page.waitForFunction(
      ({ own, other }) => {
        const text =
          document.querySelector('section[aria-label="Provider usage"]')
            ?.textContent ?? "";
        return text.includes(own) && !text.includes(other);
      },
      { own: ownModel, other: adminModel },
    );
    const confirmed = await api(`/api/dashboard/provider-usage?${interval}`);
    assert.equal(confirmed.status(), 200);
    const confirmedEnvelope = (await confirmed.json()) as {
      scope: { effectiveAccess: string };
      report: { rows: { requestedModel: string }[] };
    };
    assert.equal(confirmedEnvelope.scope.effectiveAccess, "member");
    assert.deepEqual(
      confirmedEnvelope.report.rows.map((row) => row.requestedModel),
      [ownModel],
    );
    const leaks = await page.evaluate(() => {
      const state = window as Window & { followthroughLeaks?: string[] };
      return state.followthroughLeaks ?? [];
    });
    assert.deepEqual(leaks, [], "A retired admin seed never flashes on Back");
    retiredUsageRemount = {
      responseStatus: 200,
      effectiveAccess: "member",
      outcome,
      dashboardRscRequestsBeforeValidationRelease: 0,
      priorBrowserScopeChecks,
      priorBrowserDenialMessages,
    };
    checks.push(
      "followthrough: with no prior Usage access failure, Back to the cached admin server component preserves QueryClient and hides its retired seed while real member200 validation is held; matching member scope recovers without any admin-label flash",
    );
    await assertRuntime();
    await custom();
  } finally {
    page.off("request", observeBackRequest);
    try {
      await heldRetiredValidation.close();
    } finally {
      await page.evaluate(() => {
        (
          window as Window & { followthroughObserver?: MutationObserver }
        ).followthroughObserver?.disconnect();
      });
    }
  }
  // Apply dates starts a read; the next denial must target its own Refresh.
  await page.waitForFunction(
    (label) =>
      document
        .querySelector('section[aria-label="Provider usage"]')
        ?.textContent?.includes(label),
    ownModel,
  );
  await refresh().and(page.locator(":enabled")).waitFor();
  const heldDenial = await holdUsageResponse(page, usagePattern, 403);
  try {
    await admin.query(
      'DELETE FROM "WorkspaceMember" WHERE "workspaceId"=$1 AND "userId"=$2',
      [main.id, actorId],
    );
    await refresh().click();
    await heldDenial.capture();
    await input.addMember(main.id);
    await navigate("statistics");
    await statistics().waitFor();
    await navigate("usage");
    await usage().waitFor();
    await custom();
    await page.waitForFunction(
      (label) =>
        document
          .querySelector('section[aria-label="Provider usage"]')
          ?.textContent?.includes(label),
      ownModel,
    );
    heldDenial.release();
    heldResponses.push({ status: 403, outcome: await heldDenial.delivery() });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const confirmed = await api(`/api/dashboard/provider-usage?${interval}`);
    assert.equal(confirmed.status(), 200);
    await assertRuntime();
    assert(!(await usage().textContent())?.includes(adminModel));
    assert.match(await usage().innerText(), new RegExp(ownModel));
    checks.push(
      "followthrough: fresh authorized member seed remains usable after release attempt of a held real403; receipt distinguishes delivery from cancellation, guard-specific proof remains in deferred component tests",
    );
  } finally {
    try {
      await heldDenial.close();
    } finally {
      await input.addMember(main.id);
    }
  }
  await setTextSize(page, "200%");
  const zoomDimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    overflowing: [...document.body.querySelectorAll("*")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.right > document.documentElement.clientWidth + 1
        );
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        role: element.getAttribute("role"),
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));
  assert(
    zoomDimensions.scroll <= zoomDimensions.width + 1,
    `Usage controls do not create page overflow at200% text size: ${JSON.stringify(zoomDimensions)}`,
  );
  await assertSelectedLabelsFit(page, "Provider usage");
  const primary = page.getByRole("navigation", {
    name: "Primary navigation",
    exact: true,
  });
  await primary.getByRole("link", { name: "Dashboard", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert(
    await primary
      .getByRole("link", { name: "Guide", exact: true })
      .evaluate((element) => element === document.activeElement),
    "Wrapped primary navigation preserves keyboard order at200% text size",
  );
  assert(
    await primary.getByRole("link").evaluateAll((links) =>
      links.every((link) => {
        const rect = link.getBoundingClientRect();
        const target = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return target !== null && link.contains(target);
      }),
    ),
    "Wrapped primary navigation links have unobscured targets at200% text size",
  );
  await snapshot(page, "followthrough-usage-text-zoom.png");
  await setTextSize(page, "");
  checks.push(
    "followthrough: actual Usage selected filter labels fit without page overflow at200% text size; wrapped global navigation retains unobscured targets and keyboard order",
  );
  await input.openWorkspace(page, input.empty.slug);
  await page
    .getByText("No recorded published reviews in this period yet.", {
      exact: true,
    })
    .waitFor();
  await snapshot(page, "followthrough-empty-recorded-copy.png");
  const previousCoverage = (
    await admin.query<{ value: string }>(
      'SELECT "activatedAt"::text AS value FROM "ReviewStatisticsCoverage" WHERE id=\'capture_v1\'',
    )
  ).rows[0]!.value;
  try {
    await admin.query(
      'UPDATE "ReviewStatisticsCoverage" SET "activatedAt"=$1 WHERE id=\'capture_v1\'',
      [new Date(Date.now() - dayMs).toISOString()],
    );
    await input.openWorkspace(page, main.slug);
    await page
      .getByText(/some history or connected review sources are not covered/)
      .waitFor();
    await snapshot(page, "followthrough-partial-coverage.png");
  } finally {
    await admin.query(
      'UPDATE "ReviewStatisticsCoverage" SET "activatedAt"=$1 WHERE id=\'capture_v1\'',
      [previousCoverage],
    );
  }
  checks.push(
    "followthrough: actual empty recorded-publication wording and partial coverage notice remain distinct from full synchronization claims",
  );
  return {
    heldResponses,
    retiredUsageRemount,
    sameQueryClientProof:
      "real Next Link/Back navigation retains the root layout runtime; source closure records QueryProvider useState ownership",
    usageModels: { member: ownModel, adminOnly: adminModel },
  };
}
