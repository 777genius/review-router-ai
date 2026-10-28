// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HistoryStatus,
  type HistoryPullRequestPage,
} from "@reviewrouter/features-review-history/contracts";
import { HistoryView, type HistoryViewProps } from "./history-view";
import { defaultHistoryFilters } from "../application/history-presentation";
import {
  fetchHistoryList,
  fetchHistoryRuns,
  fetchHistoryRepositories,
  HistoryRequestError,
  historyScopeKey,
} from "../adapters/history-api";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../adapters/history-api", async () => ({
  ...(await vi.importActual<typeof import("../adapters/history-api")>(
    "../adapters/history-api",
  )),
  fetchHistoryList: vi.fn(),
  fetchHistoryRuns: vi.fn(),
  fetchHistoryRepositories: vi.fn(),
}));
vi.mock("@reviewrouter/ui", async () => ({
  ...(await vi.importActual<typeof import("@reviewrouter/ui")>(
    "@reviewrouter/ui",
  )),
  SelectField: ({
    label,
    value,
    disabled,
    options,
    onValueChange,
  }: {
    label: string;
    value: string;
    disabled: boolean;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
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
function page(title = "Safely handle account access"): HistoryPullRequestPage {
  return {
    windowToken: "window-a",
    nextCursor: null,
    coverage: {
      state: "available",
      availableSince: "2026-10-28T00:00:00.000Z",
      supportedSource: "github_v2",
    },
    items: [
      {
        id: "pr-a",
        scmRepositoryIdentityId: "scm-a",
        repositoryFullName: "acme/project",
        pullRequestNumber: 42,
        pullRequestTitle: title,
        pullRequestUrl: "https://github.com/acme/project/pull/42",
        status: HistoryStatus.Completed,
        requestedAt: "2026-10-28T12:00:00.000Z",
      },
    ],
  };
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const props: HistoryViewProps = {
    actorId: "actor-a",
    workspaceId: "workspace-a",
    seedId: "seed-a",
    initialFilters: defaultHistoryFilters,
    initialPage: page(),
    initialRepositories: { items: [], selected: null, nextCursor: null },
  };
  const renderView = (next: HistoryViewProps) => (
    <QueryClientProvider client={client}>
      <HistoryView {...next} />
    </QueryClientProvider>
  );
  const view = render(renderView(props));
  return {
    client,
    props,
    rerender: (next: Partial<HistoryViewProps>) =>
      view.rerender(renderView({ ...props, ...next })),
    remountSameSeed: () => {
      view.rerender(
        <QueryClientProvider client={client}>
          <div>Another dashboard section</div>
        </QueryClientProvider>,
      );
      view.rerender(renderView(props));
    },
  };
}
beforeEach(() => {
  vi.mocked(fetchHistoryList).mockReset();
  vi.mocked(fetchHistoryRuns).mockReset();
  vi.mocked(fetchHistoryRepositories).mockReset();
  vi.mocked(fetchHistoryRepositories).mockResolvedValue({
    items: [],
    selected: null,
    nextCursor: null,
  });
});
afterEach(cleanup);
describe("Reviews access and cancellation", () => {
  it.each([401, 403])(
    "a lazy history %s closes every cached dataset and only a fresh authorized seed restores it",
    async (status) => {
      vi.mocked(fetchHistoryRuns).mockRejectedValue(
        new HistoryRequestError(status),
      );
      const { client, rerender, remountSameSeed } = setup();
      expect(fetchHistoryList).not.toHaveBeenCalled();
      client.setQueryData(
        [
          ...historyScopeKey("actor-a", "workspace-a"),
          "older-seed",
          "repositories",
        ],
        { private: "old repository" },
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Show review history for acme/project #42",
        }),
      );
      await screen.findByText(/access is no longer available/);
      expect(
        screen.queryByRole("list", { name: "Reviewed pull requests" }),
      ).toBeNull();
      expect(screen.getByLabelText("Search")).toHaveProperty("disabled", true);
      await waitFor(() =>
        expect(
          client
            .getQueryCache()
            .findAll({ queryKey: historyScopeKey("actor-a", "workspace-a") })
            .every((query) => query.state.data === undefined),
        ).toBe(true),
      );
      rerender({});
      expect(screen.queryByText("Safely handle account access")).toBeNull();
      remountSameSeed();
      expect(screen.queryByText("Safely handle account access")).toBeNull();
      expect(screen.getByLabelText("Search")).toHaveProperty("disabled", true);
      expect(fetchHistoryList).not.toHaveBeenCalled();
      let resolveEarlier!: (data: HistoryPullRequestPage) => void;
      vi.mocked(fetchHistoryList).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveEarlier = resolve;
          }),
      );
      rerender({
        seedId: "earlier-cached-server-seed",
        initialPage: page("Earlier server-rendered private review"),
      });
      expect(
        screen.queryByText("Earlier server-rendered private review"),
      ).toBeNull();
      await waitFor(() => expect(fetchHistoryList).toHaveBeenCalledTimes(1));
      expect(
        screen.queryByRole("list", { name: "Reviewed pull requests" }),
      ).toBeNull();
      vi.mocked(fetchHistoryList).mockResolvedValue(
        page("Fresh authorized review"),
      );
      rerender({ seedId: "fresh-authorized-seed" });
      expect(screen.queryByText("Safely handle account access")).toBeNull();
      expect(await screen.findByText("Fresh authorized review")).toBeTruthy();
      await act(async () => {
        resolveEarlier(page("Late earlier-seed response"));
        await Promise.resolve();
      });
      expect(screen.queryByText("Late earlier-seed response")).toBeNull();
    },
  );
  it("an obsolete request cannot resurrect departed workspace data or evict the newly authorized workspace", async () => {
    let resolveOld!: (data: HistoryPullRequestPage) => void;
    let oldSignal: AbortSignal | undefined;
    vi.mocked(fetchHistoryList).mockImplementation(
      (_workspace, _filters, _cursor, signal) => {
        oldSignal = signal;
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      },
    );
    const { client, rerender } = setup();
    client.setQueryData(
      [
        ...historyScopeKey("actor-a", "workspace-a"),
        "departed-older-seed",
        "list",
      ],
      page("Earlier departed cache"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchHistoryList).toHaveBeenCalledTimes(1));
    rerender({
      actorId: "actor-b",
      workspaceId: "workspace-b",
      seedId: "seed-b",
      initialPage: page("New workspace review"),
    });
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    await act(async () => {
      resolveOld(page("Departed private review"));
      await Promise.resolve();
    });
    expect(screen.getByText("New workspace review")).toBeTruthy();
    expect(screen.queryByText("Departed private review")).toBeNull();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: historyScopeKey("actor-a", "workspace-a") })
        .every((query) => query.state.data === undefined),
    ).toBe(true);
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: historyScopeKey("actor-b", "workspace-b") })
        .some((query) => query.state.data !== undefined),
    ).toBe(true);
    // A second filter commits pending text before its debounce can erase it.
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "pending query" },
    });
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "active" },
    });
    expect(screen.getByLabelText("Search")).toHaveProperty(
      "value",
      "pending query",
    );
    await waitFor(() =>
      expect(fetchHistoryList).toHaveBeenLastCalledWith(
        "workspace-b",
        { ...defaultHistoryFilters, q: "pending query", status: "active" },
        null,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "typed again" },
    });
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "7" },
    });
    expect(screen.getByLabelText("Search")).toHaveProperty(
      "value",
      "typed again",
    );
    await waitFor(() =>
      expect(fetchHistoryList).toHaveBeenLastCalledWith(
        "workspace-b",
        {
          ...defaultHistoryFilters,
          q: "typed again",
          status: "active",
          days: 7,
        },
        null,
        expect.any(AbortSignal),
      ),
    );
  });
});
