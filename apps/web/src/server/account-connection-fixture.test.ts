import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  createConsumerControlClient,
  createManagementClient,
} from "@agent-teams/account-gateway/http";
import {
  accountModelDiscoverySource,
  supportsConnectionMethod,
} from "@agent-teams/account-gateway/contracts";
import { startGatewayFixture } from "../../../../scripts/accounts-reference-e2e/src/gateway-fixture";
import { FIXTURES } from "../../../../scripts/accounts-reference-e2e/src/contracts";
import {
  CODEX_A_MODEL,
  CODEX_A_REFRESHED,
  CODEX_MODEL_PROFILE,
} from "../../../../scripts/accounts-reference-e2e/src/account-models-fixture";
import { connectionProfiles } from "./account-connection-catalog";
import { connectionMethodAllowed } from "../features/account-gateway/connection-capabilities";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const secrets = {
  authSecret: "fixture-auth-secret",
  gatewayAccountsContextSecret: "fixture-context-secret",
  githubClientId: "fixture-github-client",
  githubClientSecret: "fixture-github-secret",
  managementToken: "fixture-management-token",
  personalControlToken: "fixture-control-token",
};

async function withFixture(
  flag: string,
  work: (fixture: {
    url: string;
    management: ReturnType<typeof createManagementClient>;
    control: ReturnType<typeof createConsumerControlClient>;
  }) => Promise<void>,
) {
  const previous = [...process.argv];
  const workDir = await mkdtemp(join(tmpdir(), "rr-connection-fixture-"));
  if (flag) process.argv.push(flag);
  let fixture: Awaited<ReturnType<typeof startGatewayFixture>> | undefined;
  try {
    fixture = await startGatewayFixture({
      repoRoot,
      workDir,
      databaseUrl: "postgresql://unused/fixture_no_database_access",
      secrets,
    });
    await work({
      url: fixture.url,
      management: createManagementClient({
        role: "management",
        origin: fixture.url,
        token: secrets.managementToken,
      }),
      control: createConsumerControlClient({
        role: "consumer-control",
        origin: fixture.url,
        token: secrets.personalControlToken,
      }),
    });
  } finally {
    await fixture?.stop();
    process.argv.splice(0, process.argv.length, ...previous);
    await rm(workDir, { recursive: true, force: true });
  }
}

test.each([
  "",
  "--account-models-fixture",
  "--limits-fixture",
  "--subscription-fixture",
  "--api-key-storage-fixture",
])(
  "Gateway HTTP fixture %s serves authenticated coherent v2 discovery",
  async (flag) => {
    await withFixture(flag, async ({ url, management, control }) => {
      expect(
        (await fetch(`${url}/v2/provider-connection-capabilities`)).status,
      ).toBe(401);
      // Both real SDK entrypoints validate the current strict public schema.
      const snapshot = await management.getProviderConnectionCapabilitiesV2();
      expect(await control.getProviderConnectionCapabilitiesV2()).toEqual(
        snapshot,
      );
      const profiles = await control.profiles();
      expect(snapshot.capabilities.map((entry) => entry.profileId)).toEqual(
        profiles.profiles.map((entry) => entry.profileId),
      );
      for (const entry of snapshot.capabilities) {
        expect(entry.accountInfo).toBe(
          flag === "--account-models-fixture" &&
            entry.profileId === CODEX_MODEL_PROFILE,
        );
        expect(entry.models.map((model) => model.modelId)).toEqual(
          profiles.profiles.find(
            (profile) => profile.profileId === entry.profileId,
          )?.modelIds,
        );
        const canEnroll =
          ["--subscription-fixture", "--api-key-storage-fixture"].includes(
            flag,
          ) && entry.profileId !== FIXTURES.gateway.profileId;
        for (const method of entry.methods) {
          expect(method.create).toBe(canEnroll);
          expect(method.reconnect).toBe(canEnroll);
        }
      }
    });
  },
);

