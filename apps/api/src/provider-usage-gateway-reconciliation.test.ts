import { beforeEach, describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
const m = vi.hoisted(() => ({
  prune: vi.fn(async () => {}),
  claim: vi.fn(async () => null),
  replay: vi.fn(async () => 0),
  listUsage: vi.fn(),
  commitPage: vi.fn(),
  fail: vi.fn(),
  findIdentity: vi.fn(),
  readDispatchSnapshot: vi.fn(),
}));
vi.mock("@reviewrouter/features-provider-usage/composition", () => ({
  PrismaUsageReconciliation: class {
    prune = m.prune;
    claim = m.claim;
    commitPage = m.commitPage;
    fail = m.fail;
  },
  PrismaUsageAttributionReader: class {
    findIdentity = m.findIdentity;
    readDispatchSnapshot = m.readDispatchSnapshot;
  },
}));
vi.mock("@agent-teams/account-gateway/http", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-teams/account-gateway/http")
  >()),
  createConsumerControlClient: () => ({ listUsage: m.listUsage }),
}));
vi.mock("./provider-usage-quarantine", () => ({
  replayGatewayQuarantine: m.replay,
  quarantineGatewayObservation: vi.fn(),
}));
import { createProviderUsageGatewayReconciliation } from "./provider-usage-gateway-reconciliation";
import { GatewayError } from "@agent-teams/account-gateway/http";
describe("usage maintenance source scheduling", () => {
  beforeEach(() => vi.clearAllMocks());
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

  it.each([
    [
      "transport",
      new GatewayError("transport", "effect_unknown"),
      "native_source_unavailable",
    ],
    [
      "timeout",
      new GatewayError("cancelled", "effect_unknown"),
      "native_source_unavailable",
    ],
    [
      "temporary 503",
      new GatewayError(
        "safe_error",
        "not_dispatched",
        undefined,
        undefined,
        {
          code: "upstream_failure",
          traceRef: "trace",
          effect: "not_dispatched",
          retry: { kind: "never" },
        },
        503,
      ),
      "native_source_unavailable",
    ],
    [
      "malformed response",
      new GatewayError("invalid_response", "effect_unknown"),
      "native_source_error",
    ],
    [
      "forbidden",
      new GatewayError(
        "safe_error",
        "not_dispatched",
        undefined,
        undefined,
        {
          code: "forbidden",
          traceRef: "trace",
          effect: "not_dispatched",
          retry: { kind: "never" },
        },
        403,
      ),
      "native_source_error",
    ],
    ["unexpected error", new Error("unexpected"), "native_source_error"],
  ])(
    "classifies %s only at Gateway read boundary",
    async (_name, error, expected) => {
      m.claim.mockResolvedValueOnce({
        sourceInstance: "gateway/test/workspace",
        workspaceId: "workspace",
        owner: "poller",
        fence: 1n,
        cursor: null,
        highWaterMark: null,
      } as never);
      m.listUsage.mockRejectedValueOnce(error);
      const maintenance = createProviderUsageGatewayReconciliation(
        {
          $queryRaw: vi.fn().mockResolvedValue([{ workspaceId: "workspace" }]),
        } as unknown as PrismaClient,
        {
          REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN: "http://127.0.0.1:3999",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER:
            "synthetic-test-only-token",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: "configured",
        },
      );
      await maintenance.runBatch();
      expect(m.fail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: expected }),
      );
    },
  );

  it("does not classify a commit failure as a Gateway outage", async () => {
    m.claim.mockResolvedValueOnce({
      sourceInstance: "gateway/test/workspace",
      workspaceId: "workspace",
      owner: "poller",
      fence: 1n,
      cursor: null,
      highWaterMark: null,
    } as never);
    m.listUsage.mockResolvedValueOnce({
      observations: [],
      nextCursor: "cursor",
      highWaterCursor: "cursor",
    });
    m.commitPage.mockRejectedValueOnce(
      new GatewayError("transport", "effect_unknown"),
    );
    const maintenance = createProviderUsageGatewayReconciliation(
      {
        $queryRaw: vi.fn().mockResolvedValue([{ workspaceId: "workspace" }]),
      } as unknown as PrismaClient,
      {
        REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN: "http://127.0.0.1:3999",
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER:
          "synthetic-test-only-token",
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: "configured",
      },
    );
    await maintenance.runBatch();
    expect(m.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "native_source_error" }),
    );
  });
  it("does not classify an attribution failure as a Gateway outage", async () => {
    m.claim.mockResolvedValueOnce({
      sourceInstance: "gateway/test/workspace",
      workspaceId: "workspace",
      owner: "poller",
      fence: 1n,
      cursor: null,
      highWaterMark: null,
    } as never);
    m.listUsage.mockResolvedValueOnce({
      observations: [{ executionRef: "execution", requestRef: "request" }],
      nextCursor: "cursor",
      highWaterCursor: "cursor",
    });
    m.findIdentity.mockRejectedValueOnce(
      new GatewayError("transport", "effect_unknown"),
    );
    const maintenance = createProviderUsageGatewayReconciliation(
      {
        $queryRaw: vi.fn().mockResolvedValue([{ workspaceId: "workspace" }]),
      } as unknown as PrismaClient,
      {
        REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN: "http://127.0.0.1:3999",
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER:
          "synthetic-test-only-token",
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: "configured",
      },
    );
    await maintenance.runBatch();
    expect(m.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "native_source_error" }),
    );
  });
});
