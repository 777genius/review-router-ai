// @vitest-environment jsdom
import { useEffect, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ProviderSecretSetupGuidance } from "@reviewrouter/features-provider-setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProviderSetupDialog } from "./provider-setup/provider-setup-dialog";
import {
  confirmSetupPullRequestMergedClientAction,
  createSetupPullRequestClientAction,
} from "./actions";
import { RepositorySetupProgressPanel } from "./repository-setup-progress-panel";
import {
  providerSetupConfirmedEvent,
  setupPullRequestMergedEvent,
} from "./repository-setup-optimistic-events";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    custom: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("./actions", () => ({
  checkProviderRepositorySecretClientAction: vi.fn(async () => ({
    status: "missing",
  })),
  confirmSetupPullRequestMergedClientAction: vi.fn(),
  createSetupPullRequestClientAction: vi.fn(),
}));

vi.mock("./provider-setup-actions", () => ({
  inheritWorkspaceDefaultProviderAction: vi.fn(),
  saveProviderSetupAction: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe("RepositorySetupProgressPanel", () => {
  it("shows actual Gateway draining state despite cached complete progress", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent
        mutationsEnabled
        initialStep="ready"
        expectedProviderAuthModes={["codex_account_gateway"]}
        gatewayReviewV2Readiness={{
          status: "draining",
          authorityVersion: 2,
          drainNotBefore: "2026-10-13T01:28:31.829Z",
          recoveryReference: "docs/operations/review-action-v2-cutover.md",
        }}
      />,
    );
    expect(screen.getByText("3 of 4 - enable review")).toBeTruthy();
    expect(screen.queryByText("4 of 4 - complete")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "2026-10-13T01:28:31.829Z",
    );
    fireEvent(
      window,
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        authMode: "codex_account_gateway",
      }),
    );
    expect(screen.queryByText("4 of 4 - complete")).toBeNull();
  });
  it("exposes rotating preparation before the first setup PR", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="not_configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent={false}
        mutationsEnabled
        initialStep="setup_pr"
        providerSetupBeforeWorkflow
        enableReviewAction={
          <button type="button">Set up versioned provider</button>
        }
      />,
    );

    expect(screen.getByText("1 of 4 - prepare versioned setup")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Set up versioned provider" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create setup PR/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Seed the versioned provider namespace, then add its workflow by PR.",
      ),
    ).toBeTruthy();
  });

  it("keeps generic provider setup locked until after merge", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="not_configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent={false}
        mutationsEnabled
        initialStep="setup_pr"
        enableReviewAction={<button type="button">Connect provider</button>}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Connect provider" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Enable review" }),
    ).toHaveProperty("disabled", true);
  });

  it("hides the AI suggested replies option on gateway setup actions", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="not_configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent={false}
        mutationsEnabled
        initialStep="setup_pr"
        expectedProviderAuthModes={["codex_account_gateway"]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Create setup PR/i }),
    ).toBeTruthy();
    expect(screen.queryByText("Enable AI suggested replies")).toBeNull();
  });

  it("keeps the AI suggested replies option on legacy setup actions", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="not_configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent={false}
        mutationsEnabled
        initialStep="setup_pr"
        expectedProviderAuthModes={["codex_subscription_oauth_rotating"]}
      />,
    );

    expect(screen.getByText("Enable AI suggested replies")).toBeTruthy();
  });

  // Regression: step 3 opened the old "Connect model credentials" dialog.
  it("opens the unified provider dialog for this repository from step 3 and keeps it open as progress advances", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.startsWith("/api/dashboard/provider-setup?")
        ? ({
            ok: true,
            json: async () => providerSetupViewFixture(),
          } as Response)
        : providerSetupResponse({
            params: {
              notice: "provider_setup_confirmed",
              workspace: "workspace_1",
              section: "repositories",
              repository: "777genius/example",
            },
          }),
    );
    vi.stubGlobal("fetch", fetch);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepositorySetupProgressPanel
          workspaceId="workspace_1"
          repositoryId="repo_1"
          repositoryFullName="777genius/example"
          selected
          archived={false}
          initialSetupStatus="configured"
          initialSetupPullRequestUrl={null}
          workflowCurrent
          mutationsEnabled
          initialStep="provider"
          expectedProviderAuthModes={["claude_code_oauth"]}
          enableReviewAction={
            <ProviderSetupDialog
              workspaceId="workspace_1"
              target={{
                kind: "repository",
                repository: {
                  id: "repo_1",
                  fullName: "777genius/example",
                  visibility: "public",
                  canManageCredentials: true,
                  effective: {
                    authMode: "claude_code_oauth",
                    credentialKind: "user_ci_secret",
                  },
                  secretGuidance: {
                    claude_code_oauth: guidance("CLAUDE_CODE_OAUTH_TOKEN"),
                    mimo_token_plan_api_key: guidance(
                      "MIMO_TOKEN_PLAN_API_KEY",
                    ),
                  },
                  organizationLogin: null,
                  organizationSecretPolicy: null,
                  rotatingEnabled: false,
                  rotatingPreparationOnly: false,
                },
              }}
              initialStep="credentials"
              triggerLabel="Add secret"
              mutationsEnabled
              modelOptions={[]}
              gatewayAccounts={undefined}
              agentProfileOptions={[]}
            />
          }
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add secret" }));
    // The dialog is fixed to this repository and opens on its credential.
    expect(screen.getByText("Provider for 777genius/example")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "2. Add secret" })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.queryByText(/Connect model credentials/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));

    expect(
      await screen.findByText(
        "CLAUDE_CODE_OAUTH_TOKEN is set for 777genius/example.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("4 of 4 - complete")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close provider setup" }),
    ).toBeTruthy();
  });

  it("keeps the provider dialog mounted when provider confirmation advances progress", async () => {
    let actionUnmounts = 0;

    function StatefulEnableReviewAction(): React.ReactElement {
      const [open, setOpen] = useState(false);
      useEffect(() => {
        return () => {
          actionUnmounts += 1;
        };
      }, []);

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Enable review
          </button>
          {open ? <div>Provider dialog still open</div> : null}
        </>
      );
    }

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent
        mutationsEnabled
        initialStep="provider"
        enableReviewAction={<StatefulEnableReviewAction />}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable review" }));
    expect(screen.getByText("Provider dialog still open")).toBeTruthy();

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("4 of 4 - complete")).toBeTruthy();
    });
    expect(screen.getByText("Provider dialog still open")).toBeTruthy();
    expect(actionUnmounts).toBe(0);
  });

  it("allows a rotating provider namespace to refresh its merged workflow", async () => {
    vi.mocked(createSetupPullRequestClientAction).mockResolvedValueOnce({
      params: {
        notice: "setup_pr_ready",
        repository: "777genius/example",
        pr: "https://github.com/777genius/example/pull/2",
      },
    });

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent
        mutationsEnabled
        initialStep="provider"
        enableReviewAction={<button type="button">Set up provider</button>}
        providerSetupBeforeWorkflow
      />,
    );

    const updateForm = screen
      .getByRole("button", { name: "Update setup PR" })
      .closest("form");
    expect(updateForm).toBeTruthy();
    updateForm!.requestSubmit();

    expect(await screen.findByText("2 of 4 - merge setup PR")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open setup PR/i })).toBeTruthy();
  });

  it("does not advance progress for a provider setup outside the effective config", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent
        mutationsEnabled
        initialStep="provider"
        expectedProviderAuthModes={["codex_subscription_oauth_rotating"]}
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
      }),
    );

    expect(screen.getByText("3 of 4 - enable review")).toBeTruthy();
  });

  it("does not advance multi-auth progress after a single provider confirmation", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent
        mutationsEnabled
        initialStep="provider"
        expectedProviderAuthModes={["openrouter_api_key", "claude_code_oauth"]}
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
      }),
    );

    expect(screen.getByText("3 of 4 - enable review")).toBeTruthy();
  });

  it("advances multi-auth progress after all expected providers are confirmed", async () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent
        mutationsEnabled
        initialStep="provider"
        expectedProviderAuthModes={["openrouter_api_key", "claude_code_oauth"]}
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
      }),
    );
    expect(screen.getByText("3 of 4 - enable review")).toBeTruthy();

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "claude",
        authMode: "claude_code_oauth",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("4 of 4 - complete")).toBeTruthy();
    });
  });

  it("keeps the provider action available for rows that are already complete", () => {
    let actionMounts = 0;

    function MountedAction(): React.ReactElement {
      useEffect(() => {
        actionMounts += 1;
      }, []);

      return <button type="button">Enable review</button>;
    }

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent
        mutationsEnabled
        initialStep="ready"
        enableReviewAction={<MountedAction />}
      />,
    );

    expect(screen.getByRole("button", { name: "Enable review" })).toBeTruthy();
    expect(actionMounts).toBe(1);
  });

  it("advances to provider setup when merge confirmation is detected in the background", async () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="setup_pr_open"
        initialSetupPullRequestUrl="https://github.com/777genius/example/pull/1"
        workflowCurrent={false}
        mutationsEnabled
        initialStep="merge_setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    window.dispatchEvent(
      setupPullRequestMergedEvent({ repositoryId: "repo_1" }),
    );

    await waitFor(() => {
      expect(screen.getByText("3 of 4 - enable review")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Enable review" })).toBeTruthy();
  });

  it("shows a recovery action when the saved setup PR was closed", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="needs_attention"
        initialSetupPullRequestUrl="https://github.com/777genius/example/pull/1"
        initialSetupIssue="setup_pr_closed"
        workflowCurrent={false}
        mutationsEnabled
        initialStep="setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    expect(screen.getByText("Recover setup PR")).toBeTruthy();
    expect(
      screen.getByText("Previous setup PR was closed. Recreate it."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Recreate setup PR/i }),
    ).toBeTruthy();
  });

  it("explains a provisioning failure that is not a setup PR recovery issue", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="needs_attention"
        initialSetupPullRequestUrl={null}
        initialSetupIssue="workflow_delete_untrusted"
        workflowCurrent
        mutationsEnabled
        initialStep="setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    expect(screen.getByText(/belongs to another active mode/i)).toBeTruthy();
    expect(screen.queryByText("Recover setup PR")).toBeNull();
  });

  it("does not repeat a stale provisioning reason once the setup step advanced", () => {
    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="setup_pr_open"
        initialSetupPullRequestUrl="https://github.com/777genius/example/pull/2"
        initialSetupIssue="workflow_delete_untrusted"
        workflowCurrent
        mutationsEnabled
        initialStep="merge_setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    expect(screen.queryByText(/belongs to another active mode/i)).toBeNull();
  });

  it("turns a deleted setup branch merge check into a recovery step", async () => {
    vi.mocked(confirmSetupPullRequestMergedClientAction).mockResolvedValueOnce({
      params: {
        error: "setup_pr_branch_deleted",
        workspace: "workspace_1",
        section: "repositories",
      },
    });

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="setup_pr_open"
        initialSetupPullRequestUrl="https://github.com/777genius/example/pull/1"
        workflowCurrent={false}
        mutationsEnabled
        initialStep="merge_setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    const mergeForm = screen
      .getByRole("button", { name: "I merged it" })
      .closest("form");
    expect(mergeForm).toBeTruthy();

    mergeForm!.requestSubmit();

    expect(
      await screen.findByText("Setup PR branch was deleted. Recreate it."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Recreate setup PR/i }),
    ).toBeTruthy();
  });

  it("turns a merged setup PR with foreign workflow bytes into a recovery step", async () => {
    vi.mocked(confirmSetupPullRequestMergedClientAction).mockResolvedValueOnce({
      params: {
        error: "setup_pr_workflow_mismatch",
        workspace: "workspace_1",
        section: "repositories",
      },
    });

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="setup_pr_open"
        initialSetupPullRequestUrl="https://github.com/777genius/example/pull/1"
        workflowCurrent={false}
        mutationsEnabled
        initialStep="merge_setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    const mergeForm = screen
      .getByRole("button", { name: "I merged it" })
      .closest("form");
    expect(mergeForm).toBeTruthy();

    mergeForm!.requestSubmit();

    expect(
      await screen.findByText(
        "Merged setup PR does not contain the expected workflow. Recreate it and merge without edits.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Recreate setup PR/i }),
    ).toBeTruthy();
  });

  it("shows a specific GitHub permission error for setup actions", async () => {
    vi.mocked(confirmSetupPullRequestMergedClientAction).mockResolvedValueOnce({
      params: {
        error: "github_operation_forbidden",
        workspace: "workspace_1",
        section: "repositories",
      },
    });

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="setup_pr_open"
        initialSetupPullRequestUrl="https://github.com/777genius/example/pull/1"
        workflowCurrent={false}
        mutationsEnabled
        initialStep="merge_setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "I merged it" }));

    await waitFor(() => {
      expect(toast.custom).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        hasCustomToastMessage(
          /GitHub refused the setup PR update/i,
          "The dashboard action could not be completed.",
        ),
      ).toBe(true);
    });
  });

  it("shows Codex reconnect guidance for legacy setup PR actions", async () => {
    vi.mocked(createSetupPullRequestClientAction).mockResolvedValueOnce({
      params: {
        error: "codex_legacy_auth_requires_reconnect",
        workspace: "workspace_1",
        section: "repositories",
      },
    });

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="not_configured"
        initialSetupPullRequestUrl={null}
        workflowCurrent={false}
        mutationsEnabled
        initialStep="setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Create setup PR/i }));

    await waitFor(() => {
      expect(
        hasCustomToastMessage(
          /Reconnect Codex with the rotating setup command/i,
          "The dashboard action could not be completed.",
        ),
      ).toBe(true);
    });
  });

  it("shows stale dashboard guidance when a server action id changed after deploy", async () => {
    vi.mocked(confirmSetupPullRequestMergedClientAction).mockRejectedValueOnce(
      new Error("Failed to find Server Action"),
    );

    render(
      <RepositorySetupProgressPanel
        workspaceId="workspace_1"
        repositoryId="repo_1"
        repositoryFullName="777genius/example"
        selected
        archived={false}
        initialSetupStatus="setup_pr_open"
        initialSetupPullRequestUrl="https://github.com/777genius/example/pull/1"
        workflowCurrent={false}
        mutationsEnabled
        initialStep="merge_setup_pr"
        enableReviewAction={<button type="button">Enable review</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "I merged it" }));

    await waitFor(() => {
      expect(
        hasCustomToastMessage(
          /dashboard was updated while this page was open/i,
          "inspect server logs",
        ),
      ).toBe(true);
    });
  });
});

