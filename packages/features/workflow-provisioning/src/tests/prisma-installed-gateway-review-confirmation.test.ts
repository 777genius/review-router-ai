import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { workspacePolicyFixture } from "../../../review-config/src/tests/current-policy-fixture";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import {
  renderAccountGatewayWorkflow,
  reviewRouterWorkflowContract,
} from "../domain/workflow-template";
import {
  createInstalledGatewayReviewConfirmation,
  supportsInstalledGatewayReviewConfirmation,
} from "../infrastructure/prisma/prisma-installed-gateway-review-confirmation";

const io = vi.hoisted(() => ({
  runtime: undefined as unknown,
  selection: undefined as unknown,
  inventory: undefined as unknown,
  request: vi.fn(),
  publicRequest: vi.fn(),
  provision: vi.fn(),
  configured: vi.fn(),
}));
vi.mock("@octokit/app", () => ({
  App: class {
    async getInstallationOctokit() {
      return { request: io.request };
    }
  },
}));
vi.mock("@octokit/request", () => ({ request: io.publicRequest }));
vi.mock("@reviewrouter/features-review-config", async (original) => ({
  ...(await original<typeof import("@reviewrouter/features-review-config")>()),
  resolveReviewRuntimeEnv: async () => io.runtime,
}));
vi.mock("@reviewrouter/features-provider-accounts", async (original) => ({
  ...(await original<
    typeof import("@reviewrouter/features-provider-accounts")
  >()),
  PrismaProviderAccountRepository: class {
    async findBinding() {
      return io.selection;
    }
  },
}));
vi.mock(
  "../infrastructure/github/managed-review-v2-workflow-inventory",
  () => ({
    ManagedReviewV2WorkflowInventory: class {
      async inspectReviewV2ManagedWorkflowInventory() {
        return io.inventory;
      }
    },
    createOctokitReviewV2RepositoryScopedReadAccess: () => ({}),
  }),
);
vi.mock(
  "../infrastructure/prisma/prisma-gateway-review-v2-provisioning",
  () => ({
    provisionGatewayReviewV2Repository: io.provision,
  }),
);
vi.mock(
  "../infrastructure/prisma/prisma-workflow-provisioning-status-authority",
  () => ({
    PrismaWorkflowProvisioningStatusAuthority: class {
      async confirmInstalledWorkflow(input: unknown) {
        return io.configured(input);
      }
    },
  }),
);

const action = "a".repeat(40),
  head = "b".repeat(40),
  blob = "c".repeat(40);
const profile = "openrouter-openai-responses-apikey-v1";
const command = {
  workspaceId: "workspace-1",
  repositoryId: "repository-1",
  actor: "reviewrouter-operator",
  operatorAudit: {
    operatorId: "reviewrouter-operator",
    ownerUserId: "owner-1",
  },
};
const env = {
  GITHUB_APP_ID: "42",
  GITHUB_APP_PRIVATE_KEY: "fixture-never-used-for-authentication",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF: `777genius/review-router@${action}`,
  REVIEW_ROUTER_PUBLIC_API_URL: "https://reviewrouter.example",
};

