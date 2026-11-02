import { describe, expect, it } from "vitest";
import type {
  AccountProfileView,
  AccountsPage,
  AccountsResult,
} from "../../server/account-gateway-accounts";
import { connectionSetupContinuation } from "./connection-setup-continuation";

const openrouter: AccountProfileView = {
  id: "openrouter-profile",
  label: "OpenRouter",
  protocol: "openai-responses",
  authKind: "api_key",
  provider: "openrouter",
  models: ["openai/model"],
};
const page = (
  profiles = [openrouter],
  existing = false,
  existingProfileIndex = 0,
): AccountsResult<AccountsPage> => ({
  status: "ok",
  value: {
    profiles,
    nextCursor: null,
    accounts: existing
      ? [
          {
            connectionId: "existing",
            profileId: profiles[existingProfileIndex]!.id,
            profileLabel: "Existing provider",
            label: "My existing connection",
            state: "active",
            gatewayRevision: 1,
            mirrorRevision: 1,
            binding: null,
          },
        ]
      : [],
  },
});
const intent = {
  provider: "openrouter" as const,
  storage: "reviewrouter" as const,
  workspaceId: "workspace",
  repositoryIds: ["repo"],
};

describe("explicit provider connection continuation", () => {
  it("opens the exact requested workspace form when trusted workspace enrollment supports it", () => {
    expect(
      connectionSetupContinuation({
        intent,
        workspace: page(),
        personal: page(),
      }),
    ).toEqual({ autoOpen: true, ownership: "organization", view: "available" });
  });
  it("keeps a personal-only provider personal instead of selecting a different workspace provider", () => {
    const claude: AccountProfileView = {
      id: "anthropic-claude-oauth-messages-v1",
      label: "Claude",
      protocol: "openai-responses",
      authKind: "oauth",
      provider: "claude",
      models: ["sonnet"],
      connection: {
        provider: "anthropic",
        planLabel: "Subscription",
        regionLabel: "Global",
        personalOnly: true,
        completionInputKind: "authorization_code",
        limitsContract: "none",
        modelSettings: [],
      },
    };
    expect(
      connectionSetupContinuation({
        intent: { ...intent, provider: "claude-code" },
        workspace: page(),
        personal: page([claude]),
      }),
    ).toEqual({ autoOpen: true, ownership: "personal", view: "available" });
  });
  it("shows existing personal connections for explicit access instead of prompting for another key", () => {
    expect(
      connectionSetupContinuation({
        intent,
        workspace: page(),
        personal: page([openrouter], true),
      }),
    ).toEqual({ autoOpen: false, ownership: "organization", view: "own" });
  });
  it("finds an existing connection across configured profiles for the same provider", () => {
    const personal = page(
      [{ ...openrouter, id: "other-openrouter-profile" }, openrouter],
      true,
      1,
    );
    expect(
      connectionSetupContinuation({ intent, workspace: page(), personal }),
    ).toMatchObject({ autoOpen: false, view: "own" });
  });

  it("reuses an available connection and does not open enrollment for a GitHub-storage intent", () => {
    expect(
      connectionSetupContinuation({
        intent,
        workspace: page(),
        personal: page(),
        available: page([openrouter], true),
      }).autoOpen,
    ).toBe(false);
    expect(
      connectionSetupContinuation({
        intent: { ...intent, storage: "github_secrets" },
        workspace: page(),
        personal: page(),
      }).autoOpen,
    ).toBe(false);
  });
  it("does not infer workspace enrollment authority from visible account inventory", () => {
    expect(
      connectionSetupContinuation({
        intent,
        workspace: { status: "denied" },
        personal: page(),
        available: page(),
      }),
    ).toEqual({ autoOpen: true, ownership: "personal", view: "available" });
    expect(
      connectionSetupContinuation({
        intent,
        workspace: { status: "denied" },
        personal: undefined,
        available: page(),
      }).autoOpen,
    ).toBe(false);
  });
});
