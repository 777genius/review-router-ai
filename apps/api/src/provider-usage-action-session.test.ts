import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture.js";
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { ActionSessionUsageGrantPort } from "@reviewrouter/features-action-control-plane";
import { parseReviewConfiguration } from "@reviewrouter/features-review-config";
import { createProviderUsageActionSessionIssuer } from "./provider-usage-action-session.js";
function fixture(source = secretsWorkflow()) {
  const sha = "a".repeat(40),
    now = Math.floor(Date.now() / 1000),
    workflowPath = ".github/workflows/reviewrouter.yml";
  const principal: Parameters<ActionSessionUsageGrantPort["issue"]>[0] = {
    publicKey: "public-key",
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 600000),
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
      sub: "repo:owner/repo:pull_request",
      repository: "owner/repo",
      repository_owner: "owner",
      repository_id: "123",
      event_name: "pull_request",
      run_id: "456",
      run_attempt: "2",
      workflow_ref: `owner/repo/${workflowPath}@refs/heads/main`,
      workflow_sha: "b".repeat(40),
      job_workflow_ref: `777genius/review-router/.github/workflows/reviewrouter-secrets-runtime.yml@${sha}`,
      job_workflow_sha: sha,
      actor: "display-name",
      iat: now - 10,
      exp: now + 120,
      jti: "verified-jti",
    },
    session: {
      workspaceId: "ws",
      repositoryId: "connection",
      githubRepositoryId: "123",
      repository: "owner/repo",
      githubActorLogin: "display-name",
      githubRunId: "456",
      githubRunAttempt: "2",
      eventName: "pull_request",
      workflowPath,
      protocolVersion: 1,
    },
    configuration: {
      source: "repository",
      version: 1,
      workspaceVersion: 1,
      repositoryVersion: 1,
      effectivePolicyDigest: "policy",
      config: parseReviewConfiguration({
        ...workspacePolicyFixture,
        execution: {
          providerLimit: 2,
          providerMaxParallel: 2,
          inlineMinAgreement: 1,
        },
        providers: [
          {
            kind: "claude",
            authMode: "claude_code_oauth",
            model: "claude-sonnet-4-5",
          },
          {
            kind: "codex-mimo",
            authMode: "mimo_token_plan_api_key",
            model: "mimo-v2.6-pro",
          },
        ],
      }),
    },
  };
  const prisma = {
    producerRelease: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [
        { runtimeEntrypointDigest: "c".repeat(64) },
      ]),
    },
    user: { findUnique: vi.fn(async () => ({ id: "actor-from-app" })) },
  };
  const request = vi.fn(async (route: string) => ({
    data: route.includes("/contents/")
      ? {
          type: "file",
          encoding: "base64",
          content: Buffer.from(source).toString("base64"),
        }
      : {
          id: 456,
          run_attempt: 2,
          repository: { id: 123 },
          path: workflowPath,
          event: "pull_request",
          actor: { id: 77 },
        },
  }));
  const issueTrustedActionSessionGrant = vi.fn(async () => ({
    grantId: "g",
    grantToken: "usage-token",
    expiresAt: principal.expiresAt.toISOString(),
    scope: { purpose: "review" },
  }));
  const issuer = createProviderUsageActionSessionIssuer({
    prisma: prisma as unknown as PrismaClient,
    api: {
      issueTrustedActionSessionGrant: issueTrustedActionSessionGrant as never,
    },
    app: { getInstallationOctokit: async () => ({ request }) },
  });
  return { principal, prisma, request, issueTrustedActionSessionGrant, issuer };
}
describe("ActionSession provider usage authorization", () => {
  it("grants Claude and MiMo from saved policy without entering Codex lease admission", async () => {
    const f = fixture();
    const grants = await f.issuer.issue(f.principal);
    expect(grants).toHaveLength(2);
    expect(f.issueTrustedActionSessionGrant).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        provider: "claude",
        requestedModel: "claude-sonnet-4-5",
        runtimeType: "claude",
        purpose: "review",
        actorId: "actor-from-app",
        repositoryId: "123",
        runAttempt: 2,
      }),
      "public-key",
    );
    expect(f.issueTrustedActionSessionGrant).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: "mimo",
        requestedModel: "mimo-v2.6-pro",
        runtimeType: "codex",
      }),
      "public-key",
    );
  });
  it("rejects a caller-only job and a foreign run before granting telemetry scope", async () => {
    const f = fixture();
    delete f.principal.claims.job_workflow_ref;
    await expect(f.issuer.issue(f.principal)).rejects.toThrow(
      "usage_action_session_proof_denied",
    );
    expect(f.request).not.toHaveBeenCalled();
    const other = fixture();
    const foreignPrincipal = {
      ...other.principal,
      session: { ...other.principal.session, githubRunAttempt: "3" },
    };
    await expect(other.issuer.issue(foreignPrincipal)).rejects.toThrow(
      "usage_action_session_proof_denied",
    );
    expect(other.issueTrustedActionSessionGrant).not.toHaveBeenCalled();
  });
  it("rejects mutable runtime checkout and older workflow profile grants", async () => {
    const f = fixture(
      secretsWorkflow().replace("${{ job.workflow_sha }}", "main"),
    );
    await expect(f.issuer.issue(f.principal)).rejects.toThrow(
      "usage_action_session_proof_denied",
    );
    expect(f.issueTrustedActionSessionGrant).not.toHaveBeenCalled();
    const old = fixture();
    old.principal.claims.job_workflow_ref =
      old.principal.claims.job_workflow_ref!.replace(
        "secrets-runtime",
        "reusable",
      );
    await expect(old.issuer.issue(old.principal)).rejects.toThrow(
      "usage_action_session_proof_denied",
    );
    expect(old.request).not.toHaveBeenCalled();
  });
  it("refuses an unknown pinned Action producer", async () => {
    const f = fixture();
    f.prisma.producerRelease.count.mockResolvedValue(0);
    await expect(f.issuer.issue(f.principal)).rejects.toThrow(
      "usage_action_session_proof_denied",
    );
    expect(f.issueTrustedActionSessionGrant).not.toHaveBeenCalled();
  });
});

function secretsWorkflow() {
  return `jobs:
  review:
    env:
      REVIEWROUTER_RUNTIME_CONFIG_MODE: oidc
      REVIEWROUTER_STATIC_CONFIG_FALLBACK: 'false'
    steps:
      - uses: actions/checkout@${"d".repeat(40)}
        with:
          repository: 777genius/review-router
          ref: \${{ job.workflow_sha }}
          path: .reviewrouter-runtime
          persist-credentials: false
      - run: node .reviewrouter-runtime/dist/index.js
        env:
          REVIEW_ROUTER_MODE: review
`;
}
