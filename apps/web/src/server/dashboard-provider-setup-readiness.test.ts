import { describe, expect, it } from "vitest";
import { parseReviewConfiguration } from "@reviewrouter/features-review-config";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  getReadyGatewayAccounts,
  isGatewayProviderSetupReady,
} from "./dashboard-provider-setup-readiness";
import type { AccountsPage, AccountsResult } from "./account-gateway-accounts";

describe("dashboard Gateway provider evidence", () => {
  it("requires the selected live Gateway binding and catalog model", () => {
    const config = parseReviewConfiguration({
      ...workspacePolicyFixture,
      providers: [
        {
          kind: "codex",
          authMode: "codex_account_gateway",
          gatewayBindingId: "binding_1",
          gatewayProfileRef: "openai-responses-apikey-v1",
          model: "mimo-v2.6-pro",
          reasoningEffort: "medium",
          agenticContext: true,
          fastMode: false,
        },
      ],
    });
    const accounts: AccountsResult<AccountsPage> = {
      status: "ok",
      value: {
        accounts: [
          {
            connectionId: "connection_1",
            label: "Workspace account",
            profileId: "openai-responses-apikey-v1",
            profileLabel: "MiMo",
            state: "active",
            gatewayRevision: 2,
            mirrorRevision: 2,
            binding: {
              id: "binding_1",
              revision: 1,
              state: "active",
              fencePending: false,
            },
          },
        ],
        profiles: [
          {
            id: "openai-responses-apikey-v1",
            label: "MiMo",
            protocol: "openai-responses",
            models: ["mimo-v2.6-pro"],
          },
        ],
        nextCursor: null,
      },
    };
    expect(getReadyGatewayAccounts(accounts)).toHaveLength(1);
    expect(isGatewayProviderSetupReady(config, accounts)).toBe(true);

    const account = accounts.value.accounts[0]!;
    const binding = account.binding!;
    const blockedPages: AccountsResult<AccountsPage>[] = [
      { status: "unavailable" },
      { status: "denied" },
      { status: "ok", value: { ...accounts.value, accounts: [] } },
      ...[
        { ...account, state: "quarantined" as const },
        { ...account, binding: { ...binding, state: "revoked" as const } },
        { ...account, binding: { ...binding, fencePending: true } },
        { ...account, binding: { ...binding, id: "another_binding" } },
        { ...account, profileId: "another_profile" },
      ].map((blocked) => ({
        status: "ok" as const,
        value: { ...accounts.value, accounts: [blocked] },
      })),
      {
        status: "ok",
        value: {
          ...accounts.value,
          profiles: [
            { ...accounts.value.profiles[0]!, models: ["another-model"] },
          ],
        },
      },
    ];
    for (const page of blockedPages) {
      expect(isGatewayProviderSetupReady(config, page)).toBe(false);
    }
  });
});
