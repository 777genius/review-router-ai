// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewSkillsValue } from "../../src/features/review-skills/contracts";

const h = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn() }));
vi.mock("../../src/features/review-skills/client-adapter", () => ({
  requestReviewSkills: h.request,
  ReviewSkillsClientError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("./review-skills-actions", () => ({
  loadReviewSkillsClientContext: vi.fn(),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

import { RepositorySkillsOperation } from "./repository-skills-dialog";
import { reviewSkillsKeys } from "../../src/features/review-skills/query-keys";
import { ReviewSkillsClientError } from "../../src/features/review-skills/client-adapter";

const assigned: ReviewSkillsValue<"listAssignmentChoices"> = {
  items: [
    {
      skillId: "skill",
      available: true,
      name: "Review helper",
      description: "Review instructions",
      sourceWorkspaceId: "workspace",
      sourceWorkspaceName: "Workspace",
      authorName: "Author",
      assignedCount: 1,
      repositoryCount: 1,
      unavailableReason: null,
      bindings: [
        {
          skillId: "skill",
          repositoryId: "repository",
          generation: "generation",
          version: 1,
          scope: { includePaths: ["**"], excludePaths: [] },
        },
      ],
    },
  ],
  nextCursor: null,
  repositoryReadiness: [
    {
      repositoryId: "repository",
      name: "Repository",
      status: "ready",
      reason: "supported",
    },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <RepositorySkillsOperation
        workspaceId="workspace"
        viewerId="viewer"
        repositoryIds={["repository"]}
        canCreate={false}
        onClose={h.close}
      />
    </QueryClientProvider>,
  );
  return client;
}
const other = {
  ...assigned.items[0]!,
  skillId: "other",
  name: "Other helper",
  bindings: [{ ...assigned.items[0]!.bindings[0]!, skillId: "other" }],
};
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("unlocks both Close controls after acknowledged removal while assignment refresh remains pending", async () => {
  const write = deferred<ReviewSkillsValue<"applyAssignments">>();
  const readback = deferred<ReviewSkillsValue<"listAssignmentChoices">>();
  let reads = 0;
  h.request.mockImplementation((method: string) => {
    if (method === "listAssignmentChoices")
      return ++reads === 1 ? assigned : readback.promise;
    if (method === "applyAssignments") return write.promise;
    throw new Error(`Unexpected request ${method}`);
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const client = mount();
  const remove = await screen.findByRole("button", {
    name: "Remove skill Review helper",
  });
  fireEvent.click(screen.getByText("File scope", { exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "Include paths" }), {
    target: { value: "draft/**" },
  });
  fireEvent.click(remove);
  expect(confirm).toHaveBeenCalledWith(
    "Remove these skill assignments and discard their unsaved path changes?",
  );
  const close = screen.getByRole("button", { name: "Close" });
  const cornerClose = screen.getByRole("button", {
    name: "Close Assigned skills",
  });
  await waitFor(() => expect(close).toHaveProperty("disabled", true));
  expect(cornerClose).toHaveProperty("disabled", true);
  try {
    await act(async () => {
      write.resolve({ added: 0, removed: 1, unchanged: 0 });
    });
    await screen.findByText(
      "0 added, 1 removed, 0 already in the requested state.",
    );
    await waitFor(() => expect(reads).toBe(2));
    expect(
      client.getQueryState(
        reviewSkillsKeys.choices(
          "viewer",
          "workspace",
          ["repository"],
          "",
          true,
        ),
      )?.fetchStatus,
    ).toBe("fetching");
    // The stale rows must remain unavailable for another mutation until readback.
    expect(remove).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Add skills" })).toHaveProperty(
      "disabled",
      true,
    );
    await waitFor(() => expect(close).toHaveProperty("disabled", false));
    expect(cornerClose).toHaveProperty("disabled", false);
    fireEvent.click(close);
    expect(h.close).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      readback.resolve({ ...assigned, items: [] });
    });
    client.clear();
  }
});

it("keeps an acknowledged removal closable when its assignment refresh fails", async () => {
  let reads = 0;
  h.request.mockImplementation(async (method: string) => {
    if (method === "listAssignmentChoices") {
      if (++reads === 1) return assigned;
      throw new Error("Assignment refresh unavailable");
    }
    if (method === "applyAssignments")
      return { added: 0, removed: 1, unchanged: 0 };
    throw new Error(`Unexpected request ${method}`);
  });
  const client = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove skill Review helper" }),
  );
  await screen.findByText(
    "0 added, 1 removed, 0 already in the requested state.",
  );
  await screen.findByText("Assignment refresh unavailable");
  const close = screen.getByRole("button", { name: "Close" });
  expect(close).toHaveProperty("disabled", false);
  fireEvent.click(close);
  expect(h.close).toHaveBeenCalledOnce();
  client.clear();
});

it("locks Close for a new write after a previous acknowledged operation", async () => {
  const nextWrite = deferred<ReviewSkillsValue<"applyAssignments">>();
  let reads = 0;
  let writes = 0;
  h.request.mockImplementation((method: string) => {
    if (method === "listAssignmentChoices")
      return {
        ...assigned,
        items:
          ++reads === 1
            ? [...assigned.items, other]
            : reads === 2
              ? [other]
              : [],
      };
    if (method === "applyAssignments")
      return ++writes === 1
        ? { added: 0, removed: 1, unchanged: 0 }
        : nextWrite.promise;
    throw new Error(`Unexpected request ${method}`);
  });
  const client = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove skill Review helper" }),
  );
  await screen.findByText(
    "0 added, 1 removed, 0 already in the requested state.",
  );
  const remove = await screen.findByRole("button", {
    name: "Remove skill Other helper",
  });
  await waitFor(() => expect(remove).toHaveProperty("disabled", false));
  fireEvent.click(remove);
  try {
    const close = screen.getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveProperty("disabled", true));
    expect(
      screen.getByRole("button", {
        name: "Close Assigned skills",
      }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.queryByText(
        "0 added, 1 removed, 0 already in the requested state.",
      ),
    ).toBeNull();
    fireEvent.click(close);
    expect(h.close).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      nextWrite.resolve({ added: 0, removed: 1, unchanged: 0 });
    });
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Close" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  client.clear();
});

it("preserves exact retry and locks Close until the uncertain write is acknowledged", async () => {
  const firstWrite = deferred<ReviewSkillsValue<"applyAssignments">>();
  const retryWrite = deferred<ReviewSkillsValue<"applyAssignments">>();
  const readback = deferred<ReviewSkillsValue<"listAssignmentChoices">>();
  let reads = 0;
  let writes = 0;
  h.request.mockImplementation((method: string) => {
    if (method === "listAssignmentChoices")
      return ++reads === 1 ? assigned : readback.promise;
    if (method === "applyAssignments")
      return ++writes === 1 ? firstWrite.promise : retryWrite.promise;
    throw new Error(`Unexpected request ${method}`);
  });
  const client = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove skill Review helper" }),
  );
  const close = screen.getByRole("button", { name: "Close" });
  await waitFor(() => expect(close).toHaveProperty("disabled", true));
  await act(async () => {
    firstWrite.reject(
      new ReviewSkillsClientError("unknown", "The write result is unknown"),
    );
  });
  const retry = await screen.findByRole("button", {
    name: "Retry exact operation",
  });
  expect(
    screen.queryByText("0 added, 1 removed, 0 already in the requested state."),
  ).toBeNull();
  fireEvent.click(retry);
  try {
    await waitFor(() => expect(close).toHaveProperty("disabled", true));
    await waitFor(() => expect(writes).toBe(2));
    const commands = h.request.mock.calls
      .filter(([method]) => method === "applyAssignments")
      .map(([, input]) => input);
    expect(commands[1]).toEqual(commands[0]);
    await act(async () => {
      retryWrite.resolve({ added: 0, removed: 1, unchanged: 0 });
    });
    await screen.findByText(
      "0 added, 1 removed, 0 already in the requested state.",
    );
    await waitFor(() => expect(close).toHaveProperty("disabled", false));
    expect(screen.getByRole("button", { name: "Add skills" })).toHaveProperty(
      "disabled",
      true,
    );
  } finally {
    await act(async () => {
      retryWrite.resolve({ added: 0, removed: 1, unchanged: 0 });
      readback.resolve({ ...assigned, items: [] });
    });
    client.clear();
  }
});

it("still requires discarding another skill's draft after an acknowledged removal", async () => {
  const readback = deferred<ReviewSkillsValue<"listAssignmentChoices">>();
  let reads = 0;
  h.request.mockImplementation((method: string) => {
    if (method === "listAssignmentChoices")
      return ++reads === 1
        ? { ...assigned, items: [...assigned.items, other] }
        : readback.promise;
    if (method === "applyAssignments")
      return { added: 0, removed: 1, unchanged: 0 };
    throw new Error(`Unexpected request ${method}`);
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const client = mount();
  const remove = await screen.findByRole("button", {
    name: "Remove skill Review helper",
  });
  fireEvent.click(screen.getAllByText("File scope", { exact: true })[1]!);
  fireEvent.change(
    screen.getAllByLabelText("Include paths", { exact: true })[1]!,
    { target: { value: "retained/**" } },
  );
  fireEvent.click(remove);
  try {
    await screen.findByText(
      "0 added, 1 removed, 0 already in the requested state.",
    );
    const close = screen.getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveProperty("disabled", false));
    fireEvent.click(close);
    expect(confirm).toHaveBeenCalledWith(
      "Discard your unsaved skill path changes?",
    );
    expect(h.close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(close);
    expect(h.close).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => {
      readback.resolve({ ...assigned, items: [other] });
    });
    client.clear();
  }
});
