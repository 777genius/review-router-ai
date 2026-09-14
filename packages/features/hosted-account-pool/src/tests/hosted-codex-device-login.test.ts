import { describe, expect, it, vi } from "vitest";
import {
  sessionArtifactFromCodexAuthJson,
  validateCodexSessionArtifact,
} from "@777genius/subscription-runtime/provider-codex";
import type {
  HostedCodexDeviceAuthGateway,
  HostedCodexDeviceAuthPollResult,
  HostedCodexDeviceAuthTokens,
  HostedCodexDeviceAuthUserCode,
  HostedCodexDeviceLoginRecord,
  HostedCodexDeviceLoginStore,
} from "../application/ports/hosted-codex-device-login-port";
import { HOSTED_CODEX_DEVICE_LOGIN_TTL_MS } from "../application/ports/hosted-codex-device-login-port";
import { hostedCodexAuthJsonFromDeviceTokens } from "../application/use-cases/hosted-codex-device-login-auth-json";
import { pollHostedCodexDeviceLogin } from "../application/use-cases/poll-hosted-codex-device-login";
import { startHostedCodexDeviceLogin } from "../application/use-cases/start-hosted-codex-device-login";
import { hostedDeviceLoginId, workspaceId } from "../domain/identifiers";

const now = new Date("2026-09-14T12:00:00.000Z");
const workspace = workspaceId("workspace-1");
const loginId = hostedDeviceLoginId("login-1");
const actor = "user:owner";

