// @vitest-environment jsdom
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkProviderRepositorySecretClientAction } from "../actions";
import { providerSetupConfirmedEventName } from "../repository-setup-optimistic-events";
import { RotatingProviderDelivery } from "./provider-credential-delivery";
import { providerSetupQueryKeys } from "./provider-setup-api";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
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

const target = {
  workspaceId: "workspace-1",
  repositoryId: "repo-1",
  repositoryFullName: "acme/widget",
  enabled: true,
  canManage: true,
};
const issueUrl = "/api/dashboard/codex-rotating/setup-command";
const recoveryUrl = "/api/dashboard/codex-rotating/setup-recovery";
const confirmUrl = "/api/dashboard/provider-secret-setup/confirm";
const clients: QueryClient[] = [];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let storageWrites: {
  local: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof vi.fn>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function command(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return {
    command: "echo synthetic-codex-setup-only",
    expiresAt,
    providerInstanceId: "codex-rotating:123",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function view(
  props: Partial<React.ComponentProps<typeof RotatingProviderDelivery>> = {},
  existingClient?: QueryClient,
) {
  const client =
    existingClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  if (!existingClient) clients.push(client);
  const element = (next = props) => (
    <QueryClientProvider client={client}>
      <RotatingProviderDelivery {...target} {...next} />
    </QueryClientProvider>
  );
  const result = render(element());
  return {
    ...result,
    client,
    rerenderTarget: (next: typeof props) => result.rerender(element(next)),
  };
}

const statusAction = vi.mocked(checkProviderRepositorySecretClientAction);
const connected = () =>
  screen.queryByText("Codex is connected for acme/widget.");

beforeEach(() => {
  onlineManager.setOnline(true);
  statusAction.mockReset();
  statusAction.mockResolvedValue({ status: "missing" });
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (url === confirmUrl) return json({ params: {} });
    return json(command());
  });
  vi.stubGlobal("fetch", fetchMock);
  storageWrites = { local: vi.fn(), session: vi.fn() };
  vi.stubGlobal("localStorage", { setItem: storageWrites.local });
  vi.stubGlobal("sessionStorage", { setItem: storageWrites.session });
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("opens and reopens with a fresh readiness read and no issuance or recovery", async () => {
  statusAction.mockResolvedValue({ status: "available_repository" });
  const first = view();
  await screen.findByText("Codex is connected for acme/widget.");
  expect(fetchMock).not.toHaveBeenCalled();
  const reads = statusAction.mock.calls.length;
  await act(() =>
    first.client.refetchQueries({
      queryKey: providerSetupQueryKeys.secretStatus(
        target.workspaceId,
        target.repositoryId,
        "codex_subscription_oauth_rotating",
      ),
      exact: true,
    }),
  );
  expect(statusAction.mock.calls.length).toBeGreaterThan(reads);
  expect(fetchMock).not.toHaveBeenCalled();
  first.unmount();
  statusAction.mockResolvedValue({ status: "missing" });
  view({}, first.client);
  expect(connected()).toBeNull();
  await screen.findByText(/This repository's Codex setup is not confirmed yet/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["reopen", "refetch"] as const)(
  "does not treat cached availability as current success when a %s read rejects",
  async (read) => {
    statusAction.mockResolvedValue({ status: "available_repository" });
    const rendered = view();
    await screen.findByText("Codex is connected for acme/widget.");
    const queryKey = providerSetupQueryKeys.secretStatus(
      target.workspaceId,
      target.repositoryId,
      "codex_subscription_oauth_rotating",
    );
    statusAction.mockRejectedValue(new Error("READ_TRANSPORT_DETAIL"));
    if (read === "reopen") {
      rendered.unmount();
      view({}, rendered.client);
    } else {
      await act(() =>
        rendered.client.refetchQueries({ queryKey, exact: true }),
      );
    }
    await screen.findByText(
      "The current setup status could not be checked. Use Check GitHub setup to try again.",
    );
    // React Query deliberately retains the earlier data on a failed refetch.
    expect(rendered.client.getQueryData(queryKey)).toBe("available_repository");
    expect(rendered.client.getQueryState(queryKey)?.status).toBe("error");
    expect(connected()).toBeNull();
    expect(screen.queryByText("Setup verified")).toBeNull();
    expect(screen.queryByText(/READ_TRANSPORT_DETAIL/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    statusAction.mockResolvedValue({ status: "available_repository" });
    fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
    await screen.findByText("Setup verified");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([confirmUrl]);
  },
);

it("does not show cached availability when the fresh read is paused offline", async () => {
  statusAction.mockResolvedValue({ status: "available_repository" });
  const rendered = view();
  await screen.findByText("Codex is connected for acme/widget.");
  const reads = statusAction.mock.calls.length;
  rendered.unmount();
  onlineManager.setOnline(false);
  view({}, rendered.client);
  await screen.findByText(
    "The current setup status could not be checked. Use Check GitHub setup to try again.",
  );
  const queryKey = providerSetupQueryKeys.secretStatus(
    target.workspaceId,
    target.repositoryId,
    "codex_subscription_oauth_rotating",
  );
  expect(rendered.client.getQueryState(queryKey)).toMatchObject({
    data: "available_repository",
    status: "success",
    fetchStatus: "paused",
  });
  expect(connected()).toBeNull();
  expect(statusAction).toHaveBeenCalledTimes(reads);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => onlineManager.setOnline(true));
  await screen.findByText("Codex is connected for acme/widget.");
  expect(statusAction.mock.calls.length).toBeGreaterThan(reads);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("checks and confirms an existing setup without requesting any command", async () => {
  const event = vi.fn();
  window.addEventListener(providerSetupConfirmedEventName, event);
  try {
    view();
    await screen.findByText(
      /This repository's Codex setup is not confirmed yet/,
    );
    // Controlled positive adapter boundary: the server is already activated.
    statusAction.mockResolvedValue({ status: "available_repository" });
    fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
    await screen.findByText("Setup verified");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(confirmUrl);
    expect(
      Object.fromEntries(fetchMock.mock.calls[0]?.[1]?.body as FormData),
    ).toEqual({
      workspaceId: target.workspaceId,
      repositoryId: target.repositoryId,
      providerKind: "codex",
      authMode: "codex_subscription_oauth_rotating",
      secretScope: "repository",
      confirmationMode: "verified",
    });
    expect(event).toHaveBeenCalledOnce();
    expect((event.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      repositoryId: target.repositoryId,
      authMode: "codex_subscription_oauth_rotating",
    });
    expect(screen.queryByText(/Model answered/)).toBeNull();
  } finally {
    window.removeEventListener(providerSetupConfirmedEventName, event);
  }
});

it("keeps incomplete verification fail-closed without issuing a replacement", async () => {
  fetchMock.mockResolvedValue(
    json({ params: { error: "codex_rotating_setup_not_ready" } }),
  );
  view();
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText(/Return to repository setup to finish or merge/);
  expect(connected()).toBeNull();
  expect(screen.queryByText("Setup verified")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(confirmUrl);
});

it("clears a previous confirmation when the user explicitly reconnects", async () => {
  statusAction.mockResolvedValue({ status: "available_repository" });
  view();
  await screen.findByText("Codex is connected for acme/widget.");
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText("Setup verified");
  fireEvent.click(screen.getByRole("button", { name: "Reconnect Codex" }));
  await screen.findByText("echo synthetic-codex-setup-only");
  expect(screen.queryByText("Setup verified")).toBeNull();
  expect(connected()).toBeNull();
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    confirmUrl,
    issueUrl,
  ]);
});

it("issues only on request, clears old success, and treats expiry as presentation", async () => {
  statusAction.mockResolvedValue({ status: "available_repository" });
  const busy = vi.fn();
  const { client } = view({ onBusyChange: busy });
  await screen.findByText("Codex is connected for acme/widget.");
  expect(screen.getByText(/Requesting a setup command can pause/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect Codex" }));
  await screen.findByText("echo synthetic-codex-setup-only");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(issueUrl);
  expect(connected()).toBeNull();
  expect(busy).toHaveBeenCalledWith(true);
  await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
  expect(refresh).toHaveBeenCalled();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain("synthetic-codex-setup-only");
  expect(storageWrites.local).not.toHaveBeenCalled();
  expect(storageWrites.session).not.toHaveBeenCalled();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.now() + 120_000));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.getByText(/The start deadline has passed/)).toBeTruthy();
  expect(screen.getByText("echo synthetic-codex-setup-only")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("ignores a pre-issuance status read that resolves after the command", async () => {
  const oldRead = deferred<{ status: "available_repository" }>();
  statusAction.mockImplementationOnce(() => oldRead.promise);
  view();
  await waitFor(() => expect(statusAction).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Get setup command" }));
  await screen.findByText("echo synthetic-codex-setup-only");
  await act(async () => oldRead.resolve({ status: "available_repository" }));
  expect(connected()).toBeNull();
  expect(screen.queryByText("Setup verified")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not restore a cached green status after an ambiguous issuance result", async () => {
  statusAction.mockResolvedValue({ status: "available_repository" });
  fetchMock.mockRejectedValueOnce(
    new Error("DO_NOT_RENDER_RAW_TRANSPORT_DETAIL"),
  );
  view();
  await screen.findByText("Codex is connected for acme/widget.");
  fireEvent.click(screen.getByRole("button", { name: "Reconnect Codex" }));
  await screen.findByText(/The setup command result is unknown/);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(connected()).toBeNull();
  expect(screen.queryByText(/DO_NOT_RENDER_RAW_TRANSPORT_DETAIL/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
  await screen.findByText("Setup verified");
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    issueUrl,
    confirmUrl,
  ]);
});

it("requires recovery acknowledgement and retries a lost result with the same request ID", async () => {
  const recoveryReply = deferred<Response>();
  fetchMock.mockResolvedValueOnce(
    json({ error: "codex_rotating_setup_recovery_required" }, 409),
  );
  fetchMock.mockImplementationOnce(() => recoveryReply.promise);
  fetchMock.mockResolvedValueOnce(json(command()));
  view();
  fireEvent.click(screen.getByRole("button", { name: "Get setup command" }));
  const recover = await screen.findByRole("button", {
    name: "Recover and get a setup command",
  });
  expect((recover as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I confirm every earlier installer/ }),
  );
  fireEvent.click(recover);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(
    (
      screen.getByRole("button", {
        name: "Check GitHub setup",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  const firstRecovery = Object.fromEntries(
    fetchMock.mock.calls[1]?.[1]?.body as FormData,
  );
  expect(firstRecovery.acknowledgement).toBe(
    "all_prior_installers_and_writers_are_stopped",
  );
  expect(String(firstRecovery.recoveryRequestId)).not.toBe("");
  await act(async () => recoveryReply.reject(new TypeError("Failed to fetch")));
  await screen.findByText(/The recovery result is unknown/);
  const retry = await screen.findByRole("button", { name: "Retry recovery" });
  await waitFor(() =>
    expect((retry as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(retry);
  await screen.findByText("echo synthetic-codex-setup-only");
  expect(
    Object.fromEntries(fetchMock.mock.calls[2]?.[1]?.body as FormData),
  ).toEqual(firstRecovery);
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    issueUrl,
    recoveryUrl,
    recoveryUrl,
  ]);
});

it.each([
  ["codex_rotating_setup_issuance_quiesced", /paused for maintenance/],
  ["codex_rotating_identity_quarantined", /An operator must repair/],
])("does not suggest another issuance for %s", async (error, message) => {
  fetchMock.mockResolvedValueOnce(json({ error }, 409));
  view();
  fireEvent.click(screen.getByRole("button", { name: "Get setup command" }));
  await screen.findByText(message);
  expect(
    screen.queryByRole("button", { name: "Retry setup command" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Get setup command" }),
  ).toBeNull();
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Check GitHub setup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});

it("does not carry a late command into another repository or a reopened panel", async () => {
  const reply = deferred<Response>();
  fetchMock.mockImplementationOnce(() => reply.promise);
  const rendered = view();
  fireEvent.click(screen.getByRole("button", { name: "Get setup command" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  rendered.rerenderTarget({
    repositoryId: "repo-2",
    repositoryFullName: "acme/other",
  });
  await act(async () => reply.resolve(json(command())));
  expect(screen.queryByText("echo synthetic-codex-setup-only")).toBeNull();
  expect(
    screen.getByText(/Connect a dedicated Codex session for acme\/other/),
  ).toBeTruthy();
  rendered.unmount();
  view();
  expect(screen.queryByText("echo synthetic-codex-setup-only")).toBeNull();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("does not publish a late confirmation into another open repository", async () => {
  const reply = deferred<Response>();
  const event = vi.fn();
  window.addEventListener(providerSetupConfirmedEventName, event);
  try {
    fetchMock.mockImplementationOnce(() => reply.promise);
    const rendered = view();
    fireEvent.click(screen.getByRole("button", { name: "Check GitHub setup" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    rendered.rerenderTarget({
      repositoryId: "repo-2",
      repositoryFullName: "acme/other",
    });
    await act(async () => reply.resolve(json({ params: {} })));
    expect(event).not.toHaveBeenCalled();
    expect(screen.queryByText("Setup verified")).toBeNull();
    expect(
      screen.getByText(/Connect a dedicated Codex session for acme\/other/),
    ).toBeTruthy();
  } finally {
    window.removeEventListener(providerSetupConfirmedEventName, event);
  }
});

it("rejects a malformed deadline without showing the returned command", async () => {
  fetchMock.mockResolvedValueOnce(json(command("not-a-date")));
  view();
  fireEvent.click(screen.getByRole("button", { name: "Get setup command" }));
  await screen.findByText(/The setup command result is unknown/);
  expect(screen.queryByText("echo synthetic-codex-setup-only")).toBeNull();
  expect(screen.queryByText(/Invalid Date/)).toBeNull();
});
