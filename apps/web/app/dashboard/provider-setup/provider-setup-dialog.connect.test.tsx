// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSetupView } from "../../../src/features/provider-setup/provider-setup-model";
import type {
  AccountOperationView,
  AccountProfileView,
  AccountsPage,
  AccountsResult,
  AccountView,
} from "../../../src/server/account-gateway-accounts";
import type { CredentialImportMethod } from "../../../src/features/account-gateway/connection-capabilities";
import {
  GatewayModelAccountsProvider,
  type GatewayModelAccountsApi,
} from "../gateway-model-account-options";
import { PersonalConnectProvider } from "../personal-connect-panel";
import {
  attachConnectedPersonalAccount,
  beginPersonalGatewayOAuth,
  listPersonalGatewayAccounts,
  pollPersonalGatewayOAuth,
  readPersonalGatewayOperation,
  submitPersonalGatewayKey,
} from "../personal-account-actions";
import { useInlineGatewayConnect } from "./gateway-credential-section";
import {
  ProviderSetupDialog,
  type ProviderSetupDialogProps,
} from "./provider-setup-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../actions", () => ({
  checkProviderRepositorySecretClientAction: vi.fn(),
}));
vi.mock("../provider-setup-actions", () => ({
  createProviderProfileAction: vi.fn(),
  inheritWorkspaceDefaultProviderAction: vi.fn(),
  saveProviderRosterAction: vi.fn(),
}));
// Only the server boundary is mocked; the connect form, its receipts and the
// dialog's account options are the real components.
vi.mock("../account-gateway-account-actions", () => ({
  beginGatewayNativeConnection: vi.fn(),
  continueGatewayNativeConnection: vi.fn(),
  beginGatewayOAuth: vi.fn(),
  completeGatewayOAuth: vi.fn(),
  pollGatewayOAuth: vi.fn(),
  bindGatewayAccount: vi.fn(),
  detachGatewayAccount: vi.fn(),
  listGatewayAccounts: vi.fn(),
  readGatewayOperation: vi.fn(),
  submitGatewayApiKey: vi.fn(),
  mutateGatewayAccount: vi.fn(),
}));
vi.mock("../account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));
vi.mock("../personal-account-actions", () => ({
  attachConnectedPersonalAccount: vi.fn(),
  beginPersonalGatewayNativeConnection: vi.fn(),
  continuePersonalGatewayNativeConnection: vi.fn(),
  beginPersonalGatewayOAuth: vi.fn(),
  completePersonalGatewayOAuth: vi.fn(),
  listPersonalGatewayAccounts: vi.fn(),
  mutatePersonalGatewayAccount: vi.fn(),
  pollPersonalGatewayOAuth: vi.fn(),
  readPersonalGatewayOperation: vi.fn(),
  submitPersonalGatewayKey: vi.fn(),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const scope = "personal-viewer";
const model = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const nvidia: AccountProfileView = {
  id: "nvidia-build-chat-apikey-v1",
  label: "NVIDIA Build",
  protocol: "openai-responses",
  availability: "enabled",
  authKind: "api_key",
  provider: "nvidia",
  models: [model],
  connection: {
    provider: "nvidia",
    planLabel: "API",
    regionLabel: "Global",
    completionInputKind: "none",
    limitsContract: "none",
    modelSettings: [
      {
        modelId: model,
        reasoning: null,
        fast: null,
        tools: { allowed: ["function"], default: "function" },
      },
    ],
  },
};
const codex: AccountProfileView = {
  id: "openai-codex-oauth-responses-v1",
  label: "Codex",
  protocol: "openai-responses",
  availability: "enabled",
  authKind: "oauth",
  provider: "codex",
  models: ["gpt-5.6-sol", "gpt-5.5"],
};
function importProfile(method: CredentialImportMethod): AccountProfileView {
  return {
    ...codex,
    connection: {
      provider: "openai",
      planLabel: "Codex subscription",
      regionLabel: "Global",
      completionInputKind: "none",
      limitsContract: "account-limits/v2",
      modelSettings: [],
      methods: [
        {
          kind: "credential_import",
          method,
          maxBytes: 65536,
          create: true,
          reconnect: true,
        },
      ],
    },
  };
}
const connected: AccountView = {
  connectionId: "binding-new",
  label: "NVIDIA Build",
  profileId: nvidia.id,
  profileLabel: nvidia.label,
  state: "active",
  gatewayRevision: 1,
  mirrorRevision: 1,
  origin: "personal",
  // NVIDIA admits a model only from this exact account's fresh catalogue.
  modelCatalog: {
    status: "snapshot",
    source: "nvidia",
    fetchedAt: "2026-11-19T12:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    models: [model],
  },
  binding: {
    id: "binding-new",
    revision: 1,
    state: "active",
    fencePending: false,
  },
};
let profiles: AccountProfileView[];
const page = (accounts: AccountView[]): AccountsResult<AccountsPage> => ({
  status: "ok",
  value: { accounts, profiles, nextCursor: null },
});
const operation = (
  nonce: string,
  state: AccountOperationView["state"],
): AccountsResult<AccountOperationView> => ({
  status: "ok",
  value: {
    nonce,
    state,
    cleanup: "unresolved",
    ...(state === "applied" ? { account: connected } : {}),
  },
});

let view: ProviderSetupView;
let workspaceAccounts: AccountView[];
let listFails: boolean;

beforeEach(() => {
  sessionStorage.clear();
  profiles = [nvidia, codex];
  workspaceAccounts = [];
  listFails = false;
  view = {
    workspaceId: "workspace_1",
    target: "workspace",
    repositories: [],
    defaultSelection: null,
    profiles: [],
    sources: [
      {
        key: "gateway_binding",
        credentialKind: "gateway_binding",
        authMode: "codex_account_gateway",
        decision: { allowed: true },
        personalAccountDecision: { allowed: true },
      },
    ],
    viewerIsAdmin: true,
    gatewaySetupProviders: ["nvidia", "codex"],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => view }) as Response),
  );
  vi.mocked(listPersonalGatewayAccounts).mockResolvedValue(page([]));
  vi.mocked(submitPersonalGatewayKey).mockImplementation(
    async (_context, intent) => operation(intent.nonce, "applied"),
  );
  vi.mocked(readPersonalGatewayOperation).mockImplementation(
    async (_context, nonce) => operation(nonce, "applied"),
  );
  vi.mocked(attachConnectedPersonalAccount).mockImplementation(async () => {
    // The workspace list shows the connection once it is added.
    workspaceAccounts = [connected];
    return {
      status: "ok",
      value: { status: "attached", bindingId: "binding-new" },
    };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

function renderAddProvider(
  personalConnect = true,
  dialog: Partial<ProviderSetupDialogProps> = {},
) {
  const api: GatewayModelAccountsApi = {
    list: vi.fn(async () =>
      listFails ? { status: "unavailable" as const } : page(workspaceAccounts),
    ),
    get: vi.fn(async (bindingId: string) => {
      const account = workspaceAccounts.find(
        (row) => row.binding?.id === bindingId,
      );
      return account
        ? {
            status: "ok" as const,
            value: {
              account,
              profile: profiles.find((row) => row.id === account.profileId)!,
            },
          }
        : { status: "unavailable" as const };
    }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GatewayModelAccountsProvider
        scope={`${scope}:workspace:workspace_1`}
        api={api}
      >
        <PersonalConnectProvider
          place={
            personalConnect
              ? { scope, workspaceId: "workspace_1", workspaceName: "Acme" }
              : null
          }
        >
          <ProviderSetupDialog
            workspaceId="workspace_1"
            target={{ kind: "workspace" }}
            mode="add"
            triggerLabel="Add provider"
            mutationsEnabled
            modelOptions={[]}
            gatewayAccounts={page(workspaceAccounts)}
            agentProfileOptions={[]}
            {...dialog}
          />
        </PersonalConnectProvider>
      </GatewayModelAccountsProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
}

async function chooseProvider(name: RegExp) {
  const providers = await screen.findByRole("radiogroup", { name: "Provider" });
  fireEvent.click(await within(providers).findByRole("radio", { name }));
}

function expectProviderChoiceDisabled(disabled: boolean) {
  const providers = screen.getByRole("radiogroup", { name: "Provider" });
  for (const name of [/^Codex/, /NVIDIA Build/]) {
    expect(
      within(providers)
        .getByRole("radio", { name })
        .getAttribute("aria-disabled"),
    ).toBe(disabled ? "true" : null);
  }
}

function enterKey(form: HTMLElement) {
  const key = form.querySelector<HTMLInputElement>('input[name="credential"]')!;
  fireEvent.change(key, { target: { value: "synthetic-nvidia-key" } });
  fireEvent.click(
    within(form).getByRole("button", { name: "Connect account" }),
  );
}

/** Chooses Codex and starts a device-code sign-in that keeps waiting. */
async function startWaitingCodexSignIn() {
  vi.mocked(beginPersonalGatewayOAuth).mockImplementation(
    async (_context, intent) => ({
      status: "ok",
      value: {
        operation: {
          nonce: intent.nonce,
          state: "pending",
          oauthMethod: "device_code",
          cleanup: "unresolved",
        },
        deviceAuthorization: {
          userCode: "WXYZ-1234",
          verificationURL: "https://auth.openai.com/codex/device",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          intervalSeconds: 60,
        },
      },
    }),
  );
  vi.mocked(readPersonalGatewayOperation).mockImplementation(
    async (_context, nonce) => ({
      status: "ok",
      value: {
        nonce,
        state: "pending",
        oauthMethod: "device_code",
        cleanup: "unresolved",
      },
    }),
  );
  await chooseProvider(/^Codex/);
  const form = await screen.findByRole("region", { name: "Connect Codex" });
  const start = await within(form).findByRole("button", {
    name: "Sign in to Codex",
  });
  await waitFor(() => expect(start).toHaveProperty("disabled", false));
  fireEvent.click(start);
  await within(form).findByText("WXYZ-1234");
  return form;
}

describe("adding a provider and connecting its account in one dialog", () => {
  it.each(["refresh_token", "oauth_auth_json"] as const)(
    "imports Codex %s in place and selects the attached connection",
    async (method) => {
      profiles = [nvidia, importProfile(method)];
      vi.mocked(listPersonalGatewayAccounts).mockResolvedValue(page([]));
      const imported: AccountView = {
        connectionId: "binding-codex-import",
        profileId: codex.id,
        profileLabel: codex.label,
        label: "Imported Codex",
        authKind: "oauth",
        state: "active",
        gatewayRevision: 1,
        mirrorRevision: 1,
        origin: "personal",
        binding: { ...connected.binding!, id: "binding-codex-import" },
      };
      const applied = (
        nonce: string,
      ): AccountsResult<AccountOperationView> => ({
        status: "ok",
        value: {
          nonce,
          state: "applied",
          cleanup: "unresolved",
          account: imported,
        },
      });
      vi.mocked(submitPersonalGatewayKey).mockImplementation(
        async (_scope, intent) => applied(intent.nonce),
      );
      vi.mocked(readPersonalGatewayOperation).mockImplementation(
        async (_scope, nonce) => applied(nonce),
      );
      vi.mocked(attachConnectedPersonalAccount).mockImplementation(async () => {
        workspaceAccounts = [imported];
        return {
          status: "ok",
          value: { status: "attached", bindingId: "binding-codex-import" },
        };
      });
      renderAddProvider();
      await chooseProvider(/^Codex/);
      const form = await screen.findByRole("region", { name: "Connect Codex" });
      const label =
        method === "refresh_token" ? "Refresh token" : "Codex auth.json";
      const field = await within(form).findByLabelText(label);
      const credential =
        method === "refresh_token"
          ? "synthetic-inline-refresh-token"
          : '{"tokens":{"refresh_token":"synthetic-inline-auth-json"}}';
      fireEvent.input(field, { target: { value: credential } });
      const submit = within(form).getByRole("button", {
        name: `Import ${label}`,
      });
      await waitFor(() => expect(submit).toHaveProperty("disabled", false));
      fireEvent.click(submit);
      await screen.findByText("Connected and added to this workspace.");
      expect(submitPersonalGatewayKey).toHaveBeenCalledExactlyOnceWith(
        scope,
        expect.objectContaining({
          kind: "connect",
          profileId: codex.id,
          credentialImportMethod: method,
        }),
        credential,
      );
      expect(beginPersonalGatewayOAuth).not.toHaveBeenCalled();
      expect(attachConnectedPersonalAccount).toHaveBeenCalledExactlyOnceWith(
        scope,
        "workspace_1",
        vi.mocked(submitPersonalGatewayKey).mock.calls[0]![1].nonce,
      );
      expect(
        screen.getByRole("combobox", { name: /^Account\b/ }).textContent,
      ).toContain("Imported Codex");
      expect(document.body.innerHTML).not.toContain(credential);
      expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(
        credential,
      );
    },
  );

  it("clears unsubmitted imports, errors and late file reads when switching the embedded provider", async () => {
    profiles = [nvidia, importProfile("oauth_auth_json")];
    vi.mocked(listPersonalGatewayAccounts).mockResolvedValue(page([]));
    renderAddProvider();
    const chooseCodex = async () => {
      await chooseProvider(/^Codex/);
      return screen.findByRole("region", { name: "Connect Codex" });
    };
    const form = await chooseCodex();
    const field = await within(form).findByLabelText("Codex auth.json");
    fireEvent.input(field, { target: { value: "é".repeat(32769) } });
    fireEvent.click(
      within(form).getByRole("button", { name: "Import Codex auth.json" }),
    );
    expect(within(form).getByRole("alert").textContent).toContain("64 KiB");
    await chooseProvider(/NVIDIA Build/);
    const keyForm = await screen.findByRole("region", {
      name: "Connect NVIDIA Build",
    });
    await waitFor(() =>
      expect(keyForm.querySelector('input[name="credential"]')).not.toBeNull(),
    );
    expect(within(keyForm).queryByRole("alert")).toBeNull();
    const returned = await chooseCodex();
    const newField = await within(returned).findByLabelText("Codex auth.json");
    expect(newField).toHaveProperty("value", "");
    expect(within(returned).queryByRole("alert")).toBeNull();
    let finishRead!: (text: string) => void;
    const file = new File(["deferred"], "auth.json");
    Object.defineProperty(file, "text", {
      value: () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    });
    fireEvent.change(
      within(returned).getByLabelText("Or choose an auth.json file"),
      {
        target: { files: [file] },
      },
    );
    await chooseProvider(/NVIDIA Build/);
    const fresh = await chooseCodex();
    const freshField = await within(fresh).findByLabelText("Codex auth.json");
    await act(async () => finishRead("synthetic-stale-file-secret"));
    expect(freshField).toHaveProperty("value", "");
    expect(
      within(fresh).getByRole("button", { name: "Import Codex auth.json" }),
    ).toHaveProperty("disabled", false);
    expect(submitPersonalGatewayKey).not.toHaveBeenCalled();
    expect(beginPersonalGatewayOAuth).not.toHaveBeenCalled();
  });

  it("connects an API key in place, selects the new connection and its model", async () => {
    renderAddProvider();
    await chooseProvider(/NVIDIA Build/);
    const form = await screen.findByRole("region", {
      name: "Connect NVIDIA Build",
    });
    // The dialog already chose the provider and the storage.
    expect(
      within(form).queryByRole("combobox", { name: /Provider/ }),
    ).toBeNull();
    expect(within(form).queryByRole("radio", { name: /GitHub/ })).toBeNull();
    expect(
      within(form).getByText(
        "You own this connection. It is added to Acme as soon as it connects.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(form.querySelector('input[name="credential"]')).not.toBeNull(),
    );

    enterKey(form);

    await screen.findByText("Connected and added to this workspace.");
    expect(attachConnectedPersonalAccount).toHaveBeenCalledExactlyOnceWith(
      scope,
      "workspace_1",
      vi.mocked(submitPersonalGatewayKey).mock.calls[0]![1].nonce,
    );
    expect(
      screen.queryByRole("region", { name: "Connect NVIDIA Build" }),
    ).toBeNull();
    expect(
      screen.getByRole("combobox", { name: /^Account\b/ }).textContent,
    ).toContain("NVIDIA Build");
    // Its only usable model is suggested, so saving needs no further choice.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /^Model\b/ })).toHaveProperty(
        "value",
        model,
      ),
    );
    // No default yet: the new provider becomes it unless the user unticks it.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add and make default" }),
      ).toHaveProperty("disabled", false),
    );
    // The used request leaves no receipt behind in this tab.
    expect(
      JSON.parse(
        sessionStorage.getItem(`rr-c3-account-operations:personal:${scope}`) ??
          "[]",
      ),
    ).toEqual([]);
  });

  it("keeps a declined key in the form and lets the user try again", async () => {
    vi.mocked(submitPersonalGatewayKey).mockImplementation(
      async (_context, intent) => operation(intent.nonce, "rejected"),
    );
    vi.mocked(readPersonalGatewayOperation).mockImplementation(
      async (_context, nonce) => operation(nonce, "rejected"),
    );
    renderAddProvider();
    await chooseProvider(/NVIDIA Build/);
    const form = await screen.findByRole("region", {
      name: "Connect NVIDIA Build",
    });
    await waitFor(() =>
      expect(form.querySelector('input[name="credential"]')).not.toBeNull(),
    );
    enterKey(form);

    await within(form).findByText("Declined");
    // A request in progress holds the provider choice in place.
    expectProviderChoiceDisabled(true);
    fireEvent.click(
      within(form).getByRole("button", { name: "Add another account" }),
    );
    await waitFor(() =>
      expect(form.querySelector('input[name="credential"]')).not.toBeNull(),
    );
    expectProviderChoiceDisabled(false);
    expect(attachConnectedPersonalAccount).not.toHaveBeenCalled();
  });

  it("does not choose a connection that was not added to this workspace", async () => {
    vi.mocked(attachConnectedPersonalAccount).mockResolvedValue({
      status: "ok",
      value: { status: "not_attached", reason: "not_permitted" },
    });
    renderAddProvider();
    await chooseProvider(/NVIDIA Build/);
    const form = await screen.findByRole("region", {
      name: "Connect NVIDIA Build",
    });
    await waitFor(() =>
      expect(form.querySelector('input[name="credential"]')).not.toBeNull(),
    );
    enterKey(form);

    await within(form).findByText(/Not added to this workspace/);
    expect(
      screen.queryByText("Connected and added to this workspace."),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Model\b/ })).toBeNull();
  });

  it("tells a member why they cannot connect here instead of showing the form", async () => {
    view = {
      ...view,
      sources: [
        {
          ...view.sources[0]!,
          personalAccountDecision: {
            allowed: false,
            reason: "workspace_admin_required",
          },
        },
      ],
    };
    renderAddProvider();
    await chooseProvider(/NVIDIA Build/);

    await screen.findByText("Only workspace owners and admins can do this.");
    expect(
      screen.queryByRole("region", { name: "Connect NVIDIA Build" }),
    ).toBeNull();
    expect(listPersonalGatewayAccounts).not.toHaveBeenCalled();
  });

  it("keeps the form and its request while the dialog's lists cannot be reread", async () => {
    vi.mocked(submitPersonalGatewayKey).mockImplementation(
      async (_context, intent) => {
        // The connection is still confirming, and every reread now fails.
        listFails = true;
        return operation(intent.nonce, "pending");
      },
    );
    vi.mocked(readPersonalGatewayOperation).mockImplementation(
      async (_context, nonce) => operation(nonce, "pending"),
    );
    renderAddProvider();
    await chooseProvider(/NVIDIA Build/);
    const form = await screen.findByRole("region", {
      name: "Connect NVIDIA Build",
    });
    await waitFor(() =>
      expect(form.querySelector('input[name="credential"]')).not.toBeNull(),
    );
    enterKey(form);

    await within(form).findByText("Waiting for completion");
    await screen.findByText("Could not load the account list.");
    expect(
      screen.getByRole("region", { name: "Connect NVIDIA Build" }),
    ).toBeTruthy();
    expectProviderChoiceDisabled(true);
  });

  it("offers a new connection beside the existing ones and closes it again", async () => {
    workspaceAccounts = [{ ...connected, label: "Team NVIDIA" }];
    renderAddProvider();
    await chooseProvider(/NVIDIA Build/);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: /^Account\b/ }).textContent,
      ).toContain("Team NVIDIA"),
    );
    expect(
      screen.queryByRole("region", { name: "Connect NVIDIA Build" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New connection" }));
    const form = await screen.findByRole("region", {
      name: "Connect NVIDIA Build",
    });
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("region", { name: "Connect NVIDIA Build" }),
    ).toBeNull();
  });

  it("keeps the link to Connections where personal connections are off", async () => {
    renderAddProvider(false);
    await chooseProvider(/NVIDIA Build/);

    await screen.findByRole("link", { name: "Connect account" });
    expect(
      screen.queryByRole("region", { name: "Connect NVIDIA Build" }),
    ).toBeNull();
  });

  it("signs in to Codex with a device code inside the dialog and selects the new account", async () => {
    const codexAccount: AccountView = {
      connectionId: "binding-codex",
      label: "Codex",
      profileId: codex.id,
      profileLabel: codex.label,
      authKind: "oauth",
      state: "active",
      gatewayRevision: 1,
      mirrorRevision: 1,
      origin: "personal",
      binding: { ...connected.binding!, id: "binding-codex" },
    };
    vi.mocked(beginPersonalGatewayOAuth).mockImplementation(
      async (_context, intent) => ({
        status: "ok",
        value: {
          operation: {
            nonce: intent.nonce,
            state: "pending",
            oauthMethod: "device_code",
            cleanup: "unresolved",
          },
          deviceAuthorization: {
            userCode: "WXYZ-1234",
            verificationURL: "https://auth.openai.com/codex/device",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            intervalSeconds: 1,
          },
        },
      }),
    );
    const applied = (nonce: string) => ({
      status: "ok" as const,
      value: {
        nonce,
        state: "applied" as const,
        oauthMethod: "device_code" as const,
        account: codexAccount,
        cleanup: "unresolved" as const,
      },
    });
    const pending = (nonce: string) => ({
      status: "ok" as const,
      value: {
        nonce,
        state: "pending" as const,
        oauthMethod: "device_code" as const,
        cleanup: "unresolved" as const,
      },
    });
    // The first check still waits for the user, so the code must survive the
    // reread of the lists that follows the start of the sign-in.
    let polls = 0;
    vi.mocked(pollPersonalGatewayOAuth).mockImplementation(
      async (_context, nonce) =>
        ++polls === 1 ? pending(nonce) : applied(nonce),
    );
    vi.mocked(readPersonalGatewayOperation).mockImplementation(
      async (_context, nonce) => (polls < 2 ? pending(nonce) : applied(nonce)),
    );
    vi.mocked(attachConnectedPersonalAccount).mockImplementation(async () => {
      workspaceAccounts = [codexAccount];
      return {
        status: "ok",
        value: { status: "attached", bindingId: "binding-codex" },
      };
    });
    renderAddProvider();
    await chooseProvider(/^Codex/);
    const form = await screen.findByRole("region", { name: "Connect Codex" });
    const start = await within(form).findByRole("button", {
      name: "Sign in to Codex",
    });
    await waitFor(() => expect(start).toHaveProperty("disabled", false));
    fireEvent.click(start);

    // The code is shown in the dialog, and the choice stays put meanwhile.
    await within(form).findByText("WXYZ-1234");
    expectProviderChoiceDisabled(true);
    await waitFor(() =>
      expect(
        vi.mocked(listPersonalGatewayAccounts).mock.calls.length,
      ).toBeGreaterThan(1),
    );
    await waitFor(() => expect(polls).toBe(1), { timeout: 5000 });
    expect(within(form).getByText("WXYZ-1234")).toBeTruthy();

    await screen.findByText(
      "Connected and added to this workspace.",
      undefined,
      {
        timeout: 8000,
      },
    );
    expect(
      screen.getByRole("combobox", { name: /^Account\b/ }).textContent,
    ).toContain("Codex");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /^Model\b/ })).toHaveProperty(
        "value",
        "gpt-5.6-sol",
      ),
    );
  }, 15_000);

  it("lets the user leave a waiting sign-in and start over", async () => {
    renderAddProvider();
    const form = await startWaitingCodexSignIn();

    fireEvent.click(
      within(form).getByRole("button", { name: "Cancel sign-in" }),
    );

    await within(form).findByRole("button", { name: "Sign in to Codex" });
    expectProviderChoiceDisabled(false);
    // The waiting request stays a receipt in Connections.
    expect(
      JSON.parse(
        sessionStorage.getItem(`rr-c3-account-operations:personal:${scope}`) ??
          "[]",
      ),
    ).toHaveLength(1);
  });

  it("keeps the dialog's other views closed while a sign-in waits", async () => {
    view = {
      ...view,
      target: "repositories",
      repositories: [
        {
          id: "repo_1",
          fullName: "acme/api",
          source: "none",
          selection: null,
          useDefault: { allowed: true },
        },
      ],
    };
    renderAddProvider(true, {
      mode: "choose",
      target: {
        kind: "repository",
        repository: {
          id: "repo_1",
          fullName: "acme/api",
          visibility: "private",
          canManageCredentials: true,
          effective: {
            authMode: "openrouter_api_key",
            credentialKind: "user_ci_secret",
          },
          secretGuidance: null,
          organizationLogin: null,
          organizationSecretPolicy: null,
          rotatingEnabled: false,
        },
      },
    });
    const form = await startWaitingCodexSignIn();

    // Each of them would replace the form and lose the device code.
    const views = () =>
      ["Configure connected-account reviewers", "1. Provider", "2. Add secret"]
        .map((name) => screen.getByRole("button", { name }))
        .map((button) => (button as HTMLButtonElement).disabled);
    expect(views()).toEqual([true, true, true]);
    fireEvent.click(
      within(form).getByRole("button", { name: "Cancel sign-in" }),
    );
    await within(form).findByRole("button", { name: "Sign in to Codex" });
    expect(views()).toEqual([false, false, false]);
  });

  it("keeps an open form when a reread of the dialog's lists fails", () => {
    const place = { scope, workspaceId: "workspace_1", workspaceName: "Acme" };
    function Form(props: { available: boolean; readFailed: boolean }) {
      const inline = useInlineGatewayConnect({
        ...props,
        empty: props.available,
        onConnected: () => {},
      });
      return <p>{inline.show ? "Form shown" : "Form gone"}</p>;
    }
    const view = (available: boolean, readFailed: boolean) => (
      <PersonalConnectProvider place={place}>
        <Form available={available} readFailed={readFailed} />
      </PersonalConnectProvider>
    );
    const { rerender } = render(view(true, false));
    expect(screen.getByText("Form shown")).toBeTruthy();
    // A failed reread leaves no list to say the provider can connect here,
    // yet a key typed into the form and not sent yet stays.
    rerender(view(false, true));
    expect(screen.getByText("Form shown")).toBeTruthy();
    // A read that rules the provider out here closes it.
    rerender(view(false, false));
    expect(screen.getByText("Form gone")).toBeTruthy();
  });
});
