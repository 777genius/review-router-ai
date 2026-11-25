import Fastify from "fastify";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  captureContextToolsPlan,
  canonicalContextJson,
} from "@reviewrouter/features-review-context-tools";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorization,
  type ReviewRunRuntimeSnapshotV4,
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
    authorize: vi.fn<ContextToolsRunAccess["authorize"]>(
      async () => authorization,
    ),
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

function captureReviewerSnapshot(f: ReturnType<typeof fixture>) {
  const ocr: ReviewRunRuntimeSnapshotV4["reviewers"][number]["agentProfile"] = {
    ...f.snapshot.agent,
    agentKind: "ocr",
    modelTransports: ["account_gateway"],
    contextGateway: false,
    cancellation: true,
  };
  const codex: ReviewRunRuntimeSnapshotV4["reviewers"][number]["agentProfile"] =
    {
      ...ocr,
      profileRef: "codex-approved",
      agentKind: "codex",
      contextGateway: true,
    };
  // Put the ineligible engine first and make it primary: choosing the primary
  // or a positional fallback must never grant the OCR reviewer's tool access.
  const reviewers: ReviewRunRuntimeSnapshotV4["reviewers"] = [
    { id: "reviewer-codex", agent: codex },
    { id: "reviewer-ocr", agent: ocr },
  ].map(({ id, agent }, providerIndex) => ({
    reviewerId: id,
    providerIndex,
    providerVoteIdentityHash: String(providerIndex).padStart(64, "0"),
    required: true,
    transport: {
      kind: "account_gateway",
      allocationId: `allocation-${providerIndex}`,
    },
    requestedModel: "gpt-6.1-sol",
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
    agentProfile: agent,
    agentProfileDigest: createHash("sha256")
      .update(canonicalJson(agent))
      .digest("hex"),
    concurrencyGroupId: `allocation-${providerIndex}`,
    investigationGrant: null,
  }));
  const snapshot: ReviewRunRuntimeSnapshotV4 = {
    snapshotVersion: 4,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: f.snapshot.effectivePolicyDigest,
    producer: f.snapshot.producer,
    configurationCanonicalJson: canonicalJson({
      schemaVersion: 3,
      providers: reviewers.map((reviewer) => ({
        authMode: "codex_account_gateway",
        gatewayBindingId: `binding-${reviewer.providerIndex}`,
        gatewayProfileRef: "profile-1",
        model: reviewer.requestedModel,
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
      })),
    }),
    contextToolsPlanCanonicalJson: canonicalContextJson(f.plan),
    deadline: f.snapshot.deadline,
    primaryReviewerId: "reviewer-codex",
    maxParallelReviewers: 2,
    inlineMinAgreement: 1,
    reviewers,
    allocations: reviewers.map((reviewer) => ({
      allocationId: reviewer.transport.allocationId,
      bindingId: `binding-${reviewer.providerIndex}`,
      connectionId: `connection-${reviewer.providerIndex}`,
      bindingRevision: 1,
      policySubject: `binding-${reviewer.providerIndex}`,
      policyRevision: 1,
      permittedAccountRef: `account-${reviewer.providerIndex}`,
      profileRef: "profile-1",
      invocationId: `invocation-${reviewer.providerIndex}`,
      attemptId: `attempt-${reviewer.providerIndex}`,
      operationId: `operation-${reviewer.providerIndex}`,
      expectedAuthorizationEpoch: 1,
      limits: {
        requests: 8,
        concurrency: 1,
        requestBytes: 16384,
        outputBytes: 16384,
        tokens: 500,
      },
    })),
  };
  const captured = canonicalJson(snapshot);
  // Exercise the same strict snapshot parser as production, rather than
  // bypassing its reviewer/configuration/allocation consistency checks.
  expect(parseReviewRunRuntimeSnapshot(captured)).toEqual(snapshot);
  Object.assign(f.authorization, { runtimeSnapshotCanonicalJson: captured });
  return snapshot;
}

