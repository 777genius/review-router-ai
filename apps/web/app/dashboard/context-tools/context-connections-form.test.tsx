// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ContextConnectionMetadata } from "@reviewrouter/features-review-context-tools";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ContextConnectionsForm } from "./context-connections-form";

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
  vi.restoreAllMocks();
});
function renderForm(saved: ContextConnectionMetadata[] = []) {
  render(
    <ContextConnectionsForm workspaceId="workspace" connections={saved} />,
  );
  return within(
    screen.getByRole("form", {
      name: saved.length ? "docs connection" : "New connection",
    }),
  );
}
function requestBody(request: ReturnType<typeof vi.fn>, index = 0) {
  return JSON.parse(request.mock.calls[index]![1].body as string);
}
function response(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

it("discovers an unsaved anonymous draft and saves only explicitly approved tools", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        ok: true,
        tools: [
          { name: "search", description: "Search documentation" },
          { name: "fetch_page" },
        ],
      }),
    )
    .mockResolvedValueOnce(response({}));
  vi.stubGlobal("fetch", request);
  const form = renderForm();
  fireEvent.change(form.getByLabelText("Connection ID", { exact: false }), {
    target: { value: "docs" },
  });
  fireEvent.change(form.getByLabelText("HTTPS MCP URL", { exact: false }), {
    target: { value: "https://mcp.example.test/mcp" },
  });
  fireEvent.click(form.getByRole("button", { name: "Test connection" }));
  await waitFor(() =>
    expect(form.getByRole("status").textContent).toContain("Found 2 tools"),
  );
  expect(request.mock.calls[0]![0]).toBe("/api/dashboard/context-tools/test");
  expect(requestBody(request)).toEqual({
    workspaceId: "workspace",
    expectedVersion: null,
    definition: {
      id: "docs",
      url: "https://mcp.example.test/mcp",
      headers: {},
      tools: [],
      credentials: {},
    },
  });
  expect(
    (
      form.getByRole("checkbox", {
        name: "search",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  fireEvent.click(form.getByRole("checkbox", { name: "search" }));
  fireEvent.click(form.getByRole("button", { name: "Save connection" }));
  await waitFor(() =>
    expect(form.getByRole("status").textContent).toBe("Connection saved."),
  );
  expect(requestBody(request, 1).definition.tools).toEqual(["search"]);
  expect(requestBody(request, 1).enabled).toBe(true);
  expect(
    (form.getByLabelText("Connection ID", { exact: false }) as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    (form.getByLabelText("HTTPS MCP URL", { exact: false }) as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    JSON.parse(
      (form.getByLabelText("New connection definition") as HTMLTextAreaElement)
        .value,
    ).tools,
  ).toEqual([]);
});

it("preserves custom headers and GitHub bindings through guided edits and the JSON roundtrip", () => {
  const custom: ContextConnectionMetadata = {
    ...connection,
    definition: {
      ...connection.definition,
      headers: {
        Authorization: "Bearer {{ secrets.KEY }}",
        "X-Team": "{{ secrets.TEAM }}",
      },
      credentials: {
        KEY: { source: "dashboard-secret" },
        TEAM: { source: "github-secret", name: "EXACT_TEAM" },
      },
    },
  };
  const form = renderForm([custom]);
  expect(form.getByRole("combobox").textContent).toContain("Custom headers");
  fireEvent.change(form.getByLabelText("HTTPS MCP URL", { exact: false }), {
    target: { value: "https://other.example.test/mcp" },
  });
  fireEvent.change(form.getByLabelText("Tool names"), {
    target: { value: "fetch_page" },
  });
  fireEvent.click(form.getByRole("button", { name: "Add tools" }));
  const json = form.getByLabelText("docs definition") as HTMLTextAreaElement;
  expect(JSON.parse(json.value)).toEqual({
    ...custom.definition,
    url: "https://other.example.test/mcp",
    tools: ["search_docs", "fetch_page"],
  });
  fireEvent.change(json, {
    target: {
      value: JSON.stringify({
        ...custom.definition,
        url: "https://json.example.test/mcp",
      }),
    },
  });
  expect(
    (form.getByLabelText("HTTPS MCP URL", { exact: false }) as HTMLInputElement)
      .value,
  ).toBe("https://json.example.test/mcp");
  expect(
    (form.getByLabelText("Connection ID", { exact: false }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
});

it("tests stored secrets without sending them and keeps replacement passwords out of JSON", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      response({ ok: true, tools: [{ name: "search_docs" }] }),
    );
  vi.stubGlobal("fetch", request);
  const form = renderForm([connection]);
  fireEvent.click(form.getByRole("button", { name: "Test connection" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(requestBody(request).expectedVersion).toBe(4);
  expect(requestBody(request)).not.toHaveProperty("secrets");
  await waitFor(() =>
    expect(form.getByRole("status").textContent).toContain(
      "Connection successful",
    ),
  );
  const password = form.getByLabelText("API key (stored)") as HTMLInputElement;
  fireEvent.change(password, {
    target: { value: "private-replacement-token" },
  });
  expect(
    (form.getByLabelText("docs definition") as HTMLTextAreaElement).value,
  ).not.toContain("private-replacement-token");
  fireEvent.click(form.getByRole("button", { name: "Save connection" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(requestBody(request, 1).secrets).toEqual({
    KEY: "private-replacement-token",
  });
  await waitFor(() => expect(password.value).toBe(""));
  expect(form.getByRole("status").textContent).not.toContain(
    "private-replacement-token",
  );
});

it("blocks partial secret replacement and changing a saved ID before any request", () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  const twoSecrets: ContextConnectionMetadata = {
    ...connection,
    definition: {
      ...connection.definition,
      headers: {
        Authorization: "Bearer {{ secrets.KEY }}",
        "X-Team": "{{ secrets.TEAM }}",
      },
      credentials: {
        KEY: { source: "dashboard-secret" },
        TEAM: { source: "dashboard-secret" },
      },
    },
    credentials: [
      ...connection.credentials,
      { name: "TEAM", source: "dashboard-secret", present: true },
    ],
  };
  const form = renderForm([twoSecrets]);
  fireEvent.change(form.getByLabelText("KEY (stored)"), {
    target: { value: "replacement" },
  });
  fireEvent.click(form.getByRole("button", { name: "Save connection" }));
  expect(form.getByRole("alert").textContent).toContain(
    "Enter every Dashboard secret",
  );
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(form.getByLabelText("docs definition"), {
    target: {
      value: JSON.stringify({ ...twoSecrets.definition, id: "renamed" }),
    },
  });
  fireEvent.click(form.getByRole("button", { name: "Test connection" }));
  expect(form.getByRole("alert").textContent).toContain("ID cannot change");
  expect(request).not.toHaveBeenCalled();
});

it("aborts a stale probe on draft edits and ignores a late response", async () => {
  let resolve!: (result: ReturnType<typeof response>) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", request);
  const form = renderForm([connection]);
  fireEvent.click(form.getByRole("button", { name: "Test connection" }));
  const signal = request.mock.calls[0]![1].signal as AbortSignal;
  fireEvent.change(form.getByLabelText("HTTPS MCP URL", { exact: false }), {
    target: { value: "https://new.example.test/mcp" },
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(response({ ok: true, tools: [{ name: "old_result" }] }));
  });
  expect(form.queryByRole("checkbox", { name: "old_result" })).toBeNull();
  expect(form.queryByRole("status")).toBeNull();
  expect(
    (form.getByRole("button", { name: "Test connection" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("explains GitHub secret probe limitations and allows manual tool approval", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      response(
        { ok: false, tools: [], error: "context_github_secret_unavailable" },
        false,
      ),
    )
    .mockResolvedValueOnce(response({}));
  vi.stubGlobal("fetch", request);
  const github: ContextConnectionMetadata = {
    ...connection,
    definition: {
      ...connection.definition,
      credentials: { KEY: { source: "github-secret", name: "EXACT_KEY" } },
    },
    credentials: [{ name: "KEY", source: "github-secret", present: false }],
  };
  const form = renderForm([github]);
  fireEvent.click(form.getByRole("button", { name: "Test connection" }));
  await waitFor(() =>
    expect(form.getByRole("alert").textContent).toContain(
      "cannot be tested here",
    ),
  );
  fireEvent.change(form.getByLabelText("Tool names"), {
    target: { value: "manual_tool" },
  });
  fireEvent.click(form.getByRole("button", { name: "Add tools" }));
  fireEvent.click(form.getByRole("button", { name: "Save connection" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(requestBody(request, 1).definition.tools).toEqual([
    "search_docs",
    "manual_tool",
  ]);
});

it("limits approvals to 20 across discovery, manual entry and Advanced JSON", async () => {
  const names = Array.from({ length: 20 }, (_, i) => `tool_${i}`);
  const request = vi.fn().mockResolvedValue(
    response({
      ok: true,
      tools: [...names, "one_more"].map((name) => ({ name })),
    }),
  );
  vi.stubGlobal("fetch", request);
  const form = renderForm([
    { ...connection, definition: { ...connection.definition, tools: names } },
  ]);
  fireEvent.click(form.getByRole("button", { name: "Test connection" }));
  await waitFor(() =>
    expect(form.getByRole("status").textContent).toContain("Found 21 tools"),
  );
  expect(
    (
      form.getByRole("checkbox", {
        name: "one_more",
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(form.getByLabelText("Tool names"), {
    target: { value: "one_more" },
  });
  fireEvent.click(form.getByRole("button", { name: "Add tools" }));
  expect(form.getByRole("alert").textContent).toContain("no more than 20");
  const json = form.getByLabelText("docs definition") as HTMLTextAreaElement;
  expect(JSON.parse(json.value).tools).toEqual(names);
  fireEvent.change(json, {
    target: {
      value: JSON.stringify({
        ...connection.definition,
        tools: [...names, "one_more"],
      }),
    },
  });
  fireEvent.click(form.getByRole("button", { name: "Save connection" }));
  expect(form.getByRole("alert").textContent).toContain("no more than 20");
  expect(request).toHaveBeenCalledTimes(1);
});

it("surfaces the safe secret re-entry error when saving changed authentication", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      response({ error: "context_secret_reentry_required" }, false),
    );
  vi.stubGlobal("fetch", request);
  const form = renderForm([connection]);
  fireEvent.change(form.getByLabelText("HTTPS MCP URL", { exact: false }), {
    target: { value: "https://changed.example.test/mcp" },
  });
  fireEvent.click(form.getByRole("button", { name: "Save connection" }));
  await waitFor(() =>
    expect(form.getByRole("alert").textContent).toContain(
      "Re-enter every Dashboard secret to test or save",
    ),
  );
  expect(requestBody(request)).not.toHaveProperty("secrets");
});

it("creates Bearer authentication through the selector with a separate password field", async () => {
  const request = vi.fn().mockResolvedValue(response({}));
  vi.stubGlobal("fetch", request);
  const form = renderForm();
  fireEvent.change(form.getByLabelText("Connection ID", { exact: false }), {
    target: { value: "docs" },
  });
  fireEvent.change(form.getByLabelText("HTTPS MCP URL", { exact: false }), {
    target: { value: "https://mcp.example.test/mcp" },
  });
  fireEvent.click(form.getByRole("combobox"));
  const bearerOption = await screen.findByRole("option", {
    name: "Bearer API key",
  });
  // Base UI selects only the highlighted mouse option, as a real pointer does.
  fireEvent.mouseMove(bearerOption);
  fireEvent.click(bearerOption);
  const password = (await form.findByLabelText(
    "API key (required)",
  )) as HTMLInputElement;
  expect(password.type).toBe("password");
  fireEvent.change(password, { target: { value: "private-api-token" } });
  const json = form.getByLabelText(
    "New connection definition",
  ) as HTMLTextAreaElement;
  const secretName = Object.keys(JSON.parse(json.value).credentials)[0]!;
  expect(secretName).toMatch(/^MCP_DOCS_API_KEY_1_[A-F0-9]{12}$/);
  expect(JSON.parse(json.value).headers).toEqual({
    Authorization: `Bearer {{ secrets.${secretName} }}`,
  });
  expect(json.value).not.toContain("private-api-token");
  fireEvent.change(form.getByLabelText("Tool names"), {
    target: { value: "search_docs" },
  });
  fireEvent.click(form.getByRole("button", { name: "Add tools" }));
  fireEvent.click(form.getByRole("button", { name: "Save connection" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(requestBody(request).secrets).toEqual({
    [secretName]: "private-api-token",
  });
  await waitFor(() =>
    expect(form.getByRole("status").textContent).toBe("Connection saved."),
  );
  expect(form.queryByLabelText("API key (required)")).toBeNull();
  expect(form.getByRole("combobox").textContent).toContain("No authentication");
});

it("keeps independently created Bearer connection credentials distinct in a combined review plan", async () => {
  const uuid = vi
    .spyOn(crypto, "randomUUID")
    .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
    .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
  const request = vi.fn().mockResolvedValue(response({}));
  vi.stubGlobal("fetch", request);
  render(
    <>
      <ContextConnectionsForm workspaceId="workspace" connections={[]} />
      <ContextConnectionsForm workspaceId="workspace" connections={[]} />
    </>,
  );
  const forms = screen.getAllByRole("form", { name: "New connection" });
  for (const [index, element] of forms.entries()) {
    const form = within(element);
    fireEvent.change(form.getByLabelText("Connection ID", { exact: false }), {
      target: { value: `docs_${index}` },
    });
    fireEvent.change(form.getByLabelText("HTTPS MCP URL", { exact: false }), {
      target: { value: `https://mcp${index}.example.test/mcp` },
    });
    fireEvent.click(form.getByRole("combobox"));
    const option = await screen.findByRole("option", {
      name: "Bearer API key",
    });
    fireEvent.mouseMove(option);
    fireEvent.click(option);
    fireEvent.change(await form.findByLabelText("API key (required)"), {
      target: { value: `private-token-${index}` },
    });
    fireEvent.change(form.getByLabelText("Tool names"), {
      target: { value: "search_docs" },
    });
    fireEvent.click(form.getByRole("button", { name: "Add tools" }));
    fireEvent.click(form.getByRole("button", { name: "Save connection" }));
    await waitFor(() =>
      expect(form.getByRole("status").textContent).toBe("Connection saved."),
    );
  }
  expect(uuid).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(2);
  const first = requestBody(request, 0);
  const second = requestBody(request, 1);
  expect(first.definition.credentials).toEqual({
    MCP_DOCS_0_API_KEY_1_111111111111: { source: "dashboard-secret" },
  });
  expect(second.definition.credentials).toEqual({
    MCP_DOCS_1_API_KEY_1_222222222222: { source: "dashboard-secret" },
  });
  expect(first.definition.headers).toEqual({
    Authorization: "Bearer {{ secrets.MCP_DOCS_0_API_KEY_1_111111111111 }}",
  });
  expect(second.definition.headers).toEqual({
    Authorization: "Bearer {{ secrets.MCP_DOCS_1_API_KEY_1_222222222222 }}",
  });
  expect(first.secrets).toEqual({
    MCP_DOCS_0_API_KEY_1_111111111111: "private-token-0",
  });
  expect(second.secrets).toEqual({
    MCP_DOCS_1_API_KEY_1_222222222222: "private-token-1",
  });
  expect(
    new Set([...Object.keys(first.secrets), ...Object.keys(second.secrets)])
      .size,
  ).toBe(2);
  expect(JSON.stringify(first.definition)).not.toContain("private-token-0");
  expect(JSON.stringify(second.definition)).not.toContain("private-token-1");
});
