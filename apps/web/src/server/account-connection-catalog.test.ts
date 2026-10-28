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
        personalOnly: true,
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
          personalOnly: false,
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
