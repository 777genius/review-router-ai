// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderApplicationDialog } from "./provider-application-dialog";
import { RepositoryActionSelectionProvider } from "./gateway-repository-batch-controls";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("selects gateway account and model through portaled controls inside the application dialog", async () => {
  // jsdom has no layout scrolling; Radix uses this browser method for focus.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            repositories: [],
            connected: false,
            repositoriesCount: 0,
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RepositoryActionSelectionProvider workspaceId="fixture" inventory={[]}>
        <ProviderApplicationDialog
          workspaceId="fixture"
          enabled
          directEnabled
          actions={{ save: vi.fn(), read: vi.fn() }}
          accounts={{
            status: "ok",
            value: {
              nextCursor: null,
              profiles: [
                {
                  id: "responses",
                  label: "Responses",
                  protocol: "openai-responses",
                  models: ["fixture-model"],
                },
              ],
              accounts: [
                {
                  connectionId: "connection",
                  label: "Fixture account",
                  profileId: "responses",
                  profileLabel: "Responses",
                  state: "active",
                  gatewayRevision: 1,
                  mirrorRevision: 1,
                  binding: {
                    id: "binding",
                    revision: 1,
                    state: "active",
                    fencePending: false,
                  },
                },
              ],
            },
          }}
        />
      </RepositoryActionSelectionProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Configure providers" }));
  expect(
    await screen.findByRole("dialog", { name: "Configure providers" }),
  ).toBeTruthy();
  const account = screen.getByRole("combobox", { name: "Gateway account" });
  fireEvent.keyDown(account, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("option", { name: "Fixture account · Responses" }),
  );
  await waitFor(() => expect(account.textContent).toContain("Fixture account"));
  const model = screen.getByRole("combobox", { name: "Gateway model" });
  fireEvent.keyDown(model, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "fixture-model" }));
  await waitFor(() => expect(model.textContent).toContain("fixture-model"));
});
