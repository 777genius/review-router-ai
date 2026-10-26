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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryDashboardApiError,
  memoryDashboardApi,
  memoryPageKey,
} from "../../adapters/memory-dashboard-api";
import { memoryKnowledgePreviewData } from "./memory-knowledge-preview";
import { MemoryKnowledgeWorkspace } from "./memory-knowledge-workspace";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  query: "section=memory",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/dashboard/acme",
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  navigation.push.mockReset();
  navigation.query = "section=memory";
});

function fixture() {
  const page = memoryKnowledgePreviewData();
  vi.spyOn(memoryDashboardApi, "list").mockResolvedValue(page);
  const mutate = vi
    .spyOn(memoryDashboardApi, "mutate")
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const progress = vi
    .spyOn(memoryDashboardApi, "progress")
    .mockRejectedValue(new MemoryDashboardApiError("memory_not_found", 404));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const draw = (data = page) => (
    <QueryClientProvider client={client}>
      <MemoryKnowledgeWorkspace initialData={data} />
    </QueryClientProvider>
  );
  const view = render(draw());
  return { page, mutate, progress, client, view, draw };
}
describe("memory workspace navigation", () => {
  it("closes an ambiguous request, changes scope, then resumes the exact approval", async () => {
    const f = fixture();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    fireEvent.change(screen.getByLabelText("Memory text"), {
      target: { value: "Use approved parameterized SQL everywhere." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit memory" }));
    await screen.findByRole("alert");
    const original = f.mutate.mock.calls[0]![0];
    fireEvent.click(
      screen.getByRole("button", { name: "Close and check status" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    f.view.rerender(f.draw(memoryKnowledgePreviewData("repo_platform")));
    expect(
      screen.queryByRole("button", { name: "Resume same request" }),
    ).toBeNull();
    expect(
      screen.queryByText(
        original.action === "save" ? original.body : "unreachable",
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Return to request" }));
    expect(navigation.push).toHaveBeenCalledWith(
      "/dashboard/acme?section=memory",
      { scroll: false },
    );
    f.view.rerender(f.draw());
    fireEvent.click(
      screen.getByRole("button", { name: "Resume same request" }),
    );
    const input = screen.getByLabelText("Memory text") as HTMLTextAreaElement;
    expect(input.value).toBe("Use approved parameterized SQL everywhere.");
    expect(input.disabled).toBe(true);
    expect(f.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    await waitFor(() => expect(f.mutate).toHaveBeenCalledTimes(2));
    expect(f.mutate.mock.calls[1]![0]).toEqual(original);
    expect(
      f.progress.mock.calls.every(
        ([selection]) =>
          selection.repositoryId === null &&
          selection.commandId === original.commandId,
      ),
    ).toBe(true);
    f.view.rerender(f.draw({ ...f.page, workspaceId: "workspace_other" }));
    expect(
      screen.queryByRole("button", { name: "Resume same request" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Return to request" }),
    ).toBeNull();
  });

  it("preserves topic across native pages and resets cursor for a new topic", async () => {
    const f = fixture();
    const filtered = {
      ...f.page,
      topicId: "database",
      cursor: "native_1",
      nextCursor: "native_2",
    };
    navigation.query =
      "section=memory&memoryTopic=database&memoryCursor=native_1";
    f.view.rerender(f.draw(filtered));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/dashboard/acme?section=memory&memoryTopic=database&memoryCursor=native_2",
      { scroll: false },
    );
    fireEvent.change(screen.getByLabelText("Filter by topic"), {
      target: { value: "testing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/dashboard/acme?section=memory&memoryTopic=testing",
      { scroll: false },
    );
    expect(memoryPageKey(filtered)).not.toEqual(
      memoryPageKey({ ...filtered, topicId: "testing" }),
    );
  });

  it("recovers durable pending progress after a fresh page load and allows urgent removal", async () => {
    const f = fixture();
    const commandId = "123e4567-e89b-42d3-a456-426614174000";
    const page = {
      ...f.page,
      cursor: "new_page",
      entries: [{ ...f.page.entries[0]!, pendingCommandId: commandId }],
    };
    f.progress.mockResolvedValue({
      id: commandId,
      entryId: page.entries[0]!.id,
      revision: "r2",
      state: "unknown",
      message: "We are checking the outcome. Retry uses the same request.",
    });
    f.view.rerender(f.draw(page));
    fireEvent.click(
      screen.getByRole("button", { name: "Check change status" }),
    );
    await screen.findByText(
      "We are checking the outcome. Retry uses the same request.",
    );
    expect(f.progress).toHaveBeenCalledWith(
      { workspaceId: page.workspaceId, repositoryId: null, commandId },
      expect.any(AbortSignal),
    );
    expect(
      (screen.getByRole("button", { name: "Stop using" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Stop using" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Stop using memory",
      }),
    );
    await waitFor(() => expect(f.mutate).toHaveBeenCalledTimes(1));
    expect(f.mutate.mock.calls[0]![0]).toMatchObject({
      action: "retire",
      expectedRevision: page.entries[0]!.revision,
    });
    expect(f.mutate.mock.calls[0]![0].commandId).not.toBe(commandId);
  });
});
