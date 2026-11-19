// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AccountView } from "../../src/server/account-gateway-accounts";
import { getGatewaySetupAccounts } from "../../src/server/dashboard-provider-setup-readiness";
import { gatewayProviderModelOptions } from "../../src/features/provider-setup/provider-model-options";
import {
  GatewayModelAccountsProvider,
  useGatewayModelAccounts,
  type GatewayModelAccountsApi,
} from "./gateway-model-account-options";
import { GatewayModelCatalogStatus } from "./gateway-model-catalog-status";

// An NVIDIA account offers a model only from its own fresh list, which native
// keeps valid for one minute. The open picker must keep it current by itself.
const MODEL = "nvidia/nemotron";
const BINDING = "nvidia-binding";
const connection = {
  provider: "nvidia" as const,
  planLabel: "Trial",
  regionLabel: "Global",
  completionInputKind: "none" as const,
  limitsContract: "none" as const,
  modelSettings: [],
};
const profile = {
  id: "nvidia-build-chat-apikey-v1",
  label: "NVIDIA",
  protocol: "openai-responses" as const,
  authKind: "api_key" as const,
  models: [MODEL],
  connection,
};
const account: AccountView = {
  connectionId: "nvidia-connection",
  label: "NVIDIA trial",
  profileId: profile.id,
  profileLabel: profile.label,
  state: "active",
  gatewayRevision: 1,
  mirrorRevision: 1,
  binding: { id: BINDING, revision: 1, state: "active", fencePending: false },
};
type Detail = Awaited<ReturnType<GatewayModelAccountsApi["get"]>>;
const fresh = (): Detail => ({
  status: "ok",
  value: {
    account: {
      ...account,
      modelCatalog: {
        status: "snapshot",
        source: "nvidia",
        fetchedAt: new Date(Date.now()).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        models: [MODEL],
      },
    },
    profile: {
      ...profile,
      connection: {
        ...connection,
        modelSettings: [
          {
            modelId: MODEL,
            reasoning: null,
            fast: null,
            tools: { allowed: ["function"], default: "function" },
          },
        ],
      },
    },
  },
});
const failed = (): Detail => ({
  status: "ok",
  value: {
    account: {
      ...account,
      modelCatalog: { status: "unknown", source: "legacy_profile", models: [] },
    },
    profile: { ...profile, models: [] },
  },
});

function Picker() {
  const options = useGatewayModelAccounts(
    {
      status: "ok",
      value: { accounts: [account], profiles: [profile], nextCursor: null },
    },
    [BINDING],
  );
  const selected = getGatewaySetupAccounts(options.accounts).find(
    (row) => row.binding?.id === BINDING,
  );
  const selectedProfile = options.profileFor(selected);
  const choices = gatewayProviderModelOptions([], selectedProfile, {
    catalog: selected?.modelCatalog,
    requiresTools: true,
  });
  return (
    <>
      <span>
        Selectable:
        {choices
          .filter((choice) => !choice.disabled)
          .map((choice) => choice.value)
          .join(",")}
      </span>
      <GatewayModelCatalogStatus
        account={selected}
        profile={selectedProfile}
        loading={options.loading}
        canRefresh={options.canRefresh}
        onRefresh={() => options.refreshModels(BINDING)}
      />
    </>
  );
}
function Dialog({
  api,
  open,
}: {
  api: GatewayModelAccountsApi;
  open: boolean;
}) {
  return (
    <GatewayModelAccountsProvider scope="viewer:workspace:org-x" api={api}>
      {open ? <Picker /> : null}
    </GatewayModelAccountsProvider>
  );
}
const wait = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const apiWith = (get: GatewayModelAccountsApi["get"]) => ({
  list: vi.fn<GatewayModelAccountsApi["list"]>(),
  get,
});
const automaticReads = (get: { mock: { calls: unknown[][] } }) =>
  get.mock.calls.filter((call) => call[1] === undefined).length;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-19T12:00:00.000Z") });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("reads the list again before it lapses, so the model stays selectable without a click", async () => {
  const get = vi.fn<GatewayModelAccountsApi["get"]>(async () => fresh());
  render(<Dialog api={apiWith(get)} open />);
  await wait();
  expect(screen.getByText(`Selectable:${MODEL}`)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "Model list updated just now.",
  );
  await wait(44_000);
  expect(get).toHaveBeenCalledTimes(1);
  await wait(2_000);
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenLastCalledWith(BINDING);
  // Well past the first list's expiry the model is still selectable.
  await wait(30_000);
  expect(screen.getByText(`Selectable:${MODEL}`)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("reopening after the list lapsed updates it once, then offers the model", async () => {
  let release!: (value: Detail) => void;
  const get = vi
    .fn<GatewayModelAccountsApi["get"]>()
    .mockImplementationOnce(async () => fresh())
    .mockImplementationOnce(
      () => new Promise<Detail>((resolve) => (release = resolve)),
    );
  const api = apiWith(get);
  const { rerender } = render(<Dialog api={api} open />);
  await wait();
  rerender(<Dialog api={api} open={false} />);
  await wait(2 * 60_000);
  rerender(<Dialog api={api} open />);
  await wait();
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Selectable:")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "The model list for this account is out of date. Updating it now…",
  );
  await act(async () => release(fresh()));
  expect(screen.getByText(`Selectable:${MODEL}`)).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});

test("does not read a fresh list again when the picker reopens", async () => {
  const get = vi.fn<GatewayModelAccountsApi["get"]>(async () => fresh());
  const api = apiWith(get);
  const { rerender } = render(<Dialog api={api} open />);
  await wait();
  rerender(<Dialog api={api} open={false} />);
  await wait(10_000);
  rerender(<Dialog api={api} open />);
  await wait();
  expect(get).toHaveBeenCalledTimes(1);
  expect(screen.getByText(`Selectable:${MODEL}`)).toBeTruthy();
});

test("a failed update says so with Try again, never loops, and is read again only after a cooldown", async () => {
  const get = vi.fn<GatewayModelAccountsApi["get"]>(async () => failed());
  const api = apiWith(get);
  const { rerender } = render(<Dialog api={api} open />);
  await wait();
  expect(screen.getByRole("status").textContent).toBe(
    "Could not update the model list for this account.",
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.getByText("Selectable:")).toBeTruthy();
  // Reopening inside the one-minute cooldown does not read again.
  await wait(30_000);
  rerender(<Dialog api={api} open={false} />);
  rerender(<Dialog api={api} open />);
  await wait();
  expect(automaticReads(get)).toBe(1);
  // Nothing retries while the picker stays open.
  await wait(5 * 60_000);
  expect(automaticReads(get)).toBe(1);
  // After the cooldown a new open reads once.
  rerender(<Dialog api={api} open={false} />);
  rerender(<Dialog api={api} open />);
  await wait();
  expect(automaticReads(get)).toBe(2);
  // Try again forces a fresh read and the model becomes selectable.
  get.mockImplementation(async () => fresh());
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await wait();
  expect(get).toHaveBeenLastCalledWith(BINDING, { forceRefresh: true });
  expect(screen.getByText(`Selectable:${MODEL}`)).toBeTruthy();
});