describe("hosted Codex dashboard device login", () => {
  it("starts a workspace-bound flight without returning device_auth_id", async () => {
    const store = memoryStore();
    const started = await startHostedCodexDeviceLogin(
      {
        id: loginId,
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now,
      },
      { store, deviceAuth: gateway() },
    );
    expect(started).toEqual({
      loginId,
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt: new Date(now.getTime() + HOSTED_CODEX_DEVICE_LOGIN_TTL_MS),
      intervalSeconds: 3,
    });
    expect(JSON.stringify(started)).not.toMatch(
      /device_auth|refresh|id_token/iu,
    );
    expect(store.row(loginId)?.deviceAuthId).toBe("device-auth-secret");
  });

  it("rejects a second open flight for the same workspace", async () => {
    const store = memoryStore();
    const deps = { store, deviceAuth: gateway() };
    await startHostedCodexDeviceLogin(
      {
        id: loginId,
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now,
      },
      deps,
    );
    await expect(
      startHostedCodexDeviceLogin(
        {
          id: hostedDeviceLoginId("login-2"),
          workspaceId: workspace,
          actor: "user:other-admin",
          label: "Backup",
          priority: 20,
          now,
        },
        deps,
      ),
    ).rejects.toThrow("hosted_pool_device_login_in_flight");
    expect(deps.deviceAuth.requestUserCode).toHaveBeenCalledTimes(1);
  });

  it("expires a stale pending row so a new flight can start", async () => {
    const store = memoryStore();
    const deps = { store, deviceAuth: gateway() };
    await startHostedCodexDeviceLogin(
      {
        id: loginId,
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now,
      },
      deps,
    );
    const later = new Date(
      now.getTime() + HOSTED_CODEX_DEVICE_LOGIN_TTL_MS + 1,
    );
    const started = await startHostedCodexDeviceLogin(
      {
        id: hostedDeviceLoginId("login-2"),
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now: later,
      },
      deps,
    );
    expect(started.loginId).toBe("login-2");
    expect(store.row(loginId)?.status).toBe("expired");
    expect(store.row(loginId)?.deviceAuthId).toBeNull();
  });

  it("enrolls existing auth.json bytes, wipes them, and clears deviceAuthId", async () => {
    const store = memoryStore();
    const tokens = chatgptTokens("refresh-secret");
    const captured: Uint8Array[] = [];
    await startHostedCodexDeviceLogin(
      {
        id: loginId,
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now,
      },
      { store, deviceAuth: gateway() },
    );
    const enroll = vi.fn(async (input: { readonly authJson: Uint8Array }) => {
      captured.push(Uint8Array.from(input.authJson));
    });
    const result = await pollHostedCodexDeviceLogin(
      { id: loginId, workspaceId: workspace, actor, now },
      {
        store,
        deviceAuth: gateway({
          pollAuthorization: vi.fn(async () => ({
            status: "authorized" as const,
            authorizationCode: "auth-code",
            codeVerifier: "verifier",
          })),
          exchangeAuthorizationCode: vi.fn(async () => tokens),
        }),
        enroll: { enrollAuthJson: enroll },
      },
    );
    expect(result).toEqual({ status: "imported", loginId });
    expect(JSON.stringify(result)).not.toMatch(
      /refresh-secret|id_token|device-auth/iu,
    );
    expect(enroll).toHaveBeenCalledOnce();
    const enrolled = captured[0];
    expect(enrolled).toBeDefined();
    const artifact = sessionArtifactFromCodexAuthJson(
      Buffer.from(enrolled!).toString("utf8"),
    );
    expect(validateCodexSessionArtifact(artifact).status).toBe("valid");
    expect(store.row(loginId)?.status).toBe("imported");
    expect(store.row(loginId)?.deviceAuthId).toBeNull();
    expect(
      enroll.mock.calls[0]?.[0]?.authJson.every((byte) => byte === 0),
    ).toBe(true);
  });

  it("denies a poll from another actor or workspace without enrolling", async () => {
    const store = memoryStore();
    await startHostedCodexDeviceLogin(
      {
        id: loginId,
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now,
      },
      { store, deviceAuth: gateway() },
    );
    const enroll = { enrollAuthJson: vi.fn(async () => undefined) };
    await expect(
      pollHostedCodexDeviceLogin(
        { id: loginId, workspaceId: workspace, actor: "user:intruder", now },
        { store, deviceAuth: gateway(), enroll },
      ),
    ).rejects.toThrow("hosted_pool_device_login_forbidden");
    await expect(
      pollHostedCodexDeviceLogin(
        {
          id: loginId,
          workspaceId: workspaceId("workspace-2"),
          actor,
          now,
        },
        { store, deviceAuth: gateway(), enroll },
      ),
    ).rejects.toThrow("hosted_pool_device_login_not_found");
    expect(enroll.enrollAuthJson).not.toHaveBeenCalled();
    expect(store.row(loginId)?.deviceAuthId).toBe("device-auth-secret");
  });

  it("expires an overdue poll and wipes deviceAuthId without calling OpenAI", async () => {
    const store = memoryStore();
    const deviceAuth = gateway();
    await startHostedCodexDeviceLogin(
      {
        id: loginId,
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now,
      },
      { store, deviceAuth },
    );
    await expect(
      pollHostedCodexDeviceLogin(
        {
          id: loginId,
          workspaceId: workspace,
          actor,
          now: new Date(now.getTime() + HOSTED_CODEX_DEVICE_LOGIN_TTL_MS),
        },
        {
          store,
          deviceAuth,
          enroll: { enrollAuthJson: vi.fn(async () => undefined) },
        },
      ),
    ).rejects.toThrow("hosted_pool_device_login_expired");
    expect(deviceAuth.pollAuthorization).not.toHaveBeenCalled();
    expect(store.row(loginId)?.status).toBe("expired");
    expect(store.row(loginId)?.deviceAuthId).toBeNull();
  });

  it("fails closed on an invalid token artifact and does not enroll", async () => {
    const store = memoryStore();
    await startHostedCodexDeviceLogin(
      {
        id: loginId,
        workspaceId: workspace,
        actor,
        label: "Primary",
        priority: 10,
        now,
      },
      { store, deviceAuth: gateway() },
    );
    const enroll = { enrollAuthJson: vi.fn(async () => undefined) };
    await expect(
      pollHostedCodexDeviceLogin(
        { id: loginId, workspaceId: workspace, actor, now },
        {
          store,
          deviceAuth: gateway({
            pollAuthorization: vi.fn(async () => ({
              status: "authorized" as const,
              authorizationCode: "auth-code",
              codeVerifier: "verifier",
            })),
            exchangeAuthorizationCode: vi.fn(async () => ({
              idToken: "",
              accessToken: "access",
              refreshToken: "refresh",
            })),
          }),
          enroll,
        },
      ),
    ).rejects.toThrow("hosted_pool_device_login_artifact_invalid");
    expect(enroll.enrollAuthJson).not.toHaveBeenCalled();
    expect(store.row(loginId)?.status).toBe("failed");
    expect(store.row(loginId)?.deviceAuthId).toBeNull();
  });

  it("builds compact ChatGPT auth.json bytes that enrollment already accepts", () => {
    const bytes = hostedCodexAuthJsonFromDeviceTokens({
      ...chatgptTokens("refresh-secret"),
      lastRefresh: now,
    });
    const artifact = sessionArtifactFromCodexAuthJson(
      Buffer.from(bytes).toString("utf8"),
    );
    expect(validateCodexSessionArtifact(artifact).status).toBe("valid");
    expect(JSON.parse(Buffer.from(bytes).toString("utf8"))).toMatchObject({
      auth_mode: "chatgpt",
      tokens: { refresh_token: "refresh-secret" },
    });
  });
});

