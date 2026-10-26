// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccountView } from "../../src/server/account-gateway-accounts";
import type { ConnectionProbeEvent } from "../../src/features/account-gateway/connection-probe";
import { GatewayConnectionTest } from "./gateway-connection-test";
import { GatewayModelAccountsProvider } from "./gateway-model-account-options";

const account: AccountView = {
  connectionId: "connection-1",
  label: "Personal key",
  profileId: "profile-1",
  profileLabel: "Provider",
  state: "active",
  authorizationEpoch: 1,
  gatewayRevision: 1,
  mirrorRevision: 1,
  binding: {
    id: "binding-1",
    revision: 1,
    state: "active",
    fencePending: false,
  },
};
const api = { list: vi.fn(), get: vi.fn() };
function View({
  selected = account,
  available = true,
  scope = "viewer:workspace:workspace-1",
}: {
  selected?: AccountView;
  available?: boolean;
  scope?: string;
}) {
  return (
    <GatewayModelAccountsProvider scope={scope} api={api}>
      <GatewayConnectionTest
        bindingId="binding-1"
        model="model-1"
        available={available}
        account={selected}
      />
    </GatewayModelAccountsProvider>
  );
}
const ok: ConnectionProbeEvent = {
  type: "result",
  ok: true,
  elapsedMs: 1200,
  model: "model-1",
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => response([ok]));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function response(events: ConnectionProbeEvent[]) {
  return new Response(
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    { headers: { "content-type": "application/x-ndjson" } },
  );
}

it("runs only after a click and describes a dated model response, not a whole review check", async () => {
  render(<View />);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  expect(
    await screen.findByText("Model answered · model-1 · 1.2s."),
  ).toBeTruthy();
  expect(screen.getByText(/Account access can change/).textContent).toContain(
    "does not check review settings or tools",
  );
  expect(document.querySelector("time")?.getAttribute("datetime")).toMatch(
    /^\d{4}-\d{2}-\d{2}T/,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/dashboard/accounts/test");
  expect(Object.keys(JSON.parse(init.body)).sort()).toEqual([
    "bindingId",
    "context",
    "model",
    "nonce",
    "workspaceId",
  ]);
  expect(JSON.parse(init.body)).toMatchObject({
    context: "viewer",
    workspaceId: "workspace-1",
    bindingId: "binding-1",
    model: "model-1",
  });
});

it.each([
  { authorizationEpoch: 2 },
  { gatewayRevision: 2 },
  { mirrorRevision: 2 },
  { binding: { ...account.binding!, revision: 2 } },
  { state: "suspended" as const },
])(
  "discards a successful result when known account/access metadata changes: %j",
  async (change) => {
    const { rerender } = render(<View />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/Model answered/);
    rerender(<View selected={{ ...account, ...change }} />);
    expect(screen.queryByText(/Model answered/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it("aborts old work on workspace change and ignores a late terminal event", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: AbortSignal;
  fetchMock.mockImplementation(async (_url, init) => {
    signal = init.signal;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    );
  });
  const { rerender } = render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  rerender(<View scope="viewer:workspace:workspace-2" />);
  expect(signal.aborted).toBe(true);
  await act(async () => {
    stream.enqueue(new TextEncoder().encode(JSON.stringify(ok) + "\n"));
    stream.close();
  });
  expect(screen.queryByText(/Model answered/)).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Test connection",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("clears past success when the selected model is no longer available", async () => {
  const { rerender } = render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByText(/Model answered/);
  rerender(<View available={false} />);
  expect(screen.queryByText(/Model answered/)).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Test connection",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it.each(["timeout", "cleanup_pending", "denied"] as const)(
  "does not render successful model history for %s",
  async (code) => {
    fetchMock.mockResolvedValue(
      response([{ type: "result", ok: false, code }]),
    );
    render(<View />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Model answered/)).toBeNull();
    expect(document.querySelector("time")).toBeNull();
  },
);
