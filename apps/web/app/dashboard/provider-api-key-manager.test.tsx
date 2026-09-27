// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderApiKeyManager } from "./provider-api-key-manager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ProviderApiKeyManager", () => {
  it("preserves batch results and repository selection through a changed state refetch", async () => {
    let stateCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/repositories/search")) {
        return response({
          repositories: [
            { id: "repo_1", fullName: "acme/one", provider: "github" },
            { id: "repo_2", fullName: "acme/two", provider: "github" },
          ],
        });
      }
      if (url.includes("/provider-keys?")) {
        stateCalls += 1;
        return response({
          providerType: "mimo",
          keyVersion: stateCalls,
          connected: true,
          repositories: [
            {
              repositoryId: "repo_1",
              repositoryFullName: "acme/one",
              status: "applied",
              appliedKeyVersion: 1,
              attemptedKeyVersion: 1,
              appliedAt: "2026-09-26T10:00:00.000Z",
            },
          ],
        });
      }
      return response({
        providerType: "mimo",
        results: [
          {
            repositoryId: "repo_1",
            repositoryFullName: "acme/one",
            status: "applied",
          },
          {
            repositoryId: "repo_2",
            repositoryFullName: "acme/two",
            status: "failed",
            errorReason: "rate_limited",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderManager("workspace_1");
    fireEvent.click(
      screen.getByRole("button", { name: /Connect MiMo \/ OpenRouter/i }),
    );
    const secondRepository = await screen.findByRole("checkbox", {
      name: /acme\/two/i,
    });
    fireEvent.click(secondRepository);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Batch results")).toBeTruthy();
    await waitFor(() => expect(stateCalls).toBeGreaterThan(1));
    expect(screen.getByText("Batch results")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: /acme\/two/i }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("clears key text and prior results when the workspace or provider changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/repositories/search")) {
        return response({
          repositories: [
            { id: "repo_1", fullName: "acme/one", provider: "github" },
          ],
        });
      }
      if (url.includes("/provider-keys?")) {
        return response({
          providerType: url.includes("providerType=openrouter")
            ? "openrouter"
            : "mimo",
          keyVersion: 1,
          connected: true,
          repositories: [],
        });
      }
      return response({
        providerType: "mimo",
        results: [
          {
            repositoryId: "repo_1",
            repositoryFullName: "acme/one",
            status: "applied",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient, rerender } = renderManager("workspace_1");
    fireEvent.click(
      screen.getByRole("button", { name: /Connect MiMo \/ OpenRouter/i }),
    );
    const keyInput = await screen.findByLabelText(/MiMo Token Plan API key/i);
    fireEvent.change(keyInput, { target: { value: "must-not-survive" } });
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /acme\/one/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Batch results")).toBeTruthy();

    rerender(
      <QueryClientProvider client={queryClient}>
        {manager("workspace_2")}
      </QueryClientProvider>,
    );
    expect(
      (screen.getByLabelText(/MiMo Token Plan API key/i) as HTMLInputElement)
        .value,
    ).toBe("");
    expect(screen.queryByText("Batch results")).toBeNull();

    fireEvent.change(screen.getByLabelText(/MiMo Token Plan API key/i), {
      target: { value: "provider-key-that-must-clear" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /OpenRouter/i }));
    expect(
      (screen.getByLabelText(/OpenRouter API key/i) as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByText("Batch results")).toBeNull();
  });

  it("prefills saved repositories, applies the key, and renders per-repo results", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/repositories/search")) {
          return {
            ok: true,
            json: async () => ({
              repositories: [
                {
                  id: "repo_1",
                  fullName: "acme/one",
                  provider: "github",
                },
                {
                  id: "repo_2",
                  fullName: "acme/two",
                  provider: "github",
                },
              ],
            }),
          };
        }
        if (url.includes("/provider-keys?")) {
          return {
            ok: true,
            json: async () => ({
              providerType: "mimo",
              connected: true,
              repositories: [
                {
                  repositoryId: "repo_1",
                  repositoryFullName: "acme/one",
                  status: "applied",
                  appliedAt: "2026-09-26T10:00:00.000Z",
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            providerType: "mimo",
            results: [
              {
                repositoryId: "repo_1",
                repositoryFullName: "acme/one",
                status: "applied",
              },
              {
                repositoryId: "repo_2",
                repositoryFullName: "acme/two",
                status: "failed",
                errorReason: "rate_limited",
              },
            ],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderApiKeyManager workspaceId="workspace_1" />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Connect MiMo \/ OpenRouter/i }),
    );

    const savedRepository = await screen.findByRole("checkbox", {
      name: /acme\/one/i,
    });
    await waitFor(() =>
      expect((savedRepository as HTMLInputElement).checked).toBe(true),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /acme\/two/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Success")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(
      screen.getByText("GitHub rate limit reached. Try again later."),
    ).toBeTruthy();
    const applyCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/provider-keys/apply"),
    );
    expect(applyCall).toBeDefined();
    expect(JSON.parse(String(applyCall?.[1]?.body))).toEqual({
      workspaceId: "workspace_1",
      providerType: "mimo",
      repositoryIds: ["repo_1", "repo_2"],
    });
  });
});

function renderManager(workspaceId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        {manager(workspaceId)}
      </QueryClientProvider>,
    ),
  };
}

function manager(workspaceId: string) {
  return <ProviderApiKeyManager workspaceId={workspaceId} />;
}

function response(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}
