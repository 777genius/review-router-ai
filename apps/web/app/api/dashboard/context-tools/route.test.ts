import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  saveDashboardContextConnection: vi.fn(),
}));

vi.mock("../../../../src/server/context-tools", () => ({
  listDashboardContextConnections: vi.fn(),
  saveDashboardContextConnection: mocks.saveDashboardContextConnection,
  contextToolsPublicError: () => ({
    error: "context_tools_unavailable",
    status: 503,
  }),
}));

const publicOrigin = "https://reviewrouter.org";
const internalUrl = "http://0.0.0.0:3000/api/dashboard/context-tools";
const input = {
  workspaceId: "workspace_1",
  expectedVersion: null,
  definition: {
    id: "test_mcp",
    url: "https://mcp.example.test/mcp",
    headers: { Authorization: "Bearer {{ secrets.DOCS_KEY }}" },
    tools: ["search_docs"],
    credentials: { DOCS_KEY: { source: "dashboard-secret" } },
  },
  enabled: true,
  secrets: { DOCS_KEY: "test-secret" },
};
const connection = { id: "test_mcp", version: 1 };

function request(
  origin: string | undefined,
  url = internalUrl,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin === undefined ? {} : { origin }),
      ...extraHeaders,
    },
    body: JSON.stringify(input),
  });
}

describe("POST /api/dashboard/context-tools origin guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REVIEW_ROUTER_PUBLIC_WEB_URL", undefined);
    vi.stubEnv("REVIEW_ROUTER_WEB_URL", publicOrigin);
    vi.stubEnv("NEXTAUTH_URL", undefined);
    // The application boundary owns authorization, validation and persistence.
    mocks.saveDashboardContextConnection.mockResolvedValue(connection);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("allows the configured public HTTPS origin behind an internal HTTP proxy URL", async () => {
    const response = await POST(request(publicOrigin));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connection });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      mocks.saveDashboardContextConnection,
    ).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each(["REVIEW_ROUTER_PUBLIC_WEB_URL", "NEXTAUTH_URL"])(
    "uses the public origin configured through %s",
    async (name) => {
      vi.stubEnv("REVIEW_ROUTER_WEB_URL", undefined);
      vi.stubEnv(name, publicOrigin);

      const response = await POST(request(publicOrigin));

      expect(response.status).toBe(200);
      expect(mocks.saveDashboardContextConnection).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "https://attacker.example",
    "https://reviewrouter.org.attacker.example",
    "null",
    "http://0.0.0.0:3000",
  ])("rejects hostile origin %s before saving", async (origin) => {
    const response = await POST(request(origin));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "context_admin_required",
    });
    expect(mocks.saveDashboardContextConnection).not.toHaveBeenCalled();
  });

  it("does not trust a forged forwarded host or request host", async () => {
    const origin = "https://attacker.example";
    const response = await POST(
      request(origin, `${origin}/api/dashboard/context-tools`, {
        host: "attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
        forwarded: 'host="attacker.example";proto=https',
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.saveDashboardContextConnection).not.toHaveBeenCalled();
  });

  it.each([undefined, "not-a-url", "https://localhost:3000"])(
    "fails closed for missing or malformed production public URL %s",
    async (value) => {
      vi.stubEnv("REVIEW_ROUTER_WEB_URL", value);

      const response = await POST(
        request(publicOrigin, `${publicOrigin}/api/dashboard/context-tools`),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "context_tools_unavailable",
      });
      expect(mocks.saveDashboardContextConnection).not.toHaveBeenCalled();
    },
  );

  it("retains local same-origin requests on the current development port", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REVIEW_ROUTER_WEB_URL", undefined);
    const origin = "http://localhost:4567";

    const response = await POST(
      request(origin, `${origin}/api/dashboard/context-tools`),
    );

    expect(response.status).toBe(200);
    expect(mocks.saveDashboardContextConnection).toHaveBeenCalledOnce();
  });

  it("retains requests without Origin and delegates them to the application boundary", async () => {
    vi.stubEnv("REVIEW_ROUTER_WEB_URL", undefined);

    const response = await POST(request(undefined));

    expect(response.status).toBe(200);
    expect(
      mocks.saveDashboardContextConnection,
    ).toHaveBeenCalledExactlyOnceWith(input);
  });
});
