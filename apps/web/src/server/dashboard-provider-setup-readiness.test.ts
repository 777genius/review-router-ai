import { describe, expect, it } from "vitest";
import { parseReviewConfiguration } from "@reviewrouter/features-review-config";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  getGatewaySetupAccounts,
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
  it("requires every reviewer and uses exact account catalogs rather than a shared profile seed", () => {
    const provider = {
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding-1",
      gatewayProfileRef: "profile",
      model: "model-one",
      reasoningEffort: "high",
      agenticContext: true,
      fastMode: false,
    } as const;
    const config = parseReviewConfiguration({
      ...workspacePolicyFixture,
      providers: [
        provider,
        { ...provider, gatewayBindingId: "binding-2", model: "model-two" },
      ],
      execution: {
        providerLimit: 2,
        providerMaxParallel: 2,
        inlineMinAgreement: 1,
      },
    });
    const row = (id: string, model: string) => ({
      connectionId: `connection-${id}`,
      label: id,
      profileId: "profile",
      profileLabel: "Model profile",
      state: "active" as const,
      gatewayRevision: 1,
      mirrorRevision: 1,
      binding: {
        id,
        revision: 1,
        state: "active" as const,
        fencePending: false,
      },
      modelCatalog: {
        status: "snapshot" as const,
        source: "codex" as const,
        models: [model],
      },
    });
    const page = {
      accounts: [row("binding-1", "model-one"), row("binding-2", "model-two")],
      profiles: [
        {
          id: "profile",
          label: "Models",
          protocol: "openai-responses" as const,
          models: ["seed-only"],
        },
      ],
      nextCursor: null,
    };
    expect(
      isGatewayProviderSetupReady(config, { status: "ok", value: page }),
    ).toBe(true);
    for (const status of ["unknown", "snapshot"] as const) {
      const recovering: AccountsResult<AccountsPage> = {
        status: "ok",
        value: {
          ...page,
          profiles: [
            { ...page.profiles[0]!, models: ["model-one", "model-two"] },
          ],
          accounts: [
            page.accounts[0]!,
            {
              ...page.accounts[1]!,
              modelCatalog: { status, source: "codex", models: [] },
            },
          ],
        },
      };
      expect(getGatewaySetupAccounts(recovering)).toHaveLength(2);
      expect(getReadyGatewayAccounts(recovering)).toHaveLength(1);
      expect(isGatewayProviderSetupReady(config, recovering)).toBe(false);
    }
    expect(
      isGatewayProviderSetupReady(config, {
        status: "ok",
        value: { ...page, accounts: [page.accounts[0]!] },
      }),
    ).toBe(false);
    expect(
      isGatewayProviderSetupReady(config, {
        status: "ok",
        value: {
          ...page,
          accounts: [page.accounts[0]!, row("binding-2", "wrong-model")],
        },
      }),
    ).toBe(false);
  });
});
