// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { AccountLimitsView } from "../../src/server/account-gateway-accounts";
import { AccountLimitsLine } from "./account-limits-line";
import { accountLimitsKey, extractAccountLimits } from "./account-limits-query";

const now = "2026-10-22T10:00:00.000Z";
function snapshot(): AccountLimitsView {
  return {
    status: "snapshot",
    fetchedAt: now,
    displayToken: "generation-a",
    refreshAvailable: false,
    scope: "subscription",
    windows: [
      {
        label: "5h",
        durationSeconds: 18000,
        usedPercent: 37.5,
        remainingPercent: 62.5,
        progressPercent: 37.5,
        observedAt: now,
        resetAt: "2026-10-22T10:01:00.000Z",
        stale: false,
        reason: null,
      },
    ],
  };
}
const clients: QueryClient[] = [];
function fixture(
  initialData: AccountLimitsView = snapshot(),
  scope = "viewer-a",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  clients.push(client);
  const props = {
    scope,
    context: "personal-viewer.signature",
    connectionId: "account",
    client,
    initialData,
  };
  return { client, props };
}
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("SSR includes observed usage and UTC timestamps without reading the network", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { props } = fixture();
  const html = renderToString(<AccountLimitsLine {...props} />);
  expect(html).toContain("used 37.5%; remaining 62.5%");
  expect(html).toContain("2026-10-22 10:00:00 UTC+00:00");
  expect(html).toContain('aria-valuenow="37.5"');
  expect(fetch).not.toHaveBeenCalled();
});

test("reset and age become stale locally, without zeroing usage or fetching on mount/focus", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { props } = fixture();
  render(<AccountLimitsLine {...props} />);
  expect(screen.queryByText(/stale/)).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  fireEvent.focus(window);
  expect(screen.getByText(/Awaiting an observation after reset/)).toBeTruthy();
  expect(screen.getByText(/used 37.5%; remaining 62.5%.*stale/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

test("observation age becomes stale at five minutes without a reset", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const value = snapshot();
  if (value.status !== "snapshot") throw new Error();
  const { props } = fixture({
    ...value,
    windows: [{ ...value.windows[0]!, resetAt: null }],
  });
  render(<AccountLimitsLine {...props} />);
  await act(async () => {
    vi.advanceTimersByTime(300_000);
  });
  expect(screen.getByText(/Last known observation \(stale\)/)).toBeTruthy();
});

test("unknown, unsupported, restricted and partial windows never imply free quota", () => {
  const { props } = fixture();
  const { rerender } = render(
    <AccountLimitsLine
      {...props}
      initialData={{
        ...snapshot(),
        status: "unknown",
        reason: "missing_snapshot",
      }}
    />,
  );
  expect(screen.getByText(/no observations yet/)).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  // Changing account identity gives each state its own query, as real rows do.
  rerender(
    <AccountLimitsLine
      {...props}
      connectionId="unsupported"
      initialData={{
        ...snapshot(),
        status: "unsupported",
        reason: "unsupported_profile",
      }}
    />,
  );
  expect(screen.getByText(/profile does not report/)).toBeTruthy();
  rerender(
    <AccountLimitsLine
      {...props}
      connectionId="restricted"
      initialData={{
        ...snapshot(),
        status: "restricted",
        reason: "owner_only",
      }}
    />,
  );
  expect(screen.getByText(/visible to the owner/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  const partial = snapshot();
  if (partial.status !== "snapshot") throw new Error();
  rerender(
    <AccountLimitsLine
      {...props}
      connectionId="partial"
      initialData={{
        ...partial,
        windows: [
          {
            ...partial.windows[0]!,
            usedPercent: null,
            remainingPercent: null,
            progressPercent: null,
            observedAt: null,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/used unknown; remaining unknown/)).toBeTruthy();
  expect(screen.getByText("As of: unknown")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("only explicit saved read fetches, preserves observation on failure, and denial clears figures", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("down"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "denied" }),
    });
  vi.stubGlobal("fetch", fetch);
  const { props } = fixture();
  render(<AccountLimitsLine {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Read saved limits" }));
  expect(
    await screen.findByText(/Saved limits could not be read/),
  ).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "37.5",
  );
  fireEvent.click(screen.getByRole("button", { name: "Read saved limits" }));
  expect(await screen.findByText(/visible to the owner/)).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("scope switch aborts an old read and removes its cached figures", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    }),
  );
  const { props, client } = fixture();
  const { rerender } = render(<AccountLimitsLine {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Read saved limits" }));
  rerender(
    <AccountLimitsLine
      {...props}
      scope="viewer-b"
      initialData={{
        ...snapshot(),
        status: "restricted",
        reason: "owner_only",
      }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(signal?.aborted).toBe(true);
  expect(
    client.getQueryData(accountLimitsKey("viewer-a", "account")),
  ).toBeUndefined();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("inventory transfers the SSR projection to one account cache", () => {
  const { client } = fixture();
  const result = extractAccountLimits(client, "viewer-a", {
    status: "ok",
    value: {
      accounts: [
        {
          connectionId: "account",
          label: "Account",
          profileId: "codex",
          profileLabel: "Codex",
          state: "active",
          gatewayRevision: 1,
          mirrorRevision: 1,
          binding: null,
          limits: snapshot(),
        },
      ],
    },
  });
  if (result.status !== "ok") throw new Error();
  expect(result.value.accounts[0]).not.toHaveProperty("limits");
  expect(client.getQueryData(accountLimitsKey("viewer-a", "account"))).toEqual({
    status: "ok",
    value: snapshot(),
  });
});

test("two rapid saved-read clicks share one request", async () => {
  const fetch = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetch);
  const { props } = fixture();
  render(<AccountLimitsLine {...props} />);
  const button = screen.getByRole("button", { name: "Read saved limits" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a new authenticated bootstrap token hides old figures before hydration effects", () => {
  const { props, client } = fixture();
  client.setQueryData(accountLimitsKey(props.scope, props.connectionId), {
    status: "ok",
    value: snapshot(),
  });
  const html = renderToString(
    <AccountLimitsLine
      {...props}
      expectedDisplayToken="restricted"
      expectedStatus="restricted"
    />,
  );
  expect(html).toContain("Account limits are visible to the owner");
  expect(html).not.toContain("37.5");
  expect(html).not.toContain("progressbar");
});

test("an authenticated client observation newer than SSR crosses the bootstrap token gate", () => {
  const { props, client } = fixture();
  const value = {
    ...snapshot(),
    displayToken: "generation-b",
    fetchedAt: "2026-10-22T10:02:00.000Z",
  };
  client.setQueryData(accountLimitsKey(props.scope, props.connectionId), {
    status: "ok",
    value,
  });
  const html = renderToString(
    <AccountLimitsLine
      {...props}
      expectedDisplayToken="generation-a"
      expectedFetchedAt={now}
      expectedStatus="snapshot"
    />,
  );
  expect(html).toContain("used 37.5%; remaining 62.5%");
  expect(html).toContain("progressbar");
});
