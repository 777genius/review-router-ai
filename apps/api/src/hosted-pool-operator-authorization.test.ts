import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createHostedPoolOperatorAuthorization,
  readHostedPoolOperatorScope,
} from "./hosted-pool-operator-authorization";

const scope = {
  operatorId: "operator",
  workspaceId: "workspace-a",
  workspaceIds: ["workspace-a"],
  ownerGitHubUserId: "123",
};
const credential = "temporary-fake-operator-credential";
const credentialSha256 = createHash("sha256").update(credential).digest("hex");

function membership(
  resolveAdminWorkspace: (
    current: (typeof scope),
    workspace: string,
  ) => Promise<string | null>,
) {
  return { resolveAdminWorkspace };
}

describe("hosted pool operator authority", () => {
  it("fails closed when unset or partially enabled", () => {
    expect(readHostedPoolOperatorScope({})).toBeNull();
    expect(() =>
      readHostedPoolOperatorScope({
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_ENABLED: "1",
      }),
    ).toThrow("scope_invalid");
    expect(() =>
      readHostedPoolOperatorScope({
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_ENABLED: "1",
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_WORKSPACE_ID: "workspace-a",
      }),
    ).toThrow("scope_invalid");
  });
  it("reads a single pinned workspace unchanged", () => {
    expect(
      readHostedPoolOperatorScope({
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_ENABLED: "1",
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_WORKSPACE_ID: "workspace-a",
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_OWNER_GITHUB_USER_ID: "123",
      }),
    ).toEqual({
      operatorId: "reviewrouter-operator",
      workspaceId: "workspace-a",
      workspaceIds: ["workspace-a"],
      ownerGitHubUserId: "123",
    });
  });
  it("accepts a comma-separated unique workspace allowlist", () => {
    expect(
      readHostedPoolOperatorScope({
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_ENABLED: "1",
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_WORKSPACE_ID: "id-a,,id-b, ",
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_OWNER_GITHUB_USER_ID: "123",
      }),
    ).toEqual({
      operatorId: "reviewrouter-operator",
      workspaceId: "id-a",
      workspaceIds: ["id-a", "id-b"],
      ownerGitHubUserId: "123",
    });
  });
  it("fails closed on duplicate workspace ids", () => {
    expect(() =>
      readHostedPoolOperatorScope({
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_ENABLED: "1",
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_WORKSPACE_ID: "id-a, id-a",
        REVIEW_ROUTER_HOSTED_POOL_OPERATOR_OWNER_GITHUB_USER_ID: "123",
      }),
    ).toThrow("hosted_pool_operator_scope_invalid");
  });
  it("authenticates before membership reads and rejects foreign workspace", async () => {
    const resolveAdminWorkspace = vi.fn(async (_scope, workspace) =>
      workspace === scope.workspaceId ? workspace : null,
    );
    const authorize = createHostedPoolOperatorAuthorization({
      scope,
      credentialSha256,
      membership: membership(resolveAdminWorkspace),
    });
    await expect(authorize("wrong", "workspace-a")).rejects.toThrow(
      "unauthorized",
    );
    expect(resolveAdminWorkspace).not.toHaveBeenCalled();
    await expect(authorize(credential, "workspace-b")).rejects.toThrow(
      "forbidden",
    );
    expect(await authorize(credential, "workspace-a")).toEqual(scope);
  });
  it("returns the requested allowlisted workspace, not the first env id", async () => {
    const allowlist = {
      ...scope,
      workspaceId: "id-a",
      workspaceIds: ["id-a", "id-b"],
    };
    const resolveAdminWorkspace = vi.fn(async (_scope, workspace) =>
      workspace === "id-b" ? "id-b" : null,
    );
    const authorize = createHostedPoolOperatorAuthorization({
      scope: allowlist,
      credentialSha256,
      membership: membership(resolveAdminWorkspace),
    });
    await expect(authorize(credential, "id-b")).resolves.toEqual({
      ...allowlist,
      workspaceId: "id-b",
    });
  });
  it("resolves an allowlisted workspace by slug", async () => {
    const allowlist = {
      ...scope,
      workspaceId: "id-a",
      workspaceIds: ["id-a", "id-b"],
    };
    const resolveAdminWorkspace = vi.fn(async (_scope, workspace) =>
      workspace === "slug-b" ? "id-b" : null,
    );
    const authorize = createHostedPoolOperatorAuthorization({
      scope: allowlist,
      credentialSha256,
      membership: membership(resolveAdminWorkspace),
    });
    await expect(authorize(credential, "slug-b")).resolves.toEqual({
      ...allowlist,
      workspaceId: "id-b",
    });
  });
  it("does not cache revoked membership", async () => {
    let member = true;
    const authorize = createHostedPoolOperatorAuthorization({
      scope,
      credentialSha256,
      membership: membership(async () => (member ? scope.workspaceId : null)),
    });
    await authorize(credential, "workspace-a");
    member = false;
    await expect(authorize(credential, "workspace-a")).rejects.toThrow(
      "forbidden",
    );
  });
});
