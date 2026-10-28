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
