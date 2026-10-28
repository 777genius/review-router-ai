// @vitest-environment jsdom
import { Profiler } from "react";
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
function direct(organizationLogin: string | null = null) {
  return (
    <CiSecretDelivery
      {...repository}
      repositoryVisibility="public"
      authMode="openrouter_api_key"
      guidance={buildProviderSecretSetupGuidance({
        provider: "openrouter_api_key",
        repoFullName: repository.repositoryFullName,
        ...(organizationLogin ? { organizationLogin } : {}),
      })}
      organizationLogin={organizationLogin}
      organizationSecretPolicy={null}
    />
  );
}

function confirmationResponse(error?: string): Response {
  return new Response(JSON.stringify({ params: error ? { error } : {} }), {
    headers: { "content-type": "application/json" },
  });
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

it.each([
  {
    status: "missing",
    scope: "repository",
    message: "OPENROUTER_API_KEY is not set for this repository yet.",
  },
  {
    status: "not_available_to_repository",
    scope: "organization_selected_repositories",
    message:
      "An organization secret OPENROUTER_API_KEY exists, but this repository is not allowed to use it.",
  },
] as const)(
  "clears verified confirmation on the first fresh $status render without reviving it on an unknown read",
  async ({ status, scope, message }) => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status:
        scope === "repository"
          ? "available_repository"
          : "available_organization",
    });
    const negativeCommits: {
      badge: boolean;
      successMessage: boolean;
      checkEnabled: boolean;
    }[] = [];
    const { client } = view(
      <Profiler
        id="direct-confirmation"
        onRender={() => {
          if (!screen.queryByText(message)) return;
          const check = screen.queryByRole("button", {
            name: "Check GitHub setup",
          });
          negativeCommits.push({
            badge: screen.queryByText("Secret available") !== null,
            successMessage:
              screen.queryByText(
                "OPENROUTER_API_KEY is set for acme/widget.",
              ) !== null,
            checkEnabled: check !== null && !check.hasAttribute("disabled"),
          });
        }}
      >
        {direct("acme")}
      </Profiler>,
    );
    fireEvent.click(screen.getByTestId(`provider-scope-${scope}`));
    fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
    await screen.findByRole("button", { name: "Confirmed" });
    expect(screen.getByText("Secret available")).toBeTruthy();
    const queryKey = providerSetupQueryKeys.secretStatus(
      repository.workspaceId,
      repository.repositoryId,
      "openrouter_api_key",
    );
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValueOnce({
      status,
    });

    await act(async () => {
      await client.refetchQueries({ queryKey, exact: true });
    });

    await screen.findByText(message);
    // An effect-only reset must not commit contradictory success UI first.
    expect(negativeCommits[0]).toEqual({
      badge: false,
      successMessage: false,
      checkEnabled: true,
    });
    expect(screen.queryByText("Secret available")).toBeNull();
    expect(screen.getByTestId(`provider-scope-${scope}`)).toHaveProperty(
      "checked",
      true,
    );

    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValueOnce({
      status: "unknown",
    });
    await act(async () => {
      await client.refetchQueries({ queryKey, exact: true });
    });
    await screen.findByText(
      "ReviewRouter cannot read the repository secrets right now; you can still follow the steps.",
    );
    expect(screen.queryByText("Secret available")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmed" })).toBeNull();
    const check = screen.getByRole("button", { name: "Check GitHub setup" });
    expect(check).toHaveProperty("disabled", false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(check);
    await screen.findByRole("button", { name: "Confirmed" });
    expect(screen.getByText("Secret available")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (fetchMock.mock.calls[1]?.[1].body as FormData).get("secretScope"),
    ).toBe(scope);
  },
);

