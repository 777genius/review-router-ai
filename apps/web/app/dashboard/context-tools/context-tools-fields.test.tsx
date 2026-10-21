// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ContextConnectionMetadata } from "@reviewrouter/features-review-context-tools";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ContextConnectionsForm } from "./context-connections-form";
import { ContextToolsSelectionField } from "./context-tools-selection-field";
const connection: ContextConnectionMetadata = {
  id: "docs",
  version: 4,
  enabled: true,
  definition: {
    id: "docs",
    url: "https://mcp.example.test/mcp",
    headers: { Authorization: "Bearer {{ secrets.KEY }}" },
    tools: ["search_docs"],
    credentials: { KEY: { source: "dashboard-secret" } },
  },
  credentials: [{ name: "KEY", source: "dashboard-secret", present: true }],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("renders separate empty password inputs for stored secrets", () => {
  const { container } = render(
    <ContextConnectionsForm
      workspaceId="workspace"
      connections={[connection]}
    />,
  );
  const input = container.querySelector(
    'input[name="secret.KEY"]',
  ) as HTMLInputElement;
  expect(input.type).toBe("password");
  expect(input.value).toBe("");
  expect(input.getAttribute("value")).toBeNull();
  expect(
    container.querySelectorAll('textarea[name="secret.KEY"]'),
  ).toHaveLength(0);
});
it("starts off and submits only checked tool subsets from approved enabled connections", () => {
  const { container } = render(
    <ContextToolsSelectionField
      value={undefined}
      connections={[
        connection,
        { ...connection, id: "disabled", enabled: false },
      ]}
      disabled={false}
    />,
  );
  const hidden = container.querySelector(
    'input[name="contextTools"]',
  ) as HTMLInputElement;
  expect(hidden.value).toBe("");
  expect(screen.queryByText("disabled")).toBeNull();
  fireEvent.click(screen.getByLabelText("search_docs"));
  expect(JSON.parse(hidden.value)).toEqual({
    version: 1,
    builtinTools: [],
    mcp: [{ connection: "docs", tools: ["search_docs"] }],
  });
  fireEvent.click(screen.getByText("Clear context tools"));
  expect(hidden.value).toBe("");
});

it("imports a reviewable draft without saving the policy or connection", async () => {
  const selection = {
    version: 1,
    builtinTools: ["github.issue.read"],
    mcp: [{ connection: "docs", tools: ["search_docs"] }],
  };
  const request = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ selection, sourceCommit: "a".repeat(40) }),
  });
  vi.stubGlobal("fetch", request);
  const { container } = render(
    <ContextToolsSelectionField
      value={undefined}
      connections={[connection]}
      disabled={false}
      repositoryTarget={{
        workspaceId: "workspace",
        repositoryId: "repository",
      }}
    />,
  );
  fireEvent.click(screen.getByText("Import from default-branch config"));
  await waitFor(() =>
    expect(
      (
        container.querySelector(
          'input[name="contextTools"]',
        ) as HTMLInputElement
      ).value,
    ).toBe(JSON.stringify(selection)),
  );
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "/api/dashboard/context-tools/import?workspaceId=workspace&repositoryId=repository",
  );
  expect(screen.getByRole("status").textContent).toContain(
    "save this policy to apply it",
  );
});
