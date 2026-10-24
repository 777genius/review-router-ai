import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../../src/server/dashboard-mutations", () => ({
  assertDashboardMutationAllowed: mocks.authorize,
  dashboardMutationAccessAuditMetadata: () => ({}),
}));
vi.mock("../../src/server/prisma", () => ({
  getPrisma: () => ({ workspace: { update: mocks.update } }),
}));
vi.mock("@reviewrouter/features-audit-log", () => ({
  recordAuditEvent: mocks.audit,
  PrismaAuditLogRepository: class {},
}));
import { saveWorkspaceOtherSettingsClientAction } from "./other-settings-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ actor: "user:owner" });
  mocks.update.mockResolvedValue({});
  mocks.audit.mockResolvedValue(undefined);
});

describe("workspace Other settings authority", () => {
  it.each([true, false])(
    "persists selected workspace draft review = %s",
    async (enabled) => {
      const form = new FormData();
      form.set("workspaceId", "workspace-selected");
      if (enabled) form.set("reviewDraftPullRequests", "on");
      await expect(
        saveWorkspaceOtherSettingsClientAction(form),
      ).resolves.toEqual({
        params: {
          workspace: "workspace-selected",
          section: "other",
          notice: "workspace_review_settings_saved",
        },
      });
      expect(mocks.authorize).toHaveBeenCalledWith("workspace-selected");
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: "workspace-selected" },
        data: { reviewDraftPullRequests: enabled },
      });
    },
  );

  it("rejects unauthorized writes before persistence or audit", async () => {
    mocks.authorize.mockRejectedValueOnce(
      new Error("workspace_mutation_forbidden:insufficient_role"),
    );
    const form = new FormData();
    form.set("workspaceId", "workspace-other");
    await expect(
      saveWorkspaceOtherSettingsClientAction(form),
    ).resolves.toMatchObject({
      params: { section: "other", error: "workspace_mutation_forbidden" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
