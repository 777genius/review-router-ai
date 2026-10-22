import { expect, test } from "@playwright/test";
import pg from "pg";
import { FIXTURES } from "../contracts.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
  useOtherSession,
} from "./support.ts";
const databaseUrl = process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL;
test.skip(
  !databaseUrl,
  "Requires isolated accounts-reference database harness.",
);
test("provider usage serves full period totals, authorized filters, and own member history", async ({
  page,
  context,
}, info) => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const now = new Date().toISOString();
  try {
    await db.query(
      `UPDATE "WorkspaceMember" SET role='member' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    for (let index = 0; index < 105; index++) {
      const callId = `rr-e2e-usage-${index.toString().padStart(3, "0")}`;
      const identity = {
        callId,
        workspaceId: FIXTURES.workspaces.orgAlpha,
        repositoryId: null,
        actorId: index === 104 ? FIXTURES.users.other : FIXTURES.users.viewer,
        runId: `rr-e2e-run-${index}`,
        runAttempt: 1,
        invocationId: `rr-e2e-invocation-${index}`,
        attemptId: `attempt-${index}`,
        bindingId: null,
        authorizationId: "rr-e2e-authorization",
        route: "direct",
        purpose: index === 103 ? "diagnostic" : "review",
        provider: "codex",
        requestedModel: "e2e-model",
        runtimeType: "codex",
        parentScope: null,
        granularity: "call",
        occurredAt: now,
      };
      const fact = {
        schemaVersion: 1,
        sourceInstance: "rr-e2e-runtime",
        eventId: callId,
        revision: 1,
        authority: "runtime",
        identity,
        actualProvider: "openai",
        actualModel: "e2e-model",
        tokens: {
          inputTotal: 1,
          outputTotal: 1,
          total: index === 102 ? null : 2,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
        },
        cost:
          index === 102
            ? null
            : {
                amount: "0.01",
                currency: index === 101 ? "EUR" : "USD",
                basis: "source_reported",
                source: "e2e",
                asOf: now,
                priceVersion: null,
              },
        completeness: index === 102 ? "unknown" : "complete",
        state: "completed",
        dispatchEffect: "dispatched",
        durationMs: 10,
        ttftMs: null,
        correctionReason: null,
        childCallIds: null,
      };
      await db.query(
        `INSERT INTO "UsageCall" ("callId","workspaceId","actorId",provider,"actualModel",route,"runId",purpose,"occurredAt","identityHash",projection,"updatedAt") VALUES ($1,$2,$3,'codex','e2e-model','direct',$4,$5,$6,'synthetic',$7,CURRENT_TIMESTAMP)`,
        [
          callId,
          identity.workspaceId,
          identity.actorId,
          identity.runId,
          identity.purpose,
          now,
          JSON.stringify({ identity, usage: fact, lifecycle: null }),
        ],
      );
    }
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.goto("/dashboard?section=usage&workspace=rr-e2e-org-alpha");
    await expect(page.getByText(/105 measured attempts/)).toBeVisible();
    await expect(
      page.getByText(/Period known token subtotal: 208/),
    ).toBeVisible();
    await expect(page.getByText(/1 unknown/)).toBeVisible();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(
      page
        .getByRole("table", { name: "Usage observations" })
        .getByRole("cell", {
          name: /Requested: codex \/ e2e-model Observed: openai \/ e2e-model/,
        }),
    ).toHaveCount(5);
    await expect(
      page.getByText(/Period known token subtotal: 208/),
    ).toBeVisible();
    await page.getByLabel("Usage purpose").selectOption("diagnostic");
    await expect(page.getByText(/1 measured attempts/)).toBeVisible();
    const response = await context.request.get(
      "/api/dashboard/provider-usage?workspace=" + FIXTURES.workspaces.orgAlpha,
    );
    const payload = await response.json();
    expect(payload.totals.providerAttempts).toBe(105);
    expect(JSON.stringify(payload)).not.toMatch(
      /authorizationId|prompt|apiKey|publicKey/,
    );
    await useOtherSession(context);
    const member = await context.request.get(
      "/api/dashboard/provider-usage?workspace=" + FIXTURES.workspaces.orgAlpha,
    );
    expect((await member.json()).totals.providerAttempts).toBe(1);
    const forbidden = await context.request.get(
      "/api/dashboard/provider-usage?workspace=" + FIXTURES.workspaces.orgBravo,
    );
    expect(forbidden.status()).toBe(403);
    expect(violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath("usage-report.png"),
      fullPage: true,
    });
  } finally {
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId" LIKE 'rr-e2e-usage-%'`,
    );
    await db.query(
      `UPDATE "WorkspaceMember" SET role='admin' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    await db.end();
  }
});

test("provider usage isolates workspace navigation and reloads stable known totals", async ({
  page,
  context,
}) => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const violations: string[] = [];
  try {
    await seedKnownCall(
      db,
      "navigation-alpha",
      FIXTURES.workspaces.orgAlpha,
      12,
    );
    await seedKnownCall(
      db,
      "navigation-bravo",
      FIXTURES.workspaces.orgBravo,
      84,
    );
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.goto("/dashboard?section=usage&workspace=rr-e2e-org-alpha");
    const usage = page.getByRole("region", {
      name: "Provider usage",
      exact: true,
    });
    await expect(
      usage.getByText(/Period known token subtotal: 12\b/),
    ).toBeVisible();
    // Populate a client query as well as the server-rendered initial report.
    await usage.getByLabel("Usage route").selectOption("direct");
    await expect(
      usage.getByText(/Period known token subtotal: 12\b/),
    ).toBeVisible();
    await page.getByRole("tab", { name: /RR E2E Org Bravo/ }).click();
    await expect(
      usage.getByText(/Period known token subtotal: 84\b/),
    ).toBeVisible();
    await usage.getByLabel("Usage route").selectOption("direct");
    await expect(
      usage.getByText(/Period known token subtotal: 84\b/),
    ).toBeVisible();
    await expect(
      usage.getByText(/Period known token subtotal: 12\b/),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: /RR E2E Org Alpha/ }).click();
    await expect(
      usage.getByText(/Period known token subtotal: 12\b/),
    ).toBeVisible();
    await seedKnownCall(
      db,
      "navigation-bravo-new",
      FIXTURES.workspaces.orgBravo,
      16,
    );
    await page.getByRole("tab", { name: /RR E2E Org Bravo/ }).click();
    await expect(
      usage.getByText(/Period known token subtotal: 100\b/),
    ).toBeVisible();
    await usage.getByLabel("Usage route").selectOption("direct");
    await expect(
      usage.getByText(/Period known token subtotal: 100\b/),
    ).toBeVisible();
    await expect(usage.getByText(/2 measured attempts/)).toBeVisible();
    await page.reload();
    await expect(
      usage.getByText(/Period known token subtotal: 100\b/),
    ).toBeVisible();
    await expect(usage.getByText(/2 measured attempts/)).toBeVisible();
    await expect(
      usage.getByText(/Period known cost: 0\.02 USD \(source_reported\)/),
    ).toBeVisible();
    expect(violations).toEqual([]);
  } finally {
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId" LIKE 'rr-e2e-usage-navigation-%'`,
    );
    await db.end();
  }
});

