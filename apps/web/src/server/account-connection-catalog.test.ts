import { describe, expect, it } from "vitest";
import { GatewayError } from "@agent-teams/account-gateway/http";
import {
  configuredSubscriptionProfiles,
  connectionProfiles,
  operationCompletion,
} from "./account-connection-catalog";

const profileId = "glm-coding-global-responses-apikey-v1";
const capability = {
  contract: "provider-connections/v1" as const,
  profileId,
  provider: { identity: "glm" as const, label: "GLM" },
  plan: { identity: "coding_plan" as const, label: "Coding Plan" },
  region: { identity: "global" as const, label: "Global" },
  protocol: "openai-responses" as const,
  modelIds: ["glm-5.3-flash"],
  authMethods: ["api_key" as const],
  completionInputKind: "none" as const,
  availability: "enabled" as const,
  oauthCallbackMode: null,
  reconnect: "replace_api_key" as const,
  limitsContract: "account-limits/v2" as const,
  models: [
    {
      modelId: "glm-5.3-flash",
      reasoning: null,
      fast: null,
      tools: { allowed: ["function" as const], default: "function" as const },
    },
  ],
};
const response = (row = capability) => ({
  contract: "provider-connections/v1" as const,
  capabilities: [row],
});
describe("qualified connection catalog", () => {
  it("intersects the deployment allowlist and enabled safe capabilities", async () => {
    const read = () => Promise.resolve(response());
    expect(
      await connectionProfiles({
        legacy: [],
        subscriptionProfileIds: [],
        capabilities: read,
      }),
    ).toMatchObject([{ availability: "deployment_configuration_required" }]);
    const [profile] = await connectionProfiles({
      legacy: [],
      subscriptionProfileIds: [profileId],
      capabilities: read,
    });
    expect(profile).toMatchObject({
      provider: "codex",
      authKind: "api_key",
      connection: {
        provider: "glm",
        modelSettings: [{ reasoning: null, fast: null }],
      },
    });
    expect(JSON.stringify(profile)).not.toMatch(/baseURL|token|secret/);
    expect(
      await connectionProfiles({
        legacy: [],
        subscriptionProfileIds: [profileId],
        capabilities: async () => ({
          ...response(),
          capabilities: [
            {
              ...capability,
              availability: "deployment_configuration_required",
            },
          ],
        }),
      }),
    ).toMatchObject([
      {
        availability: "deployment_configuration_required",
        connection: { provider: "glm" },
      },
    ]);
  });
  it("rejects a global profile whose declared region does not match", async () => {
    expect(
      await connectionProfiles({
        legacy: [],
        subscriptionProfileIds: [profileId],
        capabilities: async () => ({
          ...response(),
          capabilities: [
            {
              ...capability,
              region: { identity: "unknown", label: "Unknown" },
            },
          ],
        }),
      }),
    ).toEqual([]);
  });
  it("does not synthesize a profile or fallback on forbidden capabilities", async () => {
    const failure = (httpStatus: number) =>
      Object.assign(new GatewayError("safe_error", "not_dispatched"), {
        httpStatus,
      });
    const args = { legacy: [], subscriptionProfileIds: [profileId] };
    expect(
      await connectionProfiles({
        ...args,
        capabilities: async () => {
          throw failure(404);
        },
      }),
    ).toEqual([]);
    await expect(
      connectionProfiles({
        ...args,
        capabilities: async () => {
          throw failure(403);
        },
      }),
    ).rejects.toMatchObject({ httpStatus: 403 });
    await expect(
      connectionProfiles({
        ...args,
        capabilities: async () => ({ ...response(), unexpected: "wire drift" }),
      }),
    ).rejects.toThrow();
  });
  it("uses the standard API-key display label for qualified NVIDIA", async () => {
    const [profile] = await connectionProfiles({
      legacy: [],
      capabilities: async () => ({
        contract: "provider-connections/v1",
        capabilities: [
          {
            ...capability,
            profileId: "nvidia-build-chat-apikey-v1",
            provider: { identity: "nvidia", label: "NVIDIA Build" },
            plan: {
              identity: "unknown",
              label: "NVIDIA API trial (evaluation only)",
            },
          },
        ],
      }),
    });
    expect(profile).toMatchObject({
      provider: "nvidia",
      availability: "enabled",
      connection: { planLabel: "API key" },
    });
  });
  it.each([
    "missing",
    "disabled",
    "absent_endpoint",
    "custom_profile",
  ] as const)(
    "does not enable configured NVIDIA with %s capability",
    async (state) => {
      const legacy = {
        id:
          state === "custom_profile"
            ? "custom-nvidia-profile"
            : "nvidia-build-chat-apikey-v1",
        label: "NVIDIA Build",
        provider: "nvidia" as const,
        protocol: "openai-responses" as const,
        models: ["nvidia/model"],
        authKind: "api_key" as const,
        canReconnect: true,
      };
      const profiles = await connectionProfiles({
        legacy: [legacy],
        capabilities: async () => {
          if (state === "absent_endpoint")
            throw Object.assign(
              new GatewayError("safe_error", "not_dispatched"),
              {
                httpStatus: 404,
              },
            );
          return {
            contract: "provider-connections/v1",
            capabilities:
              state === "missing"
                ? []
                : [
                    {
                      ...capability,
                      profileId: legacy.id,
                      provider: { identity: "nvidia", label: "NVIDIA Build" },
                      availability:
                        state === "custom_profile"
                          ? "enabled"
                          : "deployment_configuration_required",
                    },
                  ],
          };
        },
      });
      expect(profiles).toMatchObject([
        {
          id: legacy.id,
          availability: "deployment_configuration_required",
        },
      ]);
    },
  );
  it("rejects unknown and duplicate deployment profile IDs", () => {
    expect(configuredSubscriptionProfiles(undefined)).toEqual([]);
    expect(configuredSubscriptionProfiles(` ${profileId} `)).toEqual([
      profileId,
    ]);
    expect(() =>
      configuredSubscriptionProfiles(`${profileId},${profileId}`),
    ).toThrow();
    expect(() =>
      configuredSubscriptionProfiles("arbitrary-upstream"),
    ).toThrow();
  });
  it("projects completion grammar from the saved profile metadata", () => {
    expect(
      operationCompletion({
        id: "grok-subscription-responses-oauth-v1",
        label: "Grok",
        connection: {
          provider: "grok",
          planLabel: "Subscription",
          regionLabel: "Global",
          completionInputKind: "authorization_code",
          limitsContract: "account-limits/v2",
          modelSettings: [],
        },
      }),
    ).toEqual({
      providerLabel: "Grok",
      providerId: "grok",
      inputKind: "authorization_code",
    });
  });
});

