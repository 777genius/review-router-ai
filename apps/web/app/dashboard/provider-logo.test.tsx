import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountIdentity, AccountProviderLogo } from "./account-identity";
import { ProviderAuthLogoFrame } from "./provider-auth-logo";
import { ProviderLogo } from "./provider-logo";
import type { AccountConnectionView } from "../../src/features/account-gateway/connection-capabilities";

describe("provider display identity", () => {
  it.each([
    ["mimo_token_plan_api_key", "mimo"],
    ["kimi_code_api_key", "kimi"],
    ["openrouter_api_key", "openrouter"],
    ["claude_code_oauth", "anthropic"],
    ["codex_subscription_oauth_hosted_pool", "openai"],
  ] as const)("renders the actual upstream for %s", (authMode, providerId) => {
    const html = renderToStaticMarkup(
      <ProviderAuthLogoFrame authMode={authMode} />,
    );
    expect(html).toContain(`data-provider-logo="${providerId}"`);
    expect(html).toContain('aria-hidden="true"');
  });

  it("keeps Gateway neutral without upstream metadata and respects its exact upstream", () => {
    expect(
      renderToStaticMarkup(
        <ProviderAuthLogoFrame authMode="codex_account_gateway" />,
      ),
    ).toContain('data-provider-logo="unknown"');
    expect(
      renderToStaticMarkup(
        <ProviderAuthLogoFrame
          authMode="codex_account_gateway"
          providerId="kimi"
        />,
      ),
    ).toContain('data-provider-logo="kimi"');
  });

  it("does not use a renamed label or the generic Codex engine as upstream identity", () => {
    const connection: AccountConnectionView = {
      provider: "mimo",
      planLabel: "Token Plan",
      regionLabel: "Singapore",
      completionInputKind: "none",
      personalOnly: false,
      limitsContract: "none",
      modelSettings: [],
    };
    const html = renderToStaticMarkup(
      <AccountIdentity
        label="My OpenAI account"
        profileLabel="Renamed to OpenRouter"
        provider="codex"
        connection={connection}
      />,
    );
    expect(html).toContain('data-provider-logo="mimo"');
    expect(html).not.toContain('data-provider-logo="openai"');
    expect(
      renderToStaticMarkup(
        <AccountProviderLogo profileLabel="Codex OpenRouter Kimi" />,
      ),
    ).toContain('data-provider-logo="unknown"');
  });

  it("preserves independent NVIDIA identity throughout shared account controls", () => {
    const connection: AccountConnectionView = {
      provider: "nvidia",
      planLabel: "NVIDIA Build evaluation",
      regionLabel: "Global",
      completionInputKind: "none",
      personalOnly: false,
      limitsContract: "none",
      modelSettings: [],
    };
    const html = renderToStaticMarkup(
      <AccountIdentity
        label="Synthetic sandbox"
        profileLabel="NVIDIA Build"
        provider="nvidia"
        connection={connection}
      />,
    );
    expect(html).toContain('data-provider-logo="nvidia"');
    expect(html).not.toContain('data-provider-logo="openrouter"');
    expect(renderToStaticMarkup(<AccountProviderLogo provider="nvidia" />)).toContain(
      'data-provider-logo="nvidia"',
    );
  });

  it("uses local path-only MiMo geometry and a distinct neutral fallback", () => {
    const mimo = renderToStaticMarkup(<ProviderLogo providerId="mimo" />);
    expect(mimo).toContain('viewBox="72 0 60 16"');
    expect(mimo).not.toMatch(/<image|<script|href=|<foreignObject/);
    expect(renderToStaticMarkup(<ProviderLogo />)).not.toContain(
      'viewBox="0 0 256 260"',
    );
  });
});
