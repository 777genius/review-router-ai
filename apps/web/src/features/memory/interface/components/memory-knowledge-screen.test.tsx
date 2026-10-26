// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  memoryPageKey,
  type MemoryDashboardApi,
} from "../../adapters/memory-dashboard-api";
import type { MemoryUnconfirmedChange } from "../../application/memory-knowledge-view";
import { memoryKnowledgePreviewData } from "./memory-knowledge-preview";
import { MemoryKnowledgeScreen } from "./memory-knowledge-screen";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function fixture(
  changes: Partial<ReturnType<typeof memoryKnowledgePreviewData>> = {},
) {
  const page = { ...memoryKnowledgePreviewData(), ...changes };
  const api: MemoryDashboardApi = {
    list: vi.fn(async () => page),
    mutate: vi.fn(async (input) => ({
      id: input.commandId,
      entryId: input.entryId ?? "new",
      revision: "r2",
      state: "queued" as const,
      message: "Accepted. Waiting to process your change.",
    })),
    progress: vi.fn(async (input) => ({
      id: input.commandId,
      entryId: "new",
      revision: "r2",
      state: "queued" as const,
      message: "Accepted. Waiting to process your change.",
    })),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Workspace() {
    const [unconfirmedChange, setUnconfirmedChange] =
      useState<MemoryUnconfirmedChange | null>(null);
    return (
      <MemoryKnowledgeScreen
        initialData={page}
        api={api}
        onScopeChange={vi.fn()}
        onPageChange={vi.fn()}
        onTopicChange={vi.fn()}
        unconfirmedChange={unconfirmedChange}
        onUnconfirmedChange={(change, commandId) =>
          setUnconfirmedChange(
            (current) =>
              change ??
              (current?.request.commandId === commandId ? null : current),
          )
        }
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>,
  );
  return { api, view, client, page };
}
describe("memory screen", () => {
  it.each(["response", "progress"] as const)(
    "redacts confirmed Forget from every exact-scope cached page when refresh fails: %s",
    async (confirmation) => {
      const f = fixture();
      let releaseDrain!: () => void;
      const drain = new Promise<void>((resolve) => {
        releaseDrain = resolve;
      });
      const cancellation = vi
        .spyOn(f.client, "cancelQueries")
        .mockReturnValueOnce(drain);
      const invalidation = vi.spyOn(f.client, "invalidateQueries");
      const second = { ...f.page, cursor: "another_page" };
      const filtered = { ...f.page, topicId: "database" };
      const otherRepository = { ...f.page, repositoryId: "other_repository" };
      const otherWorkspace = { ...f.page, workspaceId: "other_workspace" };
      for (const page of [second, filtered, otherRepository, otherWorkspace])
        f.client.setQueryData(memoryPageKey(page), page);
      vi.mocked(f.api.list).mockRejectedValue(new Error("Refresh unavailable"));
      const result = (commandId: string) => ({
        id: commandId,
        entryId: "mem_queries",
        revision: "r2",
        state:
          confirmation === "response"
            ? ("cleanup_pending" as const)
            : ("unknown" as const),
        message:
          "Removed from new reviews. Stored-copy cleanup is still pending.",
      });
      vi.mocked(f.api.mutate).mockImplementation(async (input) => {
        if (confirmation === "progress")
          throw new TypeError("Response lost after admission");
        return result(input.commandId);
      });
      vi.mocked(f.api.progress).mockImplementation((input) =>
        confirmation === "progress"
          ? Promise.resolve(result(input.commandId))
          : new Promise(() => {}),
      );
      fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Forget memory" }));
      await waitFor(() => expect(cancellation).toHaveBeenCalledTimes(1));
      expect(invalidation).not.toHaveBeenCalled();
      expect(
        f.client.getQueryData<typeof f.page>(memoryPageKey(f.page))?.entries[0]
          ?.body,
      ).toBe(f.page.entries[0]?.body);
      releaseDrain();
      await screen.findByText("Forgetting");
      expect(screen.queryByText(/Use parameterized queries/)).toBeNull();
      await waitFor(
        () =>
          expect(
            screen.getByText(/We could not refresh this list/),
          ).toBeTruthy(),
        { timeout: 5_000 },
      );
      for (const page of [f.page, second, filtered]) {
        const cached = f.client.getQueryData<typeof page>(memoryPageKey(page))!;
        expect(cached.entries[0]).toMatchObject({
          id: "mem_queries",
          body: null,
          topics: [],
          status: "forget_pending",
        });
        expect(cached.entries[1]).toEqual(page.entries[1]);
      }
      for (const page of [otherRepository, otherWorkspace])
        expect(f.client.getQueryData(memoryPageKey(page))).toEqual(page);
    },
  );
  it("keeps an unconfirmed Forget uncertain when neither response nor progress proves admission", async () => {
    const { api } = fixture();
    vi.mocked(api.mutate).mockRejectedValue(new TypeError("Response lost"));
    vi.mocked(api.progress).mockRejectedValue(
      new Error("Progress unavailable"),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Forget memory" }));
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Close and check status" }),
    );
    expect(screen.getByText(/Use parameterized queries/)).toBeTruthy();
    expect(screen.queryByText("Forgetting")).toBeNull();
  });
  it("renders body, source, original time and historical status for a viewer without manager controls", () => {
    fixture({ canManage: false });
    expect(screen.getByText(/Use parameterized queries/)).toBeTruthy();
    expect(screen.getByText("Historical observation")).toBeTruthy();
    expect(screen.getAllByText(/Statement/)[0]?.textContent).toContain(
      "Oct 19, 2026",
    );
    expect(
      screen
        .getAllByRole("link", { name: /GitHub discussion/ })[0]
        ?.getAttribute("href"),
    ).toMatch(/^https:\/\/github.com\//);
    expect(screen.queryByRole("button", { name: "Add memory" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Forget" })).toBeNull();
    expect(screen.getByText(/View only/)).toBeTruthy();
  });
  it("submits an approved rule and shows queued rather than saved", async () => {
    const { api } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
    fireEvent.change(screen.getByLabelText("Memory text"), {
      target: { value: "Use UTC for stored timestamps." },
    });
    fireEvent.change(screen.getByLabelText(/Topics/), {
      target: { value: "database, time, database" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit memory" }));
    await screen.findByText("Accepted. Waiting to process your change.");
    expect(api.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "save",
        body: "Use UTC for stored timestamps.",
        topics: ["database", "time"],
        entryId: null,
        expectedRevision: null,
        workspaceId: "workspace_preview",
        repositoryId: null,
      }),
    );
    expect(screen.queryByText(/^Saved[.!]?$/)).toBeNull();
  });
  it("retries the exact UUID, body and revision after an ambiguous network failure", async () => {
    const { api } = fixture();
    vi.mocked(api.mutate).mockRejectedValueOnce(
      new Error("The connection was interrupted."),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    fireEvent.change(screen.getByLabelText("Memory text"), {
      target: { value: "Use parameterized queries everywhere." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit memory" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Memory text") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    await screen.findByText("Accepted. Waiting to process your change.");
    expect(vi.mocked(api.mutate).mock.calls).toHaveLength(2);
    expect(vi.mocked(api.mutate).mock.calls[1]![0]).toEqual(
      vi.mocked(api.mutate).mock.calls[0]![0],
    );
    expect(vi.mocked(api.mutate).mock.calls[0]![0].expectedRevision).toBe(
      "revision_mem_queries",
    );
  });
  it("requires human stop-using and forget confirmation even when saving is disabled", async () => {
    const { api } = fixture({ writesEnabled: false, availability: "disabled" });
    expect(
      (screen.getByRole("button", { name: "Add memory" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Stop using" })[0]!);
    expect(api.mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/no longer be used in new reviews/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]!);
    expect(screen.getByText(/Cleanup may take time/)).toBeTruthy();
    expect(api.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Forget memory" }));
    await waitFor(() =>
      expect(api.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "forget",
          entryId: "mem_queries",
          expectedRevision: "revision_mem_queries",
        }),
      ),
    );
  });
  it("keeps unrelated memory controls available while stored-copy cleanup is pending", async () => {
    const { api } = fixture();
    const cleanupResult = (commandId: string) => ({
      id: commandId,
      entryId: "mem_queries",
      revision: "r2",
      state: "cleanup_pending" as const,
      message:
        "Removed from new reviews. Stored-copy cleanup is still pending.",
    });
    vi.mocked(api.mutate).mockImplementation(async (input) =>
      cleanupResult(input.commandId),
    );
    vi.mocked(api.progress).mockImplementation(async (input) =>
      cleanupResult(input.commandId),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Forget memory" }));
    await screen.findByText(cleanupResult("unused").message);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      (screen.getByRole("button", { name: "Add memory" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    const affected = screen
      .getByText(/Use parameterized queries/)
      .closest("article")!;
    expect(
      (
        within(affected).getByRole("button", {
          name: "Forget",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const unrelated = screen
      .getByText(/Changes to payment calculations/)
      .closest("article")!;
    expect(
      (
        within(unrelated).getByRole("button", {
          name: "Edit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        within(unrelated).getByRole("button", {
          name: "Stop using",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("associates validation errors with fields and closes an untouched dialog with Escape", async () => {
    const { api } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit memory" }));
    const alert = await screen.findByRole("alert");
    const input = screen.getByLabelText("Memory text");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(input);
    expect(api.mutate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
