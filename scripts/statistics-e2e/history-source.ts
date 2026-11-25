/** One source-produced PR joins the existing production and browser harnesses. */
import assert from "node:assert/strict";
import type pg from "pg";
import type { BrowserContext, Page } from "playwright-core";
import type {
  HistoryPullRequest,
  HistoryPullRequestPage,
  HistoryRepositoryPage,
  HistoryRunPage,
} from "../../packages/features/review-history/src/index.js";
import type { ReviewActionV2E2EHarness } from "../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";

type SourceRun = Awaited<
  ReturnType<ReviewActionV2E2EHarness["createHistoryReview"]>
>;
type Phase = "queued" | "running" | "publishing" | "completed";
type Workspace = { id: string; slug: string };
type SourceReceipt = {
  rootRequestId: string;
  pullRequestId: string;
  runSequence: string;
  headSha: string;
  requestedAt: string;
  status: string;
  latestRootRequestId: string;
  intentState: string;
  executionId: string | null;
  executionState: string | null;
  completionState: string | null;
  publicationAttemptId: string | null;
  snapshotCommitReceiptId: string | null;
  historyEvents: number;
  processedHistoryEvents: number;
};
export type HistorySourceFixture = {
  harness: ReviewActionV2E2EHarness;
  first: SourceRun;
  originalFetch: typeof globalThis.fetch;
  evidence: {
    phase: Phase;
    source: SourceReceipt;
    latestApi: HistoryPullRequest;
    runsApi: HistoryRunPage;
  }[];
};

export async function createHistorySource(
  databaseUrl: string,
  fixtureScope: { prefix: string; workspaceId: string },
): Promise<HistorySourceFixture> {
  // Import reusable support only when selected, never a Vitest test module.
  const { createReviewActionV2E2EHarness } =
    await import("../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js");
  const originalFetch = globalThis.fetch;
  const harness = await createReviewActionV2E2EHarness(databaseUrl, {
    historyProfile: true,
    fixtureScope,
  });
  try {
    assert.equal(
      globalThis.fetch,
      originalFetch,
      "Source create restores fetch",
    );
    const first = await harness.createHistoryReview("first");
    assert.equal(
      globalThis.fetch,
      originalFetch,
      "Queued source restores fetch",
    );
    return { harness, first, originalFetch, evidence: [] };
  } catch (error) {
    try {
      await harness.cleanupHistoryFixtures();
    } finally {
      await harness.close();
    }
    throw error;
  }
}

export async function warmHistorySourceApis(
  warmApi: (path: string) => Promise<Response>,
  source: HistorySourceFixture,
  admin: pg.Client,
) {
  assert.equal(globalThis.fetch, source.originalFetch);
  const { harness, first } = source;
  const list = (await (
    await warmApi(
      `/api/dashboard/review-history?workspaceId=${harness.workspaceId}`,
    )
  ).json()) as HistoryPullRequestPage;
  assert.equal(list.coverage.state, "available");
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0]!.id, first.pullRequestId);
  assert.equal(list.items[0]!.status, "queued");
  assert.equal(list.items[0]!.pullRequestNumber, first.pullRequestNumber);
  assert.equal(list.items[0]!.repositoryFullName, first.repositoryFullName);
  assert.equal(list.items[0]!.pullRequestTitle, first.pullRequestTitle);
  assert.equal(list.nextCursor, null);
  const repositories = (await (
    await warmApi(
      `/api/dashboard/review-history/repositories?workspaceId=${harness.workspaceId}`,
    )
  ).json()) as HistoryRepositoryPage;
  assert.deepEqual(repositories.items, [
    { id: harness.scmRepositoryIdentityId, fullName: first.repositoryFullName },
  ]);
  const runs = (await (
    await warmApi(
      `/api/dashboard/review-history/runs?workspaceId=${harness.workspaceId}&pullRequestId=${first.pullRequestId}`,
    )
  ).json()) as HistoryRunPage;
  assert.deepEqual(
    runs.items.map((run) => [run.id, run.status]),
    [[first.rootRequestId, "queued"]],
  );
  const receipt = await readSource(admin, source, first, "queued", 1);
  assert.equal(list.items[0]!.requestedAt, receipt.requestedAt);
  source.evidence.push({
    phase: "queued",
    source: receipt,
    latestApi: list.items[0]!,
    runsApi: runs,
  });
}