beforeEach(() => {
  vi.clearAllMocks();
});
function fixture() {
  const config = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        ...workspacePolicyFixture.providers[0],
        kind: "codex",
        authMode: "codex_account_gateway",
        model: "opaque-model",
        gatewayBindingId: "binding-1",
        gatewayProfileRef: profile,
      },
    ],
  });
  const runtime = { config, revisionToken: "policy-1" };
  io.runtime = runtime;
  const selection = {
    binding: {
      id: "binding-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      state: "active",
      revision: 1,
      policyRevision: 1,
      pendingFence: null,
      fenceAck: null,
    },
    connection: {
      id: "connection-1",
      owner: { kind: "workspace", workspaceId: "workspace-1" },
      gatewayAccountRef: "account-1",
      gatewayOperationRef: "operation-1",
      profileRef: profile,
      displayName: "fixture",
      state: "active",
      metadataRevision: 1,
    },
  };
  io.selection = selection;
  io.inventory = {
    compatible: true,
    actionCommitSha: null,
    runtimeRef: "workflow-v1",
    workflowSchemaVersion: reviewRouterWorkflowContract.major,
    defaultBranchHeadSha: head,
  };
  const identity = {
    scmRepositoryIdentityId: "scm-1",
    version: 1,
    provider: "github",
    externalRepositoryId: "123",
    normalizedSourceBaseUrl: "https://github.com",
    currentWorkspaceId: "workspace-1",
    currentRepositoryConnectionId: "repository-1",
  };
  const repository = {
    id: "repository-1",
    workspaceId: "workspace-1",
    provider: "github",
    selected: true,
    archived: false,
    sourceBaseUrl: "https://github.com",
    externalRepositoryId: "123",
    githubRepositoryId: 123n,
    installationId: "installation-1",
    installation: { status: "active", githubInstallationId: 42n },
    scmRepositoryIdentityId: "scm-1",
    fullName: "owner/repo",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
  };
  let setup: Record<string, unknown> | null = null;
  let authorized = true,
    auditAvailable = true,
    sourceReads = 0;
  let remoteHook: (() => void) | undefined;
  const audits: Record<string, unknown>[] = [],
    operationalWrites: string[] = [];
  const state = {
    repositoryConnection: {
      findFirst: async () =>
        repository.selected && repository.installation.status === "active"
          ? repository
          : null,
    },
    scmRepositoryIdentity: { findUnique: async () => identity },
    workflowProvisioning: { findUnique: async () => setup },
    hostedCodexRepositoryBinding: { findFirst: async () => null },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (!auditAvailable) throw new Error("audit unavailable");
        audits.push(data);
        return data;
      },
    },
  };
  const prisma = {
    ...state,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work(state),
  } as unknown as PrismaClient;
  const expected = renderAccountGatewayWorkflow({
    actionRef: env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF,
    apiUrl: env.REVIEW_ROUTER_PUBLIC_API_URL,
    githubRepositoryId: "123",
  });
  io.request.mockImplementation(async (route: string) => {
    if (route === "GET /repos/{owner}/{repo}")
      return {
        data: { id: 123, full_name: "owner/repo", default_branch: "main" },
      };
    if (route.includes("/git/ref/")) return { data: { object: { sha: head } } };
    if (route.includes("/contents/")) {
      sourceReads++;
      if (sourceReads === 3) remoteHook?.();
      return {
        data: {
          type: "file",
          path: expected.path,
          encoding: "base64",
          sha: blob,
          content: Buffer.from(expected.content).toString("base64"),
        },
      };
    }
    throw new Error("unexpected GitHub read");
  });
  io.publicRequest.mockResolvedValue({ data: { sha: action } });
  io.provision.mockImplementation(
    async (input: { assertCurrentSetupAndSource(): Promise<void> }) => {
      await input.assertCurrentSetupAndSource();
      operationalWrites.push("authority");
      return {
        status: "ready",
        outcome: "created",
        scmRepositoryIdentityId: "scm-1",
        authorityVersion: 1,
        authorityEpoch: "1",
        actionCommitSha: action,
      };
    },
  );
  io.configured.mockImplementation(async () => {
    operationalWrites.push("setup");
    setup = {
      workspaceId: "workspace-1",
      installationId: "installation-1",
      attemptId: "setup-attempt",
      revision: 1,
      branch: "reviewrouter/setup",
      workflowPath: expected.path,
      workflowStyle: "reusable",
      actionVersion: "workflow-v1",
      status: "configured",
      pullRequestUrl: null,
      pullRequestHeadSha: null,
      installedWorkflowRequirement: "gateway",
    };
  });
  const authorize = vi.fn(async () => {
    if (!authorized) throw new Error("forbidden");
  });
  const service = createInstalledGatewayReviewConfirmation({
    prisma,
    env,
    assertAuthorized: authorize,
  });
  return {
    service,
    identity,
    runtime,
    selection,
    repository,
    audits,
    operationalWrites,
    authorize,
    replaceSetup: (value: Record<string, unknown>) => {
      setup = value;
    },
    duringFinalRead: (hook: () => void) => {
      remoteHook = hook;
    },
    revoke: () => {
      authorized = false;
    },
    failAudit: () => {
      auditAvailable = false;
    },
  };
}

