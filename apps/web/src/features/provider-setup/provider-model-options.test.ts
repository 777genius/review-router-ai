import { describe, expect, it } from "vitest";
import { gatewayProviderModelOptions } from "./provider-model-options";

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
    models: ["vendor/model"],
    connection: {
      provider: "openrouter" as const,
      planLabel: "API",
      regionLabel: "Global",
      completionInputKind: "none" as const,
      personalOnly: false,
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
        { models: ["text/only"] },
      )[0]?.disabled,
    ).toBe(true);
  });
});
