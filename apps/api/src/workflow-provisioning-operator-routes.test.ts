import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { HashedReviewConfigurationOperatorAuthorization } from "@reviewrouter/features-review-config/composition";
import { createApiApp } from "./app.js";
import { executeReviewRouterOperatorCli } from "./reviewrouter-operator-cli.js";
import { createWorkflowProvisioningOperatorAuthorization } from "./workflow-provisioning-operator-authorization.js";
import type { WorkflowProvisioningOperatorDependencies } from "./workflow-provisioning-operator-routes.js";

const credential = "test-real-config-operator-credential-0123456789";
const body = {
  workspace: "workspace",
  repository: "example/repository",
  confirm: "example/repository",
};
const path = "/api/operator/v1/workflow-provisioning/confirm-installed-gateway";
const ready = {
  status: "ready",
  outcome: "restored",
  repositoryId: "repository",
  repository: "example/repository",
  authorityVersion: 1,
  authorityEpoch: "epoch",
  workflowPath: ".github/workflows/reviewrouter-review.yml",
  sourceCommitSha: "a".repeat(40),
  callerBlobSha: "b".repeat(40),
  actionCommitSha: "c".repeat(40),
  attemptId: "attempt",
  revision: 1,
} as const;
const apps: FastifyInstance[] = [];
// Set by the post-build remote qualification lane; ordinary unit runs use source.
const compiledCli = process.env.REVIEW_ROUTER_COMPILED_OPERATOR_CLI_PATH;
function runCompiledCli(
  origin: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=production",
        compiledCli!,
        "repositories",
        "confirm-installed",
        "--workspace",
        "workspace",
        "--repo",
        "example/repository",
        "--confirm",
        "example/repository",
      ],
      {
        env: {
          ...process.env,
          REVIEW_ROUTER_API_URL: origin,
          REVIEW_ROUTER_REVIEW_CONFIG_OPERATOR_CREDENTIAL: credential,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
async function setup() {
  const access = {
    ownerUserId: vi.fn(async () => "owner"),
    isOwner: vi.fn(async () => true),
    repository: vi.fn(async () => ({
      id: "repository",
      fullName: "example/repository",
    })),
    assertEntitled: vi.fn(async () => undefined),
  };
  const dependencies: WorkflowProvisioningOperatorDependencies = {
    authorization: createWorkflowProvisioningOperatorAuthorization({
      authorization: new HashedReviewConfigurationOperatorAuthorization(
        "reviewrouter-operator",
        createHash("sha256").update(credential).digest("hex"),
      ),
      grants: [
        {
          operatorId: "reviewrouter-operator",
          permission: "confirm_installed_gateway_workflow",
          ownerGitHubUserId: "12345",
          workspaceId: "workspace",
          repositoryIds: ["repository"],
        },
      ],
      access,
    }),
    rateLimits: { consume: vi.fn(async () => true) },
    confirm: vi.fn(async () => ready),
  };
  const app = await createApiApp({
    reviewActionV2Env: {},
    workflowProvisioningOperatorDependencies: dependencies,
  });
  apps.push(app);
  return { app, dependencies, access };
}
describe("installed Gateway genuine operator HTTP boundary", () => {
  it("does not reflect malformed JSON or oversized bodies", async () => {
    const { app, dependencies } = await setup();
    for (const payload of [
      `{"private":"${credential}",`,
      JSON.stringify({ ...body, private: credential.repeat(100) }),
    ]) {
      const response = await app.inject({
        method: "POST",
        url: path,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credential}`,
        },
        payload,
      });
      expect([400, 413]).toContain(response.statusCode);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain(credential);
      expect(response.json()).toEqual({ error: { code: "invalid_request" } });
    }
    expect(dependencies.confirm).not.toHaveBeenCalled();
  });
  it("uses the existing CLI/profile transport through the normal API composition over loopback HTTP", async () => {
    const { app, dependencies } = await setup();
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const compiled = compiledCli ? await runCompiledCli(origin) : null;
    if (compiled) {
      expect(compiled.code).toBe(0);
      expect(compiled.stderr).toBe("");
    }
    const result = compiled
      ? JSON.parse(compiled.stdout)
      : await executeReviewRouterOperatorCli(
          [
            "repositories",
            "confirm-installed",
            "--workspace",
            "workspace",
            "--repo",
            "example/repository",
            "--confirm",
            "example/repository",
          ],
          {
            REVIEW_ROUTER_API_URL: origin,
            REVIEW_ROUTER_REVIEW_CONFIG_OPERATOR_CREDENTIAL: credential,
          },
        );
    expect(result).toEqual(ready);
    expect(dependencies.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        operatorId: "reviewrouter-operator",
        ownerUserId: "owner",
        repositoryId: "repository",
      }),
    );
    expect(JSON.stringify(result)).not.toContain(credential);
  });
  it.skipIf(!compiledCli)(
    "compiled CLI exits nonzero for blocked, conflict and sanitized HTTP failures",
    async () => {
      const { app, dependencies } = await setup();
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      for (const status of ["blocked", "conflict"] as const) {
        vi.mocked(dependencies.confirm).mockResolvedValueOnce({
          status,
          issue: "installed_gateway_scope_changed",
        });
        const result = await runCompiledCli(origin);
        expect(result.code).toBe(1);
        expect(JSON.parse(result.stdout)).toEqual({
          status,
          issue: "installed_gateway_scope_changed",
        });
        expect(result.stderr).toBe("");
      }
      vi.mocked(dependencies.confirm).mockRejectedValueOnce(
        new Error(credential),
      );
      const failure = await runCompiledCli(origin);
      expect(failure.code).toBe(1);
      expect(failure.stderr).toBe(
        "reviewrouter_operator_workflow_confirmation_failed\n",
      );
      expect(failure.stdout + failure.stderr).not.toContain(credential);
    },
  );
  it("rejects credentials before reads, rate-limit persistence or confirmation", async () => {
    const { app, dependencies, access } = await setup();
    const response = await app.inject({
      method: "POST",
      url: path,
      headers: { authorization: "Bearer incorrect" },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(access.repository).not.toHaveBeenCalled();
    expect(dependencies.rateLimits.consume).not.toHaveBeenCalled();
    expect(dependencies.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, confirm: "other/repository" },
    { ...body, ownerUserId: "forged" },
    { ...body, installed: true },
    { ...body, sourceCommitSha: "a".repeat(40) },
    { ...body, provider: "github" },
  ])(
    "rejects supplied proofs, identity and broadening fields %j",
    async (payload) => {
      const { app, dependencies } = await setup();
      const response = await app.inject({
        method: "POST",
        url: path,
        headers: { authorization: `Bearer ${credential}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(dependencies.confirm).not.toHaveBeenCalled();
    },
  );
  it("rechecks owner authority after a rate-limit await", async () => {
    const { app, dependencies, access } = await setup();
    vi.mocked(dependencies.rateLimits.consume).mockImplementation(async () => {
      access.isOwner.mockResolvedValue(false);
      return true;
    });
    const response = await app.inject({
      method: "POST",
      url: path,
      headers: { authorization: `Bearer ${credential}` },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
    expect(dependencies.confirm).not.toHaveBeenCalled();
  });
  it("returns finite blocked outcomes and redacts unexpected upstream failures", async () => {
    const { app, dependencies } = await setup();
    vi.mocked(dependencies.confirm).mockResolvedValueOnce({
      status: "blocked",
      issue: "installed_gateway_transport_unsupported",
    });
    const request = {
      method: "POST" as const,
      url: path,
      headers: { authorization: `Bearer ${credential}` },
      payload: body,
    };
    expect((await app.inject(request)).json()).toEqual({
      result: {
        status: "blocked",
        issue: "installed_gateway_transport_unsupported",
      },
    });
    vi.mocked(dependencies.confirm).mockRejectedValueOnce(
      new Error(`private upstream ${credential}`),
    );
    const response = await app.inject(request);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(credential);
    expect(response.json()).toEqual({
      error: { code: "workflow_confirmation_unavailable" },
    });
  });
  it("does not expose the route without an explicit trusted grant", async () => {
    const app = await createApiApp({ reviewActionV2Env: {} });
    apps.push(app);
    expect(
      (await app.inject({ method: "POST", url: path, payload: body }))
        .statusCode,
    ).toBe(404);
  });
});
