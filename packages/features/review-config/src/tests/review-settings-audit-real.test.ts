import { randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  saveRepositoryReviewSettings,
  saveWorkspaceReviewSettings,
  setWorkspaceDefaultProvider,
} from "../application/use-cases/manage-provider-selections";
import { createWorkspaceProviderProfile } from "../application/use-cases/manage-workspace-provider-profiles";
import {
  defaultWorkspaceReviewPolicy,
  effectiveReviewSettings,
} from "../domain/review-policy-document";
import { PrismaReviewConfigurationRepository } from "../infrastructure/prisma/prisma-review-configuration-repository";
import { PrismaReviewPolicyHeadReader } from "../infrastructure/prisma/prisma-review-policy-head-reader";
import { PrismaWorkspaceProviderProfileRepository } from "../infrastructure/prisma/prisma-workspace-provider-profile-repository";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;
const workspaceSettings = effectiveReviewSettings(
  defaultWorkspaceReviewPolicy(),
  null,
);

databaseTests("review settings and audit atomicity on PostgreSQL", () => {
  let prisma: PrismaClient;
  const prefix = `settings-audit-${randomUUID().slice(0, 8)}`;
  const actor = {
    userId: `${prefix}-owner`,
    auditActor: "user:github:settings-owner",
  };
  const workspaceIds: string[] = [];
  const dependencies = (client = prisma) => ({
    configurations: new PrismaReviewConfigurationRepository(
      client,
      undefined,
      false,
      actor.userId,
    ),
    policyHeads: new PrismaReviewPolicyHeadReader(client),
    validator: { validate: async () => {} },
  });

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 5 });
    await prisma.user.create({ data: { id: actor.userId } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.delete({ where: { id: actor.userId } });
    await prisma.$disconnect();
  });

  async function fixture(withDefault = true) {
    const workspaceId = `${prefix}-${workspaceIds.length}`;
    workspaceIds.push(workspaceId);
    const repositoryId = `${workspaceId}-repo`;
    await prisma.workspace.create({
      data: { id: workspaceId, slug: workspaceId, name: workspaceId },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: actor.userId, role: "owner" },
    });
    await prisma.repositoryConnection.create({
      data: {
        id: repositoryId,
        workspaceId,
        externalRepositoryId: repositoryId,
        owner: "acme",
        name: repositoryId,
        fullName: `acme/${repositoryId}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    if (withDefault) {
      const { profile } = await createWorkspaceProviderProfile(
        {
          workspaceId,
          actor,
          credential: { kind: "hosted_pool" },
          model: "gpt-5.6-sol",
        },
        {
          profiles: new PrismaWorkspaceProviderProfileRepository(prisma, {
            operatorWorkspaceId: undefined,
            personalAccountsEnabled: false,
          }),
        },
      );
      await setWorkspaceDefaultProvider(
        {
          workspaceId,
          actor,
          selection: {
            profileId: profile.id,
            reasoningEffort: "high",
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
          },
        },
        dependencies(),
      );
    }
    return { workspaceId, repositoryId };
  }

  const settingsEvents = (workspaceId: string) =>
    prisma.auditEvent.findMany({
      where: { workspaceId, action: { startsWith: "review_config." } },
      orderBy: { createdAt: "asc" },
    });
  const versionCount = (workspaceId: string) =>
    prisma.reviewConfigurationVersion.count({ where: { workspaceId } });

  it("records the exact saved workspace configuration and authoritative version", async () => {
    const { workspaceId } = await fixture();
    const saved = await saveWorkspaceReviewSettings(
      {
        workspaceId,
        actor,
        settings: {
          ...workspaceSettings,
          blockingPolicy: { failOnSeverity: "major" },
        },
        expectedVersion: 1,
        auditMetadata: {
          accessSource: "workspace_admin",
          model: "stale-model",
          failOnSeverity: "stale-severity",
          version: -1,
          providerSelected: false,
        },
      },
      dependencies(),
    );
    expect(saved.version).toBe(2);
    const events = await settingsEvents(workspaceId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor: actor.auditActor,
      action: "review_config.saved",
      targetType: "workspace",
      targetId: workspaceId,
      metadata: {
        accessSource: "workspace_admin",
        providerKind: "codex",
        authMode: "codex_subscription_oauth_hosted_pool",
        model: saved.configuration!.config.providers[0]!.model,
        failOnSeverity: "major",
        version: 2,
        providerSelected: true,
      },
    });
  });

  it("records one correctly targeted repository save and clear with inherited policy facts", async () => {
    const { workspaceId, repositoryId } = await fixture();
    const repository = { repositoryId, capability: "direct_config" as const };
    const input = {
      workspaceId,
      actor,
      repository,
      auditMetadata: {
        repository: `acme/${repositoryId}`,
        accessSource: "repo_manager",
        accessCapability: "direct_config",
      },
    };
    await saveRepositoryReviewSettings(
      {
        ...input,
        settings: { blockingPolicy: { failOnSeverity: "major" } },
        expectedVersion: null,
      },
      dependencies(),
    );
    const cleared = await saveRepositoryReviewSettings(
      { ...input, settings: {}, expectedVersion: 1 },
      dependencies(),
    );
    const events = await settingsEvents(workspaceId);
    expect(events).toHaveLength(2);
    expect(
      events.map((event) => [event.action, event.targetType, event.targetId]),
    ).toEqual([
      ["review_config.saved", "repository", repositoryId],
      ["review_config.cleared", "repository", repositoryId],
    ]);
    expect(events[0]!.metadata).toMatchObject({
      ...input.auditMetadata,
      version: 1,
      failOnSeverity: "major",
      providerSelected: true,
    });
    expect(events[1]!.metadata).toMatchObject({
      ...input.auditMetadata,
      version: 2,
      model: cleared.configuration!.config.providers[0]!.model,
      failOnSeverity:
        cleared.configuration!.config.blockingPolicy.failOnSeverity,
      providerSelected: true,
    });
  });

  it("does not audit the implicit workspace head of the first repository settings write", async () => {
    const { workspaceId, repositoryId } = await fixture(false);
    await saveRepositoryReviewSettings(
      {
        workspaceId,
        actor,
        repository: { repositoryId, capability: "direct_config" },
        settings: { limits: { inlineMaxComments: 2 } },
        expectedVersion: null,
      },
      dependencies(),
    );
    expect(await versionCount(workspaceId)).toBe(2);
    const events = await settingsEvents(workspaceId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "review_config.saved",
      targetType: "repository",
      targetId: repositoryId,
      metadata: { version: 1, providerSelected: false },
    });
    expect(events[0]!.metadata).not.toHaveProperty("model");
  });

  it("removes stale caller policy facts when the saved workspace selects no provider", async () => {
    const { workspaceId } = await fixture(false);
    const saved = await saveWorkspaceReviewSettings(
      {
        workspaceId,
        actor,
        settings: workspaceSettings,
        expectedVersion: null,
        auditMetadata: {
          accessSource: "workspace_admin",
          providerKind: "stale-kind",
          authMode: "stale-auth",
          model: "stale-model",
          failOnSeverity: "stale-severity",
          version: -1,
          providerSelected: true,
        },
      },
      dependencies(),
    );
    expect(saved.configuration).toBeNull();
    const events = await settingsEvents(workspaceId);
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({
      accessSource: "workspace_admin",
      version: 1,
      providerSelected: false,
    });
  });

  it("leaves settings and audits unchanged on a version conflict or denied writer", async () => {
    const { workspaceId } = await fixture();
    const before = await versionCount(workspaceId);
    await expect(
      saveWorkspaceReviewSettings(
        {
          workspaceId,
          actor,
          settings: workspaceSettings,
          expectedVersion: 999,
        },
        dependencies(),
      ),
    ).rejects.toThrow("review_configuration_write_conflict");
    await expect(
      saveWorkspaceReviewSettings(
        { workspaceId, actor, settings: workspaceSettings, expectedVersion: 1 },
        {
          ...dependencies(),
          // Dashboard reauthorization runs through the caller-owned validator.
          validator: {
            validate: async () => {
              throw new Error("workspace_mutation_forbidden:missing_role");
            },
          },
        },
      ),
    ).rejects.toThrow("workspace_mutation_forbidden:missing_role");
    expect(await versionCount(workspaceId)).toBe(before);
    expect(await settingsEvents(workspaceId)).toHaveLength(0);
  });

  it.each(["workspace", "repository"] as const)(
    "rolls back the %s configuration and version when its audit append fails",
    async (scope) => {
      const { workspaceId, repositoryId } = await fixture(
        scope === "workspace",
      );
      const before = await versionCount(workspaceId);
      const configurationCount = await prisma.reviewConfiguration.count({
        where: { workspaceId },
      });
      const failingClient = prisma.$extends({
        query: {
          auditEvent: {
            create({ args, query }) {
              if (
                args.data.workspaceId === workspaceId &&
                args.data.action === "review_config.saved"
              )
                throw new Error("settings_audit_append_failed");
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
      const operation =
        scope === "workspace"
          ? saveWorkspaceReviewSettings(
              {
                workspaceId,
                actor,
                settings: { ...workspaceSettings, reviewLanguage: "fr" },
                expectedVersion: 1,
              },
              dependencies(failingClient),
            )
          : saveRepositoryReviewSettings(
              {
                workspaceId,
                actor,
                repository: { repositoryId, capability: "direct_config" },
                settings: { reviewLanguage: "fr" },
                expectedVersion: null,
              },
              dependencies(failingClient),
            );
      await expect(operation).rejects.toThrow("settings_audit_append_failed");
      expect(await versionCount(workspaceId)).toBe(before);
      expect(
        await prisma.reviewConfiguration.count({ where: { workspaceId } }),
      ).toBe(configurationCount);
      expect(await settingsEvents(workspaceId)).toHaveLength(0);
    },
  );
});
