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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  StatisticsDayCoverage,
  StatisticsUncoveredSource,
} from "@reviewrouter/features-review-statistics";
import { StatisticsView } from "./statistics-view";
import {
  fetchStatisticsIssues,
  fetchStatisticsReport,
  StatisticsRequestError,
  statisticsReportKey,
  statisticsScopeKey,
} from "../adapters/statistics-api";
import { issueFixture, statisticsFixture } from "../statistics.test-fixtures";
vi.mock("../adapters/statistics-api", async () => ({
  ...(await vi.importActual<typeof import("../adapters/statistics-api")>(
    "../adapters/statistics-api",
  )),
  fetchStatisticsReport: vi.fn(),
  fetchStatisticsIssues: vi.fn(),
}));
vi.mock("@reviewrouter/ui", async () => ({
  ...(await vi.importActual<typeof import("@reviewrouter/ui")>(
    "@reviewrouter/ui",
  )),
  SelectField: ({
    name,
    label,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    name: string;
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        name={name}
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
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  BarChart: ({
    children,
    ...props
  }: {
    children: ReactNode;
    "aria-label": string;
  }) => <div aria-label={props["aria-label"]}>{children}</div>,
  Bar: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));
function setup({
  actorId = "actor-a",
  workspaceId = "workspace-a",
  seedId = "seed-a",
  initialReport = statisticsFixture(),
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  }),
} = {}) {
  const props = { actorId, workspaceId, seedId, initialReport };
  const view = render(
    <QueryClientProvider client={client}>
      <StatisticsView {...props} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    props,
    rerenderProps: (changes: Partial<typeof props>) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <StatisticsView {...props} {...changes} />
        </QueryClientProvider>,
      ),
  };
}
async function refresh() {
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })),
  );
}
beforeEach(() => {
  vi.mocked(fetchStatisticsReport).mockReset();
  vi.mocked(fetchStatisticsIssues).mockReset();
});
afterEach(cleanup);
describe("Statistics", () => {
  it("renders three SSR-seeded metrics, exact daily data and fixed review rankings without fetching issues", () => {
    setup();
    const dl = screen.getByLabelText("All-severity review summary");
    expect(
      within(dl)
        .getAllByRole("definition")
        .map((node) => node.textContent),
    ).toEqual(["1", "3", "4"]);
    expect(screen.queryByText(/merge time/i)).toBeNull();
    expect(screen.getByText("Top repositories by reviews")).toBeTruthy();
    expect(fetchStatisticsReport).not.toHaveBeenCalled();
    expect(fetchStatisticsIssues).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Daily data · all severities"));
    expect(
      screen.getAllByRole("columnheader").map((node) => node.textContent),
    ).toEqual([
      "UTC day",
      "Coverage",
      "PRs reviewed",
      "Reviews",
      "Critical",
      "Major",
      "Minor",
      "Unknown",
    ]);
    expect(screen.getByText(/daily PR counts do not add up/)).toBeTruthy();
    expect(screen.getByText("Oct 23, 2026 · in progress")).toBeTruthy();
  });
  it("filters issues consistently, keeps all-severity KPIs and the full daily table, and resets pagination", async () => {
    const original = statisticsFixture();
    vi.mocked(fetchStatisticsIssues)
      .mockResolvedValueOnce({ items: [issueFixture()], nextCursor: "next-a" })
      .mockResolvedValueOnce({
        items: [issueFixture("page-two")],
        nextCursor: null,
      })
      .mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(fetchStatisticsReport).mockImplementation(
      async (_workspace, filter) => ({
        ...original,
        filter,
        topRepositoriesByIssues: [
          { ...original.topRepositoriesByIssues[0]!, count: 1 },
        ],
      }),
    );
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "View issues in acme/project" }),
    );
    expect(await screen.findByText("Issue issue-a")).toBeTruthy();
    expect(fetchStatisticsIssues).toHaveBeenLastCalledWith(
      "workspace-a",
      expect.objectContaining({
        from: original.period.from,
        to: original.period.to,
        severity: "all",
        repositoryId: "repo-a",
      }),
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Issue page-two")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "major" },
    });
    expect(
      await screen.findByText("No recorded issues match this selection."),
    ).toBeTruthy();
    expect(fetchStatisticsIssues).toHaveBeenLastCalledWith(
      "workspace-a",
      { from: original.period.from, to: original.period.to, severity: "major" },
      expect.any(AbortSignal),
    );
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(
      within(screen.getByLabelText("All-severity review summary"))
        .getAllByRole("definition")
        .map((node) => node.textContent),
    ).toEqual(["1", "3", "4"]);
    fireEvent.click(screen.getByText("Daily data · all severities"));
    expect(screen.getByRole("columnheader", { name: "Unknown" })).toBeTruthy();
  });
  it("moves focus only for explicit issue navigation, preserving filter and refresh focus across remounts", async () => {
    const original = statisticsFixture();
    let generation = 0;
    vi.mocked(fetchStatisticsReport).mockImplementation(
      async (_workspace, filter) => ({
        ...original,
        filter,
        period: {
          ...original.period,
          to: new Date(
            Date.parse(original.period.to) + ++generation,
          ).toISOString(),
        },
      }),
    );
    vi.mocked(fetchStatisticsIssues).mockImplementation(
      async (_workspace, filter) => ({
        items: [
          issueFixture(`${filter.severity}-${filter.repositoryId ?? "all"}`),
        ],
        nextCursor: null,
      }),
    );
    const previousScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    try {
      setup();
      fireEvent.click(
        screen.getByRole("button", { name: "View issues in acme/project" }),
      );
      await screen.findByText("Issue all-repo-a");
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: "Recorded issues" }),
      );
      expect(scroll).toHaveBeenCalledTimes(1);
      const severity = screen.getByLabelText("Severity");
      severity.focus();
      fireEvent.change(severity, { target: { value: "major" } });
      await screen.findByText("Issue major-all");
      expect(document.activeElement).toBe(screen.getByLabelText("Severity"));
      expect(scroll).toHaveBeenCalledTimes(1);
      const button = screen.getByRole("button", { name: "Refresh" });
      button.focus();
      await refresh();
      await waitFor(() =>
        expect(fetchStatisticsIssues).toHaveBeenCalledTimes(3),
      );
      expect(document.activeElement).toBe(button);
      expect(scroll).toHaveBeenCalledTimes(1);
      const period = screen.getByLabelText("Period");
      period.focus();
      fireEvent.change(period, { target: { value: "7" } });
      await waitFor(() =>
        expect(fetchStatisticsIssues).toHaveBeenCalledTimes(4),
      );
      expect(document.activeElement).toBe(period);
      expect(scroll).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "View issues in acme/project" }),
      );
      await screen.findByText("Issue major-repo-a");
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: "Recorded issues" }),
      );
      expect(scroll).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole("button", { name: "Close issues" }));
      fireEvent.click(
        screen.getByRole("button", { name: "View issues caught →" }),
      );
      await screen.findByText("Issue major-all");
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: "Recorded issues" }),
      );
      expect(scroll).toHaveBeenCalledTimes(3);
    } finally {
      if (previousScroll)
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          previousScroll,
        );
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });
  it.each([401, 403])(
    "a report %s purges the entire actor/workspace and never resurrects the seed through controls",
    async (status) => {
      vi.mocked(fetchStatisticsReport).mockRejectedValue(
        new StatisticsRequestError(status),
      );
      const { client, props, rerenderProps } = setup();
      client.setQueryData(
        [
          ...statisticsScopeKey("actor-a", "workspace-a"),
          "other-seed",
          "issues",
        ],
        { items: [issueFixture()] },
      );
      await refresh();
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        expect.stringContaining("access is no longer available"),
      );
      expect(screen.queryByLabelText("All-severity review summary")).toBeNull();
      await waitFor(() =>
        expect(
          client
            .getQueryCache()
            .findAll({ queryKey: statisticsScopeKey("actor-a", "workspace-a") })
            .every((entry) => entry.state.data === undefined),
        ).toBe(true),
      );
      expect(screen.getByLabelText("Period")).toHaveProperty("disabled", true);
      rerenderProps({ ...props });
      expect(screen.queryByLabelText("All-severity review summary")).toBeNull();
      vi.mocked(fetchStatisticsReport).mockResolvedValue(statisticsFixture());
      rerenderProps({ seedId: "new-authorized-seed" });
      expect(screen.getByLabelText("All-severity review summary")).toBeTruthy();
    },
  );
  it("an old cancellation promise cannot purge a freshly authorized seed", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    });
    const cancel = client.cancelQueries.bind(client);
    let finishCancellation!: () => void;
    vi.spyOn(client, "cancelQueries").mockImplementation((filters, options) => {
      void cancel(filters, options);
      return new Promise<void>((resolve) => {
        finishCancellation = resolve;
      });
    });
    vi.mocked(fetchStatisticsReport).mockRejectedValue(
      new StatisticsRequestError(403),
    );
    const { rerenderProps } = setup({ client });
    await refresh();
    await screen.findByText(/access is no longer available/);
    rerenderProps({ seedId: "fresh-authorized-race-seed" });
    await act(async () => {
      finishCancellation();
      await Promise.resolve();
    });
    expect(
      client.getQueryData(
        statisticsReportKey(
          "actor-a",
          "workspace-a",
          "fresh-authorized-race-seed",
          statisticsFixture().filter,
        ),
      ),
    ).toMatchObject({ totals: { reviews: 3 } });
    expect(screen.getByLabelText("All-severity review summary")).toBeTruthy();
  });
  it.each([401, 403])(
    "an issues %s hides the cards and charts too",
    async (status) => {
      vi.mocked(fetchStatisticsIssues).mockRejectedValue(
        new StatisticsRequestError(status),
      );
      setup();
      fireEvent.click(
        screen.getByRole("button", { name: "View issues caught →" }),
      );
      await screen.findByText(/access is no longer available/);
      expect(screen.queryByLabelText("All-severity review summary")).toBeNull();
      expect(
        screen.queryByRole("region", { name: "Review activity" }),
      ).toBeNull();
    },
  );
  it("isolates actors in the same workspace and aborts obsolete workspace and filter requests", async () => {
    const calls: { signal: AbortSignal }[] = [];
    vi.mocked(fetchStatisticsReport).mockImplementation(
      (_workspace, _filter, signal) => {
        calls.push({ signal });
        return new Promise(() => {});
      },
    );
    const { client, rerenderProps } = setup();
    await refresh();
    rerenderProps({
      actorId: "actor-b",
      seedId: "seed-b",
      initialReport: {
        ...statisticsFixture(),
        totals: { ...statisticsFixture().totals, reviews: 999 },
      },
    });
    await waitFor(() => expect(calls[0]?.signal.aborted).toBe(true));
    expect(
      within(screen.getByLabelText("All-severity review summary")).getByText(
        "999",
      ),
    ).toBeTruthy();
    expect(
      client.getQueryData(
        statisticsReportKey(
          "actor-b",
          "workspace-a",
          "seed-b",
          statisticsFixture().filter,
        ),
      ),
    ).toMatchObject({ totals: { reviews: 999 } });
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "7" },
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.queryByLabelText("All-severity review summary")).toBeNull();
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "90" },
    });
    await waitFor(() => expect(calls[1]?.signal.aborted).toBe(true));
  });
  it("retains labeled same-period data on refresh failure and shows partial/unavailable truthfully", async () => {
    const initialReport = statisticsFixture();
    const daily = [...initialReport.daily];
    daily[0] = { ...daily[0]!, coverage: StatisticsDayCoverage.Unavailable };
    daily[1] = {
      ...daily[1]!,
      coverage: StatisticsDayCoverage.Partial,
      reviews: 9,
    };
    vi.mocked(fetchStatisticsReport).mockRejectedValue(
      new StatisticsRequestError(500),
    );
    setup({
      initialReport: {
        ...initialReport,
        daily,
        coverage: {
          ...initialReport.coverage,
          currentComplete: false,
          previousComplete: false,
          uncoveredSources: [StatisticsUncoveredSource.GitlabDirect],
        },
      },
    });
    expect(screen.queryByText(/vs prior period/)).toBeNull();
    expect(
      screen.getByText(/some history or connected review sources/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Daily data · all severities"));
    const first = screen.getAllByRole("row")[1]!;
    expect(
      within(first)
        .getAllByRole("cell")
        .every((node) => node.textContent === "Unavailable"),
    ).toBe(true);
    await refresh();
    await screen.findByText(/Refresh failed/);
    expect(screen.getByLabelText("All-severity review summary")).toBeTruthy();
  });
  it("missing activation renders unavailable without zero cards", () => {
    const initialReport = statisticsFixture();
    setup({
      initialReport: {
        ...initialReport,
        coverage: { ...initialReport.coverage, availableSince: null },
      },
    });
    expect(screen.getByText(/not available yet/)).toBeTruthy();
    expect(screen.queryByLabelText("All-severity review summary")).toBeNull();
  });
  it("same-preset midnight refresh resets issue pagination to the accepted new exact period", async () => {
    const original = statisticsFixture();
    const refreshed = {
      ...original,
      period: {
        ...original.period,
        from: "2026-09-25T00:00:00.000Z",
        to: "2026-10-24T00:01:00.000Z",
        asOf: "2026-10-24T00:01:00.000Z",
      },
    };
    vi.mocked(fetchStatisticsIssues).mockImplementation(
      async (_workspace, filter) => ({
        items: [
          issueFixture(
            filter.to === refreshed.period.to
              ? "fresh-period"
              : filter.cursor
                ? "old-page-two"
                : "old-page-one",
          ),
        ],
        nextCursor: filter.cursor ? null : "next",
      }),
    );
    vi.mocked(fetchStatisticsReport).mockResolvedValue(refreshed);
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "View issues caught →" }),
    );
    await screen.findByText("Issue old-page-one");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Issue old-page-two");
    await refresh();
    await screen.findByText("Issue fresh-period");
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(fetchStatisticsIssues).toHaveBeenLastCalledWith(
      "workspace-a",
      { from: refreshed.period.from, to: refreshed.period.to, severity: "all" },
      expect.any(AbortSignal),
    );
    expect(screen.queryByText("Issue old-page-two")).toBeNull();
  });
  it("page-only failures preserve the report and retry the same scope", async () => {
    vi.mocked(fetchStatisticsIssues).mockRejectedValue(
      new StatisticsRequestError(500),
    );
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "View issues caught →" }),
    );
    await screen.findByRole("button", { name: "Retry issues" });
    expect(screen.getByLabelText("All-severity review summary")).toBeTruthy();
    vi.mocked(fetchStatisticsIssues).mockResolvedValue({
      items: [issueFixture()],
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry issues" }));
    expect(await screen.findByText("Issue issue-a")).toBeTruthy();
    expect(fetchStatisticsIssues).toHaveBeenLastCalledWith(
      "workspace-a",
      {
        from: statisticsFixture().period.from,
        to: statisticsFixture().period.to,
        severity: "all",
      },
      expect.any(AbortSignal),
    );
  });
});
