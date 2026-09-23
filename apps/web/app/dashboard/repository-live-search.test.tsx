// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRepositorySearchHelperText,
  RepositoryLiveSearch,
  type RepositorySearchFilter,
  type RepositorySearchIndexItem,
} from "./repository-live-search";

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    "/dashboard?workspace=workspace_1&section=repositories",
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const baseInput = {
  activeFilter: "all" as const,
  hasActiveQuery: false,
  isSearchLoading: false,
  matchingCount: 37,
  renderedCountLabel: 24,
  renderedRepositoryCount: 24,
  rowLimit: 24,
  totalRepositoryCount: 60,
};

describe("buildRepositorySearchHelperText", () => {
  it("does not show optimistic match counts while updated repository rows load", () => {
    expect(
      buildRepositorySearchHelperText({
        ...baseInput,
        hasActiveQuery: true,
        isSearchLoading: true,
      }),
    ).toBe("Loading updated results...");
  });

  it("shows match counts once repository rows are ready", () => {
    expect(
      buildRepositorySearchHelperText({
        ...baseInput,
        hasActiveQuery: true,
      }),
    ).toBe("37 matching repositories. Showing first 24.");
  });

  it("filters rendered rows immediately without a spinner or server navigation", () => {
    vi.useFakeTimers();
    renderRepositoryLiveSearch();
    const replaceState = vi.spyOn(window.history, "replaceState");

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find repository" }),
      {
        target: { value: "p" },
      },
    );

    expect(
      screen.getByText("37 matching repositories. Showing first 24."),
    ).toBeTruthy();
    expect(screen.queryByText("Loading updated results...")).toBeNull();
    expect(
      document.querySelector<HTMLElement>("[data-repository-search-loader]")
        ?.hidden,
    ).toBe(true);
    act(() => vi.runAllTimers());
    expect(window.location.search).toContain("q=p");
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/dashboard?workspace=workspace_1&section=repositories&q=p",
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("hides nonmatching rows locally and preserves the selected row beyond the cap", () => {
    vi.useFakeTimers();
    renderRepositoryLiveSearch({ selectedRepositoryId: "repo_37" });

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find repository" }),
      {
        target: { value: "project" },
      },
    );
    act(() => vi.runAllTimers());
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLElement>('[data-repository-row-id="repo_37"]')
        ?.hidden,
    ).toBe(false);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find repository" }),
      {
        target: { value: "project-1" },
      },
    );
    expect(
      document.querySelector<HTMLElement>('[data-repository-row-id="repo_2"]')
        ?.hidden,
    ).toBe(true);
    expect(screen.queryByText("Loading updated results...")).toBeNull();
  });

  it("loads server rows only when the first matching page is missing locally", () => {
    vi.useFakeTimers();
    renderRepositoryLiveSearch();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find repository" }),
      {
        target: { value: "project-37" },
      },
    );

    expect(screen.getByText("Loading updated results...")).toBeTruthy();
    expect(
      document.querySelector<HTMLElement>("[data-repository-search-loader]")
        ?.hidden,
    ).toBe(false);
    act(() => vi.advanceTimersByTime(180));
    expect(routerMock.replace).toHaveBeenCalledWith(
      "/dashboard?workspace=workspace_1&section=repositories&q=project-37",
      { scroll: false },
    );
  });

  it("fetches a selected repository that was excluded by the previous filter", () => {
    vi.useFakeTimers();
    window.history.replaceState(
      {},
      "",
      "/dashboard?workspace=workspace_1&section=repositories&repository=personal%2Fproject-37&visibility=public",
    );
    renderRepositoryLiveSearch({
      selectedRepositoryId: "repo_37",
      initialFilter: "public",
      rowIds: Array.from({ length: 24 }, (_, index) => `repo_${index + 1}`),
    });

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    act(() => vi.runAllTimers());

    expect(routerMock.replace).toHaveBeenCalledWith(
      "/dashboard?workspace=workspace_1&section=repositories&repository=personal%2Fproject-37",
      { scroll: false },
    );
  });

  it("cancels a pending server search when the next query is local", () => {
    vi.useFakeTimers();
    renderRepositoryLiveSearch();
    const input = screen.getByRole("searchbox", { name: "Find repository" });
    fireEvent.change(input, { target: { value: "project-37" } });
    fireEvent.change(input, { target: { value: "project-1" } });
    act(() => vi.runAllTimers());

    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(window.location.search).toContain("q=project-1");
  });

  it("keeps server-rendered deep-link results without another navigation", () => {
    vi.useFakeTimers();
    window.history.replaceState(
      {},
      "",
      "/dashboard?workspace=workspace_1&section=repositories&q=project-37",
    );
    renderRepositoryLiveSearch({
      initialQuery: "project-37",
      rowIds: ["repo_37"],
    });
    act(() => vi.runAllTimers());

    expect(
      (
        screen.getByRole("searchbox", {
          name: "Find repository",
        }) as HTMLInputElement
      ).value,
    ).toBe("project-37");
    expect(screen.getByText("1 matching repositories.")).toBeTruthy();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("restores search and filter controls when browser history changes", () => {
    renderRepositoryLiveSearch();
    act(() => {
      window.history.replaceState(
        window.history.state,
        "",
        "/dashboard?workspace=workspace_1&section=repositories&q=missing&setup=attention",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(
      (
        screen.getByRole("searchbox", {
          name: "Find repository",
        }) as HTMLInputElement
      ).value,
    ).toBe("missing");
    expect(
      screen
        .getByRole("button", { name: "Needs attention" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});

function renderRepositoryLiveSearch(
  options: {
    readonly selectedRepositoryId?: string;
    readonly initialQuery?: string;
    readonly initialFilter?: RepositorySearchFilter;
    readonly rowIds?: readonly string[];
  } = {},
): void {
  const selectedRepositoryId = options.selectedRepositoryId;
  const rowIds =
    options.rowIds ??
    (selectedRepositoryId
      ? [
          ...Array.from({ length: 23 }, (_, index) => `repo_${index + 1}`),
          selectedRepositoryId,
        ]
      : Array.from({ length: 24 }, (_, index) => `repo_${index + 1}`));
  render(
    <div data-repository-table>
      <RepositoryLiveSearch
        workspaceKey="workspace_1"
        selectedRepositoryFullName={
          selectedRepositoryId ? "personal/project-37" : null
        }
        selectedRepositoryId={selectedRepositoryId ?? null}
        initialQuery={options.initialQuery ?? ""}
        initialFilter={options.initialFilter ?? "all"}
        searchIndex={repositorySearchIndex()}
        totalRepositoryCount={37}
        renderedRepositoryCount={rowIds.length}
        rowLimit={24}
      />
      <div data-repository-search-loader hidden />
      <div data-repository-results>
        {rowIds.map((id) => (
          <div key={id} data-repository-row-id={id}>
            {id}
          </div>
        ))}
      </div>
    </div>,
  );
}

function repositorySearchIndex(): RepositorySearchIndexItem[] {
  return Array.from({ length: 37 }, (_, index) => ({
    id: `repo_${index + 1}`,
    searchText: `personal/project-${index + 1}`,
    visibility: "private",
    readiness: "ready",
  }));
}
