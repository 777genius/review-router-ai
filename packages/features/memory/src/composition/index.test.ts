import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryIndexOperationError } from "../application/ports/memory-search-index-port";
import { parseMemorySearchConfig } from "../infrastructure/config/memory-search-config";
import { createMemorySearchRuntime } from "./index";

const receiptStorage = vi.hoisted(() => ({
  assertCompatibleIndexIdentity: vi.fn(),
  retireIndexIdentity: vi.fn(),
  listDue: vi.fn(),
  listOutstanding: vi.fn(),
}));

// Keep real Get Modular factories and the real SDK client constructor. Only the
// borrowed database boundary is replaced in these startup wiring tests.
vi.mock(
  "../infrastructure/prisma/prisma-infinity-memory-projection-store",
  () => ({
    PrismaInfinityMemoryProjectionStore: class {
      assertCompatibleIndexIdentity =
        receiptStorage.assertCompatibleIndexIdentity;
      retireIndexIdentity = receiptStorage.retireIndexIdentity;
      listDue = receiptStorage.listDue;
      listOutstanding = receiptStorage.listOutstanding;
    },
  }),
);

const infinityEnv = {
  REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "infinity",
  REVIEW_ROUTER_MEMORY_ENABLED: "false",
  REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL: "http://127.0.0.1:1",
  REVIEW_ROUTER_MEMORY_INFINITY_API_KEY: "test-service-key",
  REVIEW_ROUTER_MEMORY_INFINITY_SPACE_ID: "space-test",
  REVIEW_ROUTER_MEMORY_INFINITY_MEMORY_SCOPE_ID: "scope-test",
  REVIEW_ROUTER_MEMORY_INFINITY_PROJECTION_GENERATION: "generation-test",
  REVIEW_ROUTER_MEMORY_INFINITY_PROFILE_ID: "profile-test",
  REVIEW_ROUTER_MEMORY_INFINITY_CAPABILITY_FINGERPRINT: "a".repeat(64),
  REVIEW_ROUTER_MEMORY_INFINITY_REQUIRED_PROVIDER_LANES: "lexical,vector",
};

describe("memory search composition", () => {
  const fetchSpy = vi.fn();
  const disconnect = vi.fn();
  // Construction and supports() do not query canonical data. The real Prisma
  // adapter is tested through PostgreSQL in its own contract integration suite.
  const prisma = { $disconnect: disconnect } as unknown as PrismaClient;

  beforeEach(() => {
    receiptStorage.assertCompatibleIndexIdentity
      .mockReset()
      .mockResolvedValue(undefined);
    receiptStorage.retireIndexIdentity.mockReset().mockResolvedValue(undefined);
    receiptStorage.listDue.mockReset().mockResolvedValue([]);
    receiptStorage.listOutstanding.mockReset().mockResolvedValue([]);
    fetchSpy
      .mockReset()
      .mockRejectedValue(new Error("unexpected_startup_http"));
    disconnect.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("constructs the default Prisma capability with guarded no-op maintenance", async () => {
    const runtime = await createMemorySearchRuntime({ prisma, env: {} });
    expect(runtime.searchIndex.indexIdentity).toBe("prisma");
    expect(await runtime.searchIndex.supports()).toEqual({
      capabilities: ["lexical"],
    });
    expect(await runtime.maintenance()).toEqual({
      processed: 0,
      deleted: 0,
      pending: 0,
    });
    expect(await runtime.drain()).toEqual({
      processed: 0,
      deleted: 0,
      pending: 0,
    });
    expect(
      receiptStorage.assertCompatibleIndexIdentity,
    ).toHaveBeenCalledExactlyOnceWith("prisma");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("constructs Infinity without HTTP while memory is disabled, retaining its cleanup path", async () => {
    const config = parseMemorySearchConfig(infinityEnv);
    if (config.kind !== "infinity") throw new Error("expected_infinity_config");
    const runtime = await createMemorySearchRuntime({
      prisma,
      env: infinityEnv,
    });
    expect(runtime.searchIndex.indexIdentity).toBe(config.indexIdentity);
    expect(
      receiptStorage.assertCompatibleIndexIdentity,
    ).toHaveBeenCalledExactlyOnceWith(config.indexIdentity);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await runtime.maintenance({ limit: 3 })).toEqual({
      processed: 0,
      deleted: 0,
      pending: 0,
    });
    expect(await runtime.drain({ limit: 3 })).toEqual({
      processed: 0,
      deleted: 0,
      pending: 0,
    });
    expect(receiptStorage.listDue).toHaveBeenCalledWith(
      expect.objectContaining({
        indexIdentity: config.indexIdentity,
        limit: 3,
      }),
    );
    expect(receiptStorage.listOutstanding).toHaveBeenCalledWith({
      indexIdentity: config.indexIdentity,
      limit: 3,
    });
    expect(receiptStorage.retireIndexIdentity).toHaveBeenCalledExactlyOnceWith(
      config.indexIdentity,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("rejects incomplete explicit configuration before DB admission or HTTP", async () => {
    await expect(
      createMemorySearchRuntime({
        prisma,
        env: { REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "infinity" },
      }),
    ).rejects.toThrow("memory_infinity_base_url_invalid");
    expect(receiptStorage.assertCompatibleIndexIdentity).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([{}, infinityEnv])(
    "refuses a backend switch with outstanding exports",
    async (env) => {
      receiptStorage.assertCompatibleIndexIdentity.mockRejectedValue(
        new MemoryIndexOperationError("memory_index_identity_conflict"),
      );
      await expect(createMemorySearchRuntime({ prisma, env })).rejects.toThrow(
        "memory_index_identity_conflict",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    },
  );

  it("does not surface opaque database errors through startup failures", async () => {
    receiptStorage.assertCompatibleIndexIdentity.mockRejectedValue(
      new Error("credential-sentinel private-body-sentinel"),
    );
    const failure = await createMemorySearchRuntime({ prisma, env: {} }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("memory_search_composition_failed");
    expect((failure as Error).cause).toBeUndefined();
  });
});
