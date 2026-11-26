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
import type { createDisabledPersonalAccountsAdapter } from "./account-gateway-accounts";
type ConnectReceipt = Awaited<
  ReturnType<
    ReturnType<typeof createDisabledPersonalAccountsAdapter>["operation"]
  >
>;

const nonce = "9874b2bc-e987-4456-9212-7f94f58932da";
function fixture(
  options: {
    lifecycleWritable?: boolean;
    grok?: boolean;
    codexImports?: boolean;
    disabled?: boolean;
    nvidia?: "qualified" | "unqualified";
    nativeApi?: boolean;
    lazyCatalogue?: boolean;
  } = {},
) {
  const grokProfileId = options.codexImports
    ? "openai-codex-oauth-responses-v1"
    : "grok-subscription-responses-oauth-v1";
  const oauth = options.grok || options.codexImports;
  const apiProfileId = options.nativeApi
    ? "gemini-openai-chat-apikey-v1"
    : "profile-mimo";
  const nvidiaProfileId = "nvidia-build-chat-apikey-v1";
  let oauthBegun = false;
  let actor = "user-u",
    acknowledged = false,
    showApplied = false;
  let source: ProviderAccountConnection = {
    id: "own-source",
    owner: { kind: "user", userId: actor },
    gatewayAccountRef: "private-account",
    gatewayOperationRef: null,
    profileRef: options.nvidia
      ? nvidiaProfileId
      : oauth
        ? grokProfileId
        : apiProfileId,
    displayName: "Personal",
    state: "active",
    metadataRevision: 10,
    authorizationEpochMirror: 4,
    pendingSourceOperationId: null,
  };
  let account = {
    accountRef: source.gatewayAccountRef,
    ownerRef: `rru_${createHash("sha256").update(`rr-user-owner-v1\0${actor}`).digest("hex")}`,
    profileId: options.nvidia
      ? nvidiaProfileId
      : oauth
        ? grokProfileId
        : apiProfileId,
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
        ...(oauth
          ? [
              {
                profileId: grokProfileId,
                protocol: "openai-responses" as const,
                modelIds: ["grok-4.3"],
                authKinds: ["oauth" as const],
              },
            ]
          : []),
        ...(options.nvidia
          ? [
              {
                profileId: nvidiaProfileId,
                protocol: "openai-responses" as const,
                modelIds: ["nvidia/nemotron-3.5-super-vl-120b-a12b"],
                authKinds: ["api_key" as const],
              },
            ]
          : []),
        {
          profileId: apiProfileId,
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
        : oauthBegun
          ? {
              operationRef: id,
              state: "pending" as const,
              oauthMethod: "browser" as const,
            }
          : { operationRef: id, state: "unknown" as const },
    ),
    beginOAuthReconnect: vi.fn(
      async (_ref: string, request: { operationId: string }) => {
        expect(acknowledged).toBe(true);
        expect(operation?.phase).toBe("submitted");
        oauthBegun = true;
        return {
          operation: {
            operationRef: request.operationId,
            state: "pending" as const,
            oauthMethod: "browser" as const,
          },
          authorizationURL:
            "https://auth.x.ai/oauth2/authorize?one-off-handoff",
        };
      },
    ),
    completeOAuth: vi.fn(async (request: { operationId: string }) => {
      account = { ...account, metadataRevision: 24, authorizationEpoch: 5 };
      showApplied = true;
      return {
        operationRef: request.operationId,
        state: "applied" as const,
        result: {
          kind: "account" as const,
          accountRef: account.accountRef,
          metadataRevision: 24,
          authorizationEpoch: 5,
        },
      };
    }),
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
        request: {
          nonce: string;
          profileId: string;
          label: string;
          method?: "device_code" | "browser";
        },
        credential?: string,
      ) => Promise<{
        operation: ConnectReceipt;
        authorizationURL?: string;
        deviceAuthorization?: {
          userCode: string;
          verificationURL: "https://auth.openai.com/codex/device";
          expiresAt: string;
          intervalSeconds: number;
        };
      }>
    >(async (request) => ({
      operation: {
        operationId: "connect",
        phase: "submitted" as const,
        sourceId: null,
        bindingId: null,
        available: false,
        state: "pending" as const,
        ...(request.method === "device_code"
          ? { oauthMethod: "device_code" as const }
          : {}),
      },
      ...(request.profileId === "profile-oauth"
        ? request.method === "device_code"
          ? {
              deviceAuthorization: {
                userCode: "ABCD-EFGH",
                verificationURL: "https://auth.openai.com/codex/device",
                expiresAt: "2099-01-01T00:00:00Z",
                intervalSeconds: 5,
              },
            }
          : { authorizationURL: "https://auth.example.test/one-off-secret" }
        : {}),
    })),
    operation: vi.fn<() => Promise<ConnectReceipt>>(async () => ({
      operationId: "connect",
      phase: "submitted" as "submitted" | "unknown",
      sourceId: null,
      bindingId: null,
      available: false,
      state: "pending" as const,
    })),
    pollOAuth: vi.fn<() => Promise<ConnectReceipt>>(async () => ({
      operationId: "connect",
      phase: "submitted" as const,
      sourceId: null,
      bindingId: null,
      available: false,
      state: "pending" as const,
      oauthMethod: "device_code" as const,
    })),
    completeOAuth: vi.fn<() => Promise<ConnectReceipt>>(async () => ({
      operationId: "connect",
      phase: "submitted" as const,
      sourceId: null,
      bindingId: null,
      available: false,
      state: "pending" as const,
    })),
  };
  const deliverFences = vi.fn(async () => {});
  const personalAdapterFactory = vi.fn<
    Parameters<
      typeof createPersonalCanonicalAccounts
    >[0]["personalAdapterFactory"]
  >(() => delegate);
  const input: Parameters<typeof createPersonalCanonicalAccounts>[0] = {
    authorizeUser: async () => actor,
    ...(options.lifecycleWritable
      ? {
          lifecycleReader: {
            get: async () => ({ ...account }),
            compatible: async () => true,
            writable: async () => true,
          },
        }
      : {}),
    store,
    canonical,
    control,
    profiles: [
      ...(options.nvidia
        ? [
            {
              id: nvidiaProfileId,
              label: "NVIDIA Build",
              provider: "nvidia" as const,
              authKind: "api_key" as const,
              canReconnect: true,
              ...(options.nvidia === "qualified"
                ? {
                    availability: "enabled" as const,
                    connection: {
                      provider: "nvidia" as const,
                      planLabel: "Trial",
                      regionLabel: "Global",
                      completionInputKind: "none" as const,
                      limitsContract: "none" as const,
                      modelSettings: [],
                    },
                  }
                : {}),
            },
          ]
        : []),
      ...(oauth
        ? [
            {
              id: grokProfileId,
              availability: options.disabled
                ? ("deployment_configuration_required" as const)
                : ("enabled" as const),
              label: "Grok",
              authKind: "oauth" as const,
              canReconnect: true,
              oauthMethods: ["browser"] as const,
              connection: {
                provider: options.codexImports
                  ? ("openai" as const)
                  : ("grok" as const),
                ...(options.codexImports
                  ? {
                      methods: [
                        {
                          kind: "browser" as const,
                          create: true,
                          reconnect: false,
                        },
                        {
                          kind: "credential_import" as const,
                          method: "refresh_token" as const,
                          maxBytes: 65536 as const,
                          create: true,
                          reconnect: true,
                        },
                        {
                          kind: "credential_import" as const,
                          method: "oauth_auth_json" as const,
                          maxBytes: 65536 as const,
                          create: true,
                          reconnect: false,
                        },
                      ],
                    }
                  : {}),
                planLabel: "Subscription",
                regionLabel: "Global",
                completionInputKind: "authorization_code" as const,
                limitsContract: "account-limits/v2" as const,
                modelSettings: [],
              },
            },
          ]
        : []),
      {
        id: apiProfileId,
        label: options.nativeApi ? "Gemini" : "MiMo",
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
    personalAdapterFactory,
    deliverFences,
  };
  const qualifiedProfiles = input.profiles.map((profile) => ({
    ...profile,
    protocol: "openai-responses" as const,
    models: ["qualified-model"],
  }));
  const catalogue = vi.fn(async () => qualifiedProfiles);
  const api = createPersonalCanonicalAccounts({
    ...input,
    profiles: options.lazyCatalogue
      ? input.profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          authKind: profile.authKind,
          ...(profile.oauthMethods
            ? { oauthMethods: profile.oauthMethods }
            : {}),
          availability: "deployment_configuration_required" as const,
          canReconnect: false,
        }))
      : input.profiles,
    ...(options.lazyCatalogue ? { catalogue } : {}),
  });
  const request = {
    kind: "reconnect" as const,
    nonce,
    connectionId: source.id,
    mirrorRevision: 10,
    gatewayRevision: 999,
  };
  return {
    input,
    api,
    canonical,
    request,
    control,
    store,
    delegate,
    catalogue,
    qualifiedProfiles,
    personalAdapterFactory,
    profileId: account.profileId,
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
    oauthIdentity: () => {
      source = {
        ...source,
        profileRef: "profile-oauth",
        displayName: "Codex Alice",
      };
      account = {
        ...account,
        profileId: "profile-oauth",
        displayName: "Codex Alice",
      };
    },
    foreignGateway: () => {
      account = { ...account, ownerRef: "foreign-owner" };
    },
  };
}

