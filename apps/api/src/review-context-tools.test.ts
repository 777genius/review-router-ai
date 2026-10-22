import Fastify from "fastify";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  captureContextToolsPlan,
  canonicalContextJson,
} from "@reviewrouter/features-review-context-tools";
import {
  canonicalJson,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  ContextToolsAccessFailure,
  registerContextToolsRoutes,
  type ContextToolsRunAccess,
} from "./review-context-tools";
import { assertContextGithubBindings } from "./review-run-runtime-snapshot";

function fixture() {
  const plan = captureContextToolsPlan(
    { version: 1, builtinTools: ["github.issue.read"], mcp: [] },
    [],
  );
  const agent = {
    profileRef: "ocr-managed-v2",
    agentKind: "ocr",
    packageVersion: "1.13.1-rr.3",
    binarySha256: "a".repeat(64),
    modelTransports: ["account_gateway"],
    contextGateway: false,
    cancellation: true,
  };
  const snapshot = {
    snapshotVersion: 3,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
    agent,
    agentProfileDigest: createHash("sha256")
      .update(canonicalJson(agent))
      .digest("hex"),
    producer: {
      producerReleaseId: "release-1",
      actionCommitSha: "a".repeat(40),
      runtimeCommitSha: "a".repeat(40),
    },
    configurationCanonicalJson: canonicalJson({ schemaVersion: 3 }),
    contextToolsPlanCanonicalJson: canonicalContextJson(plan),
    deadline: "2126-01-01T00:00:00.000Z",
    gateway: null,
  };
  const authorization = {
    authorizationId: "run-1",
    workspaceId: "workspace-1",
    headSha: "a".repeat(40),
    runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
  } as ReviewRunAuthorization;
  const access = {
    authorize: vi.fn(async () => authorization),
    deliver: vi.fn(async () => ({ TOKEN: "dashboard-only" })),
    assertIssueAccess: vi.fn(async () => {}),
    readIssue: vi.fn(async () => ({
      number: 12,
      title: "Issue",
      body: "Untrusted text",
      url: "https://github.com/o/r/issues/12",
      comments: [],
    })),
  } satisfies ContextToolsRunAccess;
  return { access, authorization, snapshot, plan };
}
async function withApp(
  run: (
    app: ReturnType<typeof Fastify>,
    f: ReturnType<typeof fixture>,
  ) => Promise<void>,
) {
  const f = fixture(),
    app = Fastify();
  await registerContextToolsRoutes(app, f.access);
  try {
    await run(app, f);
  } finally {
    await app.close();
  }
}
const request = (planDigest: string, extra = {}) => ({
  method: "POST" as const,
  url: "/api/action/v2/context-tools/credentials",
  headers: { authorization: "Bearer run-token" },
  payload: { authorizationId: "run-1", planDigest, ...extra },
});

describe("captured context tools run boundary", () => {
  it("checks required issue entitlement before delivery and rechecks live authority", () =>
    withApp(async (app, f) => {
      const response = await app.inject(request(f.plan.planDigest));
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.json()).toEqual({
        planDigest: f.plan.planDigest,
        secrets: { TOKEN: "dashboard-only" },
      });
      expect(f.access.authorize).toHaveBeenCalledTimes(2);
      expect(f.access.deliver).toHaveBeenCalledWith("workspace-1", f.plan);
      expect(f.access.assertIssueAccess).toHaveBeenCalledOnce();
    }));
  it("rejects injected keys/refs and wrong plan before decrypting", () =>
    withApp(async (app, f) => {
      for (const extra of [
        { secrets: { GITHUB_TOKEN: "do-not-upload" } },
        { workspaceId: "other" },
        { planDigest: `sha256:${"f".repeat(64)}` },
      ])
        expect(
          (await app.inject(request(f.plan.planDigest, extra))).statusCode,
        ).toBeGreaterThanOrEqual(400);
      expect(f.access.deliver).not.toHaveBeenCalled();
    }));
  it("denies revoked or wrong authorization and incompatible engine", () =>
    withApp(async (app, f) => {
      f.access.authorize.mockResolvedValueOnce(null as never);
      expect((await app.inject(request(f.plan.planDigest))).statusCode).toBe(
        410,
      );
      Object.assign(f.authorization, { authorizationId: "other" });
      expect((await app.inject(request(f.plan.planDigest))).statusCode).toBe(
        410,
      );
      Object.assign(f.authorization, { authorizationId: "run-1" });
      f.snapshot.agent.agentKind = "codex";
      f.snapshot.agent.contextGateway = true;
      Object.assign(f.authorization, {
        runtimeSnapshotCanonicalJson: canonicalJson(f.snapshot),
      });
      expect((await app.inject(request(f.plan.planDigest))).statusCode).toBe(
        403,
      );
      expect(f.access.deliver).not.toHaveBeenCalled();
    }));
  it("never returns credentials if revocation wins the final authority check", () =>
    withApp(async (app, f) => {
      f.access.authorize
        .mockResolvedValueOnce(f.authorization)
        .mockResolvedValueOnce(null as never);
      const response = await app.inject(request(f.plan.planDigest));
      expect(response.statusCode).toBe(410);
      expect(response.body).not.toContain("dashboard-only");
    }));
  it("keeps backend errors finite and requires selected linked-issue read", () =>
    withApp(async (app, f) => {
      f.access.assertIssueAccess.mockRejectedValueOnce(
        new Error("provider token must never leak"),
      );
      const denied = await app.inject(request(f.plan.planDigest));
      expect(denied.statusCode).toBe(503);
      expect(denied.body).not.toContain("token");
      expect(f.access.deliver).not.toHaveBeenCalled();
      f.access.readIssue.mockRejectedValueOnce(
        new ContextToolsAccessFailure("context_issue_not_linked", 400),
      );
      const response = await app.inject({
        ...request(f.plan.planDigest),
        url: "/api/action/v2/context-tools/github-issue",
        payload: {
          authorizationId: "run-1",
          planDigest: f.plan.planDigest,
          issueNumber: 13,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "context_issue_not_linked" });
    }));
  it("compares each logical runner binding to the exact captured GitHub name", () => {
    const plan = captureContextToolsPlan(
      {
        version: 1,
        builtinTools: [],
        mcp: [{ connection: "docs", tools: ["search"] }],
      },
      [
        {
          workspaceId: "w",
          version: 1,
          enabled: true,
          encryptedSecrets: null,
          definition: {
            id: "docs",
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer {{ secrets.DOCS_TOKEN }}" },
            tools: ["search"],
            credentials: {
              DOCS_TOKEN: { source: "github-secret", name: "DOCS_MCP_TOKEN" },
            },
          },
        },
      ],
    );
    expect(() =>
      assertContextGithubBindings(plan, { DOCS_TOKEN: "DOCS_MCP_TOKEN" }),
    ).not.toThrow();
    for (const actual of [
      undefined,
      { DOCS_TOKEN: "GITHUB_TOKEN" },
      { DOCS_TOKEN: "DOCS_MCP_TOKEN", OTHER: "UNSELECTED" },
    ])
      expect(() => assertContextGithubBindings(plan, actual)).toThrow(
        "context_workflow_secret_binding_mismatch",
      );
  });
});