function hasCustomToastMessage(expected: RegExp, forbidden: string): boolean {
  type ToastRenderer = Parameters<typeof toast.custom>[0];
  const renderers = vi
    .mocked(toast.custom)
    .mock.calls.map((call) => call[0])
    .filter(
      (renderer): renderer is ToastRenderer => typeof renderer === "function",
    );

  return renderers.some((renderer, index) => {
    const rendered = render(<>{renderer(`setup-action-toast-${index}`)}</>);
    const matched =
      rendered.queryByText(expected) !== null &&
      rendered.queryByText(forbidden) === null;
    rendered.unmount();
    return matched;
  });
}

function guidance(secretName: string): ProviderSecretSetupGuidance {
  return {
    provider:
      secretName === "MIMO_TOKEN_PLAN_API_KEY"
        ? "mimo_token_plan_api_key"
        : secretName === "CLAUDE_CODE_OAUTH_TOKEN"
          ? "claude_code_oauth"
          : "openrouter_api_key",
    recommendedScope: "repository",
    commands: [
      {
        scope: "repository",
        title: "Repository secret",
        description: `Stores ${secretName} directly in this repository.`,
        command: `gh secret set ${secretName} --repo 777genius/example`,
        storesSecretIn: "github_repository_secret",
        targetLabel: "777genius/example repository secret",
        secretNames: [secretName],
        selectedRepositories: ["777genius/example"],
        validatesBeforeWrite: false,
        failureRecovery: "Retry the command.",
        sendsSecretToReviewRouter: false,
      },
    ],
    warnings: [],
  };
}

function providerSetupResponse(body: {
  readonly params: Record<string, string>;
}): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function providerSetupViewFixture() {
  return {
    workspaceId: "workspace_1",
    target: "repositories",
    repositories: [
      {
        id: "repo_1",
        fullName: "777genius/example",
        source: "repository",
        selection: {
          profileId: "profile_claude",
          agenticContext: true,
          fastMode: false,
          requiredHealthy: true,
        },
        useDefault: { allowed: true },
      },
    ],
    defaultSelection: null,
    profiles: [
      {
        id: "profile_claude",
        label: "Claude Code",
        model: "opus",
        authMode: "claude_code_oauth",
        credentialKind: "user_ci_secret",
        gatewayBindingId: null,
        isDefault: false,
        decision: { allowed: true },
        refusedRepositoryCount: 0,
      },
    ],
    sources: [],
    viewerIsAdmin: true,
  };
}