test("v2 fixture preserves Codex account-model qualification and real SDK refresh", async () => {
  await withFixture(
    "--account-models-fixture",
    async ({ management, control }) => {
      const wire = (await control.profiles()).profiles.find(
        (profile) => profile.profileId === CODEX_MODEL_PROFILE,
      )!;
      const profiles = await connectionProfiles({
        legacy: [
          {
            id: wire.profileId,
            label: "Codex",
            provider: "codex",
            authKind: "oauth",
            protocol: wire.protocol,
            models: wire.modelIds,
            oauthMethods: ["browser", "device_code"],
          },
        ],
        capabilitiesV2: () => management.getProviderConnectionCapabilitiesV2(),
      });
      const profile = profiles[0]!;
      expect(profile.availability).toBe("enabled");
      expect(
        accountModelDiscoverySource({
          profileId: profile.id,
          protocol: profile.protocol,
          authKind: profile.authKind!,
        }),
      ).toBe("codex");
      expect(connectionMethodAllowed(profile, "create", "browser")).toBe(false);
      const account = await control.get(
        FIXTURES.gateway.accounts.viewerPrimary,
      );
      const request = {
        ownerRef: account.ownerRef,
        accountRef: account.accountRef,
        profileId: account.profileId,
        expectedAuthorizationEpoch: account.authorizationEpoch,
      };
      expect(await control.readAccountModels(request)).toMatchObject({
        status: "snapshot",
        source: "codex",
        models: [{ modelId: CODEX_A_MODEL }],
      });
      expect(
        await control.readAccountModels({ ...request, forceRefresh: true }),
      ).toMatchObject({
        status: "snapshot",
        source: "codex",
        models: [{ modelId: CODEX_A_REFRESHED }],
      });
    },
  );
});

test.each([
  "",
  "--account-models-fixture",
  "--limits-fixture",
  "--subscription-fixture",
  "--api-key-storage-fixture",
])(
  "Gateway HTTP fixture %s serves authenticated native discovery",
  async (flag) => {
    await withFixture(flag, async ({ url, management, control }) => {
      expect(
        (await fetch(`${url}/v3/provider-connection-capabilities`)).status,
      ).toBe(401);
      const snapshot = await management.getProviderConnectionCapabilitiesV3();
      expect(await control.getProviderConnectionCapabilitiesV3()).toEqual(
        snapshot,
      );
      expect(snapshot.capabilities).not.toHaveLength(0);
      for (const profile of snapshot.capabilities) {
        expect(profile.modelPolicy).toEqual({
          sourceId: profile.profileId,
          contract: "native-account-models/v2",
          unavailableFallback: profile.profileId.startsWith("nvidia-")
            ? "deny"
            : "qualified_anchor",
        });
        expect(profile.methods.every(supportsConnectionMethod)).toBe(true);
      }
    });
  },
);

test("native fixture keeps scoped models and explicit training facts behind real SDK validation", async () => {
  await withFixture("--account-models-fixture", async ({ url, control }) => {
    const account = await control.get(FIXTURES.gateway.accounts.viewerPrimary);
    const request = {
      ownerRef: account.ownerRef,
      accountRef: account.accountRef,
      profileId: account.profileId,
      expectedAuthorizationEpoch: account.authorizationEpoch,
    };
    expect(await control.readAccountModelsV2(request)).toMatchObject({
      status: "snapshot",
      profileId: CODEX_MODEL_PROFILE,
      sourceId: CODEX_MODEL_PROFILE,
      admission: { unavailableFallback: "qualified_anchor" },
      models: [{ modelId: CODEX_A_MODEL }],
    });
    expect(
      await control.readAccountInfoV2({
        ownerRef: account.ownerRef,
        accountRefs: [account.accountRef],
      }),
    ).toMatchObject({
      contract: "account-info/v2",
      accounts: [
        {
          metadataRevision: account.metadataRevision,
          authorizationEpoch: account.authorizationEpoch,
          info: {
            status: "available",
            fields: { trainingUsage: { status: "known", value: "disabled" } },
          },
        },
      ],
    });
    const stats = () =>
      fetch(`${url}/__account-models-fixture`).then((response) =>
        response.json(),
      );
    const before = await stats();
    for (const changed of [
      { profileId: "foreign-profile" },
      { expectedAuthorizationEpoch: account.authorizationEpoch + 1 },
      { ownerRef: "foreign-owner" },
    ])
      await expect(
        control.readAccountModelsV2({
          ...request,
          ...changed,
          forceRefresh: true,
        }),
      ).rejects.toThrow();
    expect(await stats()).toEqual(before);
  });
});

