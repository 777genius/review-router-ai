import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { BootstrapUsageGrantPort } from "@reviewrouter/features-action-control-plane";
import { createProviderUsageBootstrapIssuer } from "./provider-usage-bootstrap.js";
function fixture() {
  const now = Math.floor(Date.now() / 1000),
    workflowPath = ".github/workflows/review.yml";
  const principal: Parameters<BootstrapUsageGrantPort["issue"]>[0] = {
    publicKey: "public-key",
    leaseId: "lease",
    leaseExpiresAt: new Date(Date.now() + 600000),
    actionRef: `owner/action@${"a".repeat(40)}`,
    workflowPath,
    repository: {
      workspaceId: "ws",
      repositoryId: "connection",
      githubRepositoryId: "123",
      githubInstallationId: "9",
      fullName: "owner/repo",
      owner: "owner",
      selected: true,
      installationStatus: "active",
    },
    claims: {
      iss: "https://token.actions.githubusercontent.com",
      aud: "rr",
      repository: "owner/repo",
      repository_id: "123",
      repository_visibility: "private",
      event_name: "pull_request",
      run_id: "456",
      run_attempt: "2",
      workflow_ref: `owner/repo/${workflowPath}@refs/heads/main`,
      workflow_sha: "b".repeat(40),
      actor: "untrusted-display-name",
      runner_environment: "github-hosted",
      iat: now - 10,
      nbf: now - 10,
      exp: now + 120,
      jti: "trusted-verified-jti",
    },
  };
  const lease = {
    id: "lease",
    workspaceId: "ws",
    repositoryId: "connection",
    githubRunId: "456",
    githubRunAttempt: "2",
    status: "preleased",
    expiresAt: principal.leaseExpiresAt,
  };
  const prisma = {
    codexOAuthLease: { findUnique: vi.fn(async () => lease) },
    producerRelease: {
      findMany: vi.fn(async () => [
        { wrapperEntrypointDigest: "c".repeat(64) },
      ]),
    },
    user: { findUnique: vi.fn(async () => ({ id: "app-derived-actor" })) },
  };
  const request = vi.fn(async () => ({
    data: {
      id: 456,
      run_attempt: 2,
      repository: { id: 123 },
      path: workflowPath,
      event: "pull_request",
      actor: { id: 77 },
    },
  }));
  const issueTrustedBootstrapGrant = vi.fn(async () => ({
    grantId: "g",
    grantToken: "usage-token",
    expiresAt: principal.leaseExpiresAt.toISOString(),
    scope: { purpose: "diagnostic" },
  }));
  const issuer = createProviderUsageBootstrapIssuer({
    prisma: prisma as unknown as PrismaClient,
    api: { issueTrustedBootstrapGrant: issueTrustedBootstrapGrant as never },
    app: { getInstallationOctokit: async () => ({ request }) },
  });
  return { principal, prisma, request, issueTrustedBootstrapGrant, issuer };
}
describe("bootstrap usage trusted principal", () => {
  it("binds the report-only diagnostic to approved wrapper digest, persisted lease and App actor", async () => {
    const f = fixture();
    await f.issuer.issue(f.principal);
    expect(f.issueTrustedBootstrapGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationId: "bootstrap-lease",
        invocationId: "lease-bootstrap",
        provider: "codex",
        requestedModel: null,
        runtimeType: "codex-refresh-bootstrap",
        purpose: "diagnostic",
        producerDigest: "c".repeat(64),
        actorId: "app-derived-actor",
        repositoryId: "123",
        runAttempt: 2,
      }),
      "public-key",
    );
  });
  it("rejects foreign run attempts and unknown producer before any grant", async () => {
    const f = fixture();
    f.principal.claims.run_attempt = "3";
    await expect(f.issuer.issue(f.principal)).rejects.toThrow(
      "usage_bootstrap_scope_denied",
    );
    expect(f.request).not.toHaveBeenCalled();
    expect(f.issueTrustedBootstrapGrant).not.toHaveBeenCalled();
    const other = fixture();
    other.prisma.producerRelease.findMany.mockResolvedValue([]);
    await expect(other.issuer.issue(other.principal)).rejects.toThrow(
      "usage_bootstrap_scope_denied",
    );
    expect(other.issueTrustedBootstrapGrant).not.toHaveBeenCalled();
  });
});
