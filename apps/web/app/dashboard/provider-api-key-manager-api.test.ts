import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProviderApiKeyState,
  providerApiKeyStateQueryKey,
} from "./provider-api-key-manager-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider API key manager API client", () => {
  it("returns state and scopes the query by workspace and provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        providerType: "openrouter",
        connected: true,
        keyVersion: 3,
        repositories: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchProviderApiKeyState({
        workspaceId: "workspace with spaces",
        providerType: "openrouter",
      }),
    ).resolves.toMatchObject({ providerType: "openrouter", keyVersion: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/provider-keys?workspace=workspace%20with%20spaces&providerType=openrouter",
    );
    expect(providerApiKeyStateQueryKey("workspace_1", "mimo")).toEqual([
      "provider-api-key-state",
      "workspace_1",
      "mimo",
    ]);
  });

  it("preserves server state-query error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          {
            error:
              "entitlement_denied:provider_key_management:feature_not_enabled_for_plan",
          },
          false,
          403,
        ),
      ),
    );

    await expect(
      fetchProviderApiKeyState({
        workspaceId: "workspace_1",
        providerType: "openrouter",
      }),
    ).rejects.toThrow(
      "entitlement_denied:provider_key_management:feature_not_enabled_for_plan",
    );
  });

  it("uses a stable fallback when the state error body is not usable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    await expect(
      fetchProviderApiKeyState({
        workspaceId: "workspace_1",
        providerType: "mimo",
      }),
    ).rejects.toThrow("provider_key_state_failed");
  });
});

function response(
  body: unknown,
  ok = true,
  status = 200,
): {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
} {
  return {
    ok,
    status,
    json: async () => body,
  };
}