const reviewerEndpoints = ["credentials", "github-issue"] as const;
const reviewerRequest = (
  f: ReturnType<typeof fixture>,
  endpoint: (typeof reviewerEndpoints)[number],
  reviewerId?: string,
) => ({
  ...request(f.plan.planDigest),
  url: `/api/action/v2/context-tools/${endpoint}`,
  headers: {
    authorization: "Bearer run-token",
    ...(reviewerId === undefined
      ? {}
      : { "x-reviewrouter-reviewer-id": reviewerId }),
  },
  payload: {
    authorizationId: "run-1",
    planDigest: f.plan.planDigest,
    ...(endpoint === "github-issue" ? { issueNumber: 12 } : {}),
  },
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
      f.access.authorize.mockResolvedValueOnce(null);
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
        .mockResolvedValueOnce(null);
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

describe("captured reviewer-v4 context tools run boundary", () => {
  it.each(reviewerEndpoints)(
    "delivers %s only for the exact captured OCR reviewer and rechecks that selector",
    (endpoint) =>
      withApp(async (app, f) => {
        captureReviewerSnapshot(f);
        const response = await app.inject(
          reviewerRequest(f, endpoint, "reviewer-ocr"),
        );
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(f.access.authorize.mock.calls).toEqual([
          ["run-token", "reviewer-ocr"],
          ["run-token", "reviewer-ocr"],
        ]);
        if (endpoint === "credentials") {
          expect(response.json()).toEqual({
            planDigest: f.plan.planDigest,
            secrets: { TOKEN: "dashboard-only" },
          });
          expect(f.access.assertIssueAccess).toHaveBeenCalledOnce();
          expect(f.access.deliver).toHaveBeenCalledWith("workspace-1", f.plan);
          expect(f.access.readIssue).not.toHaveBeenCalled();
        } else {
          expect(response.json()).toMatchObject({
            number: 12,
            body: "Untrusted text",
          });
          expect(f.access.readIssue).toHaveBeenCalledWith(f.authorization, 12);
          expect(f.access.deliver).not.toHaveBeenCalled();
        }
      }),
  );

  it.each([
    ["missing", undefined],
    ["malformed", "reviewer ocr"],
    ["unknown", "reviewer-foreign"],
    ["other engine", "reviewer-codex"],
  ] as const)(
    "rejects a %s selector before any credential or issue delivery",
    async (_label, selector) => {
      for (const endpoint of reviewerEndpoints)
        await withApp(async (app, f) => {
          captureReviewerSnapshot(f);
          const response = await app.inject(
            reviewerRequest(f, endpoint, selector),
          );
          expect(response.statusCode).toBe(_label === "malformed" ? 400 : 403);
          expect(response.json()).toEqual({
            error:
              _label === "malformed"
                ? "context_request_invalid"
                : "context_plan_unavailable",
          });
          expect(response.body).not.toContain("dashboard-only");
          expect(response.body).not.toContain("Untrusted text");
          expect(f.access.deliver).not.toHaveBeenCalled();
          expect(f.access.assertIssueAccess).not.toHaveBeenCalled();
          expect(f.access.readIssue).not.toHaveBeenCalled();
          if (_label === "malformed")
            expect(f.access.authorize).not.toHaveBeenCalled();
        });
    },
  );

  it.each(reviewerEndpoints)(
    "withholds %s when selected allocation/run authority is denied initially or revoked at recheck",
    async (endpoint) => {
      for (const losesAuthorityAt of ["initial", "recheck"] as const)
        await withApp(async (app, f) => {
          captureReviewerSnapshot(f);
          if (losesAuthorityAt === "recheck")
            f.access.authorize.mockResolvedValueOnce(f.authorization);
          f.access.authorize.mockResolvedValueOnce(null);
          const response = await app.inject(
            reviewerRequest(f, endpoint, "reviewer-ocr"),
          );
          expect(response.statusCode).toBe(410);
          expect(response.json()).toEqual({
            error: "context_authorization_inactive",
          });
          expect(response.body).not.toContain("dashboard-only");
          expect(response.body).not.toContain("Untrusted text");
          expect(f.access.authorize.mock.calls).toEqual(
            Array.from(
              { length: losesAuthorityAt === "initial" ? 1 : 2 },
              () => ["run-token", "reviewer-ocr"],
            ),
          );
          if (losesAuthorityAt === "initial") {
            expect(f.access.deliver).not.toHaveBeenCalled();
            expect(f.access.readIssue).not.toHaveBeenCalled();
          } else if (endpoint === "credentials")
            expect(f.access.deliver).toHaveBeenCalledOnce();
          else expect(f.access.readIssue).toHaveBeenCalledOnce();
        });
    },
  );

  it("withholds the captured payload when the final same-selector authorization has a different snapshot", () =>
    withApp(async (app, f) => {
      const snapshot = captureReviewerSnapshot(f);
      const changed = canonicalJson({
        ...snapshot,
        configurationVersion: 2,
        workspaceConfigurationVersion: 2,
      });
      expect(parseReviewRunRuntimeSnapshot(changed)?.snapshotVersion).toBe(4);
      f.access.authorize
        .mockResolvedValueOnce(f.authorization)
        .mockResolvedValueOnce({
          ...f.authorization,
          runtimeSnapshotCanonicalJson: changed,
        });
      const response = await app.inject(
        reviewerRequest(f, "credentials", "reviewer-ocr"),
      );
      expect(response.statusCode).toBe(410);
      expect(response.json()).toEqual({
        error: "context_authorization_changed",
      });
      expect(response.body).not.toContain("dashboard-only");
      expect(f.access.deliver).toHaveBeenCalledOnce();
      expect(f.access.authorize.mock.calls).toEqual([
        ["run-token", "reviewer-ocr"],
        ["run-token", "reviewer-ocr"],
      ]);
    }));
});
