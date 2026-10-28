import { describe, expect, it, vi } from "vitest";
import { hostedDeviceLoginId, workspaceId } from "../../domain/identifiers";
import { PrismaHostedCodexDeviceLoginStore } from "./prisma-hosted-codex-device-login-store";

const now = new Date("2026-09-14T12:00:00.000Z");

describe("PrismaHostedCodexDeviceLoginStore", () => {
  it("roundtrips the selected CAS terms above the SQL integer range", async () => {
    type Client = ConstructorParameters<
      typeof PrismaHostedCodexDeviceLoginStore
    >[0];
    type Row = Parameters<
      Client["hostedCodexDeviceLogin"]["create"]
    >[0]["data"];
    let saved: Row | null = null;
    const store = new PrismaHostedCodexDeviceLoginStore({
      hostedCodexDeviceLogin: {
        create: async ({ data }) => {
          saved = data;
        },
        findFirst: async () => saved,
        findUnique: async () => saved,
        updateMany: async () => ({ count: 0 }),
      },
    });
    const reconnectTarget = {
      accountId: "selected-account",
      expectedGeneration: 2 ** 31 + 1,
      expectedHealthVersion: 2 ** 31 + 9,
    };
    await store.createPending({
      id: hostedDeviceLoginId("login-1"),
      workspaceId: workspaceId("workspace-1"),
      actor: "user:owner",
      label: "Primary",
      priority: 10,
      reconnectTarget,
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
      deviceAuthId: "fixture-device",
      status: "pending",
      expiresAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(
      (await store.findById(hostedDeviceLoginId("login-1")))?.reconnectTarget,
    ).toEqual(reconnectTarget);
  });

  it("maps a unique pending conflict to one-flight", async () => {
    const prisma = {
      hostedCodexDeviceLogin: {
        create: vi.fn(async () => {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const store = new PrismaHostedCodexDeviceLoginStore(prisma);
    await expect(
      store.createPending({
        id: hostedDeviceLoginId("login-1"),
        workspaceId: workspaceId("workspace-1"),
        actor: "user:owner",
        label: "Primary",
        priority: 10,
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/codex/device",
        deviceAuthId: "device-auth-secret",
        status: "pending",
        expiresAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow("hosted_pool_device_login_in_flight");
  });

  it("nulls deviceAuthId when marking a flight terminal", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const store = new PrismaHostedCodexDeviceLoginStore({
      hostedCodexDeviceLogin: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        updateMany,
      },
    });
    await expect(
      store.markTerminal({
        id: hostedDeviceLoginId("login-1"),
        expectedStatus: "pending",
        status: "imported",
        now,
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "login-1", status: "pending" },
      data: {
        status: "imported",
        deviceAuthId: null,
        updatedAt: now,
      },
    });
  });
});