test("native fixture pins Codex import and reconnect intent without retaining credentials", async () => {
  await withFixture("--account-models-fixture", async ({ url, control }) => {
    await fetch(`${url}/__account-models-fixture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ importsEnabled: true }),
    });
    const profile = (
      await control.getProviderConnectionCapabilitiesV3()
    ).capabilities.find((item) => item.profileId === CODEX_MODEL_PROFILE)!;
    const method = profile.methods.find(
      (item) => item.methodId === "refresh_token",
    )!;
    const connection = {
      profileId: profile.profileId,
      methodId: method.methodId,
      methodRevision: method.revision,
      configurationGeneration: method.configurationGeneration,
    };
    const owner = await control.get(FIXTURES.gateway.accounts.viewerPrimary);
    const secret = "synthetic-codex-refresh-token";
    const begin = {
      operationId: "fixture-native-codex-connect",
      ownerRef: owner.ownerRef,
      displayName: "Native fixture Codex",
      connection,
      inputFields: { credential: secret },
    };
    const created = await control.beginConnection(begin);
    expect(created.operation.state).toBe("applied");
    expect(created.connection.credential).toEqual({
      credentialKind: "oauth",
      credentialPolicy: "subscription_session",
      refreshPolicy: "native",
    });
    expect(await control.readConnection(begin.operationId)).toEqual(created);
    expect(await control.beginConnection(begin)).toEqual(created);
    expect(JSON.stringify(created)).not.toContain(secret);
    if (
      created.operation.state !== "applied" ||
      created.operation.result?.kind !== "account"
    )
      throw new Error("Expected an applied native account receipt");
    const target = created.operation.result;
    const reconnect = {
      operationId: "fixture-native-codex-reconnect",
      expectedMetadataRevision: target.metadataRevision,
      connection,
      inputFields: { credential: "synthetic-codex-reconnect-refresh-token" },
    };
    const updated = await control.reconnectConnection(
      target.accountRef,
      reconnect,
    );
    expect(updated.operation).toMatchObject({
      state: "applied",
      result: {
        kind: "account",
        accountRef: target.accountRef,
        metadataRevision: 2,
        authorizationEpoch: 2,
      },
    });
    expect(
      await control.reconnectConnection(target.accountRef, reconnect),
    ).toEqual(updated);
    expect(await control.readConnection(reconnect.operationId)).toEqual(
      updated,
    );
    const stats = () =>
      fetch(`${url}/__account-models-fixture`).then((response) =>
        response.json(),
      );
    const before = await stats();
    await expect(
      control.reconnectConnection(
        FIXTURES.gateway.accounts.orgAlpha,
        reconnect,
      ),
    ).rejects.toThrow();
    await expect(
      control.reconnectConnection(FIXTURES.gateway.accounts.otherPrimary, {
        ...reconnect,
        operationId: "fixture-foreign-profile",
      }),
    ).rejects.toThrow();
    await expect(
      control.beginConnection({
        ...begin,
        operationId: "fixture-stale-generation",
        connection: { ...connection, configurationGeneration: "stale" },
      }),
    ).rejects.toThrow();
    expect(await stats()).toEqual(before);
  });
});

test("native subscription fixture preserves key custody and owner-bound browser recovery", async () => {
  await withFixture("--subscription-fixture", async ({ url, control }) => {
    const profiles = (await control.getProviderConnectionCapabilitiesV3())
      .capabilities;
    const owner = await control.get(FIXTURES.gateway.accounts.viewerPrimary);
    const select = (provider: string) => {
      const profile = profiles.find((item) => item.provider.id === provider)!;
      const method = profile.methods[0]!;
      return {
        profileId: profile.profileId,
        methodId: method.methodId,
        methodRevision: method.revision,
        configurationGeneration: method.configurationGeneration,
      };
    };
    const key = await control.beginConnection({
      operationId: "fixture-native-kimi",
      ownerRef: owner.ownerRef,
      displayName: "Native Kimi",
      connection: select("kimi"),
      inputFields: { credential: "synthetic-kimi-subscription-key" },
    });
    expect(key.operation.state).toBe("applied");
    expect(key.connection.credential).toEqual({
      credentialKind: "api_key",
      credentialPolicy: "provider_key",
      refreshPolicy: "none",
    });
    const browser = await control.beginConnection({
      operationId: "fixture-native-grok",
      ownerRef: owner.ownerRef,
      displayName: "Native Grok",
      connection: select("grok"),
    });
    expect(browser.challenge?.kind).toBe("browser");
    const retained = await control.readConnection("fixture-native-grok");
    expect(retained.connection).toEqual(browser.connection);
    expect(retained).not.toHaveProperty("challenge");
    expect(JSON.stringify(retained)).not.toContain("authorizationURL");
    const stats = () =>
      fetch(`${url}/__subscription-fixture`).then((response) =>
        response.json(),
      );
    const before = await stats();
    await expect(
      control.submitConnection({
        operationId: "fixture-native-grok",
        ownerRef: "foreign-owner",
        inputFields: { completion: "synthetic-browser-grok-code" },
      }),
    ).rejects.toThrow();
    expect(await stats()).toEqual(before);
    const applied = await control.submitConnection({
      operationId: "fixture-native-grok",
      ownerRef: owner.ownerRef,
      inputFields: { completion: "synthetic-browser-grok-code" },
    });
    expect(applied.operation.state).toBe("applied");
    expect(applied.connection?.credential).toEqual({
      credentialKind: "oauth",
      credentialPolicy: "subscription_session",
      refreshPolicy: "native",
    });
    expect(await control.readConnection("fixture-native-grok")).toEqual(
      applied,
    );
  });
});

test("native NVIDIA fixture fences model identity before refresh effects", async () => {
  await withFixture("--api-key-storage-fixture", async ({ url, control }) => {
    const owner = await control.get(FIXTURES.gateway.accounts.viewerPrimary);
    const profile = (
      await control.getProviderConnectionCapabilitiesV3()
    ).capabilities.find((item) => item.provider.id === "nvidia")!;
    const method = profile.methods[0]!;
    const created = await control.beginConnection({
      operationId: "fixture-native-nvidia",
      ownerRef: owner.ownerRef,
      displayName: "Native NVIDIA",
      connection: {
        profileId: profile.profileId,
        methodId: method.methodId,
        methodRevision: method.revision,
        configurationGeneration: method.configurationGeneration,
      },
      inputFields: { credential: "synthetic-nvidia-subscription-key" },
    });
    if (
      created.operation.state !== "applied" ||
      created.operation.result?.kind !== "account"
    )
      throw new Error("Expected an applied native NVIDIA account receipt");
    const account = created.operation.result;
    const request = {
      ownerRef: owner.ownerRef,
      accountRef: account.accountRef,
      profileId: profile.profileId,
      expectedAuthorizationEpoch: account.authorizationEpoch,
    };
    expect(await control.readAccountModelsV2(request)).toMatchObject({
      status: "snapshot",
      profileId: profile.profileId,
      sourceId: profile.profileId,
      admission: { unavailableFallback: "deny" },
      models: [{ modelId: "nvidia/nemotron-3.5-super-vl-120b-a12b" }],
    });
    const stats = () =>
      fetch(`${url}/__subscription-fixture`).then((response) =>
        response.json(),
      );
    const before = await stats();
    expect(before.nvidiaModelReads).toEqual([{ forceRefresh: false }]);
    for (const changed of [
      { ownerRef: "foreign-owner" },
      { profileId: "foreign-profile" },
      { expectedAuthorizationEpoch: account.authorizationEpoch + 1 },
    ])
      await expect(
        control.readAccountModelsV2({
          ...request,
          ...changed,
          forceRefresh: true,
        }),
      ).rejects.toThrow();
    expect(await stats()).toEqual(before);
    expect(
      await control.readAccountModelsV2({ ...request, forceRefresh: true }),
    ).toMatchObject({ status: "snapshot" });
    expect((await stats()).nvidiaModelReads).toEqual([
      { forceRefresh: false },
      { forceRefresh: true },
    ]);
  });
});
