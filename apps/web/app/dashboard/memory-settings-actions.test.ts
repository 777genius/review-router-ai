import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), save: vi.fn() }));
vi.mock("@reviewrouter/features-review-config", async (original) => ({
  ...(await original<typeof import("@reviewrouter/features-review-config")>()),
  saveWorkspaceMemorySettings: mocks.save,
}));
vi.mock("../../src/server/dashboard-mutations", () => ({
  assertDashboardMutationAllowed: mocks.authorize,
}));
vi.mock("../../src/server/dashboard-provider-selections", () => ({
  dashboardProviderActor: (actor: unknown) => actor,
  dashboardReviewConfigurations: () => ({}),
}));
vi.mock("../../src/server/prisma", () => ({ getPrisma: () => ({}) }));
import { saveWorkspaceMemorySettingsClientAction } from "./memory-settings-actions";

function form(enabled: boolean) {
  const data = new FormData();
  data.set("workspaceId", "workspace-selected");
  data.set("expectedVersion", "7");
  if (enabled) data.set("requireConfirmation", "on");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ userId: "owner", actor: "user:owner" });
  mocks.save.mockResolvedValue({ version: 8 });
});
describe("Memory settings server action", () => {
  it.each([true, false])(
    "saves the explicit workspace setting %s with its CAS",
    async (enabled) => {
      await expect(
        saveWorkspaceMemorySettingsClientAction(form(enabled)),
      ).resolves.toEqual({
        params: {
          workspace: "workspace-selected",
          section: "memory",
          notice: "workspace_memory_settings_saved",
        },
      });
      expect(mocks.authorize).toHaveBeenCalledWith("workspace-selected");
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-selected",
          requireConfirmation: enabled,
          expectedVersion: 7,
        }),
        expect.anything(),
      );
    },
  );
  it("refuses a non-admin before saving and returns safe stale-form feedback", async () => {
    mocks.authorize.mockRejectedValueOnce(
      new Error("workspace_mutation_forbidden:insufficient_role"),
    );
    await expect(
      saveWorkspaceMemorySettingsClientAction(form(true)),
    ).resolves.toMatchObject({
      params: { error: "workspace_mutation_forbidden" },
    });
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockRejectedValueOnce(
      new Error("review_configuration_write_conflict"),
    );
    await expect(
      saveWorkspaceMemorySettingsClientAction(form(false)),
    ).resolves.toMatchObject({
      params: { section: "memory", error: "dashboard_action_stale" },
    });
  });
  it.each(["duplicate", "repository", "missing-version", "invalid-checkbox"])(
    "rejects %s instead of broadening or guessing the write",
    async (kind) => {
      const input = form(false);
      if (kind === "duplicate") input.append("workspaceId", "workspace-other");
      if (kind === "repository") input.set("repositoryId", "repo-one");
      if (kind === "missing-version") input.delete("expectedVersion");
      if (kind === "invalid-checkbox")
        input.set("requireConfirmation", "false");
      await expect(
        saveWorkspaceMemorySettingsClientAction(input),
      ).resolves.toMatchObject({ params: { error: "invalid_form" } });
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );
});
