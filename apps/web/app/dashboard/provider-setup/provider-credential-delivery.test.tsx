// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProviderSecretSetupGuidance } from "@reviewrouter/features-provider-setup";
import { checkProviderRepositorySecretClientAction } from "../actions";
import {
  CiSecretDelivery,
  ManagedKeyDelivery,
} from "./provider-credential-delivery";
import { providerSetupQueryKeys } from "./provider-setup-api";

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
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
    status: "available_repository",
  });
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ params: {} }), {
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const repository = {
  workspaceId: "workspace-1",
  repositoryId: "repo-1",
  repositoryFullName: "acme/widget",
  canManage: true,
};
function view(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
    ),
    client,
  };
}
function direct() {
  return (
    <CiSecretDelivery
      {...repository}
      repositoryVisibility="public"
      authMode="openrouter_api_key"
      guidance={buildProviderSecretSetupGuidance({
        provider: "openrouter_api_key",
        repoFullName: repository.repositoryFullName,
      })}
      organizationLogin={null}
      organizationSecretPolicy={null}
    />
  );
}

it("checks GitHub metadata with no raw key and never presents it as a model response", async () => {
  view(direct());
  await screen.findByText(
    "OPENROUTER_API_KEY is available to this repository.",
  );
  expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
  expect(screen.queryByLabelText("API key")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText("Secret available");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "/api/dashboard/provider-secret-setup/confirm",
  );
  const form = fetchMock.mock.calls[0]?.[1].body as FormData;
  expect(Object.fromEntries(form)).toEqual({
    workspaceId: "workspace-1",
    repositoryId: "repo-1",
    providerKind: "openrouter",
    authMode: "openrouter_api_key",
    secretScope: "repository",
    confirmationMode: "verified",
  });
  expect(
    screen.getByText(/This checks GitHub secret availability/).textContent,
  ).toContain("not a response from the model");
  expect(screen.queryByText(/Model answered|Connection successful/)).toBeNull();
});

it("labels manual confirmation separately when GitHub metadata cannot be checked", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        params: { error: "provider_secret_check_permission_required" },
      }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  view(direct());
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm manually" }),
  );
  await screen.findByText("Confirmed manually");
  expect(
    screen.getByText(/Marked as done for acme\/widget/).textContent,
  ).toContain("could not check GitHub itself");
  expect(screen.queryByText("Secret available")).toBeNull();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(
    (fetchMock.mock.calls[1]?.[1].body as FormData).get("confirmationMode"),
  ).toBe("manual");
});

