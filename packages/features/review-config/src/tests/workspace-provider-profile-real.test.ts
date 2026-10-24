import { randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWorkspaceProviderProfile,
  listWorkspaceProviderProfiles,
  renameWorkspaceProviderProfile,
} from "../application/use-cases/manage-workspace-provider-profiles";
import { PrismaWorkspaceProviderProfileRepository } from "../infrastructure/prisma/prisma-workspace-provider-profile-repository";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

databaseTests("WorkspaceProviderProfile PostgreSQL storage", () => {
  let prisma: PrismaClient;
  let profiles: PrismaWorkspaceProviderProfileRepository;
  const prefix = `profile-${randomUUID()}`;
  const workspaceA = `${prefix}-a`;
  const workspaceB = `${prefix}-b`;
  const owner = { userId: `${prefix}-owner`, auditActor: "user:github:owner" };
  const creator = {
    userId: `${prefix}-creator`,
    auditActor: "user:github:creator",
  };
  const member = {
    userId: `${prefix}-member`,
    auditActor: "user:github:member",
  };
  const repositoryA = `${prefix}-repo-a`;
  const bindingA = `${prefix}-binding-a`;
  const bindingB = `${prefix}-binding-b`;
  const keyB = `${prefix}-key-b`;
  const maintain = {
    repositoryId: repositoryA,
    capability: "direct_config",
  } as const;
  const deps = () => ({ profiles });
  const gatewayDraft = (bindingId: string, model = "gpt-5.6-sol") => ({
    credential: { kind: "gateway_binding", bindingId },
    model,
  });

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 10 });
    profiles = new PrismaWorkspaceProviderProfileRepository(prisma);
    for (const id of [workspaceA, workspaceB])
      await prisma.workspace.create({ data: { id, slug: id, name: id } });
    for (const user of [owner, creator, member])
      await prisma.user.create({ data: { id: user.userId } });
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceA, userId: owner.userId, role: "owner" },
        { workspaceId: workspaceA, userId: creator.userId, role: "member" },
        { workspaceId: workspaceA, userId: member.userId, role: "member" },
      ],
    });
    await prisma.repositoryConnection.create({
      data: {
        id: repositoryA,
        workspaceId: workspaceA,
        externalRepositoryId: `${prefix}-external`,
        owner: "acme",
        name: "widget",
        fullName: `acme/${prefix}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    for (const [workspaceId, bindingId] of [
      [workspaceA, bindingA],
      [workspaceB, bindingB],
    ] as const) {
      const connection = await prisma.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspaceId,
          gatewayAccountRef: `${bindingId}-account`,
          profileRef: "profile-ref-1",
          displayName: "Team account",
          state: "active",
        },
      });
      await prisma.workspaceAccountBinding.create({
        data: {
          id: bindingId,
          workspaceId,
          connectionId: connection.id,
          state: "active",
        },
      });
    }
    await prisma.providerApiKeyConnection.create({
      data: {
        id: keyB,
        workspaceId: workspaceB,
        providerType: "mimo",
        encryptedApiKey: "test-ciphertext",
        keyVersion: 1,
        latestOperationId: `${prefix}-operation`,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    const workspaces = { in: [workspaceA, workspaceB] };
    await prisma.workspaceProviderProfile.deleteMany({
      where: { workspaceId: workspaces },
    });
    await prisma.workspaceAccountBinding.deleteMany({
      where: { workspaceId: workspaces },
    });
    await prisma.providerAccountConnection.deleteMany({
      where: { ownerWorkspaceId: workspaces },
    });
    await prisma.workspace.deleteMany({ where: { id: workspaces } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it("creates one profile and one audit event under a find-or-create race", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createWorkspaceProviderProfile(
          { workspaceId: workspaceA, actor: owner, ...gatewayDraft(bindingA) },
          deps(),
        ),
      ),
    );
    expect(new Set(results.map((result) => result.profile.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]!.profile).toMatchObject({
      createdByUserId: owner.userId,
      credential: {
        kind: "gateway_binding",
        bindingId: bindingA,
        // Captured from the binding, never from the request.
        gatewayProfileRef: "profile-ref-1",
      },
    });
    expect(
      await prisma.workspaceProviderProfile.count({
        where: { workspaceId: workspaceA },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { workspaceId: workspaceA, action: "provider_profile.created" },
      }),
    ).toBe(1);
    expect(
      (await listWorkspaceProviderProfiles(workspaceA, deps())).map(
        (profile) => profile.id,
      ),
    ).toEqual([results[0]!.profile.id]);
  });

  it("rejects references of another workspace by composite keys", async () => {
    const base = {
      workspaceId: workspaceA,
      createdByUserId: owner.userId,
      model: "gpt-5.6-sol",
      label: "Foreign",
    };
    await expect(
      prisma.workspaceProviderProfile.create({
        data: {
          ...base,
          credentialKind: "gateway_binding",
          authMode: "codex_account_gateway",
          gatewayBindingId: bindingB,
          gatewayProfileRef: "profile-ref-1",
          identityKey: `${prefix}-foreign-binding`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.workspaceProviderProfile.create({
        data: {
          ...base,
          credentialKind: "managed_api_key",
          authMode: "mimo_token_plan_api_key",
          apiKeyConnectionId: keyB,
          identityKey: `${prefix}-foreign-key`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    // The application path refuses the foreign binding before any write.
    await expect(
      createWorkspaceProviderProfile(
        { workspaceId: workspaceA, actor: owner, ...gatewayDraft(bindingB) },
        deps(),
      ),
    ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
    // Workspace A has no managed key of its own.
    await expect(
      createWorkspaceProviderProfile(
        {
          workspaceId: workspaceA,
          actor: owner,
          credential: {
            kind: "managed_api_key",
            authMode: "mimo_token_plan_api_key",
          },
          model: "mimo-v2.6-pro",
        },
        deps(),
      ),
    ).rejects.toThrow("provider_profile_credential_unavailable");
  });

  it("requires exactly the reference of the credential kind", async () => {
    const base = {
      workspaceId: workspaceA,
      createdByUserId: owner.userId,
      model: "sonnet",
      label: "Broken",
    };
    for (const data of [
      {
        ...base,
        credentialKind: "user_ci_secret" as const,
        authMode: "claude_code_oauth",
        gatewayBindingId: bindingA,
        identityKey: `${prefix}-extra-reference`,
      },
      {
        ...base,
        credentialKind: "gateway_binding" as const,
        authMode: "codex_account_gateway",
        gatewayBindingId: bindingA,
        identityKey: `${prefix}-missing-profile-ref`,
      },
      {
        ...base,
        credentialKind: "user_ci_secret" as const,
        authMode: "claude_code_oauth",
        identityKey: null,
      },
      {
        ...base,
        credentialKind: "user_ci_secret" as const,
        authMode: "claude_code_oauth",
        label: "ghp_looks-like-a-token",
        identityKey: `${prefix}-secret-label`,
      },
    ])
      await expect(
        prisma.workspaceProviderProfile.create({ data }),
      ).rejects.toThrow(/WorkspaceProviderProfile_/);
  });

  it("keeps the credential source immutable while label and model change", async () => {
    const { profile } = await createWorkspaceProviderProfile(
      {
        workspaceId: workspaceA,
        actor: creator,
        credential: { kind: "user_ci_secret", authMode: "claude_code_oauth" },
        model: "sonnet",
        repository: maintain,
      },
      deps(),
    );
    const where = { id: profile.id };
    for (const data of [
      { authMode: "openrouter_api_key" },
      { credentialKind: "managed_api_key" as const },
      { repositoryId: repositoryA },
      { workspaceId: workspaceB },
      { createdByUserId: member.userId },
    ])
      await expect(
        prisma.workspaceProviderProfile.update({ where, data }),
      ).rejects.toThrow("workspace_provider_profile_credential_immutable");
    await prisma.workspaceProviderProfile.update({
      where,
      data: { model: "opus", label: "Claude review" },
    });
    // Deleting the creator only clears the reference.
    const transient = `${prefix}-transient`;
    await prisma.user.create({ data: { id: transient } });
    const owned = await prisma.workspaceProviderProfile.create({
      data: {
        workspaceId: workspaceA,
        createdByUserId: transient,
        credentialKind: "hosted_pool",
        authMode: "codex_subscription_oauth_hosted_pool",
        model: "gpt-5.6-sol",
        label: "Hosted",
        identityKey: `${prefix}-hosted`,
      },
    });
    await prisma.user.delete({ where: { id: transient } });
    expect(
      await prisma.workspaceProviderProfile.findUniqueOrThrow({
        where: { id: owned.id },
      }),
    ).toMatchObject({
      createdByUserId: null,
      credentialKind: "hosted_pool",
    });
  });

  it("lets the creator rename until Access rights restrict it to admins", async () => {
    const { profile } = await createWorkspaceProviderProfile(
      {
        workspaceId: workspaceA,
        actor: creator,
        ...gatewayDraft(bindingA, "gpt-5.5"),
        label: "Team gateway",
        repository: maintain,
      },
      deps(),
    );
    const rename = (actor: typeof owner, label: string) =>
      renameWorkspaceProviderProfile(
        { workspaceId: workspaceA, profileId: profile.id, actor, label },
        deps(),
      );
    await expect(rename(member, "Taken over")).rejects.toThrow(
      "provider_management_forbidden:profile_creator_required",
    );
    await expect(rename(creator, "Team gateway 5.5")).resolves.toMatchObject({
      label: "Team gateway 5.5",
      credential: { kind: "gateway_binding", bindingId: bindingA },
    });
    await prisma.workspace.update({
      where: { id: workspaceA },
      data: { providerManagementAdminOnly: true },
    });
    try {
      await expect(rename(creator, "Mine again")).rejects.toThrow(
        "provider_management_forbidden:access_rights_admin_only",
      );
      await expect(
        createWorkspaceProviderProfile(
          {
            workspaceId: workspaceA,
            actor: member,
            ...gatewayDraft(bindingA, "gpt-5.4"),
            repository: maintain,
          },
          deps(),
        ),
      ).rejects.toThrow(
        "provider_management_forbidden:access_rights_admin_only",
      );
      await expect(rename(owner, "Admin label")).resolves.toMatchObject({
        label: "Admin label",
      });
    } finally {
      await prisma.workspace.update({
        where: { id: workspaceA },
        data: { providerManagementAdminOnly: false },
      });
    }
    expect(
      await prisma.auditEvent.findMany({
        where: { targetId: profile.id, action: "provider_profile.renamed" },
        select: { actor: true, metadata: true },
        orderBy: { createdAt: "asc" },
      }),
    ).toEqual([
      {
        actor: creator.auditActor,
        metadata: expect.objectContaining({
          previousLabel: "Team gateway",
          label: "Team gateway 5.5",
        }),
      },
      {
        actor: owner.auditActor,
        metadata: expect.objectContaining({ label: "Admin label" }),
      },
    ]);
  });
});
