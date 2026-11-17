import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  load: vi.fn(),
}));

vi.mock("../../../../src/server/dashboard-mutations", () => ({
  getDashboardSignedInActor: mocks.actor,
}));
vi.mock("../../../../src/server/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("../../../../src/server/provider-list-view", () => ({
  loadProviderListView: mocks.load,
}));

const request = (query: string) =>
  new NextRequest(`http://localhost/api/dashboard/provider-list${query}`);

describe("GET /api/dashboard/provider-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ actor: "user:member" });
  });

  // Membership itself is decided by loadProviderListView (its own tests).
  it("requires a sign-in and turns the loader's refusal into 403", async () => {
    mocks.actor.mockResolvedValueOnce(null);
    expect((await GET(request("?workspace=workspace_1"))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();

    mocks.load.mockResolvedValueOnce(null);
    const refused = await GET(request("?workspace=workspace_2"));
    expect(refused.status).toBe(403);
    await expect(refused.json()).resolves.toEqual({
      error: "provider_list_forbidden",
    });

    const view = { workspaceId: "workspace_1", readAt: 1, rows: [] };
    mocks.load.mockResolvedValueOnce(view);
    const served = await GET(request("?workspace=workspace_1"));
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    await expect(served.json()).resolves.toEqual(view);
    expect(mocks.actor).toHaveBeenLastCalledWith({ readOnly: true });
    expect(mocks.load).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        actor: { actor: "user:member" },
      }),
    );
  });
});
