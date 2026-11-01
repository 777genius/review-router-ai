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
  it("requires a fresh catalog on the selected dynamic binding and keeps fallback explicit", () => {
    const profileId = "openrouter-openai-responses-apikey-v1";
    const model = "openai/gpt-4.1";
    const anchor = "openai/gpt-5.4-nano";
    const config = (selected = model) =>
      parseReviewConfiguration({
        ...workspacePolicyFixture,
        providers: [
          {
            kind: "codex",
            authMode: "codex_account_gateway",
            gatewayBindingId: "binding_1",
            gatewayProfileRef: profileId,
            model: selected,
            reasoningEffort: "medium",
            agenticContext: true,
            fastMode: false,
          },
        ],
      });
    const now = Date.now();
    const catalog = {
      status: "snapshot" as const,
      source: "openrouter" as const,
      models: [model],
      fetchedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    };
    const accounts: AccountsResult<AccountsPage> = {
      status: "ok",
      value: {
        accounts: [
          {
            connectionId: "connection_1",
            label: "OpenRouter",
            profileId,
            profileLabel: "OpenRouter",
            state: "active",
            gatewayRevision: 2,
            mirrorRevision: 2,
            binding: {
              id: "binding_1",
              revision: 1,
              state: "active",
              fencePending: false,
            },
            modelCatalog: catalog,
          },
        ],
        profiles: [
          {
            id: profileId,
            label: "OpenRouter",
            protocol: "openai-responses",
            authKind: "api_key",
            models: [anchor],
          },
        ],
        nextCursor: null,
      },
    };
    expect(isGatewayProviderSetupReady(config(), accounts)).toBe(true);
    for (const invalid of [
      { ...catalog, expiresAt: new Date(now - 1).toISOString() },
      { ...catalog, fetchedAt: new Date(now + 60_000).toISOString() },
      { ...catalog, fetchedAt: "invalid" },
      { ...catalog, source: "codex" as const },
      { ...catalog, models: [anchor] },
      {
        status: "unknown" as const,
        source: "legacy_profile" as const,
        models: [model],
      },
      {
        status: "unsupported" as const,
        source: "legacy_profile" as const,
        models: [model],
      },
    ]) {
      const page: AccountsResult<AccountsPage> = {
        status: "ok",
        value: {
          ...accounts.value,
          accounts: [{ ...accounts.value.accounts[0]!, modelCatalog: invalid }],
        },
      };
      expect(isGatewayProviderSetupReady(config(), page)).toBe(false);
    }
    const unavailable: AccountsResult<AccountsPage> = {
      status: "ok",
      value: {
        ...accounts.value,
        accounts: [
          {
            ...accounts.value.accounts[0]!,
            modelCatalog: {
              status: "unavailable",
              source: "legacy_profile",
              models: [anchor, model],
            },
          },
        ],
      },
    };
    expect(isGatewayProviderSetupReady(config(anchor), unavailable)).toBe(true);
    expect(isGatewayProviderSetupReady(config(), unavailable)).toBe(false);
    const withoutCatalog = { ...accounts.value.accounts[0]! };
    delete withoutCatalog.modelCatalog;
    expect(
      isGatewayProviderSetupReady(config(anchor), {
        status: "ok",
        value: {
          ...accounts.value,
          accounts: [withoutCatalog],
        },
      }),
    ).toBe(false);
  });

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

describe("multi-reviewer dynamic Gateway readiness", () => {
  it("requires a fresh exact catalog for every reviewer even when profile seeds contain both models", () => {
    const profileId = "openrouter-openai-responses-apikey-v1";
    const provider = (id: string, model: string) => ({
      kind: "codex" as const,
      authMode: "codex_account_gateway" as const,
      gatewayBindingId: id,
      gatewayProfileRef: profileId,
      model,
      reasoningEffort: "medium" as const,
      agenticContext: true,
      fastMode: false,
    });
    const config = parseReviewConfiguration({
      ...workspacePolicyFixture,
      providers: [
        provider("binding-1", "model-one"),
        provider("binding-2", "model-two"),
      ],
      execution: {
        providerLimit: 2,
        providerMaxParallel: 2,
        inlineMinAgreement: 1,
      },
    });
    const now = Date.now();
    const row = (id: string, model: string) => ({
      connectionId: `connection-${id}`,
      label: id,
      profileId,
      profileLabel: "OpenRouter",
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
        source: "openrouter" as const,
        models: [model],
        fetchedAt: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
      },
    });
    const first = row("binding-1", "model-one");
    const second = row("binding-2", "model-two");
    const page = {
      accounts: [first, second],
      profiles: [
        {
          id: profileId,
          label: "OpenRouter",
          protocol: "openai-responses" as const,
          authKind: "api_key" as const,
          models: ["model-one", "model-two"],
        },
      ],
      nextCursor: null,
    };
    expect(
      isGatewayProviderSetupReady(config, { status: "ok", value: page }),
    ).toBe(true);
    for (const catalog of [
      { ...second.modelCatalog, expiresAt: new Date(now - 1).toISOString() },
      { ...second.modelCatalog, source: "codex" as const },
      {
        ...second.modelCatalog,
        status: "unknown" as const,
        source: "legacy_profile" as const,
      },
      { ...second.modelCatalog, models: ["model-one"] },
    ]) {
      expect(
        isGatewayProviderSetupReady(config, {
          status: "ok",
          value: {
            ...page,
            accounts: [first, { ...second, modelCatalog: catalog }],
          },
        }),
      ).toBe(false);
    }
  });
});