export async function qualifyHistorySource(input: {
  page: Page;
  context: BrowserContext;
  admin: pg.Client;
  appUrl: string;
  main: Workspace;
  empty: Workspace;
  foreign: Workspace;
  source: HistorySourceFixture;
  checks: string[];
  requests: { path: string; status: number; phase: string }[];
  snapshot: (page: Page, name: string) => Promise<void>;
  selectTheme: (page: Page, theme: "dark" | "light") => Promise<void>;
}) {
  const { page, context, admin, appUrl, main, empty, foreign, source } = input;
  const { harness, first } = source;
  const list = () =>
    page.getByRole("list", { name: "Reviewed pull requests", exact: true });
  const labels = {
    queued: "Queued",
    running: "In progress",
    publishing: "Publishing",
    completed: "Completed",
  };
  const request = async (path: string, phase: string, expected = 200) => {
    assert.equal(
      globalThis.fetch,
      source.originalFetch,
      "Browser uses real fetch",
    );
    const response = await context.request.get(appUrl + path, {
      timeout: 180_000,
    });
    input.requests.push({
      path: new URL(appUrl + path).pathname,
      status: response.status(),
      phase,
    });
    assert.equal(response.status(), expected);
    assert.equal(response.headers()["cache-control"], "private, no-store");
    return response;
  };
  const open = async (workspace: Workspace) => {
    const response = await page.goto(
      `${appUrl}/dashboard?section=reviews&workspace=${workspace.slug}`,
      { waitUntil: "domcontentloaded", timeout: 180_000 },
    );
    assert.equal(response?.status(), 200);
    await page
      .getByRole("heading", { name: "Reviews", exact: true, level: 1 })
      .waitFor();
    await page.waitForFunction(
      () => document.documentElement.dataset.dashboardLayoutReady === "true",
    );
  };
  const assertPhase = async (
    run: SourceRun,
    phase: Phase,
    count: number,
    refresh = true,
  ) => {
    assert.equal(
      globalThis.fetch,
      source.originalFetch,
      "Source lifecycle restores fetch before UI reads",
    );
    if (refresh)
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await list().waitFor();
    const summary = list()
      .locator(":scope > li")
      .first()
      .locator(":scope > div")
      .first();
    await summary.getByText(labels[phase], { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          'section[aria-label="Review history"] [aria-busy="true"]',
        ),
    );
    assert.equal(
      await list().locator(":scope > li").count(),
      1,
      "Reruns retain one canonical PR row",
    );
    await summary
      .getByText(first.repositoryFullName, { exact: true })
      .waitFor();
    const link = summary.getByRole("link", {
      name:
        first.pullRequestTitle || `Pull request #${first.pullRequestNumber}`,
      exact: true,
    });
    assert.equal(
      await link.getAttribute("href"),
      `https://github.com/${first.repositoryFullName}/pull/${first.pullRequestNumber}`,
    );
    const apiList = (await (
      await request(
        `/api/dashboard/review-history?workspaceId=${main.id}`,
        `source-${phase}`,
      )
    ).json()) as HistoryPullRequestPage;
    const apiRuns = (await (
      await request(
        `/api/dashboard/review-history/runs?workspaceId=${main.id}&pullRequestId=${run.pullRequestId}`,
        `source-${phase}`,
      )
    ).json()) as HistoryRunPage;
    const receipt = await readSource(admin, source, run, phase, count);
    assert.equal(apiList.items.length, 1);
    assert.equal(apiList.items[0]!.id, first.pullRequestId);
    assert.equal(apiList.items[0]!.status, phase);
    assert.equal(apiList.items[0]!.requestedAt, receipt.requestedAt);
    assert.equal(
      await summary.locator("time").getAttribute("datetime"),
      receipt.requestedAt,
    );
    assert.equal(apiRuns.items.length, count);
    assert.equal(apiRuns.items[0]!.id, run.rootRequestId);
    assert.equal(apiRuns.items[0]!.status, phase);
    assert.equal(apiRuns.items[0]!.requestedAt, receipt.requestedAt);
    assert.equal(apiRuns.nextCursor, null);
    source.evidence.push({
      phase,
      source: receipt,
      latestApi: apiList.items[0]!,
      runsApi: apiRuns,
    });
    return apiRuns;
  };
  await open(main);
  await input.selectTheme(page, "dark");
  await assertPhase(first, "queued", 1, false);
  await input.snapshot(page, "history-source-queued.png");
  await harness.replayHistoryReview(first);
  await assertPhase(first, "queued", 1);
  const firstFlow = await harness.startHistoryReview(first);
  await assertPhase(first, "running", 1);
  await harness.publishHistoryReview(firstFlow);
  await assertPhase(first, "publishing", 1);
  await input.snapshot(page, "history-source-publishing.png");
  await harness.completeHistoryReview(firstFlow);
  await assertPhase(first, "completed", 1);
  input.checks.push(
    "History source: genuine manual ingress and dispatcher, duplicate delivery stays one run; running execution, pending publication and receipt-backed completion match real private GETs and refreshed UI",
  );

  const second = await harness.createHistoryReview("second");
  assert.notEqual(second.rootRequestId, first.rootRequestId);
  assert.notEqual(second.requestId, first.requestId);
  assert.equal(second.pullRequestId, first.pullRequestId);
  assert.equal(
    second.headSha,
    first.headSha,
    "Genuine manual rerun uses the same SHA",
  );
  const queued = await assertPhase(second, "queued", 2);
  assert.equal(queued.items[1]!.id, first.rootRequestId);
  assert.equal(queued.items[1]!.status, "completed");
  const secondFlow = await harness.startHistoryReview(second);
  await assertPhase(second, "running", 2);
  await harness.publishHistoryReview(secondFlow);
  await assertPhase(second, "publishing", 2);
  await harness.completeHistoryReview(secondFlow);
  const finalRuns = await assertPhase(second, "completed", 2);
  assert.deepEqual(
    finalRuns.items.map((run) => [run.id, run.status]),
    [
      [second.rootRequestId, "completed"],
      [first.rootRequestId, "completed"],
    ],
  );
  const disclosure = page.getByRole("button", {
    name: `Show review history for ${first.repositoryFullName} #${first.pullRequestNumber}`,
    exact: true,
  });
  await disclosure.focus();
  await disclosure.press("Enter");
  const history = page.getByRole("list", {
    name: "Previous review runs",
    exact: true,
  });
  await history.waitFor();
  assert.equal(await history.locator(":scope > li").count(), 2);
  assert.equal(
    await history.getByText("Completed", { exact: true }).count(),
    2,
  );
  assert.deepEqual(
    await history
      .locator("time")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("datetime")),
      ),
    finalRuns.items.map((run) => run.requestedAt),
  );
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.scrollWidth <= dimensions.width + 1,
    "Expanded source history has no viewport overflow",
  );
  await input.snapshot(page, "history-source-rerun-expanded.png");
  const ssr = await context.request.get(
    `${appUrl}/dashboard?section=reviews&workspace=${main.slug}`,
    { timeout: 180_000 },
  );
  assert.equal(ssr.status(), 200);
  const html = await ssr.text();
  assert(
    html.includes(first.repositoryFullName) && html.includes("Completed"),
    "Fresh real SSR includes the source-produced completed row",
  );
  input.checks.push(
    "History source: second genuine manual request on identical PR/SHA creates a new root and latest row; real SSR, list API and keyboard-expanded two-run history agree on source IDs, order, status and UTC timestamps",
  );

  for (const path of [
    `/api/dashboard/review-history?workspaceId=${foreign.id}`,
    `/api/dashboard/review-history/repositories?workspaceId=${foreign.id}`,
    `/api/dashboard/review-history/runs?workspaceId=${foreign.id}&pullRequestId=${first.pullRequestId}`,
  ]) {
    const denied = await request(path, "foreign-workspace-denied", 403);
    assert(!(await denied.text()).includes(first.repositoryFullName));
  }
  const scopedRuns = (await (
    await request(
      `/api/dashboard/review-history/runs?workspaceId=${empty.id}&pullRequestId=${first.pullRequestId}`,
      "authorized-other-workspace",
    )
  ).json()) as HistoryRunPage;
  assert.deepEqual(scopedRuns.items, []);
  await open(empty);
  await page.getByText("No reviews yet.", { exact: true }).waitFor();
  assert.equal(await list().count(), 0);
  assert.equal(
    await page.getByText(first.repositoryFullName, { exact: true }).count(),
    0,
  );
  input.checks.push(
    "History source: all three actual foreign-workspace GETs deny403/private-no-store; an authorized different workspace cannot read the source PR's runs and its SSR/UI remains empty",
  );
}

