import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  createConsumerControlClient,
  createManagementClient,
} from "@agent-teams/account-gateway/http";
import { accountModelDiscoverySource } from "@agent-teams/account-gateway/contracts";
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
        expect(entry.accountInfo).toBe(false);
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