it("keeps verified confirmation during a pending read and inconclusive metadata results", async () => {
  const { client } = view(direct());
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByRole("button", { name: "Confirmed" });
  const queryKey = providerSetupQueryKeys.secretStatus(
    repository.workspaceId,
    repository.repositoryId,
    "openrouter_api_key",
  );
  type SecretRead = Awaited<
    ReturnType<typeof checkProviderRepositorySecretClientAction>
  >;
  let finishRead!: (result: SecretRead) => void;
  vi.mocked(checkProviderRepositorySecretClientAction).mockReturnValueOnce(
    new Promise<SecretRead>((resolve) => {
      finishRead = resolve;
    }),
  );
  let refresh!: Promise<void>;
  act(() => {
    refresh = client.refetchQueries({ queryKey, exact: true });
  });

  await screen.findByText("Checking the repository secrets on GitHub...");
  expect(screen.getByText("Secret available")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirmed" })).toHaveProperty(
    "disabled",
    true,
  );

  await act(async () => {
    finishRead({ status: "unknown" });
    await refresh;
  });
  await screen.findByText(
    "ReviewRouter cannot read the repository secrets right now; you can still follow the steps.",
  );
  expect(screen.getByText("Secret available")).toBeTruthy();

  vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValueOnce({
    status: "permission_required",
  });
  await act(async () => {
    await client.refetchQueries({ queryKey, exact: true });
  });
  expect(client.getQueryData(queryKey)).toBe("permission_required");
  expect(screen.getByText("Secret available")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirmed" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("preserves explicitly manual confirmation after a fresh missing read", async () => {
  fetchMock.mockResolvedValueOnce(
    confirmationResponse("provider_secret_check_permission_required"),
  );
  const { client } = view(direct());
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  const manual = await screen.findByRole("button", {
    name: "Confirm manually",
  });
  await waitFor(() => expect(manual).toHaveProperty("disabled", false));
  fireEvent.click(manual);
  await screen.findByRole("button", { name: "Confirmed" });
  expect(screen.getByText("Confirmed manually")).toBeTruthy();
  vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValueOnce({
    status: "missing",
  });

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
    "OPENROUTER_API_KEY is not set for this repository yet.",
  );
  expect(screen.getByText("Confirmed manually")).toBeTruthy();
  expect(
    screen.getByText(/Marked as done for acme\/widget/).textContent,
  ).toContain("could not check GitHub itself");
  expect(screen.getByRole("button", { name: "Confirmed" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.queryByText("Secret available")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
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

it("does not install a managed key when repository management is unavailable", () => {
  view(
    <ManagedKeyDelivery
      {...repository}
      canManage={false}
      authMode="mimo_token_plan_api_key"
      installed={false}
      installDecisionReason={null}
    />,
  );

  const installButton = screen.getByRole("button", { name: "Install key" });
  expect(installButton).toHaveProperty("disabled", true);
  fireEvent.click(installButton);
  expect(fetchMock).not.toHaveBeenCalled();
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

it("reinstalls a missing managed secret with the saved key for only this repository", async () => {
  let finishInstall!: (response: Response) => void;
  let finishConfirmation!: (response: Response) => void;
  fetchMock
    .mockResolvedValueOnce(confirmationResponse("provider_secret_not_found"))
    .mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finishInstall = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finishConfirmation = resolve;
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
  const reinstall = await screen.findByRole("button", {
    name: "Reinstall key",
  });
  await waitFor(() => expect(reinstall).toHaveProperty("disabled", false));
  expect(
    screen.getByRole("button", { name: "Check GitHub setup" }),
  ).toHaveProperty("disabled", false);
  expect(
    screen.queryByRole("heading", { name: /key is installed/ }),
  ).toBeNull();

  fireEvent.click(reinstall);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const checkDuringInstall = screen.getByRole("button", {
    name: "Check GitHub setup",
  });
  const installing = screen.getByRole("button", { name: "Installing..." });
  expect(checkDuringInstall).toHaveProperty("disabled", true);
  expect(installing).toHaveProperty("disabled", true);
  fireEvent.click(checkDuringInstall);
  fireEvent.click(installing);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await act(async () => {
    finishInstall(
      new Response(
        JSON.stringify({
          results: [
            {
              repositoryId: repository.repositoryId,
              repositoryFullName: repository.repositoryFullName,
              status: "applied",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  });
  const checking = await screen.findByRole("button", {
    name: "Checking the secret...",
  });
  expect(checking).toHaveProperty("disabled", true);
  expect(installing).toHaveProperty("disabled", true);
  fireEvent.click(checking);
  fireEvent.click(installing);
  expect(fetchMock).toHaveBeenCalledTimes(3);

  await act(async () => {
    finishConfirmation(confirmationResponse());
  });
  await screen.findByRole("button", { name: "Checked" });
  expect(screen.getByText("Secret available")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reinstall key" })).toBeNull();
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    "/api/dashboard/provider-secret-setup/confirm",
    "/api/dashboard/provider-keys/apply",
    "/api/dashboard/provider-secret-setup/confirm",
  ]);
  expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
    workspaceId: repository.workspaceId,
    providerType: "openrouter",
    repositoryIds: [repository.repositoryId],
  });
  const form = fetchMock.mock.calls[2]?.[1].body as FormData;
  expect(Object.fromEntries(form)).toEqual({
    workspaceId: repository.workspaceId,
    repositoryId: repository.repositoryId,
    providerKind: "openrouter",
    authMode: "openrouter_api_key",
    secretScope: "repository",
    confirmationMode: "verified",
  });
});

it.each([
  {
    reason: "repository management is unavailable",
    canManage: false,
    installDecisionReason: null,
  },
  {
    reason: "managed-key installation is denied",
    canManage: true,
    installDecisionReason: "Only workspace owners and admins install keys.",
  },
])("does not reinstall a managed key when $reason", async (permission) => {
  fetchMock.mockResolvedValueOnce(
    confirmationResponse("provider_secret_not_found"),
  );
  const delivery = (
    canManage: boolean,
    installDecisionReason: string | null,
  ) => (
    <ManagedKeyDelivery
      {...repository}
      canManage={canManage}
      authMode="openrouter_api_key"
      installed
      installDecisionReason={installDecisionReason}
    />
  );
  const { client, rerender } = view(delivery(true, null));
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText(/OPENROUTER_API_KEY was not found/);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check GitHub setup" }),
    ).toHaveProperty("disabled", false),
  );

  rerender(
    <QueryClientProvider client={client}>
      {delivery(permission.canManage, permission.installDecisionReason)}
    </QueryClientProvider>,
  );

  const reinstall = screen.getByRole("button", { name: "Reinstall key" });
  expect(reinstall).toHaveProperty("disabled", true);
  fireEvent.click(reinstall);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Check GitHub setup" }),
  ).toHaveProperty("disabled", !permission.canManage);
});

it("can recheck a managed secret restored externally without reinstalling it", async () => {
  fetchMock
    .mockResolvedValueOnce(confirmationResponse("provider_secret_not_found"))
    .mockResolvedValueOnce(confirmationResponse());
  view(
    <ManagedKeyDelivery
      {...repository}
      authMode="openrouter_api_key"
      installed
      installDecisionReason={null}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText(/OPENROUTER_API_KEY was not found/);
  const check = screen.getByRole("button", { name: "Check GitHub setup" });
  await waitFor(() => expect(check).toHaveProperty("disabled", false));

  fireEvent.click(check);

  await screen.findByRole("button", { name: "Checked" });
  expect(screen.getByText("Secret available")).toBeTruthy();
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    "/api/dashboard/provider-secret-setup/confirm",
    "/api/dashboard/provider-secret-setup/confirm",
  ]);
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
