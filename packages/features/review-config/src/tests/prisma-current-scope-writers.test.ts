import { switchRepositoryConfigurationAuthMode } from "../../../workflow-provisioning/src/infrastructure/prisma/prisma-hosted-pool-configuration";
import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  acquireReviewConfigurationWriteScope,
  PrismaReviewConfigurationRepository,
  PrismaReviewConfigurationTransactionRepository,
} from "../infrastructure/prisma/prisma-review-configuration-repository";
import {
  providerProfileFixture,
  providerProfileRowFixture,
  selectionsFor,
  storedPolicyHeadFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "./current-policy-fixture";
import { PrismaEntitlementRepository } from "../../../entitlements/src/infrastructure/prisma/prisma-entitlement-repository";
import { freeBetaEntitlement } from "../../../entitlements/src/domain/entitlement";

const target = {
  scope: "repository",
  workspaceId: "w",
  repositoryId: "r",
} as const;
const hostedProfile = providerProfileFixture({
  id: "profile_hosted",
  workspaceId: "w",
  credential: {
    kind: "hosted_pool",
    authMode: "codex_subscription_oauth_hosted_pool",
  },
  model: workspaceProviderFixture.model,
});
const workspaceHead = storedPolicyHeadFixture(
  workspacePolicyDocumentFixture(workspacePolicyFixture, [hostedProfile.id]),
);
const selections = selectionsFor(workspacePolicyFixture, [hostedProfile.id]);
function harness() {
  const events: string[] = [];
  const tx = {
    // Guards pass a Prisma.Sql; the profile lock is a tagged template.
    $queryRaw: vi.fn(async (sql: Prisma.Sql | TemplateStringsArray) => {
      const text = "text" in sql ? sql.text : sql.join("?");
      events.push(
        text.includes("WorkspaceProviderProfile")
          ? "profile-lock"
          : text.includes("lock_shared(")
            ? "shared"
            : "exclusive",
      );
      return [];
    }),
    workspaceProviderProfile: {
      findMany: vi.fn(async () => {
        events.push("profiles");
        return [providerProfileRowFixture(hostedProfile)];
      }),
      findUnique: vi.fn(async () => {
        events.push("profile-find");
        return null;
      }),
      createMany: vi.fn(async () => {
        events.push("profile-create");
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () =>
        providerProfileRowFixture({ ...hostedProfile, id: "profile_created" }),
      ),
    },
    auditEvent: {
      create: vi.fn(async () => {
        events.push("audit");
      }),
    },
    reviewConfiguration: {
      findUnique: vi.fn(
        async (input: {
          where: { workspaceId_targetKey: { targetKey: string } };
        }) => {
          events.push("config-read");
          return input.where.workspaceId_targetKey.targetKey ===
            "workspace:default"
            ? { active: true, repositoryId: null, versions: [workspaceHead] }
            : null;
        },
      ),
      upsert: vi.fn(async () => {
        events.push("target");
        return { id: "c", workspaceId: "w", active: true };
      }),
      updateMany: vi.fn(async () => {
        events.push("deactivate");
        return { count: 0 };
      }),
      deleteMany: vi.fn(async () => {
        events.push("delete");
        return { count: 0 };
      }),
    },
    reviewConfigurationVersion: {
      findFirst: vi.fn(async () => {
        events.push("version-read");
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push("version-create");
        return { ...data, id: "v" };
      }),
    },
    workspaceEntitlement: {
      upsert: vi.fn(async () => {
        events.push("entitlement");
      }),
      findUnique: vi.fn(async () => null),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (work: (transaction: typeof tx) => Promise<unknown>) => {
        events.push("begin");
        try {
          const result = await work(tx);
          events.push("commit");
          return result;
        } catch (error) {
          events.push("rollback");
          throw error;
        }
      },
    ),
    workspaceEntitlement: tx.workspaceEntitlement,
  };
  return {
    tx,
    prisma,
    events,
    client: prisma as unknown as PrismaClient,
    transaction: tx as unknown as Prisma.TransactionClient,
  };
}

describe("production config and entitlement scope writers", () => {
  it("guards the actual workflow config caller before resolution and reuses guards on save", async () => {
    const h = harness();
    expect(
      await switchRepositoryConfigurationAuthMode({
        transaction: h.transaction,
        workspaceId: "w",
        repositoryId: "r",
        authMode: "codex_subscription_oauth_hosted_pool",
      }),
    ).toBe(true);
    expect(h.events).toEqual([
      "shared",
      "shared",
      "exclusive",
      // Effective configuration: workspace and repository heads, profiles.
      "config-read",
      "config-read",
      "profiles",
      // The write rereads under the same guards, then creates the profile.
      "config-read",
      "config-read",
      "profiles",
      "profile-find",
      "profile-create",
      "audit",
      "target",
      "version-read",
      "version-create",
      "profile-lock",
    ]);
  });
  it("guards an absent repo override before target/version/provider writes in the Serializable wrapper", async () => {
    const h = harness();
    const saved = await new PrismaReviewConfigurationRepository(
      h.client,
      undefined,
      false,
      undefined,
    ).saveNextVersion({
      target,
      policy: { schemaVersion: 4, providers: selections },
      expectedVersion: null,
    });
    expect(saved.version).toBe(1);
    expect(saved.config.providers).toEqual([
      {
        ...workspacePolicyFixture.providers[0],
        authMode: "codex_subscription_oauth_hosted_pool",
      },
    ]);
    expect(h.events).toEqual([
      "begin",
      "shared",
      "shared",
      "exclusive",
      "config-read",
      "config-read",
      "profiles",
      "target",
      "version-read",
      "version-create",
      "profile-lock",
      "commit",
    ]);
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("reuses entry guards after an upstream row lock without reacquiring an ancestor", async () => {
    const h = harness();
    await acquireReviewConfigurationWriteScope(h.transaction, target);
    h.events.push("upstream-row-lock");
    const repository = new PrismaReviewConfigurationTransactionRepository(
      h.transaction,
      undefined,
      false,
      undefined,
    );
    await repository.saveNextVersion({
      target,
      policy: { schemaVersion: 4, providers: selections },
    });
    await repository.deleteTarget(target);
    expect(h.events).toEqual([
      "shared",
      "shared",
      "exclusive",
      "upstream-row-lock",
      "config-read",
      "config-read",
      "profiles",
      "target",
      "version-read",
      "version-create",
      "profile-lock",
      "config-read",
      "deactivate",
    ]);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([target, { scope: "workspace", workspaceId: "w" } as const])(
    "guards even absent deleteTarget %j in its own transaction",
    async (scope) => {
      const h = harness();
      expect(
        await new PrismaReviewConfigurationRepository(
          h.client,
          undefined,
          false,
          undefined,
        ).deleteTarget(scope),
      ).toBe(false);
      expect(h.events).toEqual([
        "begin",
        "shared",
        ...(scope.scope === "repository" ? ["shared"] : []),
        "exclusive",
        "config-read",
        "deactivate",
        "commit",
      ]);
    },
  );

  it("checks reset CAS after acquiring current scope guards before deactivation", async () => {
    const h = harness();
    await expect(
      new PrismaReviewConfigurationRepository(
        h.client,
        undefined,
        false,
        undefined,
      ).deleteTarget(target, 1),
    ).rejects.toMatchObject({ code: "review_configuration_write_conflict" });
    expect(h.events).toEqual([
      "begin",
      "shared",
      "shared",
      "exclusive",
      "config-read",
      "rollback",
    ]);
    expect(h.tx.reviewConfiguration.updateMany).not.toHaveBeenCalled();
    expect(h.tx.reviewConfiguration.deleteMany).not.toHaveBeenCalled();
  });

  it("preserves expected-version conflicts and rolls back the target insertion", async () => {
    const h = harness();
    await expect(
      new PrismaReviewConfigurationRepository(
        h.client,
        undefined,
        false,
        undefined,
      ).saveNextVersion({
        target,
        policy: { schemaVersion: 4, providers: selections },
        expectedVersion: 2,
      }),
    ).rejects.toThrow();
    expect(h.events.at(-1)).toBe("rollback");
    expect(h.tx.reviewConfigurationVersion.create).not.toHaveBeenCalled();
  });

  it("retries serialization conflicts with fresh transaction scope acquisitions", async () => {
    const h = harness();
    const retry = harness();
    h.prisma.$transaction.mockImplementationOnce(async (work) => {
      await work(h.tx);
      throw { code: "P2034" };
    });
    h.prisma.$transaction.mockImplementationOnce(async (work) =>
      work(retry.tx),
    );
    await new PrismaReviewConfigurationRepository(
      h.client,
      undefined,
      false,
      undefined,
    ).saveNextVersion({
      target,
      policy: { schemaVersion: 4, providers: selections },
    });
    // Three advisory guards and the profile lock per attempt.
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(retry.tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("blocks all persistence when guard acquisition fails", async () => {
    const h = harness();
    h.tx.$queryRaw.mockRejectedValueOnce(new Error("lock failed"));
    await expect(
      new PrismaReviewConfigurationRepository(
        h.client,
        undefined,
        false,
        undefined,
      ).saveNextVersion({
        target,
        policy: { schemaVersion: 4, providers: selections },
      }),
    ).rejects.toThrow("lock failed");
    expect(h.tx.reviewConfiguration.upsert).not.toHaveBeenCalled();
    expect(h.events).toEqual(["begin", "rollback"]);
  });

  it("protects missing entitlement insertion with shared global then exclusive workspace", async () => {
    const h = harness();
    const repository = new PrismaEntitlementRepository(h.client);
    expect(await repository.findWorkspaceEntitlement("w")).toBeNull();
    const entitlement = {
      ...freeBetaEntitlement("w"),
      status: "paused" as const,
    };
    await repository.upsertWorkspaceEntitlement(entitlement);
    expect(h.events).toEqual([
      "begin",
      "shared",
      "exclusive",
      "entitlement",
      "commit",
    ]);
    expect(h.tx.workspaceEntitlement.upsert).toHaveBeenCalledWith({
      where: { workspaceId: "w" },
      update: {
        plan: entitlement.plan,
        status: "paused",
        limits: entitlement.limits,
        flags: entitlement.flags,
      },
      create: entitlement,
    });
  });
});
