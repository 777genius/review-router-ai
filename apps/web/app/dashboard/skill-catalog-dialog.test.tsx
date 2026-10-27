// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type {
  ReviewSkillImportCandidate,
  ReviewSkillScan,
} from "../../src/features/review-skills/catalog-contracts";

const h = vi.hoisted(() => ({ request: vi.fn(), imported: vi.fn() }));
vi.mock("../../src/features/review-skills/catalog-client-adapter", () => ({
  requestSkillCatalog: h.request,
  SkillCatalogClientError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
// These tests exercise command/query state. Real dialog geometry/focus has its browser lane.
vi.mock("./review-skills-ui", () => ({
  SkillsDialog: ({
    open,
    title,
    onClose,
    children,
    footer,
    feedback,
  }: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer: ReactNode;
    feedback: ReactNode;
  }) =>
    open ? (
      <section role="dialog" aria-label={title}>
        {children}
        {feedback}
        {footer}
        <button onClick={onClose}>Close</button>
      </section>
    ) : null,
  SkillSearch: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) => (
    <label>
      {label}
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
  SkillsError: ({ error }: { error: unknown }) =>
    error instanceof Error ? <p role="alert">{error.message}</p> : null,
}));
import { SkillCatalogClientError } from "../../src/features/review-skills/catalog-client-adapter";
import { SkillCatalogDialog } from "./skill-catalog-dialog";

const expiry = "2099-01-01T00:00:00.000Z";
function candidate(id = "candidate"): ReviewSkillImportCandidate {
  return {
    id,
    content: {
      name: id === "candidate" ? "Review helper" : id,
      description: "Review instructions",
      instructions: '<script>alert("inert")</script>\nCheck edge cases.',
    },
    source: { repository: "example/skills", commit: "1".repeat(40), path: "" },
    omittedFields: [],
    hasResources: false,
    expiresAt: expiry,
    aiAvailable: true,
  };
}
function completed(mode: "static" | "ai" = "static"): ReviewSkillScan {
  return {
    id: `${mode}-job`,
    candidateId: "candidate",
    mode,
    status: "completed",
    verdict: "clear",
    findings: [],
    expiresAt: expiry,
  };
}
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Browse catalog</button>
      <SkillCatalogDialog
        open={open}
        workspaceId="workspace"
        viewerId="viewer"
        onClose={() => setOpen(false)}
        onImported={h.imported}
      />
    </>
  );
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
      <Harness />
    </QueryClientProvider>,
  );
  return client;
}
async function preview() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Preview Review helper" }),
  );
  await screen.findByRole("heading", { name: "Review helper" });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Check skill" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}

describe("catalog client command lifetime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.request.mockImplementation(
      async (method: string, input: { mode?: "static" | "ai" }) => {
        if (method === "configuration")
          return { scanAvailable: true, aiAvailable: true };
        if (method === "search")
          return {
            items: [
              {
                id: "item",
                title: "Review helper",
                repository: "example/skills",
                skillNameHint: "review",
                providerUrl: "https://skills.sh/example/skills/review",
                available: true,
              },
            ],
            page: 0,
            hasMore: false,
            stale: false,
            limited: false,
          };
        if (method === "resolve")
          return { status: "resolved", candidate: candidate() };
        if (method === "requestScan" || method === "loadScan")
          return completed(input.mode ?? "static");
        if (method === "importCandidate") return { skillId: "imported" };
        throw new Error("unexpected method");
      },
    );
  });
  afterEach(cleanup);

  it("does not reuse a static success under the AI choice and renders preview instructions as text", async () => {
    mount();
    await preview();
    expect(screen.getByText(/<script>alert/).tagName).toBe("PRE");
    expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check skill" }));
    await screen.findByText("No issues found");
    expect(
      (
        screen.getByRole("button", {
          name: "Add to library",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include AI-assisted analysis/ }),
    );
    expect(screen.queryByText("No issues found")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Add to library",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include AI-assisted analysis/ }),
    );
    await screen.findByText("No issues found");
  });

  it("replays an uncertain scan with the exact operation after same-page close and reopen", async () => {
    const normal = h.request.getMockImplementation()!;
    let requests = 0;
    h.request.mockImplementation(
      async (method: string, input: { mode?: "static" | "ai" }) => {
        if (method === "requestScan" && ++requests === 1)
          throw new SkillCatalogClientError("unknown", "reply lost");
        return normal(method, input);
      },
    );
    mount();
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Check skill" }));
    await screen.findByRole("button", { name: "Retry check" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Include AI-assisted analysis/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry check" }));
    await screen.findByText("No issues found");
    const commands = h.request.mock.calls
      .filter(([method]) => method === "requestScan")
      .map(([, input]) => input);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0].operationId).toMatch(/^[a-f0-9-]{36}$/u);
  });

  it("keeps an uncertain import immutable and replays it after reopening", async () => {
    const normal = h.request.getMockImplementation()!;
    let imports = 0;
    h.request.mockImplementation(
      async (method: string, input: { mode?: "static" | "ai" }) => {
        if (method === "importCandidate" && ++imports === 1)
          throw new SkillCatalogClientError("unknown", "reply lost");
        return normal(method, input);
      },
    );
    mount();
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Check skill" }));
    await screen.findByText("No issues found");
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    await screen.findByRole("button", { name: "Retry adding" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry adding" }));
    await waitFor(() => expect(h.imported).toHaveBeenCalledOnce());
    const commands = h.request.mock.calls
      .filter(([method]) => method === "importCandidate")
      .map(([, input]) => input);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
  });
});
