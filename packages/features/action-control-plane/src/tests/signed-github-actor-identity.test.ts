import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { exchangeGitHubOidcToken } from "../application/use-cases/exchange-github-oidc-token";
import {
  defaultActionOidcAudience,
  githubActionsOidcIssuer,
  type ActionRepositoryContext,
  type ActionSessionClaims,
} from "../domain/action-control-plane";
import { JoseGitHubActionsOidcTokenVerifier } from "../infrastructure/oidc/jose-github-actions-oidc-token-verifier";
import { JoseActionSessionTokenService } from "../infrastructure/session/jose-action-session-token-service";
const secret = "test-only-32-byte-action-session-secret";
const repository: ActionRepositoryContext = {
  workspaceId: "workspace_1",
  repositoryId: "repo_1",
  githubRepositoryId: "1234",
  githubInstallationId: "55",
  fullName: "acme/project",
  owner: "acme",
  selected: true,
  installationStatus: "active",
};
async function githubIssuer() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const verifier = new JoseGitHubActionsOidcTokenVerifier({
    jwks: createLocalJWKSet({ keys: [{ ...jwk, kid: "github-test" }] }),
  });
  return {
    verifier,
    async sign(extra: Record<string, unknown>) {
      const seconds = Math.floor(Date.now() / 1000);
      return new SignJWT({
        sub: "repo:acme/project:ref:refs/heads/main",
        repository: repository.fullName,
        repository_id: repository.githubRepositoryId,
        repository_owner: repository.owner,
        event_name: "issue_comment",
        run_id: "run_1",
        run_attempt: "1",
        workflow_ref:
          "acme/project/.github/workflows/reviewrouter.yml@refs/heads/main",
        actor: "maintainer",
        ...extra,
      })
        .setProtectedHeader({ alg: "RS256", kid: "github-test" })
        .setIssuer(githubActionsOidcIssuer)
        .setAudience(defaultActionOidcAudience)
        .setIssuedAt(seconds)
        .setExpirationTime(seconds + 60)
        .sign(privateKey);
    },
  };
}
describe("signed stable GitHub actor identity", () => {
  it("retains issuer-signed actor_id through real OIDC JWT verification, exchange and action JWT mint/verify", async () => {
    const github = await githubIssuer();
    const sessions = new JoseActionSessionTokenService(secret);
    const now = new Date();
    const token = await github.sign({ actor_id: "11" });
    const result = await exchangeGitHubOidcToken(
      { oidcToken: token, audience: defaultActionOidcAudience },
      {
        oidcVerifier: github.verifier,
        sessions,
        repositories: {
          async findSelectedRepositoryByGithubId() {
            return repository;
          },
        } as never,
        clock: { now: () => now },
      },
    );
    const claims = await sessions.verify({ token: result.sessionToken, now });
    expect(claims).toMatchObject({
      githubActorId: "11",
      githubActorLogin: "maintainer",
      protocolVersion: 1,
      repositoryId: "repo_1",
    });
  });
  it("preserves legacy normal-review JWT verification and exchange when actor_id is absent", async () => {
    const github = await githubIssuer();
    const sessions = new JoseActionSessionTokenService(secret);
    const now = new Date();
    const result = await exchangeGitHubOidcToken(
      { oidcToken: await github.sign({}), audience: defaultActionOidcAudience },
      {
        oidcVerifier: github.verifier,
        sessions,
        repositories: {
          async findSelectedRepositoryByGithubId() {
            return repository;
          },
        } as never,
        clock: { now: () => now },
      },
    );
    const claims = await sessions.verify({ token: result.sessionToken, now });
    expect(claims.githubActorLogin).toBe("maintainer");
    expect(claims).not.toHaveProperty("githubActorId");
  });
  it.each(["0", "-11", "011", "11user", "9".repeat(21), 11, null])(
    "rejects malformed actor_id from a correctly signed GitHub JWT: %s",
    async (actor_id) => {
      const github = await githubIssuer();
      await expect(
        github.verifier.verify({
          token: await github.sign({ actor_id }),
          audience: defaultActionOidcAudience,
        }),
      ).rejects.toThrow();
    },
  );
  it("rejects malformed stable identity in a correctly signed action session instead of treating it as legacy", async () => {
    const sessions = new JoseActionSessionTokenService(secret);
    const now = new Date();
    const claims: ActionSessionClaims = {
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
      githubRepositoryId: "1234",
      repository: "acme/project",
      githubActorLogin: "maintainer",
      githubActorId: "-11",
      githubRunId: "run_1",
      githubRunAttempt: "1",
      eventName: "issue_comment",
      protocolVersion: 1,
    };
    const signed = await sessions.sign({
      claims,
      expiresInSeconds: 60,
      issuedAt: now,
    });
    await expect(sessions.verify({ token: signed.token, now })).rejects.toThrow(
      "invalid_action_session_githubActorId",
    );
  });
});
