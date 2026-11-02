// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../../../src/server/context-tools", () => ({
  listDashboardContextConnections: vi.fn(async () => []),
}));
vi.mock("../../../../src/server/mcp-catalog", () => ({
  listDashboardMcpCatalogPresets: () => [],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import ContextToolsPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("clears a connection draft and cancels its probe when the workspace changes", async () => {
  let probeSignal: AbortSignal | undefined;
  const request = vi.fn((_url: string, init: RequestInit) => {
    probeSignal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", request);
  const view = render(
    await ContextToolsPage({
      searchParams: Promise.resolve({ workspaceId: "one" }),
    }),
  );
  fireEvent.change(screen.getByLabelText("Connection ID", { exact: false }), {
    target: { value: "private_docs" },
  });
  fireEvent.change(screen.getByLabelText("HTTPS MCP URL", { exact: false }), {
    target: { value: "https://mcp.example.test/mcp" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(probeSignal?.aborted).toBe(false);

  view.rerender(
    await ContextToolsPage({
      searchParams: Promise.resolve({ workspaceId: "two" }),
    }),
  );

  expect(
    (
      screen.getByLabelText("Connection ID", {
        exact: false,
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(
    (
      screen.getByLabelText("HTTPS MCP URL", {
        exact: false,
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(probeSignal?.aborted).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Test connection",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
