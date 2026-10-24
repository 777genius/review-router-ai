// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProviderListView,
  type ProviderListFacts,
} from "../../../src/features/provider-setup/provider-list-model";
import { updateProviderProfileAction } from "../provider-setup-actions";
import { ProviderList } from "./provider-list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../actions", () => ({
  checkProviderRepositorySecretClientAction: vi.fn(),
}));
vi.mock("../provider-setup-actions", () => ({
  archiveProviderProfileAction: vi.fn(),
  clearWorkspaceDefaultProviderAction: vi.fn(),
  createProviderProfileAction: vi.fn(),
  inheritWorkspaceDefaultProviderAction: vi.fn(),
  saveProviderSetupAction: vi.fn(),
  updateProviderProfileAction: vi.fn(),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const facts = (
  overrides: Partial<ProviderListFacts> = {},
): ProviderListFacts => ({
  workspaceId: "workspace_1",
  actor: { userId: "user_member", role: "member" },
  workspace: { personalOwnerUserId: null, providerManagementAdminOnly: false },
  profiles: [
    {
      id: "team",
      label: "Team ChatGPT",
      model: "gpt-5.6-sol",
      authMode: "claude_code_oauth",
      credentialKind: "user_ci_secret",
      createdByUserId: "user_owner",
      gatewayBindingId: null,
      personalBinding: false,
      rotatingRepositoryId: null,
    },
    {
      id: "mine",
      label: "My Claude",
      model: "opus",
      authMode: "claude_code_oauth",
      credentialKind: "user_ci_secret",
      createdByUserId: "user_member",
      gatewayBindingId: null,
      personalBinding: false,
      rotatingRepositoryId: null,
    },
  ],
  defaultProfileId: "team",
  usage: [
    { profileId: "team", workspaceDefault: true, repositoryIds: [] },
    { profileId: "mine", workspaceDefault: false, repositoryIds: ["repo_a"] },
  ],
  repositoryNames: new Map([["repo_a", "acme/web"]]),
  creators: new Map([["user_owner", { login: "owner", member: true }]]),
  accounts: new Map(),
  ...overrides,
});

function renderList(input: Partial<ProviderListFacts> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProviderList
        view={buildProviderListView(facts(input))}
        mutationsEnabled
        modelOptions={[
          { value: "opus", label: "opus", provider: "claude" },
          { value: "sonnet", label: "sonnet", provider: "claude" },
        ]}
        gatewayAccounts={undefined}
        agentProfileOptions={[]}
        accessRightsHref="/dashboard?section=other"
      />
    </QueryClientProvider>,
  );
}

const rowOf = (label: string) =>
  screen.getByText(label, { selector: "span" }).closest("li")! as HTMLElement;
const button = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(updateProviderProfileAction).mockResolvedValue({
    status: "saved",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Providers list", () => {
  it("shows a member the actions they cannot take as disabled, each with its reason", () => {
    renderList();
    const team = rowOf("Team ChatGPT");
    expect(within(team).getByText("Default")).toBeTruthy();
    expect(button(team, "Edit").disabled).toBe(true);
    expect(button(team, "Remove as default").disabled).toBe(true);
    expect(
      within(team).getByText(
        "Only the person who added this provider, or an owner or admin, can change it.",
      ),
    ).toBeTruthy();
    // A reason every row shares is stated once, above the list.
    expect(
      screen.getAllByText(
        "Only workspace owners and admins set the default and replace saved keys.",
      ),
    ).toHaveLength(1);
    expect(within(team).getByText(/Added by @owner/)).toBeTruthy();

    const mine = rowOf("My Claude");
    expect(button(mine, "Edit").disabled).toBe(false);
    expect(button(mine, "Remove").disabled).toBe(true);
    expect(
      within(mine).getByText(
        "To remove it, first choose another provider wherever it is used.",
      ),
    ).toBeTruthy();
    expect(within(mine).getByText("acme/web")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Add provider",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("with admin-only Access rights tells members only owners and admins manage providers", () => {
    renderList({
      workspace: {
        personalOwnerUserId: null,
        providerManagementAdminOnly: true,
      },
    });
    const mine = rowOf("My Claude");
    expect(button(mine, "Edit").disabled).toBe(true);
    expect(button(mine, "Remove").disabled).toBe(true);
    expect(
      screen.getAllByText(
        "Only workspace owners and admins can manage providers.",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Access rights" })).toBeTruthy();
  });

  it("saves only the changed model of a provider and names what blocks an edit", async () => {
    vi.mocked(updateProviderProfileAction).mockResolvedValueOnce({
      status: "error",
      error: "provider_profile_model_incompatible",
      blocking: { workspaceDefault: false, repositories: ["acme/web"] },
    });
    renderList();
    fireEvent.click(button(rowOf("My Claude"), "Edit"));
    const dialog = await screen.findByRole("dialog");
    // The credential is shown but cannot change.
    expect(
      within(dialog).getByText(
        "The credential cannot change. To use a different one, add a new provider.",
      ),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Model" }), {
      target: { value: "sonnet" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(updateProviderProfileAction).toHaveBeenCalledWith({
        workspaceId: "workspace_1",
        profileId: "mine",
        model: "sonnet",
      }),
    );
    expect(
      await within(dialog).findByText(
        "The new model does not support the review depth or fast mode used by acme/web. Change their settings first, or keep the current model.",
      ),
    ).toBeTruthy();
  });
});
