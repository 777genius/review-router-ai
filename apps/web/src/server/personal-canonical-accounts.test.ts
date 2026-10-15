import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderAccountError,
  type PersonalAccountOperationStore,
  type ProviderAccountConnection,
} from "@reviewrouter/features-provider-accounts";
import {
  personalOperationId,
  type PersonalCanonicalIntent,
  type PersonalCanonicalOperationStore,
  type PersonalCanonicalReceipt,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { createPersonalCanonicalAccounts } from "./personal-canonical-accounts";

const nonce = "9874b2bc-e987-4456-9212-7f94f58932da";
function fixture() {
  let actor = "user-u",
    acknowledged = false,
    showApplied = false;
  let source: ProviderAccountConnection = {
    id: "own-source",
    owner: { kind: "user", userId: actor },
    gatewayAccountRef: "private-account",
    gatewayOperationRef: null,
    profileRef: "profile-mimo",
    displayName: "Personal",
    state: "active",
    metadataRevision: 10,
    authorizationEpochMirror: 4,
    pendingSourceOperationId: null,
  };
  let account = {
    accountRef: source.gatewayAccountRef,
    ownerRef: `rru_${createHash("sha256").update(`rr-user-owner-v1\0${actor}`).digest("hex")}`,
    profileId: "profile-mimo",
    displayName: "Personal",
    state: "active" as const,
    metadataRevision: 23,
    authorizationEpoch: 4,
  };
  let operation: PersonalCanonicalReceipt | undefined;
  let claimSequence = 0;
  const intents: PersonalCanonicalIntent[] = [];
  const read = async () => {
    if (!operation) throw new ProviderAccountError("not_found");
    return { ...operation, source: { ...source } };
  };
  const canonical: PersonalCanonicalOperationStore = {
    findOwnedSource: async () => ({ ...source }),
    read,
    reserve: async (intent) => {
      intents.push(intent);
      source = {
        ...source,
        state: "pending",
        metadataRevision: 11,
        pendingSourceOperationId: personalOperationId(
          intent.actorUserId,
          intent.clientOperationId,
        ),
      };
      operation = {
        id: source.pendingSourceOperationId!,
        intent,
        phase: "fencing",
        source,
      };
      return read();
    },
    listFences: async () =>
      acknowledged
        ? []
        : [
            {
              bindingId: "exact-binding",
              workspaceId: "org-x",
              operationId: "late-role-fence",
              policySubject: "exact-binding",
              policyRevision: 2,
            },
          ],
    ready: async () => {
      if (operation?.phase === "fencing" && acknowledged)
        operation = { ...operation, phase: "ready" };
      return read();
    },
    claim: async () => {
      if (operation?.phase !== "ready" || !acknowledged) return null;
      operation = { ...operation, phase: "submitted" };
      return { claimToken: String(++claimSequence) };
    },
    releaseUnenteredClaim: async (_user, _nonce, token) => {
      if (token !== String(claimSequence) || operation?.phase !== "submitted")
        return false;
      operation = { ...operation, phase: "fencing" };
      return true;
    },
    notePhase: async (_user, _nonce, phase) => {
      if (operation) operation = { ...operation, phase };
    },
    finalize: async (_user, _nonce, value) => {
      source = {
        ...source,
        state: "active",
        metadataRevision: 12,
        authorizationEpochMirror: value.authorizationEpoch,
        pendingSourceOperationId: null,
        gatewayOperationRef: operation!.id,
      };
      operation = { ...operation!, phase: "applied", source };
      return read();
    },
  };
  const store = {
    findOwnedSource: vi.fn(async (user: string, id: string) => {
      if (user !== "user-u" || id !== source.id)
        throw new ProviderAccountError("not_found");
      return { ...source };
    }),
    resolvePersonalWorkspace: async () => "personal-u",
    readOperation: async () => ({
      ...(await read()),
      binding: null,
      available: false,
    }),
  } as unknown as PersonalAccountOperationStore;
  const control = {
    profiles: vi.fn(async () => ({
      profiles: [
        {
          profileId: "profile-mimo",
          protocol: "openai-responses" as const,
          modelIds: ["qualified-model"],
          authKinds: ["api_key" as const],
        },
        {
          profileId: "profile-oauth",
          protocol: "openai-responses" as const,
          modelIds: ["oauth-model"],
          authKinds: ["oauth" as const],
        },
      ],
    })),
    get: vi.fn(async () => ({ ...account })),
    operation: vi.fn(async (id: string) =>
      showApplied
        ? {
            operationRef: id,
            state: "applied" as const,
            result: {
              kind: "account" as const,
              accountRef: account.accountRef,
              metadataRevision: account.metadataRevision,
              authorizationEpoch: account.authorizationEpoch,
            },
          }
        : { operationRef: id, state: "unknown" as const },
    ),
    reconnect: vi.fn(async () => {
      expect(acknowledged).toBe(true);
      expect(operation?.phase).toBe("submitted");
      account = { ...account, metadataRevision: 24, authorizationEpoch: 5 };
      throw new Error("synthetic_lost_ack_secret_diagnostic");
    }),
    rename: vi.fn(async () => ({
      operationRef: "rename",
      state: "pending" as const,
    })),
    disable: vi.fn(async () => ({
      operationRef: "retire",
      state: "pending" as const,
    })),
  };
  const delegate = {
    list: vi.fn(async () => ({
      sources: [
        {
          sourceId: source.id,
          label: source.displayName,
          profileId: source.profileRef,
          state: source.state,
          metadataRevision: source.metadataRevision,
          sourceOperationPending: Boolean(source.pendingSourceOperationId),
        },
      ],
      nextCursor: null,
    })),
    connect: vi.fn<
      (
        request: { nonce: string; profileId: string; label: string },
        credential?: string,
      ) => Promise<{
        operation: {
          operationId: string;
          phase: "submitted";
          sourceId: null;
          bindingId: null;
          available: false;
          state: "pending";
        };
        authorizationURL?: string;
      }>
    >(async (request) => ({
      operation: {
        operationId: "connect",
        phase: "submitted" as const,
        sourceId: null,
        bindingId: null,
        available: false,
        state: "pending" as const,
      },
      ...(request.profileId === "profile-oauth"
        ? { authorizationURL: "https://auth.example.test/one-off-secret" }
        : {}),
    })),
    operation: vi.fn(async () => ({
      operationId: "connect",
      phase: "submitted" as "submitted" | "unknown",
      sourceId: null,
      bindingId: null,
      available: false,
      state: "pending" as const,
    })),
    completeOAuth: vi.fn(async () => ({
      operationId: "connect",
      phase: "submitted" as const,
      sourceId: null,
      bindingId: null,
      available: false,
      state: "pending" as const,
    })),
  };
  const deliverFences = vi.fn(async () => {});
  const api = createPersonalCanonicalAccounts({
    authorizeUser: async () => actor,
    store,
    canonical,
    control,
    profiles: [
      {
        id: "profile-mimo",
        label: "MiMo",
        authKind: "api_key",
        canReconnect: true,
      },
      {
        id: "profile-oauth",
        label: "Codex",
        authKind: "oauth",
        canReconnect: true,
      },
    ],
    personalAdapterFactory: () => delegate,
    deliverFences,
  });
  const request = {
    kind: "reconnect" as const,
    nonce,
    connectionId: source.id,
    mirrorRevision: 10,
    gatewayRevision: 999,
  };
  return {
    api,
    request,
    control,
    store,
    delegate,
    intents,
    deliverFences,
    ack: () => {
      acknowledged = true;
    },
    newFence: () => {
      acknowledged = false;
    },
    reveal: () => {
      showApplied = true;
    },
    changeActor: () => {
      actor = "user-v";
    },
    pendingSource: () => {
      source = {
        ...source,
        state: "pending",
        pendingSourceOperationId: "existing-pending",
      };
    },
    foreignGateway: () => {
      account = { ...account, ownerRef: "foreign-owner" };
    },
  };
}

describe("personal canonical UI server boundary", () => {
  it.each(["api_key", "oauth"] as const)(
    "recovers an original %s connect nonce before catalog discovery without replay",
    async (authKind) => {
      const f = fixture();
      const profileId =
        authKind === "api_key" ? "profile-mimo" : "profile-oauth";
      const label = "Original personal label";
      const original = {
        id: "original-connect",
        intent: {
          action: "connect" as const,
          actorUserId: "user-u",
          personalWorkspaceId: "personal-u",
          clientOperationId: nonce,
          proposedSourceId: "original-source",
          profileId,
          displayName: label,
          ingress:
            authKind === "api_key"
              ? ("api-key-create" as const)
              : ("oauth-begin" as const),
        },
        phase: "unknown" as const,
        source: null,
        binding: null,
        available: false,
      };
      vi.spyOn(f.store, "readOperation").mockResolvedValue(original);
      f.control.profiles.mockRejectedValue(new Error("catalog_outage"));
      f.delegate.operation.mockResolvedValue({
        operationId: "original-connect",
        phase: "unknown",
        sourceId: null,
        bindingId: null,
        available: false,
        state: "pending",
      });
      const submit = (request: {
        nonce: string;
        profileId: string;
        label?: string;
      }) =>
        authKind === "api_key"
          ? f.api.submitGatewayApiKey(
              "forged-context",
              { kind: "connect", ...request },
              "discarded-retry-secret",
            )
          : f.api.beginGatewayOAuth("forged-context", request);
      const receipt = { nonce, state: "unknown", cleanup: "unresolved" };
      expect(await submit({ nonce, profileId })).toEqual({
        status: "ok",
        value: authKind === "oauth" ? { operation: receipt } : receipt,
      });
      expect(
        await submit({ nonce, profileId, label: "Changed payload" }),
      ).toEqual({ status: "conflict" });
      expect(
        await submit({ nonce, profileId: "changed-profile", label }),
      ).toEqual({ status: "conflict" });
      expect(f.delegate.operation).toHaveBeenCalledTimes(1);
      expect(f.delegate.connect).not.toHaveBeenCalled();
      expect(f.control.profiles).not.toHaveBeenCalled();
      expect(f.control.get).not.toHaveBeenCalled();
      expect(JSON.stringify(original)).not.toContain("discarded-retry-secret");
    },
  );

  it("preserves original nonce/counters through delayed fences, secret reentry and lost ACK without replay", async () => {
    const f = fixture();
    const pending = await f.api.submitGatewayApiKey(
      "forged-org-context",
      f.request,
      "first-discarded-key",
    );
    expect(pending).toEqual({
      status: "ok",
      value: { nonce, state: "pending", cleanup: "unresolved" },
    });
    expect(f.control.reconnect).not.toHaveBeenCalled();
    expect(f.intents[0]).toMatchObject({
      actorUserId: "user-u",
      expectedSourceMetadataRevision: 10,
      expectedGatewayRevision: 23,
      expectedAuthorizationEpoch: 4,
    });
    f.ack();
    expect(
      await f.api.readGatewayOperation("any-display-context", nonce),
    ).toEqual({
      status: "ok",
      value: {
        nonce,
        state: "pending",
        cleanup: "unresolved",
        resume: {
          kind: "reconnect",
          connectionId: "own-source",
          profileId: "profile-mimo",
          gatewayRevision: 23,
          mirrorRevision: 10,
        },
      },
    });
    f.newFence();
    const deliveries = f.deliverFences.mock.calls.length;
    expect(await f.api.readGatewayOperation("", nonce)).toEqual({
      status: "ok",
      value: { nonce, state: "pending", cleanup: "unresolved" },
    });
    expect(f.deliverFences.mock.calls.length).toBe(deliveries + 1);
    f.ack();
    await Promise.all([
      f.api.submitGatewayApiKey("", f.request, "one-off-winning-key"),
      f.api.submitGatewayApiKey("", f.request, "must-never-reenter-key"),
    ]);
    expect(f.control.reconnect).toHaveBeenCalledTimes(1);
    expect(f.control.reconnect).toHaveBeenCalledWith("private-account", {
      operationId: personalOperationId("user-u", nonce),
      expectedMetadataRevision: 23,
      credential: { kind: "api_key", value: "one-off-winning-key" },
    });
    expect(await f.api.readGatewayOperation("", nonce)).toEqual({
      status: "ok",
      value: { nonce, state: "unknown", cleanup: "unresolved" },
    });
    f.reveal();
    expect(f.control.profiles).not.toHaveBeenCalled();
    f.control.profiles.mockRejectedValue(new Error("catalog_outage"));
    expect(await f.api.readGatewayOperation("", nonce)).toEqual({
      status: "ok",
      value: { nonce, state: "applied", cleanup: "unresolved" },
    });
    const gets = f.control.get.mock.calls.length;
    expect(
      (await f.api.submitGatewayApiKey("", f.request, "discarded-retry-key"))
        .status,
    ).toBe("ok");
    expect(f.control.get.mock.calls).toHaveLength(gets);
    expect(f.control.reconnect).toHaveBeenCalledTimes(1);
    expect(
      await f.api.mutateGatewayAccount("", {
        ...f.request,
        kind: "rename",
        label: "Changed payload",
      }),
    ).toEqual({ status: "conflict" });
    expect(JSON.stringify(f.intents)).not.toMatch(/key|credential|secret/);
  });

  it("rechecks the stable session after fence delivery and exposes only safe uncertainty after reservation", async () => {
    const f = fixture();
    f.deliverFences.mockImplementation(async () => {
      f.changeActor();
    });
    const result = await f.api.submitGatewayApiKey(
      "user-u.fake-authority",
      f.request,
      "never-enter-key",
    );
    expect(result).toEqual({
      status: "ok",
      value: { nonce, state: "unknown", cleanup: "unresolved" },
    });
    expect(f.control.reconnect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /private-account|user-u|ownerRef|profileId|key/,
    );
  });

  it("returns only verified own configured rows and never makes pending sources manageable", async () => {
    const f = fixture();
    const result = await f.api.listGatewayAccounts("untrusted-context", null);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected list");
    expect(result.value.accounts[0]).toMatchObject({
      connectionId: "own-source",
      gatewayRevision: 23,
      mirrorRevision: 10,
      canManage: true,
      binding: null,
    });
    expect(result.value.profiles[0]?.models).toEqual(["qualified-model"]);
    expect(result.value.profiles[1]?.canReconnect).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /private-account|ownerRef|authorizationEpoch/,
    );
    f.pendingSource();
    const pending = await f.api.listGatewayAccounts("", null);
    expect(
      pending.status === "ok" && pending.value.accounts[0]?.canManage,
    ).toBe(false);
    f.foreignGateway();
    const foreign = await f.api.listGatewayAccounts("", null);
    expect(foreign.status === "ok" && foreign.value.accounts).toEqual([]);
  });

  it("delegates fresh OAuth/callback only and keeps auth URLs outside ordinary readback", async () => {
    const f = fixture();
    const begin = await f.api.beginGatewayOAuth("ignored", {
      nonce,
      profileId: "profile-oauth",
      label: "Own Codex",
    });
    expect(begin).toEqual({
      status: "ok",
      value: {
        operation: { nonce, state: "pending", cleanup: "unresolved" },
        authorizationURL: "https://auth.example.test/one-off-secret",
      },
    });
    expect(f.delegate.connect).toHaveBeenCalledWith(
      { nonce, profileId: "profile-oauth", label: "Own Codex" },
      undefined,
    );
    expect(
      await f.api.beginGatewayOAuth("", {
        nonce,
        connectionId: "own-source",
        gatewayRevision: 23,
        mirrorRevision: 10,
      }),
    ).toEqual({ status: "invalid" });
    const callbackURL =
      "http://localhost:1455/auth/callback?code=synthetic-code&state=" +
      "b".repeat(64);
    await f.api.completeGatewayOAuth("ignored", { nonce, callbackURL });
    expect(f.delegate.completeOAuth).toHaveBeenCalledWith({
      nonce,
      callbackURL,
    });
    expect(JSON.stringify(f.intents)).not.toMatch(
      /synthetic-code|one-off-secret|callbackURL/,
    );
  });
});