it("does not present cached secret availability after a fresh metadata read fails", async () => {
  const { client } = view(direct());
  const available = "OPENROUTER_API_KEY is available to this repository.";
  await screen.findByText(available);
  vi.mocked(checkProviderRepositorySecretClientAction).mockRejectedValueOnce(
    new Error("GitHub metadata is unavailable"),
  );
  const queryKey = providerSetupQueryKeys.secretStatus(
    repository.workspaceId,
    repository.repositoryId,
    "openrouter_api_key",
  );

  await act(async () => {
    await client.refetchQueries({ queryKey, exact: true });
  });

  expect(client.getQueryState(queryKey)?.status).toBe("error");
  expect(
    await screen.findByText(
      "ReviewRouter cannot read the repository secrets right now; you can still follow the steps.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(available)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps an explicit successful confirmation when a later background read fails", async () => {
  const { client } = view(direct());
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByRole("button", { name: "Confirmed" });
  expect(screen.getByText("Secret available")).toBeTruthy();
  vi.mocked(checkProviderRepositorySecretClientAction).mockRejectedValueOnce(
    new Error("GitHub metadata is unavailable"),
  );

  await act(async () => {
    await client.refetchQueries({
      queryKey: providerSetupQueryKeys.secretStatus(
        repository.workspaceId,
        repository.repositoryId,
        "openrouter_api_key",
      ),
      exact: true,
    });
  });

  await screen.findByText(
    "ReviewRouter cannot read the repository secrets right now; you can still follow the steps.",
  );
  expect(screen.getByText("Secret available")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirmed" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not let a pre-check read restore availability after the secret check reports missing", async () => {
  type SecretRead = Awaited<
    ReturnType<typeof checkProviderRepositorySecretClientAction>
  >;
  let finishOldRead!: (result: SecretRead) => void;
  const oldRead = new Promise<SecretRead>((resolve) => {
    finishOldRead = resolve;
  });
  vi.mocked(checkProviderRepositorySecretClientAction)
    .mockResolvedValue({ status: "missing" })
    .mockReturnValueOnce(oldRead);
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ params: { error: "provider_secret_not_found" } }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  const { client } = view(direct());
  await waitFor(() =>
    expect(checkProviderRepositorySecretClientAction).toHaveBeenCalledTimes(1),
  );

  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText(
    "OPENROUTER_API_KEY is not in the Actions secrets of acme/widget yet. Run the command, then check again.",
  );
  await act(async () => {
    finishOldRead({ status: "available_repository" });
  });

  await waitFor(() =>
    expect(
      client.getQueryData(
        providerSetupQueryKeys.secretStatus(
          repository.workspaceId,
          repository.repositoryId,
          "openrouter_api_key",
        ),
      ),
    ).toBe("missing"),
  );
  expect(
    screen.queryByText("OPENROUTER_API_KEY is available to this repository."),
  ).toBeNull();
  expect(screen.queryByText("Secret available")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps the secret scope fixed until its check completes and clears the result on a later change", async () => {
  vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
    status: "missing",
  });
  let resolveConfirmation!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      resolveConfirmation = resolve;
    }),
  );
  const { container } = view(
    <CiSecretDelivery
      {...repository}
      repositoryVisibility="private"
      authMode="claude_code_oauth"
      guidance={buildProviderSecretSetupGuidance({
        provider: "claude_code_oauth",
        repoFullName: repository.repositoryFullName,
        organizationLogin: "acme",
      })}
      organizationLogin="acme"
      organizationSecretPolicy={{
        planName: "Team",
        privateRepositoriesAvailable: true,
        status: "available",
      }}
    />,
  );
  const repositoryScope = screen.getByTestId("provider-scope-repository");
  const organizationScope = screen.getByTestId(
    "provider-scope-organization_selected_repositories",
  );
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toHaveProperty("disabled", true);
  expect(repositoryScope).toHaveProperty("checked", true);
  expect(organizationScope).toHaveProperty("checked", false);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(
    (fetchMock.mock.calls[0]?.[1].body as FormData).get("secretScope"),
  ).toBe("repository");

  await act(async () => {
    resolveConfirmation(
      new Response(
        JSON.stringify({ params: { error: "provider_secret_not_found" } }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  });
  const repositoryError =
    "CLAUDE_CODE_OAUTH_TOKEN is not in the Actions secrets of acme/widget yet. Run the command, then check again.";
  await screen.findByText(repositoryError);
  await waitFor(() => {
    for (const radio of screen.getAllByRole("radio"))
      expect(radio).toHaveProperty("disabled", false);
  });
  expect(screen.queryByText(/not an Actions secret of acme yet/)).toBeNull();

  fireEvent.click(organizationScope);
  expect(organizationScope).toHaveProperty("checked", true);
  expect(screen.queryByText(repositoryError)).toBeNull();
  expect(container.querySelector("pre")?.textContent).toContain(
    "--org acme --repos widget --app actions",
  );
  expect(
    screen.getByRole("button", { name: "Check GitHub setup" }),
  ).toHaveProperty("disabled", false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps the installed managed key on its GitHub path without installing or probing again", async () => {
  view(
    <ManagedKeyDelivery
      {...repository}
      authMode="mimo_token_plan_api_key"
      installed
      installDecisionReason={null}
    />,
  );
  expect(
    screen.getByText(/ReviewRouter wrote MIMO_TOKEN_PLAN_API_KEY/),
  ).toBeTruthy();
  expect(
    screen.getByText(/The saved key is used in GitHub Actions/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText("Secret available");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "/api/dashboard/provider-secret-setup/confirm",
  );
  expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
});

it.each([
  {
    error: "provider_secret_check_permission_required",
    explanation: /cannot read.*secret/i,
    nextAction: /permission/i,
  },
  {
    error: "repository_not_visible_to_github_app",
    explanation: /GitHub App cannot access this repository/i,
    nextAction: /selected repositories/i,
  },
])(
  "explains managed-key $error without a wait-only or manual-confirmation instruction",
  async ({ error, explanation, nextAction }) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ params: { error } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    view(
      <ManagedKeyDelivery
        {...repository}
        authMode="openrouter_api_key"
        installed
        installDecisionReason={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));

    const message = await screen.findByText(explanation);
    expect(message.textContent).toMatch(nextAction);
    expect(screen.queryByText(/Wait a moment and check again/i)).toBeNull();
    expect(screen.queryByText(/Confirm manually/i)).toBeNull();
    expect(screen.queryByText("Secret available")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check GitHub setup" }),
      ).toHaveProperty("disabled", false),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it("gets the Claude subscription token before asking the user to store it", () => {
  const { container } = view(
    <CiSecretDelivery
      {...repository}
      repositoryVisibility="public"
      authMode="claude_code_oauth"
      guidance={buildProviderSecretSetupGuidance({
        provider: "claude_code_oauth",
        repoFullName: repository.repositoryFullName,
      })}
      organizationLogin={null}
      organizationSecretPolicy={null}
    />,
  );
  const steps = screen.getAllByRole("listitem").map((item) => item.textContent);
  expect(steps[1]).toContain("Run claude setup-token");
  expect(steps[2]).toContain(
    "Run the command below. Paste only the printed token",
  );
  expect(container.querySelector("pre")?.textContent).toContain(
    "gh secret set CLAUDE_CODE_OAUTH_TOKEN",
  );
});
