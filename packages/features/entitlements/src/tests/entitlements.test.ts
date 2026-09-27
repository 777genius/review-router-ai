import { describe, expect, it } from "vitest";
import type {
  AuditEventInput,
  AuditLogRepositoryPort,
} from "@reviewrouter/features-audit-log";
import type { EntitlementRepositoryPort } from "../application/ports/entitlement-repository-port";
import { assertWorkspaceFeatureEntitlement } from "../application/use-cases/assert-workspace-feature-entitlement";
import {
  EntitlementDeniedError,
  evaluateFeatureEntitlement,
  freeBetaEntitlement,
  freeBetaLimits,
  type WorkspaceEntitlement,
} from "../domain/entitlement";

class InMemoryEntitlements implements EntitlementRepositoryPort {
  public entitlement: WorkspaceEntitlement | null = null;

  async findWorkspaceEntitlement(): Promise<WorkspaceEntitlement | null> {
    return this.entitlement;
  }

  async upsertWorkspaceEntitlement(
    entitlement: WorkspaceEntitlement,
  ): Promise<void> {
    this.entitlement = entitlement;
  }
}

class InMemoryAuditLog implements AuditLogRepositoryPort {
  public readonly events: AuditEventInput[] = [];

  async append(event: AuditEventInput): Promise<void> {
    this.events.push(event);
  }
}

describe("entitlements", () => {
  it("uses one explicit free beta limit policy", () => {
    expect(freeBetaEntitlement("workspace_1").limits).toEqual({
      maxRepositories: freeBetaLimits.maxRepositories,
      maxWorkspacesPerUser: freeBetaLimits.maxWorkspacesPerUser,
      maxActiveMemoryItemsPerWorkspace:
        freeBetaLimits.maxActiveMemoryItemsPerWorkspace,
      maxPendingMemorySuggestionsPerWorkspace:
        freeBetaLimits.maxPendingMemorySuggestionsPerWorkspace,
    });
    expect(freeBetaLimits.setupPrAttemptsPerRepositoryPerHour).toBeGreaterThan(
      0,
    );
    expect(
      freeBetaLimits.installationSyncsPerInstallationPer15Minutes,
    ).toBeGreaterThan(0);
    expect(freeBetaLimits.reviewConfigSavesPerWorkspacePerHour).toBeGreaterThan(
      0,
    );
  });

  it("allows MVP features on free beta by default", async () => {
    const entitlements = new InMemoryEntitlements();

    await expect(
      assertWorkspaceFeatureEntitlement(
        {
          workspaceId: "workspace_1",
          feature: "workflow_provisioning",
          actor: "system:test",
        },
        { entitlements },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertWorkspaceFeatureEntitlement(
        {
          workspaceId: "workspace_1",
          feature: "balanced_memory",
          actor: "system:test",
        },
        { entitlements },
      ),
    ).resolves.toBeUndefined();
  });

  it("denies future paid features with a clear error and audit", async () => {
    const entitlements = new InMemoryEntitlements();
    const auditLog = new InMemoryAuditLog();

    await expect(
      assertWorkspaceFeatureEntitlement(
        {
          workspaceId: "workspace_1",
          feature: "cloud_review_execution",
          actor: "user:777genius",
        },
        { entitlements, auditLog },
      ),
    ).rejects.toBeInstanceOf(EntitlementDeniedError);
    expect(auditLog.events).toContainEqual(
      expect.objectContaining({
        action: "entitlement.feature_denied",
        targetId: "cloud_review_execution",
      }),
    );
  });

  it("includes hosted account enrollment for free beta workspaces", () => {
    expect(freeBetaEntitlement("workspace_1").flags.hosted_codex_pool).toBe(
      true,
    );
  });

  it("grants hosted enrollment to existing active workspaces with the old false bit", async () => {
    const entitlement = {
      ...freeBetaEntitlement("workspace_1"),
      flags: {
        ...freeBetaEntitlement("workspace_1").flags,
        hosted_codex_pool: false,
      },
    };
    const entitlements = new InMemoryEntitlements();
    entitlements.entitlement = entitlement;

    await expect(
      assertWorkspaceFeatureEntitlement(
        {
          workspaceId: "workspace_1",
          feature: "hosted_codex_pool",
          actor: "user:owner",
        },
        { entitlements },
      ),
    ).resolves.toBeUndefined();
    expect(
      evaluateFeatureEntitlement({
        entitlement: { ...entitlement, status: "paused" },
        feature: "hosted_codex_pool",
      }),
    ).toEqual({ allowed: false, reason: "workspace_entitlement_not_active" });
  });

  it("denies inactive workspace entitlements", async () => {
    const entitlements = new InMemoryEntitlements();
    entitlements.entitlement = {
      ...freeBetaEntitlement("workspace_1"),
      status: "paused",
    };

    await expect(
      assertWorkspaceFeatureEntitlement(
        {
          workspaceId: "workspace_1",
          feature: "repository_dashboard",
          actor: "user:777genius",
        },
        { entitlements },
      ),
    ).rejects.toThrow("workspace_entitlement_not_active");
  });
});