test("provider usage renders native lag and partial producer coverage truthfully", async ({
  page,
  context,
}) => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const violations: string[] = [];
  const asOf = new Date(Date.now() - 120_000).toISOString();
  const coveredFrom = new Date(Date.now() - 3_600_000).toISOString();
  const retryAt = new Date(Date.now() + 3_600_000).toISOString();
  try {
    await seedKnownCall(db, "coverage", FIXTURES.workspaces.orgAlpha, 42);
    await db.query(
      `INSERT INTO "UsageSourceCheckpoint" ("sourceInstance","workspaceId","coveredFrom","asOf","failureCount","nextAttemptAt","lastErrorCode") VALUES ('rr-e2e-usage-native',$1,$2,$3,1,$4,'gateway_unavailable')`,
      [FIXTURES.workspaces.orgAlpha, coveredFrom, asOf, retryAt],
    );
    await db.query(
      `INSERT INTO "ProviderUsageGrant" (id,"tokenHash","workspaceId","invocationId","repositoryId","runId","runAttempt","authorizationId","actorId","producerDigest","workflowIdentity","jobIdentity","publicKey","issuedAt","expiresAt","producerCoverage") VALUES ('rr-e2e-usage-grant','rr-e2e-usage-token-hash',$1,'rr-e2e-usage-coverage-invocation','rr-e2e-repository','rr-e2e-usage-coverage-run',1,'rr-e2e-authorization',$2,'rr-e2e-digest','rr-e2e-workflow','rr-e2e-job','rr-e2e-unused-key',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 hour',$3)`,
      [
        FIXTURES.workspaces.orgAlpha,
        FIXTURES.users.viewer,
        JSON.stringify({
          schemaVersion: 1,
          revision: 1,
          state: "partial",
          reason: "spool_overflow",
          droppedEvents: 3,
          occurredAt: asOf,
        }),
      ],
    );
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.goto("/dashboard?section=usage&workspace=rr-e2e-org-alpha");
    const usage = page.getByRole("region", {
      name: "Provider usage",
      exact: true,
    });
    await expect(
      usage.getByText(/Source lag: [\d.]+s \(native reconciliation\)/),
    ).toBeVisible();
    await expect(
      usage.getByText(`Source as of ${asOf}`, { exact: false }),
    ).toBeVisible();
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      `Native source coverage from ${coveredFrom}; as of ${asOf}`,
    );
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      `retry at ${retryAt}`,
    );
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      "last source error: gateway_unavailable",
    );
    await expect(usage.getByLabel("Producer delivery coverage")).toHaveText(
      "Runtime delivery: partial (spool_overflow, 3 dropped events)",
    );
    await expect(
      usage.getByText(/Period known token subtotal: 42\b/),
    ).toBeVisible();
    await expect(usage.getByText(/Quota \/ limits: unknown/)).toBeVisible();
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      "reported observations only; transport completeness varies",
    );
    expect(violations).toEqual([]);
  } finally {
    await db.query(
      `DELETE FROM "ProviderUsageGrant" WHERE id='rr-e2e-usage-grant'`,
    );
    await db.query(
      `DELETE FROM "UsageSourceCheckpoint" WHERE "sourceInstance"='rr-e2e-usage-native'`,
    );
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId"='rr-e2e-usage-coverage'`,
    );
    await db.end();
  }
});

