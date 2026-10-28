// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { apiKeyProviders } from "@reviewrouter/features-review-providers";
import {
  apiKeyProviderForCredential,
  apiKeyProviderForGatewayProfile,
  apiKeySetupHref,
  apiKeyStorageLabel,
  consumeApiKeySetupIntent,
  readApiKeySetupIntent,
  type ApiKeySetupIntent,
} from "./api-key-storage";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("API key storage and safe continuation", () => {
  it.each(apiKeyProviders)(
    "maps $label by trusted identity and preserves legacy custody",
    (provider) => {
      expect(
        apiKeyProviderForCredential({ authMode: provider.directAuthMode }),
      ).toBe(provider.id);
      expect(
        apiKeyProviderForGatewayProfile({
          authKind: "api_key",
          provider: provider.directProviderKind,
        }),
      ).toBe(provider.id);
      expect(
        apiKeyProviderForGatewayProfile({
          authKind: "oauth",
          provider: provider.directProviderKind,
        }),
      ).toBeUndefined();
      expect(apiKeyStorageLabel("managed_api_key")).toBe(
        "GitHub Secrets · managed by ReviewRouter",
      );
      expect(apiKeyStorageLabel("gateway_binding")).toBe("ReviewRouter");
    },
  );

  it("round trips the exact workspace and bounded bulk target through only internal routes", () => {
    const intent: ApiKeySetupIntent = {
      provider: "kimi",
      storage: "reviewrouter",
      workspaceId: "workspace-one",
      repositoryIds: ["repo-a", "repo-b"],
    };
    for (const destination of ["accounts", "providers"] as const) {
      const url = new URL(
        apiKeySetupHref(destination, intent),
        "https://example.test",
      );
      const params = Object.fromEntries(url.searchParams);
      expect(url.origin).toBe("https://example.test");
      expect(
        readApiKeySetupIntent(
          {
            ...params,
            keyRepository: url.searchParams.getAll("keyRepository"),
          },
          "workspace-one",
        ),
      ).toEqual(intent);
      expect(readApiKeySetupIntent(params, "workspace-two")).toBeNull();
      expect(url.searchParams.has("returnTo")).toBe(false);
    }
  });

  it.each([
    { keyProvider: "unsupported" },
    { keyProvider: ["kimi", "mimo"] },
    { keyStorage: "server-ciphertext-installer" },
    { keyRepository: ["repo-a", "repo-a"] },
    { keyRepository: ["https://other.test"] },
    { keyRepository: Array.from({ length: 101 }, (_, i) => `repo-${i}`) },
  ])("rejects malformed or expanded navigation hints: %j", (change) => {
    expect(
      readApiKeySetupIntent(
        {
          keyProvider: "kimi",
          keyStorage: "github_secrets",
          keyWorkspace: "workspace-one",
          ...change,
        },
        "workspace-one",
      ),
    ).toBeNull();
  });

  it("consumes opening hints without changing the workspace, section, search or fragment", () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard?section=providers&workspace=workspace-one&q=kept&keyProvider=kimi&keyStorage=reviewrouter&keyWorkspace=workspace-one&keyRepository=repo-a#dashboard-section-content",
    );
    consumeApiKeySetupIntent();
    expect(window.location.href).not.toContain("keyProvider");
    expect(window.location.href).not.toContain("keyRepository");
    expect(window.location.search).toBe(
      "?section=providers&workspace=workspace-one&q=kept",
    );
    expect(window.location.hash).toBe("#dashboard-section-content");
  });
});
