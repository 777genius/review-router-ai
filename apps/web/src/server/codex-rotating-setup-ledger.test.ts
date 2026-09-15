import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeDispatch: vi.fn(),
  httpsRequest: vi.fn(),
  mintSecretWriteToken: vi.fn(),
}));

vi.mock("node:https", () => ({ request: mocks.httpsRequest }));

vi.mock("@reviewrouter/features-provider-setup", () => ({
  activateCodexRotatingSetup: vi.fn(),
  authorizeCodexRotatingSetupDispatch: vi.fn(),
  getCodexRotatingSetupStatus: vi.fn(),
  prepareCodexRotatingSetup: vi.fn(),
  reattestCodexRotatingWorkflow: vi.fn(),
  recordCodexRotatingSetupDispatchOutcome: vi.fn(),
}));

vi.mock("@reviewrouter/platform-config", () => ({
  requireReviewRouterDatabaseRecoveryWitness: () => "witness",
}));

vi.mock("./prisma", () => ({
  getCodexEffectAuthorityPrisma: () => ({}),
  getPrisma: () => ({}),
}));

vi.mock("./prisma-codex-rotating-setup-payload-claim", () => ({
  CodexRotatingSetupPreDispatchError: class extends Error {
    override readonly name = "CodexRotatingSetupPreDispatchError";
    constructor(cause?: unknown) {
      super(cause instanceof Error ? cause.message : "predispatch");
    }
  },
  PrismaCodexRotatingSetupPayloadClaim: class {
    authorizeDispatch = mocks.authorizeDispatch;
  },
}));

vi.mock("./dashboard-mutations", () => ({
  mintFreshGitHubAppRepositorySecretWriteToken: mocks.mintSecretWriteToken,
}));

import { codexRotatingSetupLedger } from "./codex-rotating-setup-ledger";

const request = {
  claimId: "claim_setup_scope",
  idempotencyKey: "dispatch:setup-scope",
  encryptedValue: "ZW5jcnlwdGVk",
  keyId: "github-key-1",
};
const target = {
  githubInstallationId: "101",
  githubRepositoryId: "1001",
  owner: "reviewrouter",
  repo: "target",
  secretName: "REVIEWROUTER_CODEX_AUTH_JSON_SCOPED",
};

describe("setup secret PUT composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeDispatch.mockImplementation(
      async (
        _authority: unknown,
        dispatch: (value: typeof target) => unknown,
      ) => dispatch(target),
    );
  });

  it.each([
    "setup_secret_token_repository_scope_mismatch",
    "setup_secret_token_permissions_mismatch",
  ])(
    "does not PUT when minted token validation fails with %s",
    async (error) => {
      mocks.mintSecretWriteToken.mockRejectedValueOnce(new Error(error));

      await expect(
        codexRotatingSetupLedger.authorizeAndPutSecret(request),
      ).rejects.toThrow(error);
      expect(mocks.mintSecretWriteToken).toHaveBeenCalledWith({
        githubInstallationId: target.githubInstallationId,
        githubRepositoryId: target.githubRepositoryId,
      });
      expect(mocks.httpsRequest).not.toHaveBeenCalled();
    },
  );

  it("classifies synchronous request construction failure as proven pre-PUT", async () => {
    mocks.mintSecretWriteToken.mockResolvedValueOnce("token");
    mocks.httpsRequest.mockImplementationOnce(() => {
      throw new Error("construction failed");
    });

    await expect(
      codexRotatingSetupLedger.authorizeAndPutSecret(request),
    ).rejects.toMatchObject({ name: "CodexRotatingSetupPreDispatchError" });
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("classifies DNS/TCP/TLS failure before secureConnect as proven pre-PUT", async () => {
    mocks.mintSecretWriteToken.mockResolvedValueOnce("token");
    const clientRequest = new EventEmitter() as EventEmitter & {
      end: (body: Buffer) => void;
      destroy: (error: Error) => void;
    };
    clientRequest.destroy = vi.fn();
    clientRequest.end = vi.fn(() => {
      const socket = Object.assign(new EventEmitter(), { encrypted: true });
      clientRequest.emit("socket", socket);
      clientRequest.emit("error", new Error("tls failed"));
    });
    mocks.httpsRequest.mockReturnValueOnce(clientRequest);

    await expect(
      codexRotatingSetupLedger.authorizeAndPutSecret(request),
    ).rejects.toMatchObject({ name: "CodexRotatingSetupPreDispatchError" });
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps transport loss after secureConnect outcome-unknown", async () => {
    mocks.mintSecretWriteToken.mockResolvedValueOnce("token");
    const clientRequest = new EventEmitter() as EventEmitter & {
      end: (body: Buffer) => void;
      destroy: (error: Error) => void;
    };
    clientRequest.destroy = vi.fn();
    clientRequest.end = vi.fn(() => {
      const socket = Object.assign(new EventEmitter(), { encrypted: true });
      clientRequest.emit("socket", socket);
      socket.emit("secureConnect");
      clientRequest.emit("error", new Error("connection lost"));
    });
    mocks.httpsRequest.mockReturnValueOnce(clientRequest);

    await expect(
      codexRotatingSetupLedger.authorizeAndPutSecret(request),
    ).rejects.toMatchObject({
      name: "Error",
      message: "setup_secret_put_transport_unknown",
    });
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps a complete non-success response outcome-unknown and never retries", async () => {
    mocks.mintSecretWriteToken.mockResolvedValueOnce("token");
    const response = Object.assign(new EventEmitter(), {
      complete: true,
      statusCode: 500,
    });
    const clientRequest = new EventEmitter() as EventEmitter & {
      end: (body: Buffer) => void;
      destroy: (error: Error) => void;
    };
    clientRequest.destroy = vi.fn();
    clientRequest.end = vi.fn(() => {
      const socket = Object.assign(new EventEmitter(), { encrypted: true });
      clientRequest.emit("socket", socket);
      socket.emit("secureConnect");
      const callback = mocks.httpsRequest.mock.calls[0]?.[2] as (
        value: typeof response,
      ) => void;
      callback(response);
      response.emit("end");
    });
    mocks.httpsRequest.mockReturnValueOnce(clientRequest);

    await expect(
      codexRotatingSetupLedger.authorizeAndPutSecret(request),
    ).rejects.toThrow("codex_rotating_setup_secret_put_failed");
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);
  });
});
