import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HashedReviewConfigurationOperatorAuthorization } from "@reviewrouter/features-review-config/composition";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  createWorkflowProvisioningOperatorAuthorization,
  readWorkflowProvisioningOperatorGrants,
  prismaWorkflowProvisioningOperatorAccess,
  type WorkflowProvisioningOperatorAccess,
} from "./workflow-provisioning-operator-authorization.js";

const credential = "test-config-operator-credential-0123456789";
const grant = {
  operatorId: "reviewrouter-operator",
  permission: "confirm_installed_gateway_workflow",
  ownerGitHubUserId: "12345",
  workspaceId: "workspace",
  repositoryIds: ["repository"],
};
function setup(grants = [grant]) {
  const access: WorkflowProvisioningOperatorAccess = {
    ownerUserId: vi.fn(async () => "owner"),
    isOwner: vi.fn(async () => true),
    repository: vi.fn(async (_workspace, name, ids) =>
      ids.includes("repository") && name === "example/repository"
        ? { id: "repository", fullName: name }
        : null,
    ),
    assertEntitled: vi.fn(async () => undefined),
  };
  const authorization = createWorkflowProvisioningOperatorAuthorization({
    grants: readWorkflowProvisioningOperatorGrants(JSON.stringify(grants)),
    access,
    authorization: new HashedReviewConfigurationOperatorAuthorization(
      "reviewrouter-operator",
      createHash("sha256").update(credential).digest("hex"),
    ),
  });
  return { access, authorization };
}
describe("installed Gateway operator scope", () => {
  it("the production membership adapter accepts owners, never admin-only delegation or another personal owner", async () => {
    const workspace = vi.fn(async () => ({
      deletionState: "active",
      personalOwnerUserId: null as string | null,
    }));
    const member = vi.fn(async () => ({ role: "admin" }));
    const prisma = {
      workspace: { findUnique: workspace },
      workspaceMember: { findFirst: member },
    } as unknown as PrismaClient;
    const access = prismaWorkflowProvisioningOperatorAccess(
      prisma,
      async () => undefined,
    );
    expect(await access.isOwner("workspace", "owner")).toBe(false);
    member.mockResolvedValue({ role: "owner" });
    expect(await access.isOwner("workspace", "owner")).toBe(true);
    workspace.mockResolvedValue({
      deletionState: "active",
      personalOwnerUserId: "another-user",
    });
    expect(await access.isOwner("workspace", "owner")).toBe(false);
    workspace.mockResolvedValue({
      deletionState: "active",
      personalOwnerUserId: "owner",
    });
    expect(await access.isOwner("workspace", "owner")).toBe(true);
  });
  it("the production identity adapter refuses disagreeing GitHub identity owners", async () => {
    const external = vi.fn(async () => ({
      userId: "owner",
      user: { githubUserId: 12345n },
    }));
    const legacy = vi.fn(async () => ({ id: "other" }));
    const access = prismaWorkflowProvisioningOperatorAccess(
      {
        userExternalIdentity: { findUnique: external },
        user: { findUnique: legacy },
      } as unknown as PrismaClient,
      async () => undefined,
    );
    expect(await access.ownerUserId("12345")).toBeNull();
    legacy.mockResolvedValue({ id: "owner" });
    expect(await access.ownerUserId("12345")).toBe("owner");
    external.mockResolvedValue({
      userId: "owner",
      user: { githubUserId: 777n },
    });
    expect(await access.ownerUserId("12345")).toBeNull();
  });
  it.each(
    [
      [{ ...grant, extra: true }],
      [{ ...grant, permission: "read_review_configuration" }],
      [{ ...grant, ownerGitHubUserId: "0" }],
      [{ ...grant, ownerGitHubUserId: "1.1" }],
      [{ ...grant, repositoryIds: [] }],
      [{ ...grant, repositoryIds: ["*"] }],
      [{ ...grant, repositoryIds: ["repository", "repository"] }],
      [grant, grant],
      Array.from({ length: 17 }, () => grant),
      [
        {
          ...grant,
          repositoryIds: Array.from({ length: 17 }, (_, i) => `repo${i}`),
        },
      ],
    ].map((grants) => ({ grants })),
  )(
    "rejects malformed or duplicate trusted grants before use: %j",
    ({ grants }) => {
      expect(() =>
        readWorkflowProvisioningOperatorGrants(JSON.stringify(grants)),
      ).toThrow("workflow_provisioning_operator_grants_invalid");
    },
  );
  it("authenticates the genuine config credential before tenant reads", async () => {
    const { access, authorization } = setup();
    await expect(
      authorization.authorize("invalid", "workspace", "example/repository"),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(access.repository).not.toHaveBeenCalled();
    expect(access.ownerUserId).not.toHaveBeenCalled();
    expect(access.assertEntitled).not.toHaveBeenCalled();
  });
  it("denies absent grants without reads even though the existing authenticator accepts the operation", async () => {
    const { access } = setup();
    const authorization = createWorkflowProvisioningOperatorAuthorization({
      access,
      grants: readWorkflowProvisioningOperatorGrants(undefined),
      authorization: new HashedReviewConfigurationOperatorAuthorization(
        "reviewrouter-operator",
        createHash("sha256").update(credential).digest("hex"),
      ),
    });
    await expect(
      authorization.authorize(credential, "workspace", "example/repository"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(access.repository).not.toHaveBeenCalled();
  });
  it.each(["wrong-operator", "wrong-workspace", "wrong-repository"])(
    "denies a different selector: %s",
    async (kind) => {
      const { authorization } = setup([
        {
          ...grant,
          ...(kind === "wrong-operator"
            ? { operatorId: "other" }
            : kind === "wrong-workspace"
              ? { workspaceId: "other" }
              : { repositoryIds: ["other"] }),
        },
      ]);
      await expect(
        authorization.authorize(credential, "workspace", "example/repository"),
      ).rejects.toMatchObject({ code: "forbidden" });
    },
  );
  it("rechecks owner identity, owner membership and entitlement on each application guard", async () => {
    const { access, authorization } = setup();
    const scope = await authorization.authorize(
      credential,
      "workspace",
      "example/repository",
    );
    expect(scope).toMatchObject({
      operatorId: "reviewrouter-operator",
      ownerUserId: "owner",
      repositoryId: "repository",
    });
    vi.mocked(access.isOwner).mockResolvedValue(false); // Includes admin-only membership.
    await expect(authorization.assertCurrent(scope)).rejects.toMatchObject({
      code: "forbidden",
    });
    vi.mocked(access.isOwner).mockResolvedValue(true);
    vi.mocked(access.ownerUserId).mockResolvedValue("another-user");
    await expect(authorization.assertCurrent(scope)).rejects.toMatchObject({
      code: "forbidden",
    });
    vi.mocked(access.ownerUserId).mockResolvedValue("owner");
    vi.mocked(access.assertEntitled).mockRejectedValue(new Error("denied"));
    await expect(authorization.assertCurrent(scope)).rejects.toThrow("denied");
  });
  it("refuses ownership revoked during the entitlement await", async () => {
    const { access, authorization } = setup();
    vi.mocked(access.assertEntitled).mockImplementation(async () => {
      vi.mocked(access.isOwner).mockResolvedValue(false);
    });
    await expect(
      authorization.authorize(credential, "workspace", "example/repository"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
