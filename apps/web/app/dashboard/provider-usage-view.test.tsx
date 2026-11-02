// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProviderUsageView } from "./provider-usage-view";
import { ModelUsageTable, RunUsageTable } from "./provider-usage-tables";
import type { ProviderUsageReport, UsageFilters } from "./provider-usage-model";
import {
  fetchProviderUsage,
  ProviderUsageError,
  providerUsageKey,
} from "./provider-usage-api";
vi.mock("./provider-usage-api", async () => ({
  ...(await vi.importActual<typeof import("./provider-usage-api")>(
    "./provider-usage-api",
  )),
  fetchProviderUsage: vi.fn(),
}));
// Exercise report orchestration independently of the shared popup's geometry.
vi.mock("@reviewrouter/ui", async () => ({
  ...(await vi.importActual<typeof import("@reviewrouter/ui")>(
    "@reviewrouter/ui",
  )),
  SelectField: ({
    label,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
const totals: ProviderUsageReport["totals"] = {
  tokens: {
    inputTotal: 900,
    outputTotal: 100,
    total: 1000,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  },
  unknownTokenValues: 6,
  unknownTotalTokenCount: 1,
  partialCount: 0,
  unknownCount: 1,
  providerAttempts: 101,
  logicalRuns: 2,
  reportedSummaries: 0,
  diagnosticCount: 0,
  costs: [
    { amount: "0.500000000001", currency: "USD", basis: "estimated" },
    { amount: "0.4", currency: "EUR", basis: "source_reported" },
  ],
  unknownCostCount: 1,
};
const model = {
  provider: "codex",
  requestedModel: "requested-alpha",
  route: "direct" as const,
  totals,
  observedModels: ["actual-beta"],
  hasUnknownObservedModel: true,
};
const report: ProviderUsageReport = {
  from: "2026-09-21T12:00:00.000Z",
  to: "2026-10-21T12:00:00.000Z",
  asOf: "2026-10-21T12:00:00.000Z",
  coveredFrom: null,
  sourceLag: "unknown",
  sources: [],
  deliveryCoverage: [],
  unattributed: null,
  rows: [],
  attempts: 101,
  logicalRuns: 2,
  unknown: 1,
  partial: 0,
  unboundedSummaries: 0,
  hasMore: true,
  nextCursor: "observation-page",
  groups: [],
  totals,
  overview: {
    daily: [{ day: "2026-10-20", provider: "codex", totals }],
    models: [model],
    topModels: {
      tokens: [model],
      requests: [model],
      costs: [
        { currency: "USD", basis: "estimated", models: [model] },
        { currency: "EUR", basis: "source_reported", models: [model] },
      ],
    },
    runs: [
      {
        runId: "entire-period-run",
        firstOccurredAt: "2026-10-01T00:00:00Z",
        lastOccurredAt: "2026-10-20T00:00:00Z",
        identities: [model],
        routes: ["direct"],
        totals,
        observedModels: ["actual-beta"],
        hasUnknownObservedModel: true,
      },
    ],
    nextRunCursor: "run-page",
    facets: { providers: ["codex", "mimo"], models: [model] },
    hasDirectObservations: true,
    observationsWithoutRunId: 1,
  },
};
const initialFilters: UsageFilters = {
  from: report.from,
  to: report.to,
  purpose: "review",
};
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const usageScope = {
  actorId: "actor-a",
  workspaceId: "workspace",
  effectiveAccess: "admin" as const,
  seedId: "seed-a",
};
const seedIds = new WeakMap<object, string>();
let seedSequence = 0;
let client: QueryClient;
function Harness({
  workspaceId = "workspace",
  seed = report,
  actorId = "actor-a",
  effectiveAccess = "admin",
  seedId,
}: {
  workspaceId?: string;
  seed?: ProviderUsageReport;
  actorId?: string;
  effectiveAccess?: "admin" | "member";
  seedId?: string;
}) {
  if (!seedIds.has(seed))
    seedIds.set(seed, seed === report ? "seed-a" : `seed-${++seedSequence}`);
  return (
    <QueryClientProvider client={client}>
      <ProviderUsageView
        workspaceId={workspaceId}
        actorId={actorId}
        effectiveAccess={effectiveAccess}
        seedId={seedId ?? seedIds.get(seed)!}
        initialReport={seed}
        initialFilters={{ ...initialFilters, from: seed.from, to: seed.to }}
      />
    </QueryClientProvider>
  );
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => {
  vi.clearAllMocks();
  router.refresh.mockClear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  vi.mocked(fetchProviderUsage).mockResolvedValue(report);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("provider usage interactive report", () => {
  it("links account limits to the authorized Accounts page from usage details", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByLabelText("Details"));
    expect(
      screen
        .getByRole("link", { name: "Account limits are shown in Accounts" })
        .getAttribute("href"),
    ).toBe("/dashboard/setup?workspace=workspace#dashboard-section-content");
    expect(container.textContent).not.toContain("Quota / limits: unknown");
  });
  it("hydrates the exact review key and preserves exact currency/basis and requested/observed identities", () => {
    render(<Harness />);
    expect(fetchProviderUsage).not.toHaveBeenCalled();
    expect(
      client.getQueryData(providerUsageKey(usageScope, initialFilters)),
    ).toEqual(report);
    expect(screen.getByRole("definition", { name: "1,000" })).toBeTruthy();
    expect(
      within(screen.getByLabelText("Period usage summary")).getByTitle(
        "0.500000000001 USD (estimated)",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByLabelText("Period usage summary")).queryByTitle(
        "0.4 EUR (source reported)",
      ),
    ).toBeNull();
    change("Cost currency", "EUR");
    expect(
      within(screen.getByLabelText("Period usage summary")).getByTitle(
        "0.4 EUR (source reported)",
      ),
    ).toBeTruthy();
    change("Cost currency", "USD");
    expect(
      screen.getByRole("table", { name: "Requested model usage" }).textContent,
    ).toContain("codex / requested-alpha");
    expect(
      screen.getByRole("table", { name: "Requested model usage" }).textContent,
    ).toContain("Observed: actual-beta +1 · includes Unknown");
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(screen.queryByLabelText("Cost basis")).toBeNull();
    expect(fetchProviderUsage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    expect(
      screen.getByRole("table", { name: "Review run usage" }).textContent,
    ).toContain("entire-period-run");
  });
  it("clears both cursors on filters, resets requested model on provider change, and aborts obsolete requests", async () => {
    const calls: { filters: UsageFilters; signal: AbortSignal }[] = [];
    vi.mocked(fetchProviderUsage).mockImplementation(
      (_workspace, filters, signal) => {
        calls.push({ filters, signal: signal! });
        return Promise.resolve(report);
      },
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Next observation page" }),
    );
    await waitFor(() =>
      expect(calls.at(-1)?.filters.after).toBe("observation-page"),
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Runs" }));
    fireEvent.click(screen.getByRole("button", { name: "Next run page" }));
    await waitFor(() =>
      expect(calls.at(-1)?.filters.runAfter).toBe("run-page"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("table", { name: "Review run usage" }),
      ).toBeTruthy(),
    );
    change("Requested model", "requested-alpha");
    await waitFor(() =>
      expect(calls.at(-1)?.filters.model).toBe("requested-alpha"),
    );
    expect(calls.at(-1)?.filters.after).toBeUndefined();
    expect(calls.at(-1)?.filters.runAfter).toBeUndefined();
    await waitFor(() =>
      expect(
        screen.getByRole("table", { name: "Review run usage" }),
      ).toBeTruthy(),
    );
    change("Provider", "mimo");
    await waitFor(() => expect(calls.at(-1)?.filters.provider).toBe("mimo"));
    expect(calls.at(-1)?.filters.model).toBeUndefined();
    vi.mocked(fetchProviderUsage).mockImplementation(
      (_workspace, filters, signal) => {
        calls.push({ filters, signal: signal! });
        return new Promise(() => {});
      },
    );
    change("Route", "gateway");
    await waitFor(() => expect(calls.at(-1)?.filters.route).toBe("gateway"));
    const obsolete = calls.at(-1)!;
    expect(screen.queryByRole("definition", { name: "1,000" })).toBeNull();
    change("Route", "direct");
    await waitFor(() => expect(obsolete.signal.aborted).toBe(true));
  });
  it.each([401, 403])(
    "purges every workspace cache variant on %s and never reuses the rejected SSR seed",
    async (status) => {
      client.setQueryData(
        providerUsageKey(usageScope, { ...initialFilters, provider: "mimo" }),
        report,
      );
      render(<Harness />);
      change("Route", "gateway");
      await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      vi.mocked(fetchProviderUsage).mockRejectedValue(
        new ProviderUsageError(status),
      );
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "access is no longer available",
        ),
      );
      await waitFor(() =>
        expect(
          client
            .getQueryCache()
            .findAll({ queryKey: ["provider-usage", "actor-a", "workspace"] })
            .every((entry) => entry.state.data === undefined),
        ).toBe(true),
      );
      const countBefore = vi.mocked(fetchProviderUsage).mock.calls.length;
      change("Route", "");
      expect(screen.queryByRole("definition", { name: "1,000" })).toBeNull();
      expect(fetchProviderUsage).toHaveBeenCalledTimes(countBefore);
    },
  );
  it("uses one new captured interval for rolling Refresh and fixed inclusive custom dates for custom Refresh", async () => {
    const now = new Date("2026-10-22T15:16:17.123Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    // Constructor-based interval capture is independently controlled without fake query timers.
    const RealDate = Date;
    vi.stubGlobal(
      "Date",
      class extends RealDate {
        constructor(value?: string | number) {
          super(value ?? now.getTime());
        }
      },
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetchProviderUsage).mock.calls[0]![1]).toEqual({
      from: "2026-09-22T15:16:17.123Z",
      to: now.toISOString(),
      purpose: "review",
    });
    change("Period", "custom");
    change("Usage from", "2026-10-01");
    change("Usage to", "2026-10-01");
    fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
    await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchProviderUsage).mock.calls[1]![1]).toEqual({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      purpose: "review",
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetchProviderUsage).mock.calls[2]![1]).toEqual(
      vi.mocked(fetchProviderUsage).mock.calls[1]![1],
    );
    change("Usage to", "2026-09-01");
    expect(
      (screen.getByRole("button", { name: "Apply dates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(fetchProviderUsage).toHaveBeenCalledTimes(3);
  });
  it("resets local controls on workspace change and removes foreign cached reports", async () => {
    const view = render(<Harness />);
    change("Route", "gateway");
    await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(1));
    view.rerender(
      <Harness
        workspaceId="other"
        seed={{
          ...report,
          totals: { ...totals, tokens: { ...totals.tokens, total: 7 } },
        }}
      />,
    );
    expect((screen.getByLabelText("Route") as HTMLSelectElement).value).toBe(
      "",
    );
    expect(screen.getByRole("definition", { name: "7" })).toBeTruthy();
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ["provider-usage", "actor-a", "workspace"] }),
      ).toHaveLength(0),
    );
  });
  it("resets period and custom date drafts when a new authorized SSR report arrives in the same workspace", () => {
    const view = render(<Harness />);
    change("Period", "custom");
    change("Usage from", "2026-09-01");
    change("Usage to", "2026-09-02");
    view.rerender(
      <Harness
        seed={{
          ...report,
          from: "2026-09-22T12:00:00.000Z",
          to: "2026-10-22T12:00:00.000Z",
        }}
      />,
    );
    expect((screen.getByLabelText("Period") as HTMLSelectElement).value).toBe(
      "30",
    );
    change("Period", "custom");
    expect(
      (screen.getByLabelText("Usage from") as HTMLInputElement).value,
    ).toBe("2026-09-22");
    expect((screen.getByLabelText("Usage to") as HTMLInputElement).value).toBe(
      "2026-10-22",
    );
  });
  it("retains full requested identity while omitting redundant observed labels and disclosing long mismatches", () => {
    const longModel = "requested/" + "long-model-identity-".repeat(7);
    const actual = "actual/" + "different-observed-model-".repeat(5);
    const seed = {
      ...report,
      overview: {
        ...report.overview,
        models: [
          {
            ...model,
            requestedModel: longModel,
            observedModels: [longModel],
            hasUnknownObservedModel: false,
          },
        ],
      },
    };
    const view = render(<ModelUsageTable report={seed} />);
    expect(
      within(
        screen.getByRole("table", { name: "Requested model usage" }),
      ).getByTitle(`codex / ${longModel}`).textContent,
    ).toBe(`codex / ${longModel}`);
    expect(
      screen.getByRole("rowheader", {
        name: new RegExp(`codex / ${longModel}`),
      }),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("table", { name: "Requested model usage" }),
      ).queryByText(/Observed:/),
    ).toBeNull();
    view.rerender(
      <ModelUsageTable
        report={{
          ...seed,
          overview: {
            ...seed.overview,
            models: [
              {
                ...model,
                requestedModel: longModel,
                observedModels: [actual],
                hasUnknownObservedModel: true,
              },
            ],
          },
        }}
      />,
    );
    expect(
      within(
        screen.getByRole("table", { name: "Requested model usage" }),
      ).getByText(/Observed:.*includes Unknown/),
    ).toBeTruthy();
    const disclosure = within(
      screen.getByRole("table", { name: "Requested model usage" }),
    )
      .getByText(/Observed:.*includes Unknown/)
      .closest("details")!;
    fireEvent.click(disclosure.querySelector("summary")!);
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText(actual)).toBeTruthy();
    expect(within(disclosure).getByText("Unknown")).toBeTruthy();
  });
  it("keeps Details open when a new observation page replaces the loading context, then resets it for fresh SSR", async () => {
    const firstRow: ProviderUsageReport["rows"][number] = {
      id: "call-before",
      provider: "codex",
      requestedModel: "before-pagination",
      model: "before-pagination",
      day: "2026-10-20",
      route: "direct",
      purpose: "review",
      runId: "run",
      granularity: "call",
      total: 10,
      completeness: "complete",
      cost: null,
      authority: "runtime",
      durationMs: null,
      ttftMs: null,
    };
    const firstReport = { ...report, rows: [firstRow] };
    let completePage!: (value: ProviderUsageReport) => void;
    vi.mocked(fetchProviderUsage).mockImplementation(
      () =>
        new Promise((resolve) => {
          completePage = resolve;
        }),
    );
    const view = render(<Harness seed={firstReport} />);
    fireEvent.click(screen.getByLabelText("Details"));
    await waitFor(() =>
      expect(screen.getByLabelText("Details").closest("details")!.open).toBe(
        true,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Next observation page" }),
    );
    await waitFor(() =>
      expect(fetchProviderUsage).toHaveBeenCalledWith(
        "workspace",
        expect.objectContaining({ after: "observation-page" }),
        expect.any(AbortSignal),
        expect.objectContaining({
          actorId: "actor-a",
          workspaceId: "workspace",
          effectiveAccess: "admin",
        }),
      ),
    );
    expect(screen.queryByText(/before-pagination/)).toBeNull();
    await act(async () =>
      completePage({
        ...firstReport,
        rows: [
          {
            ...firstRow,
            id: "call-after",
            requestedModel: "after-pagination",
            model: "after-pagination",
          },
        ],
        hasMore: false,
        nextCursor: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Details").closest("details")!.open).toBe(
        true,
      ),
    );
    expect(
      screen.getByRole("table", { name: "Usage observations" }).textContent,
    ).toContain("after-pagination");
    view.rerender(<Harness seed={{ ...firstReport }} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Details").closest("details")!.open).toBe(
        false,
      ),
    );
  });
  it("synchronizes one cost currency across KPI, bases, models, runs and Details without fetching or changing counts", async () => {
    const usdCosts: ProviderUsageReport["totals"]["costs"] = [
      { currency: "USD", basis: "estimated", amount: "0.5" },
      { currency: "USD", basis: "source_reported", amount: "0.2" },
    ];
    const eurCosts: ProviderUsageReport["totals"]["costs"] = [
      { currency: "EUR", basis: "source_reported", amount: "0.4" },
    ];
    const usdTotals = { ...totals, costs: usdCosts };
    const eurTotals = { ...totals, costs: eurCosts };
    const mixedTotals = { ...totals, costs: [...usdCosts, ...eurCosts] };
    const raw: ProviderUsageReport["rows"][number] = {
      id: "usd",
      provider: "codex",
      model: "alpha",
      day: "2026-10-20",
      route: "direct",
      purpose: "review",
      runId: "run",
      granularity: "call",
      total: 10,
      completeness: "complete",
      cost: usdCosts[0]!,
      authority: "runtime",
      durationMs: null,
      ttftMs: null,
    };
    const seed: ProviderUsageReport = {
      ...report,
      totals: mixedTotals,
      rows: [raw, { ...raw, id: "eur", cost: eurCosts[0]! }],
      overview: {
        ...report.overview,
        models: [
          { ...model, totals: usdTotals },
          { ...model, requestedModel: "eur-model", totals: eurTotals },
        ],
        daily: [{ day: "2026-10-20", provider: "codex", totals: mixedTotals }],
        runs: report.overview.runs.map((run) => ({
          ...run,
          totals: mixedTotals,
        })),
        topModels: {
          ...report.overview.topModels,
          costs: [...usdCosts, ...eurCosts].map((cost) => ({
            currency: cost.currency,
            basis: cost.basis,
            models: [{ ...model, totals: mixedTotals }],
          })),
        },
      },
    };
    render(<Harness seed={seed} />);
    const kpi = () =>
      within(screen.getByLabelText("Period usage summary")).getByText(
        "Known cost",
        { selector: "dt" },
      ).parentElement!;
    const table = (name: string) =>
      screen.getByRole("table", { name }).textContent!;
    expect(
      (screen.getByLabelText("Cost currency") as HTMLSelectElement).value,
    ).toBe("USD");
    expect(kpi().textContent).toContain("0.5 USD");
    expect(kpi().textContent).toContain("0.2 USD");
    expect(kpi().textContent).not.toContain("EUR");
    expect(table("Requested model usage")).toContain("No USD amount");
    fireEvent.click(screen.getByLabelText("Details"));
    await waitFor(() =>
      expect(screen.getByLabelText("Details").closest("details")!.open).toBe(
        true,
      ),
    );
    expect(table("Daily usage data")).toContain("0.5 USD Estimated");
    expect(table("Daily usage data")).toContain("0.2 USD Reported");
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(
      within(screen.getByLabelText("Cost basis"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Estimated", "Reported"]);
    change("Cost basis", JSON.stringify(["USD", "source_reported"]));
    expect(table("Daily usage data")).toContain("0.2 USD Reported");
    expect(table("Daily usage data")).not.toContain("0.5 USD");
    expect(table("Usage observations")).toContain("No USD amount");
    expect(table("Usage observations")).not.toContain("0.4 EUR");
    change("Cost currency", "EUR");
    expect(kpi().textContent).toContain("0.4 EUR");
    expect(kpi().textContent).not.toContain("USD");
    expect(screen.queryByLabelText("Cost basis")).toBeNull();
    expect(table("Requested model usage")).toContain("No EUR amount");
    expect(table("Requested model usage")).not.toContain("0.5 USD");
    expect(table("Daily usage data")).toContain("0.4 EUR Reported");
    expect(table("Daily usage data")).not.toContain("USD");
    expect(table("Usage observations")).toContain("No EUR amount");
    expect(table("Usage observations")).not.toContain("0.5 USD");
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    expect(table("Review run usage")).toContain("0.4 EUR Reported");
    expect(table("Review run usage")).not.toContain("USD");
    expect(screen.getByRole("definition", { name: "1,000" })).toBeTruthy();
    expect(screen.getByRole("definition", { name: "101" })).toBeTruthy();
    expect(fetchProviderUsage).not.toHaveBeenCalled();
  });
  it("preserves valid currency and basis across refetches, falling back when the currency disappears", async () => {
    const seed: ProviderUsageReport = {
      ...report,
      totals: {
        ...totals,
        costs: [
          ...totals.costs,
          { currency: "EUR", basis: "estimated", amount: "0.1" },
        ],
      },
    };
    vi.mocked(fetchProviderUsage).mockResolvedValue(seed);
    render(<Harness seed={seed} />);
    change("Cost currency", "EUR");
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    change("Cost basis", JSON.stringify(["EUR", "source_reported"]));
    change("Route", "gateway");
    await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Cost currency") as HTMLSelectElement).value,
      ).toBe("EUR"),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Cost basis") as HTMLSelectElement).value,
      ).toBe(JSON.stringify(["EUR", "source_reported"])),
    );
    const gbpReport = {
      ...report,
      totals: {
        ...totals,
        costs: [
          { currency: "GBP", basis: "estimated" as const, amount: "0.9" },
          { currency: "CAD", basis: "estimated" as const, amount: "0.8" },
        ],
      },
    };
    vi.mocked(fetchProviderUsage).mockResolvedValue(gbpReport);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Cost currency") as HTMLSelectElement).value,
      ).toBe("CAD"),
    );
    expect(screen.getByTitle("0.8 CAD (estimated)")).toBeTruthy();
    expect(
      within(screen.getByLabelText("Period usage summary")).queryByTitle(
        "0.4 EUR (source reported)",
      ),
    ).toBeNull();
  });
  it("keeps run summary metrics in the flat row and exposes the full copyable run identity", async () => {
    const runId = "rr-test-run/" + "long-identity-".repeat(5);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <RunUsageTable
        report={{
          ...report,
          overview: {
            ...report.overview,
            runs: [{ ...report.overview.runs[0]!, runId }],
          },
        }}
        selectedCurrency="USD"
        onNext={() => {}}
      />,
    );
    const summary = screen.getByRole("region", { name: "Run usage summaries" });
    const row = within(summary).getByRole("listitem");
    expect(
      within(row).getByText("Requests").nextElementSibling?.textContent,
    ).toBe("101");
    expect(
      within(row).getByText("Known tokens").nextElementSibling?.textContent,
    ).toContain("1,000");
    expect(
      within(row).getByText("Known cost").nextElementSibling?.textContent,
    ).toContain("0.500000000001 USD Estimated");
    expect(row.querySelector("p")?.textContent).toContain("…");
    const details = within(row).getByText("Run details").closest("details")!;
    fireEvent.click(within(row).getByText("Run details"));
    expect(details.open).toBe(true);
    expect(within(details).getByText(runId, { selector: "code" })).toBeTruthy();
    fireEvent.click(
      within(details).getByRole("button", { name: "Copy run ID" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(runId));
    expect(within(details).getByRole("status").textContent).toBe(
      "Run ID copied",
    );
  });
  it("collapses charts and uses honest freshness text when the interval has no observations", () => {
    render(
      <Harness
        seed={{
          ...report,
          asOf: null,
          rows: [],
          overview: {
            ...report.overview,
            daily: [],
            models: [],
            runs: [],
            topModels: { tokens: [], requests: [], costs: [] },
          },
          totals: {
            ...totals,
            tokens: { ...totals.tokens, total: null },
            providerAttempts: 0,
            logicalRuns: 0,
            costs: [],
          },
        }}
      />,
    );
    expect(screen.getByText("Freshness unavailable")).toBeTruthy();
    expect(screen.queryByLabelText("Daily usage chart")).toBeNull();
    expect(screen.queryByLabelText("Requested provider legend")).toBeNull();
    expect(
      screen.getByText(/No measured observations for this interval/),
    ).toBeTruthy();
  });
  it("resets dimension filters and both cursors while preserving interval, purpose, currency and period", async () => {
    const selectedFilters: UsageFilters = {
      ...initialFilters,
      purpose: "diagnostic",
      provider: "codex",
      model: "requested-alpha",
      route: "direct",
      after: "old-call-cursor",
      runAfter: "old-run-cursor",
    };
    let complete!: (value: ProviderUsageReport) => void;
    vi.mocked(fetchProviderUsage).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <QueryClientProvider client={client}>
        <ProviderUsageView
          workspaceId="workspace"
          actorId="actor-a"
          effectiveAccess="admin"
          seedId="seed-a"
          initialReport={report}
          initialFilters={selectedFilters}
        />
      </QueryClientProvider>,
    );
    change("Period", "custom");
    change("Cost currency", "EUR");
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetchProviderUsage).mock.calls[0]![1]).toEqual({
      ...initialFilters,
      purpose: "diagnostic",
    });
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Refreshing…" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.queryByLabelText("Period usage summary")).toBeNull();
    await act(async () => complete(report));
    expect(
      (await screen.findByRole("button", { name: "Refresh" })).getAttribute(
        "aria-busy",
      ),
    ).toBe("false");
    expect((screen.getByLabelText("Period") as HTMLSelectElement).value).toBe(
      "custom",
    );
    expect((screen.getByLabelText("Purpose") as HTMLSelectElement).value).toBe(
      "diagnostic",
    );
    expect(
      (screen.getByLabelText("Cost currency") as HTMLSelectElement).value,
    ).toBe("EUR");
    expect(
      (screen.getByLabelText("Usage from") as HTMLInputElement).value,
    ).toBe("2026-09-21");
    expect((screen.getByLabelText("Usage to") as HTMLInputElement).value).toBe(
      "2026-10-21",
    );
  });
  it.each(["unknownCostCount", "unknownTotalTokenCount"] as const)(
    "polls when %s is the only incomplete metric and stops after full measurements",
    async (field) => {
      const incomplete = {
        ...report,
        unknown: 0,
        partial: 0,
        totals: {
          ...totals,
          unknownCount: 0,
          partialCount: 0,
          unknownCostCount: 0,
          unknownTotalTokenCount: 0,
          [field]: 1,
        },
      };
      const complete = {
        ...incomplete,
        totals: { ...incomplete.totals, [field]: 0 },
      };
      vi.mocked(fetchProviderUsage).mockResolvedValue(complete);
      vi.useFakeTimers();
      render(<Harness seed={incomplete} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchProviderUsage).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetchProviderUsage).mock.calls[0]![1]).toEqual(
        initialFilters,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchProviderUsage).toHaveBeenCalledTimes(1);
    },
  );
});

