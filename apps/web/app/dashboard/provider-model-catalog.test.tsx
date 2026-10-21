// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderModelCatalogSnapshot,
  PublicCatalogProvider,
} from "@reviewrouter/features-review-providers";
import {
  catalogStaleTime,
  ProviderModelCatalogProvider,
  ProviderModelCatalogStatus,
  useProviderModelCatalogs,
} from "./provider-model-catalog";

function snapshot(
  providerKind: PublicCatalogProvider,
  overrides: Partial<ProviderModelCatalogSnapshot> = {},
): ProviderModelCatalogSnapshot {
  return {
    providerKind,
    models: [
      {
        id: `${providerKind}-public`,
        name: `${providerKind} public`,
        contextTokens: 10000,
        textInput: true,
        textOutput: true,
        toolCalling: true,
        pricing: null,
      },
    ],
    source: providerKind === "openrouter" ? "openrouter" : "models.dev",
    fetchedAt: Date.now(),
    lastAttemptAt: Date.now(),
    state: "fresh",
    error: null,
    refresh: "cached",
    ...overrides,
  };
}
function Consumer({ kind }: { kind: PublicCatalogProvider }) {
  const catalogs = useProviderModelCatalogs([]);
  return (
    <>
      <ProviderModelCatalogStatus
        status={catalogs.status(kind)}
        publicSelection
      />
      <div data-testid="options">
        {catalogs.options.map((option) => option.value).join(",")}
      </div>
    </>
  );
}
afterEach(cleanup);
describe("public model catalog query", () => {
  it("does not renew source TTL when a cooldown response reaches the client", () => {
    const fetchedAt = Date.now() - 29 * 60_000;
    expect(
      catalogStaleTime(
        snapshot("codex", { fetchedAt }),
        fetchedAt + 29 * 60_000,
      ),
    ).toBe(60_000);
    expect(
      catalogStaleTime(
        snapshot("codex", { fetchedAt, state: "stale" }),
        Date.now(),
      ),
    ).toBe(0);
  });
  it.each(["codex", "claude", "openrouter"] as const)(
    "seeds %s with source age and manually revalidates without account data",
    async (kind) => {
      const api = vi.fn(
        async (
          _input: Parameters<
            typeof import("./provider-model-catalog-api").readProviderModelCatalog
          >[0],
        ) => {
          void _input;
          return snapshot(kind, { refresh: "cooldown" });
        },
      );
      render(
        <ProviderModelCatalogProvider
          snapshots={[
            snapshot("codex"),
            snapshot("claude"),
            snapshot("openrouter"),
          ]}
          api={api}
        >
          <Consumer kind={kind} />
        </ProviderModelCatalogProvider>,
      );
      expect(api).not.toHaveBeenCalled();
      expect(screen.getByText("Account access not checked.")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain("fresh");
      fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
      await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
      expect(api.mock.calls[0]?.[0]).toMatchObject({
        providerKind: kind,
        forceRefresh: true,
      });
      expect(Object.keys(api.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
        "forceRefresh",
        "providerKind",
        "signal",
      ]);
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain(
          "refresh cooldown",
        ),
      );
    },
  );
  it("shows upstream failure even when the last successful snapshot is still fresh", () => {
    const api = vi.fn();
    render(
      <ProviderModelCatalogProvider
        snapshots={[
          snapshot("codex", { error: "source_unavailable", refresh: "failed" }),
          snapshot("claude"),
          snapshot("openrouter"),
        ]}
        api={api}
      >
        <Consumer kind="codex" />
      </ProviderModelCatalogProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "source unavailable",
    );
    expect(screen.getByRole("status").textContent).toContain("refresh failed");
    expect(api).not.toHaveBeenCalled();
  });
  it("revalidates stale initial data using its successful fetch time", async () => {
    const api = vi.fn(
      async (
        _input: Parameters<
          typeof import("./provider-model-catalog-api").readProviderModelCatalog
        >[0],
      ) => {
        void _input;
        return snapshot("codex");
      },
    );
    render(
      <ProviderModelCatalogProvider
        snapshots={[
          snapshot("codex", {
            state: "stale",
            fetchedAt: Date.now() - 40 * 60_000,
          }),
          snapshot("claude"),
          snapshot("openrouter"),
        ]}
        api={api}
      >
        <Consumer kind="codex" />
      </ProviderModelCatalogProvider>,
    );
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[0]?.[0]).toMatchObject({ providerKind: "codex" });
    expect(api.mock.calls[0]?.[0]).not.toHaveProperty("forceRefresh");
  });
});