function gateway(
  overrides: Partial<HostedCodexDeviceAuthGateway> = {},
): HostedCodexDeviceAuthGateway & {
  requestUserCode: ReturnType<typeof vi.fn>;
  pollAuthorization: ReturnType<typeof vi.fn>;
  exchangeAuthorizationCode: ReturnType<typeof vi.fn>;
} {
  const requestUserCode = vi.fn(
    async (): Promise<HostedCodexDeviceAuthUserCode> => ({
      deviceAuthId: "device-auth-secret",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
      intervalSeconds: 3,
    }),
  );
  const pollAuthorization = vi.fn(
    async (_input: {
      readonly deviceAuthId: string;
      readonly userCode: string;
    }): Promise<HostedCodexDeviceAuthPollResult> => ({
      status: "pending",
    }),
  );
  const exchangeAuthorizationCode = vi.fn(
    async (_input: {
      readonly authorizationCode: string;
      readonly codeVerifier: string;
    }): Promise<HostedCodexDeviceAuthTokens> => chatgptTokens("refresh"),
  );
  if (overrides.requestUserCode) {
    requestUserCode.mockImplementation(overrides.requestUserCode);
  }
  if (overrides.pollAuthorization) {
    pollAuthorization.mockImplementation(overrides.pollAuthorization);
  }
  if (overrides.exchangeAuthorizationCode) {
    exchangeAuthorizationCode.mockImplementation(
      overrides.exchangeAuthorizationCode,
    );
  }
  return {
    requestUserCode,
    pollAuthorization,
    exchangeAuthorizationCode,
  };
}

function chatgptTokens(refreshToken: string): HostedCodexDeviceAuthTokens {
  const claims = Buffer.from(
    JSON.stringify({
      iss: "https://auth.openai.com",
      sub: "user-1",
      "https://api.openai.com/auth": { chatgpt_account_id: "chatgpt-1" },
    }),
  ).toString("base64url");
  return {
    idToken: `e30.${claims}.id-token-signature`,
    accessToken: "access-token",
    refreshToken,
  };
}

function memoryStore(): HostedCodexDeviceLoginStore & {
  row(id: string): HostedCodexDeviceLoginRecord | undefined;
} {
  const rows = new Map<string, HostedCodexDeviceLoginRecord>();
  return {
    async expireStalePending(id, at) {
      for (const [key, row] of rows) {
        if (
          row.workspaceId === id &&
          row.status === "pending" &&
          row.expiresAt.getTime() <= at.getTime()
        ) {
          rows.set(key, {
            ...row,
            status: "expired",
            deviceAuthId: null,
            updatedAt: at,
          });
        }
      }
    },
    async findPendingByWorkspace(id) {
      return (
        [...rows.values()].find(
          (row) => row.workspaceId === id && row.status === "pending",
        ) ?? null
      );
    },
    async createPending(record) {
      if (
        [...rows.values()].some(
          (row) =>
            row.workspaceId === record.workspaceId && row.status === "pending",
        )
      ) {
        throw new Error("hosted_pool_device_login_in_flight");
      }
      rows.set(record.id, record);
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async markTerminal(input) {
      const row = rows.get(input.id);
      if (!row || row.status !== input.expectedStatus) return false;
      rows.set(input.id, {
        ...row,
        status: input.status,
        deviceAuthId: null,
        updatedAt: input.now,
      });
      return true;
    },
    row(id) {
      return rows.get(id);
    },
  };
}