describe("Usage authenticated cache lifecycle", () => {
  it.each([
    ["role", { effectiveAccess: "member" as const }],
    ["actor", { actorId: "actor-b" }],
    ["workspace", { workspaceId: "workspace-b" }],
  ])(
    "validates an old seed before showing fresh cached totals after a successful %s change",
    async (_change, nextScope) => {
      const view = render(<Harness />);
      const limited = {
        ...report,
        totals: { ...totals, tokens: { ...totals.tokens, total: 7 } },
      };
      vi.mocked(fetchProviderUsage).mockResolvedValue(limited);
      view.rerender(
        <Harness {...nextScope} seedId="new-authorized-seed" seed={limited} />,
      );
      expect(fetchProviderUsage).not.toHaveBeenCalled();
      change("Route", "gateway");
      await waitFor(() => expect(fetchProviderUsage).toHaveBeenCalledTimes(1));
      const call = vi.mocked(fetchProviderUsage).mock.calls[0]!;
      const expectedScope = {
        ...usageScope,
        ...nextScope,
        seedId: "new-authorized-seed",
      };
      expect(call[3]).toEqual(expectedScope);
      await waitFor(() =>
        expect(
          client.getQueryData(providerUsageKey(expectedScope, call[1])),
        ).toEqual(limited),
      );
      let resolve!: (value: ProviderUsageReport) => void;
      vi.mocked(fetchProviderUsage).mockClear();
      vi.mocked(fetchProviderUsage).mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      client.setQueryData(providerUsageKey(usageScope, initialFilters), report);
      view.rerender(<Harness />);
      expect(screen.queryByLabelText("Period usage summary")).toBeNull();
      await waitFor(() => expect(resolve).toBeTypeOf("function"));
      expect(fetchProviderUsage).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetchProviderUsage).mock.calls[0]![3]).toEqual(
        usageScope,
      );
      await act(async () => resolve(limited));
      expect(
        within(await screen.findByLabelText("Period usage summary")).getByRole(
          "definition",
          { name: "7" },
        ),
      ).toBeTruthy();
      expect(router.refresh).not.toHaveBeenCalled();
    },
  );
  it("keeps fresh SSR usable through Strict Mode replay and validates a same-tick remount", async () => {
    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(screen.getByLabelText("Period usage summary")).toBeTruthy();
    expect(fetchProviderUsage).not.toHaveBeenCalled();
    let resolve!: (value: ProviderUsageReport) => void;
    vi.mocked(fetchProviderUsage).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    // Both commits occur before the deferred old-seed cleanup can run.
    view.rerender(<StrictMode>Another section</StrictMode>);
    view.rerender(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(screen.queryByLabelText("Period usage summary")).toBeNull();
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    await act(async () => resolve(report));
    expect(await screen.findByLabelText("Period usage summary")).toBeTruthy();
  });
  it("renders a same-workspace limited SSR seed without the old administrator totals", () => {
    const view = render(<Harness />);
    const limited = {
      ...report,
      totals: { ...totals, tokens: { ...totals.tokens, total: 7 } },
    };
    view.rerender(
      <Harness effectiveAccess="member" seedId="member-seed" seed={limited} />,
    );
    expect(
      within(screen.getByLabelText("Period usage summary")).getByRole(
        "definition",
        { name: "7" },
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByLabelText("Period usage summary")).queryByRole(
        "definition",
        { name: "1,000" },
      ),
    ).toBeNull();
    expect(
      client.getQueryData(
        providerUsageKey(
          { ...usageScope, effectiveAccess: "member", seedId: "member-seed" },
          initialFilters,
        ),
      ),
    ).toEqual(limited);
  });
  it("ignores a late old-admin denial after accepting a member seed", async () => {
    let reject!: (error: unknown) => void;
    vi.mocked(fetchProviderUsage).mockImplementation(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    const view = render(<Harness />);
    change("Route", "gateway");
    await waitFor(() => expect(reject).toBeTypeOf("function"));
    const limited = {
      ...report,
      totals: { ...totals, tokens: { ...totals.tokens, total: 7 } },
    };
    view.rerender(
      <Harness
        effectiveAccess="member"
        seedId="member-after-admin"
        seed={limited}
      />,
    );
    await act(async () => reject(new ProviderUsageError(403)));
    expect(
      within(screen.getByLabelText("Period usage summary")).getByRole(
        "definition",
        { name: "7" },
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Usage access is no longer available/),
    ).toBeNull();
    expect(
      client.getQueryData(
        providerUsageKey(
          {
            ...usageScope,
            effectiveAccess: "member",
            seedId: "member-after-admin",
          },
          initialFilters,
        ),
      ),
    ).toEqual(limited);
  });
  it("retains rejection across remounts, distrusts unseen cached seeds and preserves other features", async () => {
    client.setQueryDefaults(["review-statistics", "actor-a", "workspace"], {
      gcTime: Infinity,
    });
    client.setQueryData(["review-statistics", "actor-a", "workspace"], {
      private: "stats",
    });
    vi.mocked(fetchProviderUsage).mockRejectedValue(
      new ProviderUsageError(403),
    );
    const view = render(<Harness />);
    change("Route", "gateway");
    await screen.findByText(/Usage access is no longer available/);
    view.rerender(
      <QueryClientProvider client={client}>
        <div>Another section</div>
      </QueryClientProvider>,
    );
    view.rerender(<Harness />);
    expect(screen.queryByLabelText("Period usage summary")).toBeNull();
    expect(
      client.getQueryData(["review-statistics", "actor-a", "workspace"]),
    ).toEqual({ private: "stats" });
    let resolve!: (value: ProviderUsageReport) => void;
    vi.mocked(fetchProviderUsage).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    client.setQueryData(
      providerUsageKey(
        { ...usageScope, seedId: "unseen-old-seed" },
        initialFilters,
      ),
      report,
    );
    view.rerender(<Harness seedId="unseen-old-seed" />);
    expect(screen.queryByLabelText("Period usage summary")).toBeNull();
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    await act(async () => resolve(report));
    expect(await screen.findByLabelText("Period usage summary")).toBeTruthy();
  });
  it("closes and requests fresh SSR on an authenticated scope mismatch", async () => {
    vi.mocked(fetchProviderUsage).mockRejectedValue(
      new ProviderUsageError(409),
    );
    render(<Harness />);
    change("Route", "gateway");
    await screen.findByText(/Usage access is no longer available/);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Period usage summary")).toBeNull();
  });
});