test("provider usage operator report permits administrators and denies members and signed-out users", async ({
  page,
  context,
}) => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const violations: string[] = [];
  try {
    await seedKnownCall(db, "operator-alpha", FIXTURES.workspaces.orgAlpha, 12);
    await seedKnownCall(db, "operator-bravo", FIXTURES.workspaces.orgBravo, 84);
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.goto("/operator/provider-usage");
    await expect(
      page.getByRole("heading", {
        name: "Operator provider usage",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator("dl").getByText("96", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("All users across active workspaces.", { exact: false }),
    ).toBeVisible();
    const allowed = await context.request.get("/api/operator/provider-usage");
    expect(allowed.status()).toBe(200);
    const report = await allowed.json();
    expect(report.totals.providerAttempts).toBe(2);
    expect(report.totals.tokens.total).toBe(96);
    await db.query(
      `UPDATE "WorkspaceMember" SET role='member' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    await context.clearCookies();
    await useOtherSession(context);
    await page.reload();
    await expect(
      page.getByText("Operator administrator access required.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("dl")).toHaveCount(0);
    expect(
      (await context.request.get("/api/operator/provider-usage")).status(),
    ).toBe(403);
    await context.clearCookies();
    await page.reload();
    await expect(
      page.getByText("Sign in to view this report.", { exact: true }),
    ).toBeVisible();
    expect(
      (await context.request.get("/api/operator/provider-usage")).status(),
    ).toBe(401);
    expect(violations).toEqual([]);
  } finally {
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId" LIKE 'rr-e2e-usage-operator-%'`,
    );
    await db.query(
      `UPDATE "WorkspaceMember" SET role='admin' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    await db.end();
  }
});

async function seedKnownCall(
  db: pg.Client,
  suffix: string,
  workspaceId: string,
  total: number,
) {
  const now = new Date().toISOString();
  const callId = `rr-e2e-usage-${suffix}`;
  const identity = {
    callId,
    workspaceId,
    repositoryId: null,
    actorId: FIXTURES.users.viewer,
    runId: callId,
    runAttempt: 1,
    invocationId: callId,
    attemptId: callId,
    bindingId: null,
    authorizationId: "rr-e2e-authorization",
    route: "direct",
    purpose: "review",
    provider: "codex",
    requestedModel: `e2e-${suffix}`,
    runtimeType: "codex",
    parentScope: null,
    granularity: "call",
    occurredAt: now,
  };
  const fact = {
    schemaVersion: 1,
    sourceInstance: "rr-e2e-runtime",
    eventId: callId,
    revision: 1,
    authority: "runtime",
    identity,
    actualProvider: "openai",
    actualModel: `e2e-${suffix}`,
    tokens: {
      inputTotal: total - 1,
      outputTotal: 1,
      total,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    cost: {
      amount: "0.01",
      currency: "USD",
      basis: "source_reported",
      source: "e2e",
      asOf: now,
      priceVersion: null,
    },
    completeness: "complete",
    state: "completed",
    dispatchEffect: "dispatched",
    durationMs: 10,
    ttftMs: null,
    correctionReason: null,
    childCallIds: null,
  };
  await db.query(
    `INSERT INTO "UsageCall" ("callId","workspaceId","actorId",provider,"actualModel",route,"runId",purpose,"occurredAt","identityHash",projection,"updatedAt") VALUES ($1,$2,$3,'codex',$4,'direct',$1,'review',$5,'synthetic',$6,CURRENT_TIMESTAMP)`,
    [
      callId,
      workspaceId,
      FIXTURES.users.viewer,
      fact.actualModel,
      now,
      JSON.stringify({ identity, usage: fact, lifecycle: null }),
    ],
  );
}
