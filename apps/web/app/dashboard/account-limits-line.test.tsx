// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  expect(html).toContain("62.5% left");
  expect(html).toContain("37.5% used");
  expect(html).toContain("2026-10-22 10:00:00 UTC+00:00");
  expect(html).toContain('aria-label="5h remaining"');
  expect(html).toContain('aria-valuenow="62.5"');
  expect(fetch).not.toHaveBeenCalled();
});

test("summarizes at most two known plan windows and keeps monthly/rate observations in Details", () => {
  const value = snapshot();
  if (value.status !== "snapshot") throw new Error();
  const base = value.windows[0]!;
  const { props } = fixture({
    ...value,
    windows: [
      {
        ...base,
        label: "Request rate",
        dimension: "rate_limit",
        unit: "requests",
      },
      { ...base, label: "5h", dimension: "plan_quota", unit: "credits" },
      { ...base, label: "Week", dimension: "plan_quota", unit: "credits" },
      {
        ...base,
        label: "Month",
        dimension: "plan_quota",
        unit: "credits",
        usedPercent: null,
        remainingPercent: null,
        progressPercent: null,
      },
    ],
  });
  render(<AccountLimitsLine {...props} />);
  expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  expect(
    screen.getByRole("progressbar", { name: "5h remaining" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("progressbar", { name: "Week remaining" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("progressbar", { name: "Request rate remaining" }),
  ).toBeNull();
  expect(screen.queryByText("Remaining unknown")).toBeNull();
  const details = screen.getByText("Details").closest("details")!;
  expect(details.textContent).toContain("Month");
  expect(details.textContent).toContain("Used unknown");
  expect(details.textContent).toContain("Rate limit · requests");
  expect(details.textContent).toContain("Plan quota · credits");
});

test("shows a provider billing reset even when the remaining quota was not reported", () => {
  const value = snapshot();
  if (value.status !== "snapshot") throw new Error();
  const { props } = fixture({
    ...value,
    windows: [
      {
        ...value.windows[0]!,
        label: "Month",
        dimension: "plan_quota",
        unit: "unknown",
        usedPercent: null,
        remainingPercent: null,
        progressPercent: null,
        resetAt: "2026-10-22T12:15:00.000Z",
      },
    ],
  });
  render(<AccountLimitsLine {...props} />);
  expect(
    screen.getByText("Remaining not reported").closest("details"),
  ).toBeNull();
  expect(screen.getByText("Resets in 2h 15m").closest("details")).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("remaining and reset stay in the compact summary, with saved observations in Details", () => {
  const value = snapshot();
  if (value.status !== "snapshot") throw new Error();
  const { props } = fixture({
    ...value,
    windows: [{ ...value.windows[0]!, resetAt: "2026-10-22T12:15:00.000Z" }],
  });
  render(<AccountLimitsLine {...props} />);
  const details = screen.getByText("Details").closest("details");
  expect(details?.open).toBe(false);
  expect(screen.getByText("62.5% left").closest("details")).toBeNull();
  expect(screen.getByText("Resets in 2h 15m").closest("details")).toBeNull();
  expect(
    screen.getByRole("progressbar", { name: "5h remaining" }),
  ).toBeTruthy();
  const reload = screen.getByRole("button", { name: "Reload saved limits" });
  expect(reload.getAttribute("title")).toContain(
    "Does not contact the provider",
  );
  fireEvent.click(screen.getByText("Details"));
  expect(details?.open).toBe(true);
  expect(screen.getByText(/37.5% used/)).toBeTruthy();
  expect(screen.getByText(/^As of:/)).toBeTruthy();
  expect(screen.getByText(/shared across all activity/)).toBeTruthy();
});

test("over-limit observations keep reported usage while showing no remaining quota", () => {
  const value = snapshot();
  if (value.status !== "snapshot") throw new Error();
  const { props } = fixture({
    ...value,
    windows: [
      {
        ...value.windows[0]!,
        usedPercent: 127.5,
        remainingPercent: 0,
        progressPercent: 100,
      },
    ],
  });
  render(<AccountLimitsLine {...props} />);
  expect(screen.getByText("0% left")).toBeTruthy();
  const progress = screen.getByRole("progressbar", { name: "5h remaining" });
  expect(progress.getAttribute("aria-valuenow")).toBe("0");
  expect(progress.getAttribute("aria-valuetext")).toBe(
    "0% remaining; 127.5% used",
  );
  fireEvent.click(screen.getByText("Details"));
  expect(screen.getByText(/127.5% used/)).toBeTruthy();
});

test("reset and age become stale locally, without zeroing usage or fetching on mount/focus", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { props } = fixture();
  render(<AccountLimitsLine {...props} />);
  expect(screen.queryByText("Outdated")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  fireEvent.focus(window);
  expect(screen.getByText("Reset pending")).toBeTruthy();
  expect(screen.getByText("Outdated")).toBeTruthy();
  expect(screen.getByText("62.5% left")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe(
    "62.5% remaining; 37.5% used",
  );
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
  expect(screen.getByText("Outdated")).toBeTruthy();
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
  expect(screen.getByText("No limits saved yet")).toBeTruthy();
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
  expect(screen.getByText("Limits not supported")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  rerender(
    <AccountLimitsLine
      {...props}
      connectionId="unavailable"
      initialData={{
        ...snapshot(),
        status: "unavailable",
        reason: "source_unavailable",
      }}
    />,
  );
  expect(screen.queryByText("Limits source unavailable")).toBeNull();
  expect(screen.getByLabelText("Account limits").textContent).toBe("");
  expect(
    screen.getByRole("button", { name: "Reload saved limits" }),
  ).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
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
  expect(screen.getByText("Remaining unknown")).toBeTruthy();
  expect(screen.getByText(/Used unknown/)).toBeTruthy();
  expect(screen.getByText("As of: unknown")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test.each(["denied", "invalid"] as const)(
  "only explicit saved read fetches, preserves observation on failure, and %s masks figures without an ownership claim",
  async (status) => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status }),
      });
    vi.stubGlobal("fetch", fetch);
    const { props } = fixture();
    render(<AccountLimitsLine {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved limits" }),
    );
    expect(
      await screen.findByText("Could not reload saved limits."),
    ).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "62.5",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved limits" }),
    );
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(screen.queryByText(/visible to the owner/)).toBeNull();
    expect(screen.queryByLabelText("Account limits")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

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
  fireEvent.click(screen.getByRole("button", { name: "Reload saved limits" }));
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
  const button = screen.getByRole("button", { name: "Reload saved limits" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
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
  expect(html).toContain("Limits visible to the owner only");
  expect(html).not.toContain("37.5");
  expect(html).not.toContain("progressbar");
  expect(html).not.toContain("Reload saved limits");
  const unavailable = renderToString(
    <AccountLimitsLine
      {...props}
      expectedDisplayToken="unavailable"
      expectedStatus="unavailable"
    />,
  );
  expect(unavailable).not.toContain("62.5");
  expect(unavailable).not.toContain("progressbar");
  expect(unavailable).not.toContain("visible to the owner");
  expect(unavailable).not.toContain("No limits saved yet");
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
  expect(html).toContain("62.5% left");
  expect(html).toContain("37.5% used");
  expect(html).toContain("progressbar");
});
