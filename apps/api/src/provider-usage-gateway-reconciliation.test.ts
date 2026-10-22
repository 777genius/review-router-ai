import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
const m = vi.hoisted(() => ({
  prune: vi.fn(async () => {}),
  claim: vi.fn(async () => null),
  replay: vi.fn(async () => 0),
}));
vi.mock("@reviewrouter/features-provider-usage/composition", () => ({
  PrismaUsageReconciliation: class {
    prune = m.prune;
    claim = m.claim;
  },
  PrismaUsageAttributionReader: class {},
}));
vi.mock("@agent-teams/account-gateway/http", () => ({
  createConsumerControlClient: () => ({ listUsage: vi.fn() }),
}));
vi.mock("./provider-usage-quarantine", () => ({
  replayGatewayQuarantine: m.replay,
  quarantineGatewayObservation: vi.fn(),
}));
import { createProviderUsageGatewayReconciliation } from "./provider-usage-gateway-reconciliation";
describe("usage maintenance source scheduling", () => {
  it("prunes direct-only deployments without a native reader", async () => {
    const maintenance = createProviderUsageGatewayReconciliation(
      {} as PrismaClient,
      {},
    );
    expect(await maintenance.runBatch()).toEqual({
      status: "native_unavailable",
    });
    expect(m.prune).toHaveBeenCalled();
  });
  it("uses bounded parameterized keyset pages and wraps after the final workspace", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ workspaceId: "a" }, { workspaceId: "b" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ workspaceId: "a" }]);
    const maintenance = createProviderUsageGatewayReconciliation(
      { $queryRaw: query } as unknown as PrismaClient,
      {
        REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN: "http://127.0.0.1:3999",
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER:
          "synthetic-test-only-token",
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: "configured",
      },
    );
    await maintenance.runBatch();
    await maintenance.runBatch();
    expect(query.mock.calls.map((call) => call[1])).toEqual(["", "b", ""]);
    expect(
      query.mock.calls.every((call) => String(call[0]).includes("LIMIT 10")),
    ).toBe(true);
  });
});