async function readSource(
  admin: pg.Client,
  source: HistorySourceFixture,
  run: SourceRun,
  phase: Phase,
  count: number,
): Promise<SourceReceipt> {
  const receipt = (
    await admin.query<SourceReceipt>(
      `
    SELECT h."rootRequestId", h."pullRequestId", h."runSequence"::text AS "runSequence", h."headSha",
      to_char(h."requestedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "requestedAt", h.status,
      p."latestRootRequestId", i.state::text AS "intentState", i."executionId",
      e.state::text AS "executionState", c.state::text AS "completionState",
      c."publicationAttemptId", c."snapshotCommitReceiptId",
      (SELECT COUNT(*)::int FROM "OutboxEvent" o WHERE o.type='review.history.changed' AND o."aggregateId"=h."rootRequestId") AS "historyEvents",
      (SELECT COUNT(*)::int FROM "OutboxEvent" o WHERE o.type='review.history.changed' AND o."aggregateId"=h."rootRequestId" AND o.status='processed' AND o."processedAt" IS NOT NULL) AS "processedHistoryEvents"
    FROM "ReviewHistoryRun" h
    JOIN "ReviewHistoryPullRequest" p ON p.id=h."pullRequestId"
    JOIN "ReviewRequestedIntent" i ON i."requestId"=$2 AND i."historyRootRequestId"=h."rootRequestId"
    LEFT JOIN "ReviewExecutionV2" e ON e."executionId"=i."executionId" AND e."historyRootRequestId"=h."rootRequestId"
    LEFT JOIN "ReviewCompletionProcess" c ON c."executionId"=e."executionId"
    WHERE h."rootRequestId"=$1 AND h."workspaceId"=$3`,
      [run.rootRequestId, run.requestId, source.harness.workspaceId],
    )
  ).rows[0];
  assert(receipt, "Source intent/root/execution binding must exist");
  assert.equal(receipt.pullRequestId, run.pullRequestId);
  assert.equal(receipt.headSha, run.headSha);
  assert.equal(receipt.status, phase);
  assert.equal(receipt.latestRootRequestId, run.rootRequestId);
  assert.equal(receipt.runSequence, String(count));
  assert(
    receipt.historyEvents > 0,
    "Production capture emitted immutable History events",
  );
  assert.equal(
    receipt.processedHistoryEvents,
    receipt.historyEvents,
    "Registered History outbox handler drained every captured event",
  );
  if (phase === "queued") {
    assert.equal(receipt.intentState, "awaiting_authorization");
    assert.equal(receipt.executionId, null);
    assert.equal(receipt.completionState, null);
  } else if (phase === "running") {
    assert.equal(receipt.intentState, "dispatched");
    assert.equal(receipt.executionState, "running");
    assert.equal(receipt.completionState, null);
  } else if (phase === "publishing") {
    assert.equal(receipt.executionState, "completed");
    assert.equal(receipt.completionState, "pending_publication");
    assert.equal(receipt.snapshotCommitReceiptId, null);
  } else {
    assert.equal(receipt.executionState, "completed");
    assert.equal(receipt.completionState, "completed");
    assert(
      receipt.publicationAttemptId && receipt.snapshotCommitReceiptId,
      "Completion requires actual production publication and snapshot receipts",
    );
  }
  return receipt;
}
