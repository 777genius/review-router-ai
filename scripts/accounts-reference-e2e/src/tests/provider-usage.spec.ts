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
        .getByRole("cell", { name: "openai / e2e-model" }),
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
