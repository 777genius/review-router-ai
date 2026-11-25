import { createManagementClient } from "@agent-teams/account-gateway/http";
import { expect, it } from "vitest";
import {
  VISUAL_NATIVE_DOCUMENT,
  VISUAL_NATIVE_PROFILE,
  VISUAL_NATIVE_SECRET,
} from "./native-catalog-fixture.js";
import { startGatewayCatalogFixture } from "./gateway-catalog-fixture.js";

it("serves native models and metadata only for the current enrolled authority", async () => {
  const fixture = await startGatewayCatalogFixture({
    credentialImports: true,
    accountMetadata: true,
  });
  const origin =
    fixture.environment.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? "";
  const token =
    fixture.environment.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? "";
  const client = createManagementClient({ role: "management", origin, token });
  const post = (path: string, body: unknown) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const ownerRef = "visual-native-model-owner";
  const connection = {
    profileId: VISUAL_NATIVE_PROFILE,
    methodId: "structured",
    methodRevision: 1,
    configurationGeneration: "visual-native-generation-1",
  };
  const inputFields = {
    project: "visual-project",
    region: "eu",
    document: VISUAL_NATIVE_DOCUMENT,
    secret: VISUAL_NATIVE_SECRET,
  };
  try {
    const enrolled = await post("/v3/accounts/connections/begin", {
      operationId: "10000000-0000-4000-8000-000000000001",
      ownerRef,
      displayName: "Native models fixture",
      connection,
      inputFields,
    });
    expect(enrolled.status).toBe(200);
    await enrolled.arrayBuffer();
    const [account] = fixture.nativeOperations.accounts();
    if (!account) throw new Error("native enrollment did not create an account");
    const request = {
      ownerRef,
      accountRef: account.accountRef,
      profileId: VISUAL_NATIVE_PROFILE,
      expectedAuthorizationEpoch: 1,
    };
    const original = await client.readAccountModelsV2(request);
    expect(original).toMatchObject({
      status: "snapshot",
      sourceId: "visual-new-provider",
      profileId: "visual-native-identity-v1",
      admission: { unavailableFallback: "qualified_anchor" },
      models: [
        {
          modelId: "visual-native-model",
          reasoning: null,
          fast: null,
          tools: { allowed: ["function"], default: "function" },
        },
      ],
    });
    if (original.status !== "snapshot")
      throw new Error("native model snapshot was not returned");
    const reconnected = await post(
      `/v3/accounts/${account.accountRef}/connections/reconnect`,
      {
        operationId: "10000000-0000-4000-8000-000000000002",
        ownerRef,
        expectedMetadataRevision: 1,
        connection,
        inputFields,
      },
    );
    expect(reconnected.status).toBe(200);
    await reconnected.arrayBuffer();
    const effects = fixture.nativeOperations.evidence();
    const current = { ...request, expectedAuthorizationEpoch: 2 };
    const refreshed = await client.readAccountModelsV2({
      ...current,
      forceRefresh: true,
    });
    expect(refreshed).toMatchObject({
      status: "snapshot",
      sourceId: "visual-new-provider",
      profileId: "visual-native-identity-v1",
      admission: { unavailableFallback: "qualified_anchor" },
      models: original.models,
    });
    if (refreshed.status !== "snapshot")
      throw new Error("reconnected model snapshot was not returned");
    expect(refreshed.physicalGeneration).not.toBe(original.physicalGeneration);
    expect(refreshed.principalVersion).not.toBe(original.principalVersion);
    for (const rejected of [
      request,
      { ...current, ownerRef: "another-owner" },
      { ...current, profileId: "another-profile" },
      { ...current, accountRef: "missing-account" },
    ]) {
      const response = await post("/v2/account-models/read", rejected);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "binding_unavailable" });
    }
    const malformed = await post("/v2/account-models/read", {
      ...current,
      unexpected: true,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_models_request" });
    const legacy = await post("/v1/account-models/read", current);
    expect(legacy.status).toBe(404);
    await legacy.arrayBuffer();
    expect(
      await client.readAccountInfoV2({
        ownerRef,
        accountRefs: [account.accountRef],
      }),
    ).toEqual({
      contract: "account-info/v2",
      accounts: [
        {
          accountRef: account.accountRef,
          metadataRevision: 2,
          authorizationEpoch: 2,
          info: { status: "unsupported" },
        },
      ],
    });
    for (const rejected of [
      { ownerRef: "another-owner", accountRefs: [account.accountRef] },
      { ownerRef, accountRefs: [account.accountRef, "missing-account"] },
    ]) {
      const response = await post("/v2/account-info/read", rejected);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "account_unavailable" });
    }
    expect(fixture.nativeOperations.evidence()).toEqual(effects);
  } finally {
    await fixture.stop();
  }
});
