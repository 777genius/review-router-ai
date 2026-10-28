import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  changeAccessRights: vi.fn(),
}));
vi.mock("../../src/server/dashboard-mutations", () => ({
  assertDashboardMutationAllowed: mocks.authorize,
  dashboardMutationAccessAuditMetadata: () => ({}),
}));
vi.mock(
  "../../src/server/dashboard-provider-selections",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/server/dashboard-provider-selections")
    >()),
    dashboardProviderProfiles: () => ({
      changeAccessRights: mocks.changeAccessRights,
    }),
  }),
);
vi.mock("../../src/server/prisma", () => ({
  getPrisma: () => ({ workspace: { update: mocks.update } }),
}));
vi.mock("@reviewrouter/features-audit-log", () => ({
  recordAuditEvent: mocks.audit,
  PrismaAuditLogRepository: class {},
}));
import {
  saveWorkspaceAccessRightsClientAction,
  saveWorkspaceOtherSettingsClientAction,
} from "./other-settings-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    userId: "user-owner",
    actor: "user:owner",
    githubLogin: "owner",
  });
  mocks.changeAccessRights.mockImplementation(
    async (input: { readonly adminOnly: boolean }) => ({
      adminOnly: input.adminOnly,
      previous: !input.adminOnly,
    }),
  );
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

describe("workspace Access rights authority", () => {
  it.each([true, false])(
    "persists only the Access rights column = %s",
    async (adminOnly) => {
      const form = new FormData();
      form.set("workspaceId", "workspace-selected");
      if (adminOnly) form.set("providerManagementAdminOnly", "on");
      // A stale draft review field in the same form never reaches storage.
      form.set("reviewDraftPullRequests", "on");
      await expect(
        saveWorkspaceAccessRightsClientAction(form),
      ).resolves.toEqual({
        params: {
          workspace: "workspace-selected",
          section: "other",
          notice: "workspace_access_rights_saved",
        },
      });
      expect(mocks.authorize).toHaveBeenCalledWith("workspace-selected");
      // The provider write decides, writes and audits in one transaction.
      expect(mocks.changeAccessRights).toHaveBeenCalledExactlyOnceWith({
        workspaceId: "workspace-selected",
        actor: expect.objectContaining({
          userId: "user-owner",
          auditActor: "user:owner",
        }),
        adminOnly,
        auditMetadata: {},
        authorize: expect.any(Function),
      });
      const { authorize } = mocks.changeAccessRights.mock.calls[0]![0];
      const workspace = {
        personalOwnerUserId: null,
        providerManagementAdminOnly: false,
      };
      expect(() =>
        authorize({ actor: { userId: "u", role: "member" }, workspace }),
      ).toThrow("provider_management_forbidden:workspace_admin_required");
      expect(() =>
        authorize({ actor: { userId: "u", role: "admin" }, workspace }),
      ).not.toThrow();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it("rejects members before persistence or audit", async () => {
    mocks.authorize.mockRejectedValueOnce(
      new Error("workspace_mutation_forbidden:insufficient_role"),
    );
    const form = new FormData();
    form.set("workspaceId", "workspace-other");
    form.set("providerManagementAdminOnly", "on");
    await expect(
      saveWorkspaceAccessRightsClientAction(form),
    ).resolves.toMatchObject({
      params: { section: "other", error: "workspace_mutation_forbidden" },
    });
    expect(mocks.changeAccessRights).not.toHaveBeenCalled();
  });
});
