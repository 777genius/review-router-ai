// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RepositoryScanInstallation,
  RepositoryScanSnapshot,
} from "../../src/features/repository-scan/repository-scan-model";
import { requestInstallationSyncClientAction } from "./actions";
import { RepositoryScanStatus } from "./repository-scan-status";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("./actions", () => ({
  requestInstallationSyncClientAction: vi.fn(async () => ({
    params: { notice: "sync_requested", workspace: "workspace-1" },
  })),
}));

vi.mock("sonner", () => ({
  toast: { custom: vi.fn(), dismiss: vi.fn() },
}));

const start = new Date("2026-11-17T12:00:00.000Z");
const scope = { actorId: "user-1", workspaceId: "workspace-1" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function scanned(
  state: RepositoryScanInstallation["state"],
  overrides: Partial<RepositoryScanSnapshot> = {},
): RepositoryScanSnapshot {
  // Requested and read now unless a test moves the read time.
  const now = new Date(Date.now()).toISOString();
  return {
    installations: [
      {
        githubInstallationId: "101",
        accountLogin: "octo-org",
        state,
        requestedAt: now,
      },
    ],
    repositoryCount: 0,
    checkedAt: now,
    ...overrides,
  };
}

function status(
  initialSnapshot: RepositoryScanSnapshot,
  hasRepositories = false,
): ReactElement {
  return (
    <RepositoryScanStatus
      scope={scope}
      initialSnapshot={initialSnapshot}
      hasRepositories={hasRepositories}
      mutationsEnabled
    >
      <p>No repositories yet</p>
    </RepositoryScanStatus>
  );
}

function renderWithClient(element: ReactElement) {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  );
  return {
    ...view,
    rerender: (next: ReactElement) =>
      view.rerender(
        <QueryClientProvider client={client}>{next}</QueryClientProvider>,
      ),
  };
}

function respond(...snapshots: (RepositoryScanSnapshot | number)[]) {
  const fetch = vi.fn(async () => {
    const next = snapshots.length > 1 ? snapshots.shift()! : snapshots[0]!;
    return typeof next === "number"
      ? new Response("{}", { status: next })
      : Response.json(next);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("RepositoryScanStatus", () => {
  it("explains a running scan instead of an empty list", () => {
    respond(scanned("scanning"));
    renderWithClient(status(scanned("scanning", { repositoryCount: 7 })));

    expect(screen.getByText("Scanning repositories")).toBeTruthy();
    expect(screen.getByText("7 found so far")).toBeTruthy();
    expect(
      screen.getByText(/repositories of octo-org from GitHub/),
    ).toBeTruthy();
    expect(screen.queryByText("No repositories yet")).toBeNull();
  });

  it("shows a failed scan with a retry through the existing sync action", async () => {
    const fetch = respond(scanned("scanning"));
    renderWithClient(status(scanned("failed")));

    expect(screen.getByText("Repository scan failed")).toBeTruthy();
    expect(screen.queryByText("No repositories yet")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry scan" }));
    });

    const formData = vi.mocked(requestInstallationSyncClientAction).mock
      .calls[0]![0];
    expect(formData.get("githubInstallationId")).toBe("101");
    expect(formData.get("workspaceId")).toBe("workspace-1");
    // The request starts watching the new scan at once.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Scanning repositories")).toBeTruthy();
  });

  it("keeps the plain empty state when no scan runs", () => {
    respond(scanned("completed"));
    renderWithClient(status(scanned("completed")));

    expect(screen.getByText("No repositories yet")).toBeTruthy();
    expect(screen.queryByText("Scanning repositories")).toBeNull();
  });

  it("shows a one-line notice above an existing list", () => {
    respond(scanned("scanning"));
    renderWithClient(status(scanned("scanning"), true));

    expect(screen.getByText(/Scanning octo-org on GitHub/)).toBeTruthy();
    expect(screen.queryByText("Scanning repositories")).toBeNull();
    expect(screen.queryByText("No repositories yet")).toBeNull();
  });

  it("polls while scanning, reloads the list once when done, then stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const fetch = respond(
      scanned("scanning", { checkedAt: "2026-11-17T12:00:03.000Z" }),
      scanned("completed", {
        repositoryCount: 4,
        checkedAt: "2026-11-17T12:00:06.000Z",
      }),
    );
    const initial = scanned("scanning");
    const view = renderWithClient(status(initial));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // The refreshed server render carries the same finished outcome.
    view.rerender(
      status(
        scanned("completed", {
          repositoryCount: 4,
          checkedAt: "2026-11-17T12:00:07.000Z",
        }),
        true,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("watches briefly after an install for a scan that starts late", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const later = scanned("completed", {
      repositoryCount: 3,
      checkedAt: "2026-11-17T12:00:10.000Z",
    });
    const fetch = respond(scanned("completed"), {
      ...later,
      installations: [
        { ...later.installations[0]!, requestedAt: "2026-11-17T12:00:07.000Z" },
      ],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepositoryScanStatus
          scope={scope}
          initialSnapshot={scanned("completed")}
          hasRepositories
          mutationsEnabled
          expectScan
        />
      </QueryClientProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_050);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    // The watch window is one minute.
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(12);
    const calls = fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("offers a retry instead of polling a scan stuck for 15 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const fetch = respond(scanned("scanning"));
    renderWithClient(
      status({
        ...scanned("scanning"),
        checkedAt: new Date(start.getTime() + 16 * 60_000).toISOString(),
      }),
    );

    expect(screen.getByText("Scan did not finish")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry scan" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops polling and hides progress when access is denied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const fetch = respond(403);
    renderWithClient(status(scanned("scanning")));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_050);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No repositories yet")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