const codexId = "openai-codex-oauth-responses-v1";
const v2Capability = {
  profileId: codexId,
  provider: { id: "openai", label: "Codex" },
  product: { id: "subscription" as const, label: "Codex subscription" },
  region: { id: "global" as const, label: "Global" },
  protocol: "openai-responses" as const,
  models: capability.models,
  methods: [
    {
      kind: "browser" as const,
      completionInputKind: "callback_url" as const,
      callbackMode: "manual_callback_url" as const,
      create: true,
      reconnect: false,
    },
    {
      kind: "credential_import" as const,
      method: "refresh_token" as const,
      maxBytes: 65536 as const,
      create: true,
      reconnect: true,
    },
    {
      kind: "credential_import" as const,
      method: "oauth_auth_json" as const,
      maxBytes: 65536 as const,
      create: true,
      reconnect: false,
    },
  ],
  accountInfo: true,
  limitsContract: "account-limits/v2" as const,
  availability: "enabled" as const,
};

describe("native v2 catalog and method admission", () => {
  it("reads one v2 catalog and preserves independent create/reconnect methods", async () => {
    const { connectionMethodAllowed } =
      await import("../features/account-gateway/connection-capabilities");
    const [profile] = await connectionProfiles({
      legacy: [
        {
          id: codexId,
          label: "Codex",
          provider: "codex",
          authKind: "oauth",
          protocol: "openai-responses",
          models: capability.modelIds,
        },
      ],
      capabilitiesV2: async () => ({
        contract: "provider-connections/v2",
        capabilities: [v2Capability],
      }),
      capabilities: async () => {
        throw new Error("v1 must not be read after qualified v2");
      },
    });
    expect(profile?.canReconnect).toBe(true);
    expect(
      connectionMethodAllowed(
        profile!,
        "create",
        "credential_import",
        "oauth_auth_json",
      ),
    ).toBe(true);
    expect(
      connectionMethodAllowed(
        profile!,
        "reconnect",
        "credential_import",
        "oauth_auth_json",
      ),
    ).toBe(false);
    expect(
      connectionMethodAllowed(
        profile!,
        "reconnect",
        "credential_import",
        "refresh_token",
      ),
    ).toBe(true);
    expect(connectionMethodAllowed(profile!, "reconnect", "browser")).toBe(
      false,
    );
    expect(
      connectionMethodAllowed(
        { ...profile!, id: "unqualified-oauth" },
        "create",
        "credential_import",
        "refresh_token",
      ),
    ).toBe(false);
  });
  it.each([
    ["anthropic-messages-apikey-v1", "anthropic"],
    ["gemini-openai-chat-apikey-v1", "gemini"],
  ] as const)(
    "qualifies %s only with its native identity and API-key method",
    async (profileId, provider) => {
      const wire = {
        ...v2Capability,
        profileId,
        provider: { id: provider, label: provider },
        methods: [{ kind: "api_key" as const, create: true, reconnect: true }],
      };
      const read = (row = wire) =>
        connectionProfiles({
          legacy: [],
          capabilitiesV2: async () => ({
            contract: "provider-connections/v2",
            capabilities: [row],
          }),
        });
      expect(await read()).toMatchObject([
        {
          id: profileId,
          authKind: "api_key",
          provider: "codex",
          connection: { provider },
        },
      ]);
      expect(
        await read({ ...wire, provider: { id: "foreign", label: "Foreign" } }),
      ).toEqual([]);
      expect(
        await read({
          ...wire,
          methods: [{ kind: "api_key", create: false, reconnect: true }],
        }),
      ).toMatchObject([
        {
          id: profileId,
          connection: { methods: [{ create: false, reconnect: true }] },
        },
      ]);
    },
  );
  it.each([400, 404, 403, 503])(
    "does not probe v1 after a v2 discovery error %s",
    async (httpStatus) => {
      const failure = Object.assign(
        new GatewayError("safe_error", "not_dispatched"),
        { httpStatus },
      );
      let reads = 0;
      await expect(
        connectionProfiles({
          legacy: [],
          capabilitiesV2: async () => {
            throw failure;
          },
          capabilities: async () => {
            reads++;
            return response();
          },
        }),
      ).rejects.toMatchObject({ httpStatus });
      expect(reads).toBe(0);
    },
  );
});
