import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryKnowledgeAccessPort } from "../application/ports/memory-knowledge-access-port";
import { MemoryKnowledgeError } from "../domain/memory-knowledge";
import { HINDSIGHT_MEMORY_PROFILE } from "../infrastructure/config/memory-provider-config";
import { createMemoryKnowledgeRuntime } from "./memory-knowledge-runtime";

const hindsightEnv = {
  REVIEW_ROUTER_MEMORY_PROVIDER: "hindsight",
  REVIEW_ROUTER_MEMORY_GENERATION: "composition-test",
  REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: HINDSIGHT_MEMORY_PROFILE,
  REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://127.0.0.1:1",
  REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY: "test-native-key",
  REVIEW_ROUTER_MEMORY_NAMESPACE: "composition-test",
};

describe("complete memory runtime composition", () => {
  const fetchSpy = vi.fn();
  const query = vi.fn();
  const disconnect = vi.fn();
  const prisma = {
    $queryRaw: query,
    $disconnect: disconnect,
  } as unknown as PrismaClient;

  beforeEach(() => {
    fetchSpy
      .mockReset()
      .mockRejectedValue(new Error("unexpected_startup_http"));
    query
      .mockReset()
      .mockRejectedValue(new Error("unexpected_startup_database"));
    disconnect.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("constructs the disabled default without native or database I/O", async () => {
    const runtime = await createMemoryKnowledgeRuntime({ prisma, env: {} });
    expect(runtime.enabled).toBe(false);
    expect(runtime.generation).toBe("memory-v1");
    expect(runtime.cleanupProof).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it.each(["true", "false"])(
    "composes the selected provider without I/O when service enabled=%s",
    async (enabled) => {
      const runtime = await createMemoryKnowledgeRuntime({
        prisma,
        env: { ...hindsightEnv, REVIEW_ROUTER_MEMORY_ENABLED: enabled },
      });
      expect(runtime.enabled).toBe(enabled === "true");
      expect(runtime.generation).toBe("composition-test");
      expect(runtime.providerProfileVersion).toBe(HINDSIGHT_MEMORY_PROFILE);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    },
  );

  it("keeps authenticated access contexts separate before scoped reads reach storage", async () => {
    const runtime = await createMemoryKnowledgeRuntime({
      prisma,
      env: hindsightEnv,
    });
    const denied = (): MemoryKnowledgeAccessPort => ({
      authorize: vi.fn(async () => {
        throw new MemoryKnowledgeError("forbidden");
      }),
      verifySource: vi.fn(),
      sourceApplicable: vi.fn(),
    });
    const first = denied();
    const second = denied();
    const actor = {
      kind: "workspace_user" as const,
      id: "user",
      githubUserId: null,
      login: null,
    };
    const scope = {
      kind: "repository" as const,
      workspaceId: "workspace",
      repositoryId: "repository",
    };
    const controls = { deadlineAt: new Date(Date.now() + 10_000) };
    await expect(
      runtime
        .forAccess(first)
        .read(
          { actor, ref: { type: "entry", scope, entryId: "entry" } },
          controls,
        ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(first.authorize).toHaveBeenCalledExactlyOnceWith(
      { actor, scope, action: "read" },
      controls,
    );
    expect(second.authorize).not.toHaveBeenCalled();
    const otherScope = { ...scope, repositoryId: "other" };
    await expect(
      runtime.forAccess(second).read(
        {
          actor,
          ref: { type: "entry", scope: otherScope, entryId: "entry" },
        },
        controls,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(second.authorize).toHaveBeenCalledExactlyOnceWith(
      { actor, scope: otherScope, action: "read" },
      controls,
    );
    expect(first.authorize).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects incomplete explicit native configuration before composition or I/O", async () => {
    await expect(
      createMemoryKnowledgeRuntime({
        prisma,
        env: { REVIEW_ROUTER_MEMORY_PROVIDER: "hindsight" },
      }),
    ).rejects.toThrow("memory_provider_url_invalid");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