describe("production installed Gateway guard callbacks (no external network)", () => {
  it("verifies the real captured source/binding and records genuine operator/owner audit before writes", async () => {
    const f = fixture();
    expect(await f.service.confirm(command)).toMatchObject({
      status: "ready",
      authorityEpoch: "1",
      sourceCommitSha: head,
    });
    expect(f.operationalWrites).toEqual(["authority", "setup"]);
    expect(f.audits[0]).toMatchObject({
      actor: "reviewrouter-operator",
      action: "workflow.installed_gateway_confirmation_started",
      metadata: {
        authorizedOwnerUserId: "owner-1",
        operatorId: "reviewrouter-operator",
        scmBindingVersion: 1,
      },
    });
    expect(f.authorize.mock.calls.length).toBeGreaterThan(4);
  });
  it("passes the captured legacy binding only after installed source verification", async () => {
    const f = fixture();
    const previous = {
      workflowPath: ".github/workflows/reviewrouter-codex.yml",
      workflowStyle: "explicit",
      actionVersion: "v1",
    };
    f.replaceSetup({
      ...previous,
      workspaceId: "workspace-1",
      installationId: "installation-1",
      attemptId: "legacy-attempt",
      revision: 7,
      branch: "reviewrouter/setup",
      status: "configured",
      pullRequestUrl: null,
      pullRequestHeadSha: null,
      installedWorkflowRequirement: "gateway",
    });
    expect(await f.service.confirm(command)).toMatchObject({ status: "ready" });
    expect(io.configured).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedPreviousGatewayBinding: previous,
        expectedAttempt: { attemptId: "legacy-attempt", revision: 7 },
        workflowPath: reviewRouterWorkflowContract.callerPath,
        actionVersion: "workflow-v1",
      }),
    );
    expect(f.operationalWrites).toEqual(["authority", "setup"]);
  });
  it("keeps caller runtime channel separate from the immutable server-selected producer", async () => {
    const f = fixture();
    const runtimeCommit = "d".repeat(40);
    io.publicRequest.mockResolvedValue({ data: { sha: runtimeCommit } });
    expect(await f.service.confirm(command)).toMatchObject({
      status: "ready",
      actionCommitSha: action,
    });
    expect(f.audits[0]).toMatchObject({
      metadata: { runtimeCommitSha: runtimeCommit, actionCommitSha: action },
    });
  });
  it("rejects a caller channel moving during the final source read", async () => {
    const f = fixture();
    f.duringFinalRead(() =>
      io.publicRequest.mockResolvedValue({ data: { sha: "d".repeat(40) } }),
    );
    expect(await f.service.confirm(command)).toEqual({
      status: "conflict",
      issue: "installed_gateway_scope_changed",
    });
    expect(f.operationalWrites).toEqual([]);
  });
  it("refuses ownership revoked during the final GitHub await before provisioning", async () => {
    const f = fixture();
    f.duringFinalRead(f.revoke);
    expect(await f.service.confirm(command)).toMatchObject({
      status: "blocked",
    });
    expect(f.operationalWrites).toEqual([]);
    expect(f.audits[0]?.action).toBe(
      "workflow.installed_gateway_confirmation_started",
    );
  });
  it("rejects SCM unbind/rebind ABA (same coherent tuple, changed version) during the final GitHub await", async () => {
    const f = fixture();
    f.duringFinalRead(() => {
      f.identity.version += 2;
    });
    expect(await f.service.confirm(command)).toEqual({
      status: "conflict",
      issue: "installed_gateway_scope_changed",
    });
    expect(f.operationalWrites).toEqual([]);
  });
  it.each(["policy", "binding"])(
    "rejects a %s revision change during the final GitHub await",
    async (changed) => {
      const f = fixture();
      f.duringFinalRead(() => {
        if (changed === "policy") f.runtime.revisionToken = "policy-2";
        else f.selection.binding.revision++;
      });
      expect(await f.service.confirm(command)).toMatchObject({
        status: "conflict",
        issue: "installed_gateway_scope_changed",
      });
      expect(f.operationalWrites).toEqual([]);
    },
  );
  it("does not reach operational writes when the real pre-effect audit append fails", async () => {
    const f = fixture();
    f.failAudit();
    expect(await f.service.confirm(command)).toEqual({
      status: "blocked",
      issue: "installed_gateway_audit_unavailable",
    });
    expect(f.operationalWrites).toEqual([]);
  });
  it("does not grant setup when the binding is paused or has a pending fence", async () => {
    const f = fixture();
    f.selection.binding.state = "paused";
    expect(await f.service.confirm(command)).toEqual({
      status: "blocked",
      issue: "installed_gateway_binding_unavailable",
    });
    expect(f.audits).toEqual([]);
    expect(f.operationalWrites).toEqual([]);
  });
  it("refuses a transferred SCM scope before any provisioning", async () => {
    const f = fixture();
    f.identity.currentWorkspaceId = "foreign";
    expect(await f.service.confirm(command)).toEqual({
      status: "conflict",
      issue: "installed_gateway_scope_changed",
    });
    expect(f.audits).toEqual([]);
    expect(f.operationalWrites).toEqual([]);
  });
  it("accepts an empty/builtins-only context selection without pretending to support MCP secrets", () => {
    const f = fixture();
    expect(
      supportsInstalledGatewayReviewConfirmation({
        ...f.runtime.config,
        contextTools: {
          version: 1,
          builtinTools: ["github.issue.read"],
          mcp: [],
        },
      }),
    ).toBe(true);
    expect(
      supportsInstalledGatewayReviewConfirmation({
        ...f.runtime.config,
        contextTools: {
          version: 1,
          builtinTools: [],
          mcp: [{ connection: "external", tools: ["lookup"] }],
        },
      }),
    ).toBe(false);
  });
});
