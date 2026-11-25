import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  scope: "scope",
  sharing: {
    listAccessSummaries: vi.fn(async () => ({
      status: "ok",
      value: { summaries: [] },
    })),
    listOwnGrants: vi.fn(async () => ({
      status: "ok",
      value: { grants: [], nextCursor: null },
    })),
    listEligibleOrganizations: vi.fn(async () => ({
      status: "ok",
      value: { organizations: [], nextCursor: null },
    })),
  },
  service: vi.fn(),
}));
vi.mock("../../../../../src/server/personal-account-composition", () => ({
  productionPersonalAccounts: fixture.service,
}));
vi.mock("../../../../../src/server/account-lifecycle-composition", () => ({
  productionAccountLifecycle: async () => ({
    read: async () => ({
      operationId: "original",
      phase: "unknown",
      closureComplete: false,
    }),
    readByNonce: async () => ({
      operationId: "original",
      phase: "unknown",
      closureComplete: false,
    }),
  }),
}));
import { GET } from "./route";
function request(view: string, input: unknown, context = "scope") {
  return new Request(
    `https://test.invalid/api/dashboard/accounts/access?${new URLSearchParams({ context, view, request: JSON.stringify(input) })}`,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.service.mockResolvedValue({
    scope: fixture.scope,
    sharing: fixture.sharing,
  });
});
describe("private GET account access projection", () => {
  it("provides observational lifecycle readback through GET", async () => {
    const result = await GET(
      request("lifecycle", {
        workspaceId: "workspace",
        operationId: "original",
      }),
    );
    expect(await result.json()).toMatchObject({
      status: "ok",
      value: {
        operationId: "original",
        phase: "unknown",
        closureComplete: false,
      },
    });
    expect(result.headers.get("Cache-Control")).toContain("no-store");
  });
  it("reads grants without mutation and forbids HTTP caching", async () => {
    const response = await GET(
      request("grants", { sourceId: "source", limit: 25 }),
    );
    expect(await response.json()).toMatchObject({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(fixture.sharing.listOwnGrants).toHaveBeenCalledWith({
      sourceId: "source",
      limit: 25,
    });
    expect(fixture.service).toHaveBeenCalledTimes(2);
  });
  it("does not read with a foreign actor context or an unbounded request", async () => {
    expect(
      await (
        await GET(
          request("grants", { sourceId: "source", limit: 25 }, "foreign"),
        )
      ).json(),
    ).toEqual({ status: "denied" });
    expect(
      await (
        await GET(request("grants", { sourceId: "source", limit: 101 }))
      ).json(),
    ).toEqual({ status: "invalid" });
    expect(fixture.sharing.listOwnGrants).not.toHaveBeenCalled();
  });
  it("discards a safe read if the signed actor context changes while awaiting it", async () => {
    fixture.service
      .mockResolvedValueOnce({ scope: "scope", sharing: fixture.sharing })
      .mockResolvedValueOnce({
        scope: "other-actor",
        sharing: fixture.sharing,
      });
    expect(
      await (await GET(request("summaries", { sourceIds: ["source"] }))).json(),
    ).toEqual({ status: "denied" });
  });
});
