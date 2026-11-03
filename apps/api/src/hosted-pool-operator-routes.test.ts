import { WorkflowProvisioningOutcomeError } from "@reviewrouter/features-workflow-provisioning";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerHostedPoolOperatorRoutes } from "./hosted-pool-operator-routes";
import { createHostedPoolOperatorAuthorization } from "./hosted-pool-operator-authorization";
import { createHash } from "node:crypto";

const scope = {
  operatorId: "operator",
  workspaceId: "workspace",
  workspaceIds: ["workspace"],
  ownerGitHubUserId: "123",
};
const credential = "temporary-fake-credential-for-tests";
async function fixture() {
  let member = true;
  const authorize = createHostedPoolOperatorAuthorization({
    scope,
    credentialSha256: createHash("sha256").update(credential).digest("hex"),
    membership: {
      resolveAdminWorkspace: async (_scope, workspace) =>
        member && workspace === scope.workspaceId ? scope.workspaceId : null,
    },
  });
  const execute = vi.fn(async (scope, command, auth?: Uint8Array) => {
    void scope;
    void command;
    void auth;
    return { status: "imported" };
  });
  const status = vi.fn(async () => ({ pool: null }));
  const app = Fastify({ logger: false });
  await registerHostedPoolOperatorRoutes(app, {
    authorize,
    assertEntitled: async () => {},
    status,
    execute,
  });
  return {
    app,
    execute,
    status,
    revoke: () => {
      member = false;
    },
  };
}
describe("hosted pool HTTP boundary", () => {
  it("rejects credential and cross-tenant requests before reads or mutations", async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.app.inject({
            url: "/api/operator/v1/hosted-pool?workspace=workspace",
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await f.app.inject({
            url: "/api/operator/v1/hosted-pool?workspace=foreign",
            headers: { authorization: `Bearer ${credential}` },
          })
        ).statusCode,
      ).toBe(403);
      expect(f.status).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it("checks revoked membership on each request", async () => {
    const f = await fixture();
    try {
      const request = {
        url: "/api/operator/v1/hosted-pool?workspace=workspace",
        headers: { authorization: `Bearer ${credential}` },
      };
      expect((await f.app.inject(request)).statusCode).toBe(200);
      f.revoke();
      expect((await f.app.inject(request)).statusCode).toBe(403);
      expect(f.status).toHaveBeenCalledTimes(1);
    } finally {
      await f.app.close();
    }
  });
  it("does not accept server file paths or noncanonical/oversized auth", async () => {
    const f = await fixture();
    try {
      for (const payload of [
        {
          workspace: "workspace",
          label: "primary",
          authFile: "/arbitrary/server/path",
        },
        { workspace: "workspace", label: "primary", authBase64: "not base64" },
        {
          workspace: "workspace",
          label: "primary",
          authBase64: Buffer.alloc(1024 * 1024 + 1).toString("base64"),
        },
      ])
        expect(
          (
            await f.app.inject({
              method: "POST",
              url: "/api/operator/v1/hosted-pool/accounts/import",
              headers: { authorization: `Bearer ${credential}` },
              payload,
            })
          ).statusCode,
        ).toBe(400);
      expect(f.execute).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it("redacts arbitrary adapter errors and clears decoded bytes on failure", async () => {
    const f = await fixture();
    let observed: Uint8Array | undefined;
    f.execute.mockImplementation(async (_scope, _command, bytes) => {
      observed = bytes;
      throw new Error("temporary-fake-provider-secret");
    });
    try {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/operator/v1/hosted-pool/accounts/import",
        headers: { authorization: `Bearer ${credential}` },
        payload: {
          workspace: "workspace",
          label: "primary",
          authBase64: Buffer.from("temporary-fake-provider-secret").toString(
            "base64",
          ),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.body).not.toContain("temporary-fake-provider-secret");
      expect(observed?.every((byte) => byte === 0)).toBe(true);
    } finally {
      await f.app.close();
    }
  });
});

it.each(["superseded", "persistence_uncertain", "audit_unavailable"] as const)(
  "projects %s workflow outcomes without leaking internal evidence",
  async (outcome) => {
    const f = await fixture();
    const committed = outcome === "audit_unavailable";
    f.execute.mockRejectedValue(
      new WorkflowProvisioningOutcomeError(
        `workflow_provisioning_${outcome}`,
        {
          attempt: {
            workspaceId: "workspace",
            repositoryId: "internal-repo",
            installationId: "internal-installation",
            attemptId: "internal-attempt",
            revision: 1,
            branch: "internal-branch",
          },
          stage: committed ? "success_audit" : "completion",
          mayHaveExternalEffects: true,
          observedPullRequest: {
            url: "https://github.com/acme/repo/pull/7",
            number: 7,
            headSha: "a".repeat(40),
            branch: "internal-branch",
          },
        },
        { cause: new Error("private-upstream-detail") },
      ),
    );
    try {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/operator/v1/hosted-pool/connect",
        headers: { authorization: `Bearer ${credential}` },
        payload: {
          workspace: "workspace",
          repository: "acme/repo",
          expectedRevision: null,
        },
      });
      expect(response.statusCode).toBe(outcome === "superseded" ? 409 : 503);
      expect(response.json()).toEqual({
        error: {
          code:
            outcome === "superseded"
              ? "hosted_pool_conflict"
              : `workflow_provisioning_${outcome}`,
        },
        ...(committed
          ? {
              result: {
                status: "setup_pr_recorded",
                pullRequestUrl: "https://github.com/acme/repo/pull/7",
                pullRequestNumber: 7,
              },
            }
          : {}),
      });
      expect(response.body).not.toMatch(
        /private-upstream-detail|internal-|headSha|cause|observedPullRequest/,
      );
    } finally {
      await f.app.close();
    }
  },
);
