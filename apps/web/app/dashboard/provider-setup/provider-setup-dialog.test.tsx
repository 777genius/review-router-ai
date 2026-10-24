// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSetupView } from "../../../src/features/provider-setup/provider-setup-model";
import {
  inheritWorkspaceDefaultProviderAction,
  saveProviderSetupAction,
} from "../provider-setup-actions";
import {
  ProviderSetupDialog,
  type ProviderSetupDialogProps,
} from "./provider-setup-dialog";
import { BulkProviderSetupAction } from "./repository-selection";
import {
  RepositorySelectionCheckbox,
  RepositorySelectionProvider,
} from "../repository-action-selection";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../actions", () => ({
  checkProviderRepositorySecretClientAction: vi.fn(async () => ({
    status: "missing",
  })),
}));
vi.mock("../provider-setup-actions", () => ({
  inheritWorkspaceDefaultProviderAction: vi.fn(),
  saveProviderSetupAction: vi.fn(),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const selection = (profileId: string) => ({
  profileId,
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
});
const claudeProfile = (id: string, label: string, isDefault = false) => ({
  id,
  label,
  model: "opus",
  authMode: "claude_code_oauth" as const,
  credentialKind: "user_ci_secret" as const,
  gatewayBindingId: null,
  isDefault,
  decision: { allowed: true as const },
  refusedRepositoryCount: 0,
});

let view: ProviderSetupView;

beforeEach(() => {
  view = {
    workspaceId: "workspace_1",
    target: "repositories",
    repositories: [
      {
        id: "repo_1",
        fullName: "acme/widget",
        source: "workspace",
        selection: null,
        useDefault: { allowed: true },
      },
    ],
    defaultSelection: selection("profile_default"),
    profiles: [
      claudeProfile("profile_default", "Team Claude", true),
      claudeProfile("profile_other", "Second Claude"),
    ],
    sources: [],
    viewerIsAdmin: true,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => view }) as Response),
  );
  vi.mocked(saveProviderSetupAction).mockResolvedValue({
    status: "saved",
    results: [
      {
        repositoryId: "repo_1",
        fullName: "acme/widget",
        status: "applied",
      },
    ],
  });
  vi.mocked(inheritWorkspaceDefaultProviderAction).mockResolvedValue({
    status: "saved",
    results: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

const repositoryTarget: ProviderSetupDialogProps["target"] = {
  kind: "repository",
  repository: {
    id: "repo_1",
    fullName: "acme/widget",
    visibility: "private",
    canManageCredentials: true,
    effective: {
      authMode: "claude_code_oauth",
      credentialKind: "user_ci_secret",
    },
    secretGuidance: null,
    organizationLogin: null,
    organizationSecretPolicy: null,
    rotatingEnabled: false,
    rotatingPreparationOnly: false,
  },
};

function renderDialog(target: ProviderSetupDialogProps["target"]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderSetupDialog
        workspaceId="workspace_1"
        target={target}
        triggerLabel="Change provider"
        mutationsEnabled
        modelOptions={[]}
        gatewayAccounts={undefined}
        agentProfileOptions={[]}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
}

/** Selects the provider option whose row shows the text. */
async function choose(text: string | RegExp): Promise<void> {
  const label = (await screen.findByText(text)).closest("label")!;
  fireEvent.click(label.querySelector('[role="radio"]')!);
}

describe("ProviderSetupDialog", () => {
  it("shows the inherited workspace default as already chosen for a repository", async () => {
    renderDialog(repositoryTarget);
    const inherited = (
      await screen.findByText("Workspace default: Team Claude")
    ).closest("label")!;
    expect(
      inherited.querySelector('[role="radio"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(inherited.textContent).toContain("In use");
    // Nothing changed yet, so there is nothing to save.
    expect(
      (
        screen.getByRole("button", {
          name: "Use the workspace default",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("attaches an existing provider by its ID, never by its credential and model", async () => {
    renderDialog(repositoryTarget);
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use for this repository" }),
    );
    await waitFor(() => expect(saveProviderSetupAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveProviderSetupAction).mock.calls[0]![0]).toMatchObject({
      workspaceId: "workspace_1",
      target: { kind: "repositories", repositoryIds: ["repo_1"] },
      provider: { kind: "profile", profileId: "profile_other" },
    });
    // Claude Code needs its secret next: the dialog moves to that step and
    // takes the focus there.
    const secretStep = await screen.findByRole("button", {
      name: "2. Add secret",
    });
    await waitFor(() =>
      expect(secretStep.getAttribute("aria-current")).toBe("step"),
    );
    await waitFor(() => expect(document.activeElement).toBe(secretStep));
  });

  it("returns a repository with its own provider to the workspace default", async () => {
    view = {
      ...view,
      repositories: [
        {
          ...view.repositories[0]!,
          source: "repository",
          selection: selection("profile_other"),
        },
      ],
    };
    renderDialog(repositoryTarget);
    await choose("Workspace default: Team Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use the workspace default" }),
    );
    await waitFor(() =>
      expect(inheritWorkspaceDefaultProviderAction).toHaveBeenCalledWith({
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      }),
    );
    expect(saveProviderSetupAction).not.toHaveBeenCalled();
  });

  it("sets the workspace default and reports each repository of a bulk change", async () => {
    view = { ...view, target: "workspace", repositories: [] };
    renderDialog({ kind: "workspace" });
    await choose("Second Claude");
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
    await waitFor(() =>
      expect(saveProviderSetupAction).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { kind: "workspace" },
          provider: { kind: "profile", profileId: "profile_other" },
        }),
      ),
    );
    cleanup();

    view = {
      ...view,
      target: "repositories",
      repositories: ["repo_1", "repo_2"].map((id) => ({
        id,
        fullName: `acme/${id}`,
        source: "workspace" as const,
        selection: null,
        useDefault: { allowed: true as const },
      })),
    };
    vi.mocked(saveProviderSetupAction).mockResolvedValueOnce({
      status: "saved",
      results: [
        { repositoryId: "repo_1", fullName: "acme/repo_1", status: "applied" },
        {
          repositoryId: "repo_2",
          fullName: "acme/repo_2",
          status: "denied",
          reason: "repository_direct_config_required",
        },
      ],
    });
    renderDialog({
      kind: "repositories",
      repositories: [
        { id: "repo_1", fullName: "acme/repo_1" },
        { id: "repo_2", fullName: "acme/repo_2" },
      ],
    });
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use for 2 repositories" }),
    );
    expect(
      await screen.findByText(/The provider is set for 1 of 2 repositories/),
    ).toBeTruthy();
    expect(screen.getByText("Not allowed")).toBeTruthy();
    expect(
      screen.getByText(
        "You need maintain or admin access to this repository on GitHub.",
      ),
    ).toBeTruthy();
  });

  it("keeps the bulk target and its results until the dialog closes, then clears the selection", async () => {
    view = {
      ...view,
      repositories: ["repo_1", "repo_2"].map((id) => ({
        id,
        fullName: `acme/${id}`,
        source: "workspace" as const,
        selection: null,
        useDefault: { allowed: true as const },
      })),
    };
    vi.mocked(saveProviderSetupAction).mockResolvedValueOnce({
      status: "saved",
      results: ["repo_1", "repo_2"].map((id) => ({
        repositoryId: id,
        fullName: `acme/${id}`,
        status: "applied" as const,
      })),
    });
    const repositories = ["repo_1", "repo_2"].map((id) => ({
      id,
      fullName: `acme/${id}`,
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepositorySelectionProvider
          workspaceId="workspace_1"
          inventory={repositories.map((repository) => ({
            repositoryId: repository.id,
            fullName: repository.fullName,
            available: true,
          }))}
        >
          <BulkProviderSetupAction
            workspaceId="workspace_1"
            mutationsEnabled
            modelOptions={[]}
            gatewayAccounts={undefined}
            agentProfileOptions={[]}
            limit={100}
            editableRepositoryIds={repositories.map(
              (repository) => repository.id,
            )}
          />
          {repositories.map((repository) => (
            <RepositorySelectionCheckbox
              key={repository.id}
              repositoryId={repository.id}
            />
          ))}
        </RepositorySelectionProvider>
      </QueryClientProvider>,
    );
    for (const repository of repositories)
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Select ${repository.fullName}` }),
      );
    fireEvent.click(
      screen.getByRole("button", { name: "Configure providers" }),
    );
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use for 2 repositories" }),
    );
    expect(
      await screen.findByText(/The provider is set for all 2 repositories/),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Provider for 2 repositories" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Closing after a save clears the shared table selection.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Configure providers" }),
      ).toHaveProperty("disabled", true),
    );
    for (const repository of repositories)
      expect(
        screen.getByRole("checkbox", { name: `Select ${repository.fullName}` }),
      ).toHaveProperty("checked", false);
    // Every read named the opened repositories, never an emptied selection.
    for (const [url] of vi.mocked(fetch).mock.calls)
      expect(String(url)).toContain("repository=repo_1&repository=repo_2");
  });
});

describe("Configure providers on the shared table selection", () => {
  const renderBulk = (
    count: number,
    { limit, editable }: { limit: number; editable: readonly string[] },
  ) => {
    const repositories = Array.from({ length: count }, (_, index) => ({
      id: `repo_${index + 1}`,
      fullName: `acme/repo_${index + 1}`,
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepositorySelectionProvider
          workspaceId="workspace_1"
          inventory={repositories.map((repository) => ({
            repositoryId: repository.id,
            fullName: repository.fullName,
            available: true,
          }))}
        >
          <BulkProviderSetupAction
            workspaceId="workspace_1"
            mutationsEnabled
            modelOptions={[]}
            gatewayAccounts={undefined}
            agentProfileOptions={[]}
            limit={limit}
            editableRepositoryIds={editable}
          />
          {repositories.map((repository) => (
            <RepositorySelectionCheckbox
              key={repository.id}
              repositoryId={repository.id}
            />
          ))}
        </RepositorySelectionProvider>
      </QueryClientProvider>,
    );
    for (const repository of repositories)
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Select ${repository.fullName}` }),
      );
    return screen.getByRole("button", { name: "Configure providers" });
  };

  it("refuses more repositories than one change may target and says why", () => {
    const trigger = renderBulk(3, {
      limit: 2,
      editable: ["repo_1", "repo_2", "repo_3"],
    });
    expect(trigger).toHaveProperty("disabled", true);
    expect(trigger.getAttribute("title")).toBe(
      "Up to 2 repositories per change.",
    );
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Up to 2 repositories per change.");
  });

  it("refuses a selection with repositories the viewer cannot change", () => {
    const trigger = renderBulk(2, { limit: 100, editable: ["repo_1"] });
    expect(trigger).toHaveProperty("disabled", true);
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("1 repository of the selection cannot be changed now.");
  });

  it("opens for an editable selection within the limit", () => {
    const trigger = renderBulk(2, {
      limit: 2,
      editable: ["repo_1", "repo_2"],
    });
    expect(trigger).toHaveProperty("disabled", false);
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
  });
});
