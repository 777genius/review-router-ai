import { describe, expect, it } from "vitest";
import {
  gatewayProviderModelOptions,
  suggestedModel,
} from "./provider-model-options";

describe("Gateway model catalog presentation", () => {
  it("keeps public recommendation and pricing metadata while exact account admission disables unavailable models", () => {
    const available = {
      value: "openai/available",
      label: "Available model",
      provider: "openrouter" as const,
      badge: "FREE RECOMMENDED" as const,
      description: "128K context · $0 / $0 per 1M tokens",
    };
    const unavailable = {
      value: "anthropic/unavailable",
      label: "Unavailable model",
      provider: "openrouter" as const,
      description: "200K context",
    };
    const options = gatewayProviderModelOptions([available, unavailable], {
      id: "openrouter-openai-responses-apikey-v1",
      protocol: "openai-responses",
      models: ["openai/available", "runtime/private-model"],
    });
    expect(options[0]).toEqual(available);
    expect(options[1]).toMatchObject({ value: "runtime/private-model" });
    expect(options[2]).toEqual({
      ...unavailable,
      disabled: true,
      description: "200K context Unavailable for this account.",
    });
  });

  it("fails closed during an account outage without erasing the public catalog", () => {
    expect(
      gatewayProviderModelOptions(
        [
          {
            value: "public/model",
            label: "Public model",
            provider: "openrouter",
          },
        ],
        undefined,
      ),
    ).toEqual([
      {
        value: "public/model",
        label: "Public model",
        provider: "openrouter",
        disabled: true,
        description: "Unavailable for this account.",
      },
    ]);
  });

  const nativeProfile = (tools: "function" | "none" = "function") => ({
    id: "openrouter-openai-responses-apikey-v1",
    protocol: "openai-responses" as const,
    authKind: "api_key" as const,
    models: ["vendor/model"],
    connection: {
      provider: "openrouter" as const,
      planLabel: "API",
      regionLabel: "Global",
      completionInputKind: "none" as const,
      limitsContract: "none" as const,
      modelSettings: [
        {
          modelId: "vendor/model",
          reasoning: null,
          fast: null,
          tools: { allowed: [tools], default: tools },
        },
      ],
    },
  });
  const stalePublic = {
    value: "vendor/model",
    label: "Cached model name",
    provider: "openrouter" as const,
    disabled: true,
    badge: "Unsupported" as const,
    metadataDescription: "$1/$2 per 1M tokens. 128K context.",
    description:
      "$1/$2 per 1M tokens. 128K context. Tool calling support not confirmed.",
  };
  const nativeCatalog = () => ({
    status: "snapshot" as const,
    source: "openrouter" as const,
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    models: ["vendor/model"],
  });

  it("lets exact fresh native capabilities supersede stale public refusal while keeping catalog facts", () => {
    const [option] = gatewayProviderModelOptions(
      [stalePublic],
      nativeProfile(),
      { catalog: nativeCatalog(), requiresTools: true },
    );
    expect(option?.disabled).toBe(false);
    expect(option?.badge).not.toBe("Unsupported");
    expect(option?.label).toBe("Cached model name");
    expect(option?.description).toBe("$1/$2 per 1M tokens. 128K context.");
    expect(option?.description).not.toContain("not confirmed");
  });

  it("admits only the live-qualified NVIDIA Nemotron tool model with its own fresh account proof", () => {
    const modelId = "nvidia/nemotron-3.5-super-vl-120b-a12b";
    const profile = {
      id: "nvidia-build-chat-apikey-v1",
      protocol: "openai-responses" as const,
      authKind: "api_key" as const,
      models: [modelId],
      connection: {
        provider: "nvidia" as const,
        planLabel: "Trial",
        regionLabel: "Global",
        completionInputKind: "none" as const,
        limitsContract: "none" as const,
        modelSettings: [
          {
            modelId,
            reasoning: null,
            fast: null,
            tools: {
              allowed: ["function"] as const,
              default: "function" as const,
            },
          },
        ],
      },
    };
    const catalog = {
      status: "snapshot" as const,
      source: "nvidia" as const,
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      models: [modelId],
    };
    const [approved] = gatewayProviderModelOptions([], profile, {
      catalog,
      requiresTools: true,
    });
    expect(approved?.provider).toBe("nvidia");
    expect(approved?.disabled).toBe(false);

    // Native publishes NVIDIA's live list beside the anchor; every listed model
    // of this account is selectable, well past the former 8-model limit.
    const live = Array.from(
      { length: 20 },
      (_, index) => `vendor/live-model-${index}`,
    );
    const listed = [modelId, ...live];
    const long = gatewayProviderModelOptions(
      [],
      {
        ...profile,
        models: listed,
        connection: {
          ...profile.connection,
          modelSettings: listed.map((id) => ({
            ...profile.connection.modelSettings[0]!,
            modelId: id,
          })),
        },
      },
      { catalog: { ...catalog, models: listed }, requiresTools: true },
    );
    expect(long.map((option) => option.value)).toEqual(listed);
    expect(long.every((option) => !option.disabled)).toBe(true);

    // A list that is not this account's fresh proof blocks every choice. The
    // catalogue status explains it once above the list, so no option carries
    // a misleading reason of its own; models other than NVIDIA's are unaffected.
    const publicNemotron = {
      value: modelId,
      label: "Nemotron",
      provider: "nvidia" as const,
      description: "Public metadata",
    };
    for (const stale of [
      { ...catalog, source: "openrouter" as const },
      { ...catalog, expiresAt: new Date(Date.now() - 60_000).toISOString() },
      { status: "unknown" as const, source: "legacy_profile" as const, models: [] },
      undefined,
    ]) {
      const [blocked] = gatewayProviderModelOptions([publicNemotron], profile, {
        catalog: stale,
        requiresTools: true,
      });
      expect(blocked).toEqual({
        value: modelId,
        label: "Nemotron",
        provider: "nvidia",
        disabled: true,
      });
    }
    // A fresh list that does not include the model keeps a per-option reason.
    const [missing] = gatewayProviderModelOptions(
      [],
      { ...profile, models: [modelId, "nvidia/other"] },
      { catalog, requiresTools: true },
    ).filter((option) => option.value === "nvidia/other");
    expect(missing).toMatchObject({
      disabled: true,
      description: "This account's model list does not include it.",
    });

    const noTools = {
      ...profile,
      connection: {
        ...profile.connection,
        modelSettings: [
          {
            modelId,
            reasoning: null,
            fast: null,
            tools: { allowed: ["none"] as const, default: "none" as const },
          },
        ],
      },
    };
    const [notToolQualified] = gatewayProviderModelOptions([], noTools, {
      catalog,
      requiresTools: true,
    });
    expect(notToolQualified?.disabled).toBe(true);
    const [textOnly] = gatewayProviderModelOptions([], noTools, {
      catalog,
      requiresTools: false,
    });
    expect(textOnly?.disabled).toBe(false);
  });

  it("keeps true native tools:none unavailable for a tool-using review", () => {
    const [option] = gatewayProviderModelOptions(
      [{ ...stalePublic, disabled: false, badge: "PAID" }],
      nativeProfile("none"),
      { catalog: nativeCatalog(), requiresTools: true },
    );
    expect(option?.disabled).toBe(true);
    expect(option?.description).toContain(
      "Tool calling is not supported by this account model.",
    );
    expect(
      gatewayProviderModelOptions([stalePublic], nativeProfile("none"), {
        catalog: nativeCatalog(),
        requiresTools: false,
      })[0]?.disabled,
    ).toBe(false);
  });

  it.each([
    { status: "unknown" as const },
    { source: "legacy_profile" as const },
    { source: "codex" as const },
    { expiresAt: new Date(Date.now() - 60000).toISOString() },
    { fetchedAt: new Date(Date.now() + 60000).toISOString() },
    { models: ["another/model"] },
  ])(
    "does not override public refusal with unqualified account proof: %j",
    (change) => {
      expect(
        gatewayProviderModelOptions([stalePublic], nativeProfile(), {
          catalog: { ...nativeCatalog(), ...change },
          requiresTools: true,
        })[0],
      ).toEqual(stalePublic);
    },
  );

  it("requires exact native modelSettings and does not override public policy for old profile seeds", () => {
    expect(
      gatewayProviderModelOptions(
        [stalePublic],
        {
          ...nativeProfile(),
          connection: { ...nativeProfile().connection, modelSettings: [] },
        },
        { catalog: nativeCatalog(), requiresTools: true },
      )[0],
    ).toEqual(stalePublic);
    expect(
      gatewayProviderModelOptions([stalePublic], nativeProfile())[0],
    ).toEqual(stalePublic);
  });

  it("preserves provider runtime restrictions even when the account lists the model", () => {
    expect(
      gatewayProviderModelOptions(
        [
          {
            value: "text/only",
            label: "Text only",
            provider: "openrouter",
            disabled: true,
          },
        ],
        {
          id: "openrouter-openai-responses-apikey-v1",
          protocol: "openai-responses",
          models: ["text/only"],
        },
      )[0]?.disabled,
    ).toBe(true);
  });
  it("offers the GLM catalogue models with the capabilities of a fresh native_catalog snapshot", () => {
    const setting = (modelId: string) => ({
      modelId,
      reasoning: null,
      fast: null,
      tools: { allowed: ["function" as const], default: "function" as const },
    });
    const profile = {
      id: "glm-coding-global-responses-apikey-v1",
      protocol: "openai-responses" as const,
      authKind: "api_key" as const,
      models: ["glm-5.3-flash", "glm-5.3"],
      connection: {
        provider: "glm" as const,
        planLabel: "GLM Coding Plan",
        regionLabel: "Global",
        completionInputKind: "none" as const,
        limitsContract: "account-limits/v2" as const,
        modelSettings: [setting("glm-5.3-flash"), setting("glm-5.3")],
      },
    };
    const catalog = {
      status: "snapshot" as const,
      source: "native_catalog" as const,
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      models: ["glm-5.3-flash", "glm-5.3"],
    };
    const options = gatewayProviderModelOptions([], profile, {
      catalog,
      requiresTools: true,
    });
    expect(options.map((option) => option.value)).toEqual([
      "glm-5.3-flash",
      "glm-5.3",
    ]);
    expect(options.every((option) => option.disabled === false)).toBe(true);
  });
});

describe("the model a new provider starts with", () => {
  const option = (value: string, disabled = false) => ({
    value,
    label: value,
    provider: "openrouter" as const,
    disabled,
  });

  it("prefers the provider's catalogue default when this account offers it", () => {
    expect(
      suggestedModel(
        [option("openai/other"), option("openai/gpt-5.3-codex")],
        "openrouter",
      ),
    ).toBe("openai/gpt-5.3-codex");
  });

  it("never suggests a default the account cannot use", () => {
    expect(
      suggestedModel(
        [option("openai/gpt-5.3-codex", true), option("openai/only")],
        "openrouter",
      ),
    ).toBe("openai/only");
  });

  it("takes the only usable model, otherwise leaves the choice to the user", () => {
    expect(
      suggestedModel(
        [option("nvidia/one"), option("nvidia/off", true)],
        "nvidia",
      ),
    ).toBe("nvidia/one");
    expect(
      suggestedModel([option("nvidia/one"), option("nvidia/two")], "nvidia"),
    ).toBe("");
    expect(suggestedModel([], "openrouter")).toBe("");
  });
});
