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
});
