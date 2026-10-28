import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getPrisma: vi.fn(),
  memoryActor: vi.fn(),
  memoryDependencies: vi.fn(),
  mutateMemory: vi.fn(),
  entitlement: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn<(target: string) => never>(() => {
    throw new Error("paused-action-redirect");
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../src/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("../../src/server/dashboard-mutations", () => ({
  assertDashboardMutationAllowed: mocks.authenticate,
  asDashboardGitHubActor: vi.fn(),
  assertDashboardRepositoryConfigMutationAllowed: vi.fn(),
  assertDashboardRepositoryMutationAllowed: vi.fn(),
  createGitHubAppInstallationOctokit: vi.fn(),
  createGitHubUserOctokit: vi.fn(),
  dashboardMutationAccessAuditMetadata: vi.fn(),
  getDashboardSignedInActor: vi.fn(),
  getDashboardWorkspaceScope: vi.fn(),
}));
vi.mock("@reviewrouter/features-audit-log", () => ({
  recordAuditEvent: mocks.audit,
  PrismaAuditLogRepository: class {},
}));
vi.mock("@reviewrouter/features-entitlements", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@reviewrouter/features-entitlements")
  >()),
  assertWorkspaceFeatureEntitlement: mocks.entitlement,
}));

import {
  confirmMemorySuggestionAction,
  confirmMemorySuggestionClientAction,
  createMemoryItemAction,
  createMemoryItemClientAction,
  deleteMemoryItemAction,
  deleteMemoryItemClientAction,
  disableMemoryItemAction,
  disableMemoryItemClientAction,
  editMemoryItemAction,
  editMemoryItemClientAction,
  rejectMemorySuggestionAction,
  rejectMemorySuggestionClientAction,
} from "./actions";

const staleActions = [
  ["create", createMemoryItemAction, createMemoryItemClientAction],
  [
    "confirm",
    confirmMemorySuggestionAction,
    confirmMemorySuggestionClientAction,
  ],
  ["reject", rejectMemorySuggestionAction, rejectMemorySuggestionClientAction],
  ["edit", editMemoryItemAction, editMemoryItemClientAction],
  ["disable", disableMemoryItemAction, disableMemoryItemClientAction],
  ["delete", deleteMemoryItemAction, deleteMemoryItemClientAction],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockReset().mockResolvedValue({ actor: "github:owner" });
});

function staleForm() {
  const form = new FormData();
  form.set("workspaceId", "workspace-a");
  form.set("body", "untrusted-stale-body");
  const read = form.get.bind(form);
  const get = vi.spyOn(form, "get").mockImplementation((name) => {
    if (name !== "workspaceId") throw new Error("body-must-not-be-read");
    return read(name);
  });
  return { form, get };
}

function expectNoMemorySideEffects() {
  for (const spy of [
    mocks.getPrisma,
    mocks.memoryActor,
    mocks.memoryDependencies,
    mocks.mutateMemory,
    mocks.entitlement,
    mocks.audit,
    mocks.revalidate,
  ]) {
    expect(spy).not.toHaveBeenCalled();
  }
}

describe.each(staleActions)(
  "paused dashboard %s action",
  (_, server, client) => {
    it("authenticates stale client calls before refusing them without memory IO", async () => {
      const { form, get } = staleForm();
      expect(await client(form)).toEqual({
        params: {
          workspace: "workspace-a",
          section: "memory",
          error: "memory_dashboard_in_development",
        },
      });
      expect(mocks.authenticate).toHaveBeenCalledExactlyOnceWith("workspace-a");
      expect(get).toHaveBeenCalledExactlyOnceWith("workspaceId");
      expectNoMemorySideEffects();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("refuses stale server submissions without revalidation or a success redirect", async () => {
      const { form, get } = staleForm();
      await expect(server(form)).rejects.toThrow("paused-action-redirect");
      expect(mocks.authenticate).toHaveBeenCalledExactlyOnceWith("workspace-a");
      expect(get).toHaveBeenCalledExactlyOnceWith("workspaceId");
      const target = new URL(
        mocks.redirect.mock.calls[0]![0],
        "https://router.test",
      );
      expect(target.pathname).toBe("/dashboard");
      expect(Object.fromEntries(target.searchParams)).toEqual({
        workspace: "workspace-a",
        section: "memory",
        error: "memory_dashboard_in_development",
      });
      expectNoMemorySideEffects();
    });

    it.each([
      [
        "dashboard_mutation_requires_sign_in",
        "dashboard_mutation_requires_sign_in",
      ],
      [
        "workspace_mutation_forbidden:private-detail",
        "workspace_mutation_forbidden",
      ],
    ])(
      "preserves %s for both stale entrypoints",
      async (rejection, expected) => {
        mocks.authenticate.mockRejectedValue(new Error(rejection));
        const { form, get } = staleForm();
        expect(await client(form)).toEqual({
          params: {
            workspace: "workspace-a",
            section: "memory",
            error: expected,
          },
        });
        await expect(server(form)).rejects.toThrow("paused-action-redirect");
        expect(mocks.authenticate).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenCalledTimes(2);
        const target = new URL(
          mocks.redirect.mock.calls[0]![0],
          "https://router.test",
        );
        expect(target.searchParams.get("error")).toBe(expected);
        expect(target.href).not.toContain("private-detail");
        expectNoMemorySideEffects();
      },
    );
  },
);
