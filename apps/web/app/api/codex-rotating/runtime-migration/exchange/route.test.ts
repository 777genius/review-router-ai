import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), prisma: {} }));
vi.mock("../../../../../src/server/prisma", () => ({
  getPrisma: () => mocks.prisma,
}));
vi.mock(
  "../../../../../src/server/codex-runtime-migration-composition",
  () => ({ exchangeConfiguredCodexRuntimeMigration: mocks.exchange }),
);
import { POST } from "./route";

describe("runtime migration bounded exchange transport", () => {
  beforeEach(() => vi.clearAllMocks());
  it("cancels an oversized chunked body and preserves its nondisclosing error", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1025));
      },
      cancel,
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { authorization: "Bearer fixture-oidc" },
      body,
      duplex: "half",
    };
    const response = await POST(
      new Request(
        "https://reviewrouter.org/api/codex-rotating/runtime-migration/exchange",
        init,
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "codex_runtime_migration_unavailable",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("passes a valid small exchange through unchanged", async () => {
    const migrationId = "codex_migration_11111111-1111-4111-8111-111111111111";
    mocks.exchange.mockResolvedValue({ status: "accepted" });
    const response = await POST(
      new Request(
        "https://reviewrouter.org/api/codex-rotating/runtime-migration/exchange",
        {
          method: "POST",
          headers: { authorization: "Bearer fixture-oidc" },
          body: JSON.stringify({ migrationId }),
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith({
      prisma: mocks.prisma,
      migrationId,
      oidcToken: "fixture-oidc",
    });
  });
});
