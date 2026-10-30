import { describe, expect, it } from "vitest";
import {
  freeBetaEntitlement,
  type EntitlementRepositoryPort,
  type WorkspaceEntitlement,
} from "@reviewrouter/features-entitlements";
import { EntitlementMemoryPolicyConfig } from "../infrastructure/entitlements/entitlement-memory-policy-config";
import { readMemoryServiceEnabled } from "../infrastructure/config/memory-service-flag";

class InMemoryEntitlements implements EntitlementRepositoryPort {
  constructor(private readonly entitlement: WorkspaceEntitlement | null) {}

  async findWorkspaceEntitlement(
    workspaceId: string,
  ): Promise<WorkspaceEntitlement | null> {
    if (this.entitlement?.workspaceId !== workspaceId) return null;
    return this.entitlement;
  }

  async upsertWorkspaceEntitlement(): Promise<void> {
    throw new Error("not_supported");
  }
}

describe("memory policy config", () => {
  it("keeps memory enabled for free beta fallback workspaces", async () => {
    const config = new EntitlementMemoryPolicyConfig(
      new InMemoryEntitlements(null),
    );

    await expect(
      config.getPolicy({ workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      memoryEnabled: true,
      requireConfirmation: false,
      settingsRevision: "0",
    });
  });

  it("reads one fresh workspace setting for every repository without re-enabling disabled memory", async () => {
    let version = 1;
    let required = true;
    const workspaceSettings = async (workspaceId: string) => ({
      requireConfirmation: workspaceId === "workspace_1" && required,
      version: workspaceId === "workspace_1" ? version : null,
    });
    const config = new EntitlementMemoryPolicyConfig(
      new InMemoryEntitlements(null),
      {
        workspaceSettings,
      },
    );
    for (const repositoryId of ["repo_a", "repo_b"])
      await expect(
        config.getPolicy({ workspaceId: "workspace_1", repositoryId }),
      ).resolves.toMatchObject({
        requireConfirmation: true,
        settingsRevision: "1",
      });
    await expect(
      config.getPolicy({ workspaceId: "workspace_2" }),
    ).resolves.toMatchObject({
      requireConfirmation: false,
      settingsRevision: "0",
    });
    version++;
    required = false;
    await expect(
      config.getPolicy({ workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({
      requireConfirmation: false,
      settingsRevision: "2",
    });
    const disabled = new EntitlementMemoryPolicyConfig(
      new InMemoryEntitlements(null),
      {
        workspaceSettings,
        serviceEnabled: false,
      },
    );
    expect(
      (await disabled.getPolicy({ workspaceId: "workspace_1" })).memoryEnabled,
    ).toBe(false);
  });

  it("disables memory when the service kill switch is off", async () => {
    const config = new EntitlementMemoryPolicyConfig(
      new InMemoryEntitlements(freeBetaEntitlement("workspace_1")),
      { serviceEnabled: false },
    );

    await expect(
      config.getPolicy({ workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({ memoryEnabled: false });
  });

  it("disables memory for inactive workspace entitlements", async () => {
    const config = new EntitlementMemoryPolicyConfig(
      new InMemoryEntitlements({
        ...freeBetaEntitlement("workspace_1"),
        status: "paused",
      }),
    );

    await expect(
      config.getPolicy({ workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({ memoryEnabled: false });
  });

  it("disables memory when the workspace balanced_memory flag is off", async () => {
    const entitlement = freeBetaEntitlement("workspace_1");
    const config = new EntitlementMemoryPolicyConfig(
      new InMemoryEntitlements({
        ...entitlement,
        flags: { ...entitlement.flags, balanced_memory: false },
      }),
    );

    await expect(
      config.getPolicy({ workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({ memoryEnabled: false });
  });

  it("parses service-level memory flags without reading process.env in use cases", () => {
    expect(readMemoryServiceEnabled({})).toBe(true);
    expect(
      readMemoryServiceEnabled({ REVIEW_ROUTER_MEMORY_ENABLED: "0" }),
    ).toBe(false);
    expect(
      readMemoryServiceEnabled({ REVIEW_ROUTER_MEMORY_ENABLED: "false" }),
    ).toBe(false);
    expect(
      readMemoryServiceEnabled({ REVIEW_ROUTER_MEMORY_ENABLED: "true" }),
    ).toBe(true);
    expect(
      readMemoryServiceEnabled({ REVIEW_ROUTER_DISABLE_MEMORY: "1" }),
    ).toBe(false);
    expect(
      readMemoryServiceEnabled({ REVIEW_ROUTER_DISABLE_MEMORY: "true" }),
    ).toBe(false);
    expect(
      readMemoryServiceEnabled({ REVIEW_ROUTER_DISABLE_MEMORY: "0" }),
    ).toBe(true);
  });
});