describe("personal canonical UI server boundary", () => {
  it.each([
    ["UUIDv1", "9874b2bc-e987-1456-9212-7f94f58932da", false],
    ["UUIDv7", "9874b2bc-e987-7456-9212-7f94f58932da", false],
    ["uppercase UUIDv4", nonce.toUpperCase(), false],
    ["lowercase UUIDv4", nonce, true],
  ] as const)(
    "keeps native begin and recovery on the same nonce contract (%s)",
    async (_kind, value, accepted) => {
      const f = fixture();
      const connection = {
        profileId: f.profileId,
        methodId: "browser",
        methodRevision: 1,
        configurationGeneration: "generation-1",
      };
      const read = vi.spyOn(f.store, "readOperation").mockResolvedValue({
        id: personalOperationId("user-u", value),
        intent: {
          action: "connect",
          actorUserId: "user-u",
          personalWorkspaceId: "personal-u",
          clientOperationId: value,
          proposedSourceId: "original-native-source",
          profileId: f.profileId,
          displayName: "Original native account",
          ingress: "native-begin",
          nativeConnection: { schemaVersion: 1, ...connection },
        },
        phase: "rejected",
        source: null,
        binding: null,
        available: false,
      });
      const operation = {
        nonce: value,
        state: "rejected",
        cleanup: "unresolved",
      };
      expect(
        await f.api.beginGatewayNativeConnection(
          "",
          { nonce: value, connection },
          {},
        ),
      ).toEqual(
        accepted
          ? { status: "ok", value: { operation } }
          : { status: "invalid" },
      );
      for (const result of [
        await f.api.readGatewayOperation("", value),
        await f.api.continueGatewayNativeConnection("", value),
      ])
        expect(result).toEqual(
          accepted ? { status: "ok", value: operation } : { status: "invalid" },
        );
      if (accepted) expect(read).toHaveBeenCalledWith("user-u", value);
      else expect(read).not.toHaveBeenCalled();
      expect(f.control.profiles).not.toHaveBeenCalled();
      expect(f.control.operation).not.toHaveBeenCalled();
      expect(f.delegate.connect).not.toHaveBeenCalled();
      expect(f.intents).toEqual([]);
    },
  );

  it.each(["api_key", "oauth", "unknown"] as const)(
    "preserves account %s identity when the native catalog has no auth kind",
    async (authKind) => {
      const f = fixture();
      const account = await f.control.get();
      const api = createPersonalCanonicalAccounts({
        ...f.input,
        lifecycleReader: {
          get: async () => ({ ...account, authKind }),
          compatible: async () => true,
          writable: async () => false,
        },
        catalogue: async () => [
          {
            id: f.profileId,
            label: "Native account",
            protocol: "openai-responses",
            models: [],
            connection: {
              provider: "mimo",
              planLabel: "Native plan",
              regionLabel: "Global",
              completionInputKind: "none",
              limitsContract: "none",
              modelSettings: [],
              nativeMethods: [],
            },
          },
        ],
      });
      const page = await api.listGatewayAccounts("", null);
      expect(page.status).toBe("ok");
      if (page.status !== "ok") throw new Error("expected account inventory");
      expect(page.value.accounts).toHaveLength(1);
      expect(page.value.accounts[0]?.authKind).toBe(
        authKind === "unknown" ? undefined : authKind,
      );
    },
  );

  it("denies fresh unqualified NVIDIA enrollment but preserves existing account lifecycle", async () => {
    const f = fixture({ nvidia: "unqualified" });
    expect(
      await f.api.submitGatewayApiKey(
        "",
        {
          kind: "connect",
          nonce,
          profileId: "nvidia-build-chat-apikey-v1",
          label: "Synthetic NVIDIA",
        },
        "synthetic-unqualified-key",
      ),
    ).toEqual({ status: "denied" });
    expect(f.delegate.connect).not.toHaveBeenCalled();
    const listed = await f.api.listGatewayAccounts("", null);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") throw new Error("expected existing account");
    expect(listed.value.accounts[0]?.profileId).toBe(
      "nvidia-build-chat-apikey-v1",
    );
    const reconnected = await f.api.submitGatewayApiKey(
      "",
      f.request,
      "synthetic-reconnect-key",
    );
    expect(reconnected.status).toBe("ok");
  });

  it("permits qualified NVIDIA fresh enrollment only through the existing Gateway account adapter", async () => {
    const f = fixture({ nvidia: "qualified" });
    const enrolled = await f.api.submitGatewayApiKey(
      "",
      {
        kind: "connect",
        nonce,
        profileId: "nvidia-build-chat-apikey-v1",
        label: "Synthetic NVIDIA",
      },
      "synthetic-qualified-key",
    );
    expect(enrolled.status).toBe("ok");
    expect(f.delegate.connect).toHaveBeenCalledOnce();
  });

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
      if (authKind === "oauth")
        expect(
          await f.api.beginGatewayOAuth("", {
            nonce,
            profileId,
            method: "device_code",
          }),
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

  it("advertises lifecycle actions by default with no feature flag configured", async () => {
    const f = fixture({ lifecycleWritable: true });
    const result = await f.api.listGatewayAccounts("", null);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected list");
    expect(result.value.accounts[0]).toMatchObject({
      connectionId: "own-source",
      lifecycle: { status: "available" },
      allowedActions: ["suspend", "delete"],
      authorizationEpoch: 4,
    });
  });

  const appliedConnectFixture = () => {
    const f = fixture();
    f.oauthIdentity();
    const result: ConnectReceipt = {
      operationId: "connect",
      phase: "applied",
      sourceId: "own-source",
      bindingId: null,
      available: true,
      state: "active",
      oauthMethod: "device_code",
    };
    vi.spyOn(f.store, "readOperation").mockResolvedValue({
      id: "connect",
      intent: {
        action: "connect",
        actorUserId: "user-u",
        personalWorkspaceId: "personal-u",
        clientOperationId: nonce,
        proposedSourceId: "own-source",
        profileId: "profile-oauth",
        displayName: "Codex Alice",
        ingress: "oauth-begin",
        method: "device_code",
      },
      phase: "applied",
      source: null,
      binding: null,
      available: true,
    });
    f.delegate.operation.mockResolvedValue(result);
    f.delegate.pollOAuth.mockResolvedValue(result);
    f.delegate.completeOAuth.mockResolvedValue(result);
    f.delegate.connect.mockResolvedValue({ operation: result });
    return f;
  };
  const callback = {
    nonce,
    callbackURL:
      "http://localhost:1455/auth/callback?code=synthetic-code&state=" +
      "b".repeat(64),
  };

  it.each(["read", "poll", "complete", "begin"] as const)(
    "projects the verified applied connection identity on %s",
    async (kind) => {
      const f = appliedConnectFixture();
      const response =
        kind === "read"
          ? await f.api.readGatewayOperation("", nonce)
          : kind === "poll"
            ? await f.api.pollGatewayOAuth("", nonce)
            : kind === "complete"
              ? await f.api.completeGatewayOAuth("", callback)
              : await f.api.beginGatewayOAuth("", {
                  nonce,
                  profileId: "profile-oauth",
                  method: "device_code",
                });
      expect(response.status).toBe("ok");
      if (response.status !== "ok") throw new Error("expected receipt");
      const receipt =
        "operation" in response.value
          ? response.value.operation
          : response.value;
      expect(receipt).toMatchObject({
        nonce,
        state: "applied",
        oauthMethod: "device_code",
        account: {
          connectionId: "own-source",
          label: "Codex Alice",
          profileId: "profile-oauth",
          profileLabel: "Codex",
          authKind: "oauth",
          origin: "personal",
          isOwnedByViewer: true,
        },
      });
      expect(f.store.findOwnedSource).toHaveBeenCalledWith(
        "user-u",
        "own-source",
      );
      expect(JSON.stringify(response)).not.toMatch(
        /private-account|ownerRef|synthetic-code/,
      );
    },
  );

  it("keeps an applied receipt when optional identity metadata is temporarily unavailable", async () => {
    const f = appliedConnectFixture();
    f.control.get.mockRejectedValue(new Error("metadata_outage"));
    expect(await f.api.pollGatewayOAuth("", nonce)).toEqual({
      status: "ok",
      value: {
        nonce,
        state: "applied",
        oauthMethod: "device_code",
        cleanup: "unresolved",
      },
    });
  });

  it("does not expose applied identity for a foreign account or a changed session", async () => {
    const f = appliedConnectFixture();
    f.foreignGateway();
    expect(await f.api.readGatewayOperation("", nonce)).toEqual({
      status: "denied",
    });
    const changed = appliedConnectFixture();
    changed.control.get.mockImplementationOnce(async () => {
      changed.changeActor();
      throw new Error("metadata_outage_after_session_change");
    });
    const result = await changed.api.pollGatewayOAuth("", nonce);
    expect(result).toEqual({
      status: "ok",
      value: { nonce, state: "unknown", cleanup: "unresolved" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Codex Alice|own-source|profile-oauth/,
    );
  });

  it("passes device handoff only from fresh enrollment and delegates original-nonce polling", async () => {
    const f = fixture();
    const begin = await f.api.beginGatewayOAuth("ignored", {
      nonce,
      profileId: "profile-oauth",
      label: "Own Codex",
      method: "device_code",
    });
    expect(begin).toMatchObject({
      status: "ok",
      value: {
        operation: { nonce, state: "pending", oauthMethod: "device_code" },
        deviceAuthorization: { userCode: "ABCD-EFGH" },
      },
    });
    expect(f.delegate.connect).toHaveBeenCalledWith(
      {
        nonce,
        profileId: "profile-oauth",
        label: "Own Codex",
        method: "device_code",
      },
      undefined,
    );
    const result = await f.api.pollGatewayOAuth("ignored", nonce);
    expect(result).toEqual({
      status: "ok",
      value: {
        nonce,
        state: "pending",
        oauthMethod: "device_code",
        cleanup: "unresolved",
      },
    });
    expect(f.delegate.pollOAuth).toHaveBeenCalledWith(nonce);
    expect(JSON.stringify(result)).not.toMatch(/ABCD-EFGH|deviceAuthorization/);
  });

  it("projects an uncertain device poll as unknown without creating another connection", async () => {
    const f = fixture();
    f.delegate.pollOAuth.mockResolvedValueOnce({
      operationId: "connect",
      phase: "unknown",
      sourceId: null,
      bindingId: null,
      available: false,
      state: "pending",
      oauthMethod: "device_code",
    });
    expect(await f.api.pollGatewayOAuth("ignored", nonce)).toEqual({
      status: "ok",
      value: {
        nonce,
        state: "unknown",
        oauthMethod: "device_code",
        cleanup: "unresolved",
      },
    });
    expect(f.delegate.connect).not.toHaveBeenCalled();
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
    vi.spyOn(f.store, "readOperation").mockResolvedValue({
      id: "connect",
      intent: {
        action: "connect",
        actorUserId: "user-u",
        personalWorkspaceId: "personal-u",
        clientOperationId: nonce,
        proposedSourceId: "own-source",
        profileId: "profile-oauth",
        displayName: "Own Codex",
        ingress: "oauth-begin",
        method: "browser",
      },
      phase: "submitted",
      source: null,
      binding: null,
      available: false,
    });
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

describe("qualified personal OAuth reconnect", () => {
  it.each(["authorization_code", "callback_url"] as const)(
    "fences once, restores saved Grok code presentation and completes %s without repeating begin",
    async (representation) => {
      const f = fixture({ grok: true });
      const request = {
        nonce,
        connectionId: "own-source",
        mirrorRevision: 10,
        gatewayRevision: 23,
        method: "browser" as const,
      };
      const pending = await f.api.beginGatewayOAuth("", request);
      expect(pending.status).toBe("ok");
      expect(f.control.beginOAuthReconnect).not.toHaveBeenCalled();
      f.ack();
      const begun = await f.api.beginGatewayOAuth("", request);
      expect(begun).toMatchObject({
        status: "ok",
        value: {
          operation: {
            completion: {
              providerLabel: "Grok",
              inputKind: "authorization_code",
            },
          },
          authorizationURL:
            "https://auth.x.ai/oauth2/authorize?one-off-handoff",
        },
      });
      expect(f.control.beginOAuthReconnect).toHaveBeenCalledTimes(1);
      const readback = await f.api.readGatewayOperation("", nonce);
      expect(readback).toMatchObject({
        status: "ok",
        value: {
          completion: {
            providerLabel: "Grok",
            inputKind: "authorization_code",
          },
        },
      });
      await f.api.beginGatewayOAuth("", request);
      expect(f.control.beginOAuthReconnect).toHaveBeenCalledTimes(1);
      const wrong = await f.api.completeGatewayOAuth("", {
        nonce,
        callbackURL:
          "http://localhost:1455/auth/callback?code=synthetic-code&state=" +
          "b".repeat(64),
      });
      expect(wrong.status).toBe("denied");
      expect(f.control.completeOAuth).not.toHaveBeenCalled();
      expect(
        await f.api.completeGatewayOAuth("", {
          nonce,
          authorizationCode: `synthetic-claude-code#${"a".repeat(64)}`,
        }),
      ).toMatchObject({ status: "denied" });
      expect(f.control.completeOAuth).not.toHaveBeenCalled();
      const credential =
        representation === "authorization_code"
          ? { authorizationCode: "synthetic-grok-plain-code" }
          : {
              callbackURL:
                "http://127.0.0.1:56121/callback?code=synthetic-code&state=" +
                "b".repeat(64),
            };
      const completed = await f.api.completeGatewayOAuth("", {
        nonce,
        ...credential,
      });
      expect(completed).toMatchObject({
        status: "ok",
        value: { state: "applied" },
      });
      expect(f.control.completeOAuth).toHaveBeenCalledTimes(1);
      await f.api.completeGatewayOAuth("", { nonce, ...credential });
      expect(f.control.completeOAuth).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(f.intents)).not.toMatch(
        /synthetic-code|synthetic-grok-plain-code|authorizationCode|callbackURL|one-off-handoff/,
      );
    },
  );
});

it("retains existing account cleanup when its qualified profile is disabled", async () => {
  const f = fixture({ grok: true, disabled: true });
  const page = await f.api.listGatewayAccounts("", null);
  expect(page).toMatchObject({
    status: "ok",
    value: {
      accounts: [
        {
          profileId: "grok-subscription-responses-oauth-v1",
          connection: { provider: "grok" },
        },
      ],
    },
  });
  if (page.status === "ok")
    expect(
      page.value.profiles.some(
        (profile) => profile.id === "grok-subscription-responses-oauth-v1",
      ),
    ).toBe(false);
  expect(
    await f.api.beginGatewayOAuth("", {
      nonce,
      profileId: "grok-subscription-responses-oauth-v1",
    }),
  ).toEqual({ status: "denied" });
  expect(f.delegate.connect).not.toHaveBeenCalled();
  f.ack();
  expect(
    await f.api.mutateGatewayAccount("", {
      nonce,
      kind: "disable",
      connectionId: "own-source",
      mirrorRevision: 10,
      gatewayRevision: 23,
    }),
  ).toMatchObject({ status: "ok" });
  expect(f.control.disable).toHaveBeenCalledTimes(1);
});

it("routes a saved Grok connect through the shared journal after reload without probing the canonical reconnect reader", async () => {
  const f = fixture({ grok: true });
  vi.spyOn(f.store, "readOperation").mockResolvedValue({
    id: personalOperationId("user-u", nonce),
    intent: {
      action: "connect",
      actorUserId: "user-u",
      personalWorkspaceId: "personal-u",
      clientOperationId: nonce,
      proposedSourceId: "own-source",
      profileId: "grok-subscription-responses-oauth-v1",
      displayName: "Own Grok",
      ingress: "oauth-begin",
      method: "browser",
    },
    phase: "submitted",
    source: null,
    binding: null,
    available: false,
  });
  const canonicalRead = vi
    .spyOn(f.canonical, "read")
    .mockRejectedValue(new ProviderAccountError("operation_conflict"));
  const callbackURL =
    "http://127.0.0.1:56121/callback?code=synthetic&state=" + "a".repeat(64);
  expect(
    await f.api.completeGatewayOAuth("", { nonce, callbackURL }),
  ).toMatchObject({ status: "ok", value: { state: "pending" } });
  expect(canonicalRead).not.toHaveBeenCalled();
  expect(f.delegate.completeOAuth).toHaveBeenCalledExactlyOnceWith({
    nonce,
    callbackURL,
  });
});

it("reconnect imports retain their selected method through fencing and lost acknowledgement", async () => {
  const f = fixture({ codexImports: true });
  const request = {
    ...f.request,
    credentialImportMethod: "refresh_token" as const,
  };
  const first = await f.api.submitGatewayApiKey(
    "",
    request,
    "synthetic-import-first",
  );
  expect(first.status).toBe("ok");
  expect(f.control.reconnect).not.toHaveBeenCalled();
  expect(f.intents).toHaveLength(1);
  expect(f.intents[0]).toMatchObject({
    action: "reconnect",
    credentialImportMethod: "refresh_token",
  });
  expect(JSON.stringify(f.intents)).not.toContain("synthetic-import");
  expect(
    await f.api.submitGatewayApiKey(
      "",
      { ...request, credentialImportMethod: "oauth_auth_json" },
      "synthetic-other",
    ),
  ).toEqual({ status: "conflict" });
  f.ack();
  const ready = await f.api.readGatewayOperation("", nonce);
  expect(ready).toMatchObject({
    status: "ok",
    value: {
      state: "pending",
      resume: { credentialImportMethod: "refresh_token" },
    },
  });
  if (ready.status === "ok") expect(ready.value.completion).toBeUndefined();
  const submitted = await f.api.submitGatewayApiKey(
    "",
    request,
    "synthetic-import-reentered",
  );
  expect(submitted.status).toBe("ok");
  expect(f.control.reconnect).toHaveBeenCalledExactlyOnceWith(
    "private-account",
    expect.objectContaining({
      credential: {
        kind: "credential_import",
        method: "refresh_token",
        value: "synthetic-import-reentered",
      },
    }),
  );
  await f.api.submitGatewayApiKey("", request, "synthetic-never-replay");
  expect(f.control.reconnect).toHaveBeenCalledTimes(1);
  expect(f.control.beginOAuthReconnect).not.toHaveBeenCalled();
});
it("a create-only import method cannot start reconnect fencing", async () => {
  const f = fixture({ codexImports: true });
  expect(
    await f.api.submitGatewayApiKey(
      "",
      { ...f.request, credentialImportMethod: "oauth_auth_json" },
      "synthetic-import",
    ),
  ).toEqual({ status: "denied" });
  expect(f.intents).toEqual([]);
  expect(f.control.reconnect).not.toHaveBeenCalled();
});

describe("lazy native admission and durable personal recovery", () => {
  it.each(["native API", "Codex import"] as const)(
    "recovers a saved %s nonce without discovery and denies a new nonce during outage",
    async (kind) => {
      const f = fixture({
        lazyCatalogue: true,
        nativeApi: kind === "native API",
        codexImports: kind === "Codex import",
      });
      const credentialImportMethod =
        kind === "Codex import" ? ("refresh_token" as const) : undefined;
      const original = {
        id: "accepted-connect",
        intent: {
          action: "connect" as const,
          actorUserId: "user-u",
          personalWorkspaceId: "personal-u",
          clientOperationId: nonce,
          proposedSourceId: "original-source",
          profileId: f.profileId,
          displayName: "Saved label",
          ingress: credentialImportMethod
            ? ("credential-import" as const)
            : ("api-key-create" as const),
          ...(credentialImportMethod ? { credentialImportMethod } : {}),
        },
        phase: "unknown" as const,
        source: null,
        binding: null,
        available: false,
      };
      vi.spyOn(f.store, "readOperation").mockImplementation(
        async (_actor, requested) => {
          if (requested !== nonce) throw new ProviderAccountError("not_found");
          return original;
        },
      );
      f.catalogue.mockRejectedValue(new Error("native_capabilities_outage"));
      f.control.profiles.mockRejectedValue(new Error("profile_catalog_outage"));
      f.delegate.operation.mockResolvedValue({
        operationId: original.id,
        phase: "unknown",
        sourceId: null,
        bindingId: null,
        available: false,
        state: "pending",
      });
      const request = {
        kind: "connect" as const,
        nonce,
        profileId: f.profileId,
        ...(credentialImportMethod ? { credentialImportMethod } : {}),
      };
      const recovered = {
        status: "ok",
        value: { nonce, state: "unknown", cleanup: "unresolved" },
      };
      expect(
        await f.api.submitGatewayApiKey("", request, "discarded-retry-secret"),
      ).toEqual(recovered);
      expect(await f.api.readGatewayOperation("", nonce)).toEqual(recovered);
      expect(f.catalogue).not.toHaveBeenCalled();
      expect(f.control.profiles).not.toHaveBeenCalled();
      expect(f.delegate.connect).not.toHaveBeenCalled();
      expect(f.delegate.operation).toHaveBeenCalledTimes(2);
      expect(
        await f.api.submitGatewayApiKey(
          "",
          {
            ...request,
            nonce: "537d0104-f074-4434-9539-a11b4ae10f2c",
          },
          "fresh-secret",
        ),
      ).toEqual({ status: "unavailable" });
      expect(f.catalogue).toHaveBeenCalledOnce();
      expect(f.delegate.connect).not.toHaveBeenCalled();
      expect(JSON.stringify(original)).not.toContain("secret");
    },
  );

  it.each(["native API", "Codex import"] as const)(
    "passes the qualified %s descriptor to the existing fresh enrollment adapter",
    async (kind) => {
      const f = fixture({
        lazyCatalogue: true,
        nativeApi: kind === "native API",
        codexImports: kind === "Codex import",
      });
      expect(f.catalogue).not.toHaveBeenCalled();
      const result = await f.api.submitGatewayApiKey(
        "",
        {
          kind: "connect",
          nonce,
          profileId: f.profileId,
          ...(kind === "Codex import"
            ? { credentialImportMethod: "refresh_token" as const }
            : {}),
        },
        "synthetic-fresh-credential",
      );
      expect(result.status).toBe("ok");
      expect(f.catalogue).toHaveBeenCalledOnce();
      expect(f.control.profiles).not.toHaveBeenCalled();
      expect(f.delegate.connect).toHaveBeenCalledOnce();
      const selected = f.personalAdapterFactory.mock.calls.at(-1)?.[0];
      expect([...selected!.profiles.keys()]).toEqual([f.profileId]);
      expect(selected?.connectionProfiles).toEqual([
        f.qualifiedProfiles.find((profile) => profile.id === f.profileId),
      ]);
      expect(selected?.connectionProfiles?.[0]?.availability).not.toBe(
        "deployment_configuration_required",
      );
    },
  );

  it.each(["policy", "method"] as const)(
    "a saved resume hint never overrides current %s admission or redispatches a completed import",
    async (denial) => {
      const f = fixture({ codexImports: true, lazyCatalogue: true });
      const request = {
        ...f.request,
        credentialImportMethod: "refresh_token" as const,
      };
      expect(
        (await f.api.submitGatewayApiKey("", request, "first-entry")).status,
      ).toBe("ok");
      expect(f.control.reconnect).not.toHaveBeenCalled();
      expect(f.intents).toHaveLength(1);
      f.ack();
      f.catalogue.mockRejectedValue(new Error("catalog_outage"));
      const beforeRead = f.catalogue.mock.calls.length;
      expect(await f.api.readGatewayOperation("", nonce)).toMatchObject({
        status: "ok",
        value: {
          state: "pending",
          resume: { credentialImportMethod: "refresh_token" },
        },
      });
      expect(f.catalogue).toHaveBeenCalledTimes(beforeRead);
      f.catalogue.mockResolvedValue(
        f.qualifiedProfiles.map((profile) => ({
          ...profile,
          ...(denial === "policy" ? { canReconnect: false } : {}),
          ...(profile.connection
            ? {
                connection: {
                  ...profile.connection,
                  ...(denial === "method" && profile.connection.methods
                    ? {
                        methods: profile.connection.methods.map((method) => ({
                          ...method,
                          reconnect: false,
                        })),
                      }
                    : {}),
                },
              }
            : {}),
        })),
      );
      await f.api.submitGatewayApiKey("", request, "must-not-enter");
      expect(f.control.reconnect).not.toHaveBeenCalled();
      expect(f.intents).toHaveLength(1);
      f.catalogue.mockResolvedValue(f.qualifiedProfiles);
      await f.api.submitGatewayApiKey("", request, "authorized-entry");
      expect(f.control.reconnect).toHaveBeenCalledOnce();
      f.catalogue.mockRejectedValue(new Error("catalog_outage"));
      const beforeRecovery = f.catalogue.mock.calls.length;
      f.reveal();
      expect(await f.api.readGatewayOperation("", nonce)).toMatchObject({
        status: "ok",
        value: { state: "applied" },
      });
      await f.api.submitGatewayApiKey("", request, "must-not-replay");
      expect(f.catalogue).toHaveBeenCalledTimes(beforeRecovery);
      expect(f.control.reconnect).toHaveBeenCalledOnce();
    },
  );

  it("continues an accepted browser reconnect during discovery outage without a new begin", async () => {
    const f = fixture({ grok: true, lazyCatalogue: true });
    const request = { ...f.request, method: "browser" as const };
    expect((await f.api.beginGatewayOAuth("", request)).status).toBe("ok");
    f.ack();
    expect((await f.api.beginGatewayOAuth("", request)).status).toBe("ok");
    expect(f.control.beginOAuthReconnect).toHaveBeenCalledOnce();
    f.catalogue.mockRejectedValue(new Error("catalog_outage"));
    const before = f.catalogue.mock.calls.length;
    await f.api.readGatewayOperation("", nonce);
    const completion = {
      nonce,
      authorizationCode: "synthetic-grok-plain-code",
    };
    expect(await f.api.completeGatewayOAuth("", completion)).toMatchObject({
      status: "ok",
      value: { state: "applied" },
    });
    await f.api.completeGatewayOAuth("", completion);
    expect(f.catalogue).toHaveBeenCalledTimes(before);
    expect(f.control.beginOAuthReconnect).toHaveBeenCalledOnce();
    expect(f.control.completeOAuth).toHaveBeenCalledOnce();
  });

  it("does not admit a live descriptor outside its offline identity/auth-kind bound", async () => {
    const f = fixture({ nativeApi: true, lazyCatalogue: true });
    f.catalogue.mockResolvedValue(
      f.qualifiedProfiles.map((profile) => ({
        ...profile,
        authKind: "oauth" as const,
      })),
    );
    expect(
      await f.api.submitGatewayApiKey(
        "",
        {
          kind: "connect",
          nonce,
          profileId: f.profileId,
        },
        "must-not-enter",
      ),
    ).toEqual({ status: "denied" });
    expect(f.delegate.connect).not.toHaveBeenCalled();
    expect(f.control.get).not.toHaveBeenCalled();
  });
});
