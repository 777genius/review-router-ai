// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type {
  AccountsPage,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import {
  GatewayModelAccountsProvider,
  useGatewayModelAccounts,
  type GatewayModelAccountsApi,
} from "./gateway-model-account-options";
import { getReadyGatewayAccounts } from "../../src/server/dashboard-provider-setup-readiness";

afterEach(cleanup);
const profile = {
  id: "mimo",
  label: "MiMo",
  protocol: "openai-responses" as const,
  models: ["mimo-v2.6-pro"],
};
const account = (id: string): AccountView => ({
  connectionId: "canonical-source",
  label: id,
  profileId: profile.id,
  profileLabel: profile.label,
  state: "active",
  gatewayRevision: 3,
  mirrorRevision: 7,
  binding: { id, revision: 1, state: "active", fencePending: false },
});
const page: AccountsPage = {
  accounts: [account("page-one")],
  profiles: [profile],
  nextCursor: "page-one",
};
function Harness() {
  const options = useGatewayModelAccounts({ status: "ok", value: page }, [
    "saved-binding",
  ]);
  const ready = getReadyGatewayAccounts(options.accounts);
  return (
    <>
      <input aria-label="Saved binding" value="saved-binding" readOnly />
      <span>
        {ready.some((row) => row.binding?.id === "saved-binding")
          ? "Saved selection available"
          : "Saved selection unavailable"}
      </span>
      {ready.map((row) => (
        <span key={row.binding!.id}>{row.label}</span>
      ))}
      <button onClick={options.loadMore}>Load more</button>
      <button onClick={options.refresh}>Refresh</button>
    </>
  );
}
test("exact saved offpage binding stays selected, while a retired binding never follows a fresh lifetime", async () => {
  const api = {
    list: vi.fn<GatewayModelAccountsApi["list"]>().mockResolvedValue({
      status: "ok",
      value: {
        accounts: [account("fresh-binding")],
        profiles: [profile],
        nextCursor: null,
      },
    }),
    get: vi.fn<GatewayModelAccountsApi["get"]>().mockResolvedValue({
      status: "ok",
      value: { account: account("saved-binding"), profile },
    }),
  };
  render(
    <GatewayModelAccountsProvider scope="org-x" api={api}>
      <Harness />
    </GatewayModelAccountsProvider>,
  );
  expect(await screen.findByText("Saved selection available")).toBeTruthy();
  fireEvent.click(screen.getByText("Load more"));
  expect(await screen.findByText("fresh-binding")).toBeTruthy();
  expect(api.list).toHaveBeenCalledWith({
    afterBindingId: "page-one",
    limit: 25,
  });
  api.get.mockResolvedValue({ status: "denied" });
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(screen.getByText("Saved selection unavailable")).toBeTruthy(),
  );
  expect(
    (screen.getByLabelText("Saved binding") as HTMLInputElement).value,
  ).toBe("saved-binding");
  expect(screen.getByText("fresh-binding")).toBeTruthy();
  expect(
    api.get.mock.calls.every(([bindingId]) => bindingId === "saved-binding"),
  ).toBe(true);
});
