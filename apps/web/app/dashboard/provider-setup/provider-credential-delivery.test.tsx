// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {element}
    </QueryClientProvider>,
  );
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
