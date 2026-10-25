import { afterEach, expect, test, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  PrismaProviderAccountRepository,
  type BindingSelection,
} from "@reviewrouter/features-provider-accounts";
import type * as c from "@agent-teams/account-gateway/contracts";
import { createGatewayModelAccountOptions } from "./gateway-model-account-options";

afterEach(() => vi.restoreAllMocks());
const setting = (modelId: string): c.AccountModelCapability => ({
  modelId,
  reasoning: {
    allowed: ["minimal", "high"],
    default: "high",
  },
  fast: { allowed: ["balanced"], default: "balanced" },
  tools: { allowed: ["function"], default: "function" },
});
const snapshot = (models: string[]): c.AccountModels => ({
  status: "snapshot",
  physicalGeneration: "generation-private",
  principalVersion: "principal-private",
  source: "codex",
  fetchedAt: "2026-10-25T10:00:00.000Z",
  expiresAt: "2026-10-25T10:05:00.000Z",
  models: models.map(setting),
});
function fixture() {
  let authorized = true;
  let revision = 1;
  let duringModels: (() => void) | undefined;
  let response = snapshot(["new-authorized-model"]);
  vi.spyOn(
    PrismaProviderAccountRepository.prototype,
    "findBinding",
  ).mockImplementation(
    async ({ bindingId }) =>
      ({
        binding: {
          id: bindingId,
          connectionId: "connection-private",
          workspaceId: "workspace",
          state: "active",
          revision,
          policyRevision: 1,
          pendingFence: null,
          fenceAck: null,
        },
        connection: {
          id: "connection-private",
          owner: { kind: "workspace", workspaceId: "workspace" },
          gatewayAccountRef: "account-private",
          gatewayOperationRef: null,
          profileRef: "openai-codex-oauth-responses-v1",
          displayName: "Account",
          state: "active",
          metadataRevision: 1,
        },
      }) satisfies BindingSelection,
  );
  const readAccountModels = vi.fn(async () => {
    duringModels?.();
    return response;
  });
  const get = vi.fn(
    async (): Promise<c.Account> => ({
      accountRef: "account-private",
      ownerRef: "owner-private",
      profileId: "openai-codex-oauth-responses-v1",
      displayName: "Account",
      state: "active",
      metadataRevision: 1,
      authorizationEpoch: 7,
    }),
  );
  const prisma = {
    workspace: {
      findUnique: async () =>
        authorized
          ? {
              personalOwnerUserId: null,
              deletionState: "active",
              members: [{ role: "member" }],
            }
          : null,
    },
    $queryRaw: async () => [{ id: "binding" }],
  } as unknown as PrismaClient;
  const api = createGatewayModelAccountOptions({
    prisma,
    env: {},
    profiles: [
      {
        id: "openai-codex-oauth-responses-v1",
        label: "Codex",
        protocol: "openai-responses",
        provider: "codex",
        authKind: "oauth",
        models: ["old-seed"],
      },
    ],
    gateway: { get, readAccountModels },
    ownerRef: () => "owner-private",
    authorizeWorkspace: async () => ({
      workspaceId: "workspace",
      actor: { userId: "viewer" },
    }),
  });
  return {
    api,
    get,
    readAccountModels,
    respond: (value: c.AccountModels) => {
      response = value;
    },
    revoke: () => {
      duringModels = () => {
        authorized = false;
      };
    },
    changeBinding: () => {
      duringModels = () => {
        revision += 1;
      };
    },
  };
}

// RED if first paint discovers all account catalogs, a seed replaces an empty
// snapshot, private identities escape, or a model from another source probes.
test("discovers only selected account models and uses the same capabilities for probes", async () => {
  const f = fixture();
  const page = await f.api.list();
  expect(page.status).toBe("ok");
  expect(f.readAccountModels).not.toHaveBeenCalled();
  const result = await f.api.get("binding", { forceRefresh: true });
  expect(f.readAccountModels).toHaveBeenCalledWith({
    ownerRef: "owner-private",
    accountRef: "account-private",
    profileId: "openai-codex-oauth-responses-v1",
    expectedAuthorizationEpoch: 7,
    forceRefresh: true,
  });
  expect(result).toMatchObject({
    status: "ok",
    value: {
      profile: { models: ["new-authorized-model"] },
      account: {
        modelCatalog: {
          status: "snapshot",
          source: "codex",
          models: ["new-authorized-model"],
        },
        connection: { modelSettings: [setting("new-authorized-model")] },
      },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /generation-private|principal-private|owner-private|account-private/,
  );
  await expect(
    f.api.resolveProbe("binding", "new-authorized-model"),
  ).resolves.toMatchObject({ bindingId: "binding" });
  await expect(f.api.resolveProbe("binding", "old-seed")).rejects.toMatchObject(
    { code: "binding_unavailable" },
  );
  f.respond(snapshot([]));
  expect(await f.api.get("binding")).toMatchObject({
    status: "ok",
    value: {
      profile: { models: [] },
      account: {
        modelCatalog: { models: [] },
        connection: { modelSettings: [] },
      },
    },
  });
  f.respond({ status: "unavailable" });
  expect(await f.api.get("binding")).toMatchObject({
    status: "ok",
    value: {
      account: {
        modelCatalog: {
          status: "unavailable",
          source: "legacy_profile",
          models: ["old-seed"],
        },
      },
    },
  });
  await expect(
    f.api.resolveProbe("binding", "old-seed"),
  ).resolves.toMatchObject({ bindingId: "binding" });
  for (const status of ["unknown", "unsupported"] as const) {
    f.respond({ status });
    expect(await f.api.get("binding")).toMatchObject({
      status: "ok",
      value: {
        profile: { models: [] },
        account: { modelCatalog: { status, models: [] } },
      },
    });
    await expect(
      f.api.resolveProbe("binding", "old-seed"),
    ).rejects.toMatchObject({ code: "binding_unavailable" });
  }
});

test.each(["revoke", "changeBinding"] as const)(
  "discards discovery when authority changes during the await: %s",
  async (change) => {
    const f = fixture();
    f[change]();
    expect(await f.api.get("binding")).toEqual({ status: "denied" });
  },
);

// The consumer's contract parse must not turn invalid capabilities into the
// explicit unavailable/anchor fallback.
test.each(["duplicate", "oversize"] as const)(
  "rejects invalid catalog bounds without seed admission: %s",
  async (mode) => {
    const f = fixture();
    f.respond(
      snapshot(
        mode === "duplicate"
          ? ["same", "same"]
          : Array.from({ length: 129 }, (_, index) => `model-${index}`),
      ),
    );
    expect(await f.api.get("binding")).toMatchObject({
      status: "ok",
      value: {
        profile: { models: [] },
        account: { modelCatalog: { status: "unknown", models: [] } },
      },
    });
    await expect(
      f.api.resolveProbe("binding", "old-seed"),
    ).rejects.toMatchObject({ code: "binding_unavailable" });
  },
);
