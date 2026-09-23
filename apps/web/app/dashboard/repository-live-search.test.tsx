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
  RepositoryLiveSearch,
  selectVisibleRepositoryIds,
  type RepositorySearchIndexItem,
} from "./repository-live-search";

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const index: RepositorySearchIndexItem[] = Array.from(
  { length: 40 },
  (_, i) => ({
    id: `repo_${i + 1}`,
    fullName: `personal/project-${i + 1}`,
    sourceUrl: `https://github.com/personal/project-${i + 1}`,
    searchText: `personal/project-${i + 1}`,
    visibility: i === 39 ? "public" : "private",
    readiness: i === 39 ? "needs_setup" : "ready",
    stargazersCount: i + 1,
    archived: i === 39,
  }),
);

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    "/dashboard?workspace=workspace_1&section=repositories&other=kept",
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("RepositoryLiveSearch", () => {
  it("renders repository #395 immediately as a real summary", () => {
    const deep = {
      ...index[0]!,
      id: "repo_395",
      fullName: "personal/project-395",
      searchText: "personal/project-395",
    };
    renderFixture({ searchIndex: [...index, deep] });
    search("project-395");
    expect(rowIds()).toEqual(["repo_395"]);
    expect(screen.getByText("personal/project-395")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /Open setup\/settings for personal\/project-395/,
      }),
    ).toBeTruthy();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(window.location.search).toContain("q=project-395");
  });

  it("orders rich and summary rows by the search index, with no duplicates", () => {
    renderFixture({ richIds: ["repo_2", "repo_1", "repo_24"] });
    expect(rowIds()).toEqual(
      Array.from({ length: 24 }, (_, i) => `repo_${i + 1}`),
    );
    expect(
      document.querySelectorAll("[data-repository-summary-row]"),
    ).toHaveLength(21);
    expect(screen.getByText("rich repo_1")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-repository-row-id="repo_1"]'),
    ).toHaveLength(1);
  });

  it("keeps a selected match beyond the cap in one rich row", () => {
    renderFixture({ selectedId: "repo_40", richIds: ["repo_40", "repo_1"] });
    expect(rowIds()).toHaveLength(24);
    expect(rowIds()[0]).toBe("repo_40");
    expect(rowIds()).not.toContain("repo_24");
    expect(screen.getByText("rich repo_40")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-repository-row-id="repo_40"]'),
    ).toHaveLength(1);
  });

  it("preserves a rich row's unsaved state while it is filtered out", () => {
    renderFixture();
    const checkbox = document.querySelector<HTMLInputElement>(
      '[data-repository-row-id="repo_1"] input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox!);
    search("project-40");
    expect(rowIds()).toEqual(["repo_40"]);
    search("");
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-repository-row-id="repo_1"] input[type="checkbox"]',
      ),
    ).toBe(checkbox);
    expect(checkbox?.checked).toBe(true);
  });

  it("does not overwrite browser navigation to another section or workspace", () => {
    renderFixture();
    search("project-40");
    const replaceState = vi.spyOn(window.history, "replaceState");
    act(() => {
      window.history.replaceState(
        window.history.state,
        "",
        "/dashboard/setup?workspace=workspace_1",
      );
      replaceState.mockClear();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.pathname).toBe("/dashboard/setup");
    expect(replaceState).not.toHaveBeenCalled();

    act(() => {
      window.history.replaceState(
        window.history.state,
        "",
        "/dashboard?workspace=workspace_2&section=repositories",
      );
      replaceState.mockClear();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.search).toBe(
      "?workspace=workspace_2&section=repositories",
    );
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("does not claim the bare default dashboard from a nondefault workspace", () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard?workspace=workspace_2&section=repositories",
    );
    render(<Fixture workspaceKey="workspace_2" />);
    search("project-40");
    const replaceState = vi.spyOn(window.history, "replaceState");
    act(() => {
      window.history.replaceState(window.history.state, "", "/dashboard?q=all");
      replaceState.mockClear();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.href).toContain("/dashboard?q=all");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("normalizes a bare default dashboard URL when filtering", () => {
    window.history.replaceState({}, "", "/dashboard");
    render(<Fixture initialWorkspaceParam="" />);
    search("project-40");
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe(
      "?workspace=workspace_1&section=repositories&q=project-40",
    );
    expect(rowIds()).toEqual(["repo_40"]);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("updates URL without navigation and restores query/filter on popstate", () => {
    renderFixture();
    const replaceState = vi.spyOn(window.history, "replaceState");
    search("project-40");
    expect(rowIds()).toEqual(["repo_40"]);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/dashboard?workspace=workspace_1&section=repositories&other=kept&q=project-40",
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
    act(() => {
      window.history.replaceState(
        window.history.state,
        "",
        "/dashboard?workspace=workspace_1&section=repositories&other=kept&visibility=public",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      (
        screen.getByRole("searchbox", {
          name: "Find repository",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(
      screen
        .getByRole("button", { name: "Public" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(rowIds()).toEqual(["repo_40"]);
  });

  it("opens a summary with preserved URL state and row-local pending", () => {
    renderFixture();
    search("project-40");
    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    const button = screen.getByRole("button", {
      name: /Open setup\/settings for personal\/project-40/,
    });
    fireEvent.click(button);
    expect(routerMock.replace).toHaveBeenCalledWith(
      "/dashboard?workspace=workspace_1&section=repositories&other=kept&q=project-40&visibility=public&repository=personal%2Fproject-40",
      { scroll: false },
    );
    expect(button.textContent).toBe("Opening...");
  });

  it("replaces a stale pending search and clears locally", () => {
    renderFixture();
    search("project-40");
    search("project-1");
    expect(rowIds()).toEqual([
      "repo_1",
      ...Array.from({ length: 10 }, (_, i) => `repo_${i + 10}`),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(rowIds()).toHaveLength(24);
    expect(window.location.search).not.toContain("q=");
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("resets controls when workspace key changes", () => {
    const view = render(<Fixture workspaceKey="workspace_1" />);
    search("project-40");
    window.history.replaceState(
      {},
      "",
      "/dashboard?workspace=workspace_2&section=repositories",
    );
    view.rerender(<Fixture workspaceKey="workspace_2" />);
    expect(
      (
        screen.getByRole("searchbox", {
          name: "Find repository",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(rowIds()).toHaveLength(24);
  });
});

it("includes selected match beyond the cap once", () => {
  expect(selectVisibleRepositoryIds(["a", "b", "c", "d"], 3, "d")).toEqual([
    "d",
    "a",
    "b",
  ]);
  expect(selectVisibleRepositoryIds(["a", "b", "c"], 2, "absent")).toEqual([
    "a",
    "b",
  ]);
});

function search(value: string): void {
  fireEvent.change(screen.getByRole("searchbox", { name: "Find repository" }), {
    target: { value },
  });
}

function renderFixture(
  options: {
    readonly searchIndex?: readonly RepositorySearchIndexItem[];
    readonly richIds?: readonly string[];
    readonly selectedId?: string;
  } = {},
): void {
  render(<Fixture {...options} />);
}

function Fixture({
  workspaceKey = "workspace_1",
  initialWorkspaceParam = workspaceKey,
  searchIndex = index,
  richIds = Array.from({ length: 24 }, (_, i) => `repo_${i + 1}`),
  selectedId,
}: {
  readonly workspaceKey?: string;
  readonly initialWorkspaceParam?: string | null;
  readonly searchIndex?: readonly RepositorySearchIndexItem[];
  readonly richIds?: readonly string[];
  readonly selectedId?: string;
}): React.ReactElement {
  return (
    <div data-repository-table>
      <RepositoryLiveSearch
        key={workspaceKey}
        workspaceKey={workspaceKey}
        initialWorkspaceParam={initialWorkspaceParam}
        selectedRepositoryFullName={
          selectedId ? `personal/project-${selectedId.slice(5)}` : null
        }
        selectedRepositoryId={selectedId ?? null}
        initialQuery=""
        initialFilter="all"
        searchIndex={searchIndex}
        totalRepositoryCount={searchIndex.length}
        rowLimit={24}
        richRowIds={richIds}
      >
        {richIds.map((id) => (
          <div key={id} data-repository-row-id={id} data-repository-setup-row>
            <input type="checkbox" defaultChecked={id === selectedId} />
            rich {id}
          </div>
        ))}
      </RepositoryLiveSearch>
    </div>
  );
}

function rowIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-repository-row-id]"),
  )
    .filter(
      (row) =>
        !row.closest<HTMLElement>("[data-repository-result-slot]")?.hidden,
    )
    .map((row) => row.dataset.repositoryRowId ?? "");
}
