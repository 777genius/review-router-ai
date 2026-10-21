import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import {
  createDashboardGatewayProbeAccess,
  registerDashboardGatewayProbeAccessRoute,
} from "./dashboard-gateway-probe-access";
import {
  signGatewayProbeAccess,
  gatewayProbeAccessPath,
} from "@reviewrouter/features-provider-accounts/gateway-probe";
const secret = "synthetic-probe-purpose-secret-123456";
const request = () => ({
  userId: "test-user",
  workspaceId: "test-workspace",
  bindingId: "test-binding",
  model: "test-model",
  nonce: "3900013a-6276-4606-9a46-ce40b595242c",
  deadline: new Date(Date.now() + 60000).toISOString(),
});
describe("private dashboard probe issuer", () => {
  it("rejects forged, changed, expired, over-budget and extra-field requests before DB or Gateway access", async () => {
    const db = vi.fn();
    const get = vi.fn();
    const runAccess = vi.fn();
    const issuer = createDashboardGatewayProbeAccess({
      prisma: { workspace: { findUnique: db } } as unknown as PrismaClient,
      secret,
      profiles: [],
      control: { get, runAccess },
      executionOrigin: "http://localhost:1234",
      env: {},
    });
    const original = request();
    const signature = signGatewayProbeAccess(original, secret);
    const expired = {
      ...original,
      deadline: new Date(Date.now() - 1).toISOString(),
    };
    const over = {
      ...original,
      deadline: new Date(Date.now() + 100000).toISOString(),
    };
    for (const [body, proof] of [
      [original, "0".repeat(64)],
      [{ ...original, userId: "foreign-user" }, signature],
      [expired, signGatewayProbeAccess(expired, secret)],
      [over, signGatewayProbeAccess(over, secret)],
      [{ ...original, accountRef: "caller-account" }, signature],
    ]) {
      expect((await issuer(body, proof)).status).toBe(403);
    }
    expect(db).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(runAccess).not.toHaveBeenCalled();
  });
  it("fails closed when the issuer is unconfigured and bounds HTTP request size", async () => {
    const app = Fastify();
    await registerDashboardGatewayProbeAccessRoute(app, null);
    try {
      const denied = await app.inject({
        method: "POST",
        url: gatewayProbeAccessPath,
        payload: request(),
      });
      expect(denied.statusCode).toBe(503);
      expect(denied.headers["cache-control"]).toBe("private, no-store");
      const oversized = await app.inject({
        method: "POST",
        url: gatewayProbeAccessPath,
        payload: { text: "x".repeat(5000) },
      });
      expect(oversized.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });
});
