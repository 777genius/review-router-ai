import { describe, expect, it, vi } from "vitest";
import type * as c from "@agent-teams/account-gateway/contracts";
import { GatewayError } from "@agent-teams/account-gateway/http";
import { createAccountsAdapter } from "./account-gateway-accounts";

const profileId = "openrouter-openai-responses-apikey-v1";
const modelId = "openai/gpt-5.4-nano";
const capability: c.ProviderConnectionCapability = {
  contract: "provider-connections/v1",
  profileId,
  provider: { identity: "openrouter", label: "OpenRouter" },
  plan: { identity: "pay_as_you_go", label: "OpenRouter credits" },
  region: { identity: "global", label: "Global" },
  protocol: "openai-responses",
  modelIds: [modelId],
  authMethods: ["api_key"],
  completionInputKind: "none",
  availability: "enabled",
  oauthCallbackMode: null,
  reconnect: "replace_api_key",
  limitsContract: "none",
  models: [
    {
      modelId,
      reasoning: { allowed: ["low", "medium", "high"], default: "medium" },
      fast: null,
      tools: { allowed: ["function"], default: "function" },
    },
  ],
};

function fixture() {
  type Input = Parameters<typeof createAccountsAdapter>[0];
  const profiles = vi.fn(async () => ({
    profiles: [
      {
        profileId,
        protocol: "openai-responses",
        authKinds: ["api_key"],
        modelIds: [modelId, "outside-qualified-capabilities"],
      },
    ],
  }));
  const capabilities = vi.fn(async () => ({
    contract: "provider-connections/v1" as const,
    capabilities: [capability],
  }));
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error("unexpected_account_or_credential_access");
      },
    },
  );
  const adapter = createAccountsAdapter({
    gateway: {
      profiles,
      getProviderConnectionCapabilities: capabilities,
    } as unknown as Input["gateway"],
    apiKeyProfiles: new Map([[profileId, "OpenRouter"]]),
    accounts: unused as Input["accounts"],
    synchronization: unused as Input["synchronization"],
    bindingDependencies: unused as Input["bindingDependencies"],
    authorize: async () => {
      throw new Error("public_catalog_has_no_account_context");
    },
  });
  return { adapter, profiles, capabilities };
}

describe("Gateway review catalog capability projection", () => {
  it("retains qualified review settings and never admits a profile-only model", async () => {
    const h = fixture();
    expect(await h.adapter.reviewCatalog()).toMatchObject([
      {
        id: profileId,
        provider: "openrouter",
        models: [modelId],
        connection: {
          provider: "openrouter",
          modelSettings: capability.models,
        },
      },
    ]);
    expect(h.profiles).toHaveBeenCalledOnce();
    expect(h.capabilities).toHaveBeenCalledOnce();
  });

  it("reads updated capability settings instead of keeping an enrollment snapshot", async () => {
    const h = fixture();
    await h.adapter.reviewCatalog();
    const changed = {
      ...capability,
      models: [{ ...capability.models[0]!, reasoning: null }],
    };
    h.capabilities.mockResolvedValue({
      contract: "provider-connections/v1",
      capabilities: [changed],
    });
    expect(await h.adapter.reviewCatalog()).toMatchObject([
      { connection: { modelSettings: [{ modelId, reasoning: null }] } },
    ]);
  });

  it("keeps the explicit absent-endpoint fallback but rejects forbidden reads", async () => {
    const h = fixture();
    const failure = (httpStatus: number) =>
      Object.assign(new GatewayError("safe_error", "not_dispatched"), {
        httpStatus,
      });
    h.capabilities.mockRejectedValueOnce(failure(404));
    expect(await h.adapter.reviewCatalog()).toMatchObject([
      { models: [modelId, "outside-qualified-capabilities"] },
    ]);
    h.capabilities.mockRejectedValueOnce(failure(403));
    await expect(h.adapter.reviewCatalog()).rejects.toMatchObject({
      httpStatus: 403,
    });
  });

  it("rejects provider identity drift before exposing model settings", async () => {
    const h = fixture();
    h.capabilities.mockResolvedValue({
      contract: "provider-connections/v1",
      capabilities: [
        { ...capability, provider: { identity: "mimo", label: "MiMo" } },
      ],
    });
    await expect(h.adapter.reviewCatalog()).rejects.toThrow(
      "accounts_unavailable",
    );
  });
});
