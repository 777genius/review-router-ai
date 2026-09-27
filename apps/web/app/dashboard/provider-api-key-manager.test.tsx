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
