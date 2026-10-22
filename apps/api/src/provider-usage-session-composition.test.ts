import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { createProviderUsageSessionComposition } from "./provider-usage-session-composition";
import { registerProviderUsageRoutes } from "./provider-usage-routes";
describe("Action Session usage with the v2 execution API disabled", () => {
  it("exposes report-only routes without constructing a v2 execution authority", async () => {
    const lookup = vi.fn(async () => null);
    const prisma = {
      providerUsageGrant: { findUnique: lookup },
    } as unknown as PrismaClient;
    const feature = createProviderUsageSessionComposition({
      prisma,
      appId: "1",
      privateKey: "synthetic-unused-private-key",
      env: {},
    });
    expect(typeof feature.providerUsageActionSession.issue).toBe("function");
    expect(typeof feature.providerUsageBootstrap.issue).toBe("function");
    const app = Fastify();
    await registerProviderUsageRoutes(app, feature.providerUsage);
    const execution = await app.inject({
      method: "POST",
      url: "/api/provider-usage/grants",
      headers: { authorization: "Bearer existing-action-session-token" },
      payload: {},
    });
    expect(execution.statusCode).toBe(503);
    expect(execution.json()).toEqual({ error: "usage_execution_unavailable" });
    expect(lookup).not.toHaveBeenCalled();
    const report = await app.inject({
      method: "POST",
      url: "/api/provider-usage/reports",
      headers: { authorization: "Bearer unknown-report-token" },
      payload: {},
    });
    expect(report.statusCode).toBe(401);
    expect(report.json()).toEqual({ error: "usage_grant_denied" });
    expect(lookup).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
