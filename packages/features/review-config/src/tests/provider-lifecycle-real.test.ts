import { randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveWorkspaceProviderProfile,
  changeWorkspaceProviderProfileModel,
  createWorkspaceProviderProfile,
  renameWorkspaceProviderProfile,
} from "../application/use-cases/manage-workspace-provider-profiles";
import {
  assignProviderProfileToRepositories,
  clearRepositoryProviderSelection,
  setWorkspaceDefaultProvider,
  type EffectiveReviewConfigurationValidatorPort,
  type ProviderSelectionDraft,
} from "../application/use-cases/manage-provider-selections";
import type { ProviderProfileModelChangeValidator } from "../application/use-cases/manage-workspace-provider-profiles";
import { resolveEffectiveReviewConfiguration } from "../application/use-cases/resolve-effective-review-configuration";
import { ProviderManagementDeniedError } from "../domain/provider-management-policy";
import { reviewConfigurationTargetKey } from "../domain/review-configuration-target";
import { defaultWorkspaceReviewPolicy } from "../domain/review-policy-document";
import {
  defaultProviderProfileLabel,
  ProviderProfileError,
  type ProviderCredentialSource,
} from "../domain/workspace-provider-profile";
import { PrismaReviewConfigurationRepository } from "../infrastructure/prisma/prisma-review-configuration-repository";
import { PrismaReviewPolicyHeadReader } from "../infrastructure/prisma/prisma-review-policy-head-reader";
import { PrismaWorkspaceProviderProfileRepository } from "../infrastructure/prisma/prisma-workspace-provider-profile-repository";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

databaseTests("provider profile lifecycle on PostgreSQL", () => {
  let prisma: PrismaClient;
  const prefix = `lifecycle-${randomUUID().slice(0, 8)}`;
  const workspaceId = `${prefix}-w`;
  const actor = (name: string) => ({
    userId: `${prefix}-${name}`,
    auditActor: `user:github:${name}`,
  });
  const owner = actor("owner");
  const member = actor("member");
  const outsider = actor("outsider");
  const repoA = `${prefix}-repo-a`;
  const repoB = `${prefix}-repo-b`;
  const secret = `sk-${prefix}-plaintext-secret`;
  const settings = {
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  } as const;
  // The caller-owned environment checks are not under test here.
  const acceptAll: EffectiveReviewConfigurationValidatorPort = {
    validate: async () => {},
  };
  const acceptModelChange: ProviderProfileModelChangeValidator = {
    beforeTransaction: async () => {},
    scope: () => {},
  };
  let deps: {
    configurations: PrismaReviewConfigurationRepository;
    policyHeads: PrismaReviewPolicyHeadReader;
    validator: EffectiveReviewConfigurationValidatorPort;
  };
  let profiles: { profiles: PrismaWorkspaceProviderProfileRepository };
  const countProfiles = () =>
    prisma.workspaceProviderProfile.count({ where: { workspaceId } });
  const countVersions = () =>
    prisma.reviewConfigurationVersion.count({ where: { workspaceId } });
  const hostedProfile = async (model: string) =>
    (
      await createWorkspaceProviderProfile(
        {
          workspaceId,
          actor: owner,
          credential: { kind: "hosted_pool" },
          model,
        },
        profiles,
      )
    ).profile;
  /** A new provider requested together with its first attach. */
  const draftOf = (
    credential: unknown,
    source: ProviderCredentialSource,
    model: string,
  ): ProviderSelectionDraft => ({
    draft: {
      draftId: "draft-0",
      credential: credential as never,
      model,
      label: null,
    },
    profile: {
      id: "draft-0",
      workspaceId,
      createdByUserId: null,
      credential: source,
      model,
      label: "draft-0",
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  });
  const attachDraft = async (
    who: typeof owner,
    capability: "repo_manager" | "direct_config" | null,
    repositoryId: string,
    draft: ProviderSelectionDraft,
  ) => {
    const [result] = await assignProviderProfileToRepositories(
      {
        workspaceId,
        actor: who,
        profileId: draft.draft.draftId,
        settings,
        draft,
        repositories: [{ repositoryId, capability }],
      },
      deps,
    );
    return result!;
  };
  const denialOf = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    if (!(error instanceof ProviderManagementDeniedError))
      throw error ?? new Error("provider_management_denial_expected");
    return error.reason;
  };

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 10 });
    deps = {
      configurations: new PrismaReviewConfigurationRepository(
        prisma,
        undefined,
        false,
        undefined,
      ),
      policyHeads: new PrismaReviewPolicyHeadReader(prisma),
      validator: acceptAll,
    };
    profiles = {
      profiles: new PrismaWorkspaceProviderProfileRepository(prisma, {
        operatorWorkspaceId: undefined,
        personalAccountsEnabled: false,
      }),
    };
    await prisma.workspace.create({
      data: { id: workspaceId, slug: workspaceId, name: workspaceId },
    });
    for (const user of [owner, member, outsider])
      await prisma.user.create({ data: { id: user.userId } });
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: owner.userId, role: "owner" },
        { workspaceId, userId: member.userId, role: "member" },
      ],
    });
    for (const id of [repoA, repoB])
      await prisma.repositoryConnection.create({
        data: {
          id,
          workspaceId,
          externalRepositoryId: id,
          owner: "acme",
          name: id,
          fullName: `acme/${id}`,
          defaultBranch: "main",
          visibility: "private",
        },
      });
    // A managed MiMo key that is not applied to any repository yet.
    await prisma.providerApiKeyConnection.create({
      data: {
        workspaceId,
        providerType: "mimo",
        encryptedApiKey: secret,
        keyVersion: 1,
        latestOperationId: `${prefix}-key-operation`,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it("decides a new provider together with its attach, leaving nothing on refusal", async () => {
    const before = {
      profiles: await countProfiles(),
      versions: await countVersions(),
    };
    const claude = draftOf(
      { kind: "user_ci_secret", authMode: "claude_code_oauth" },
      { kind: "user_ci_secret", authMode: "claude_code_oauth" },
      "opus",
    );
    const key = await prisma.providerApiKeyConnection.findFirstOrThrow({
      where: { workspaceId, providerType: "mimo" },
    });
    const mimo = draftOf(
      { kind: "managed_api_key", authMode: "mimo_token_plan_api_key" },
      {
        kind: "managed_api_key",
        authMode: "mimo_token_plan_api_key",
        apiKeyConnectionId: key.id,
      },
      "mimo-v2.6-pro",
    );
    expect(await attachDraft(member, null, repoA, claude)).toMatchObject({
      status: "denied",
      reason: "repository_direct_config_required",
    });
    // Applying a managed key stays an admin flow.
    expect(
      await attachDraft(member, "direct_config", repoA, mimo),
    ).toMatchObject({ status: "denied", reason: "workspace_admin_required" });
    expect(
      await attachDraft(outsider, "direct_config", repoA, claude),
    ).toMatchObject({ status: "denied", reason: "workspace_member_required" });
    // No profile, no workspace document and no repository version.
    expect({
      profiles: await countProfiles(),
      versions: await countVersions(),
    }).toEqual(before);

    const saved = await attachDraft(member, "direct_config", repoA, claude);
    expect(saved).toMatchObject({ status: "applied" });
    expect(
      (
        await deps.configurations.findLatest({
          scope: "repository",
          workspaceId,
          repositoryId: repoA,
        })
      )?.config.providers,
    ).toEqual([
      expect.objectContaining({
        kind: "claude",
        authMode: "claude_code_oauth",
      }),
    ]);
    const created = await prisma.workspaceProviderProfile.findMany({
      where: { workspaceId },
    });
    expect(created).toEqual([
      expect.objectContaining({
        credentialKind: "user_ci_secret",
        createdByUserId: member.userId,
      }),
    ]);
    // The first attach created the workspace document without a default.
    expect(
      (
        await deps.policyHeads.readPolicyHeads({
          scope: "workspace",
          workspaceId,
        })
      ).workspace,
    ).toMatchObject({ version: 1, schemaVersion: 4 });
    // One audit event for the attach, none for the document it created.
    expect(
      await prisma.auditEvent.findMany({
        where: { workspaceId, action: "provider_selection.assigned" },
        select: { targetType: true, targetId: true },
      }),
    ).toEqual([{ targetType: "repository", targetId: repoA }]);
    await clearRepositoryProviderSelection(
      {
        workspaceId,
        actor: member,
        repository: { repositoryId: repoA, capability: "direct_config" },
      },
      deps,
    );
  });

  it("lets only owners and admins set the default, never a rotating profile", async () => {
    const profile = await hostedProfile("gpt-5.5");
    const set = (who: typeof owner, profileId: string | null) =>
      setWorkspaceDefaultProvider(
        {
          workspaceId,
          actor: who,
          selection: profileId ? { profileId, ...settings } : null,
        },
        deps,
      );
    expect(await denialOf(set(member, profile.id))).toBe(
      "workspace_admin_required",
    );
    const saved = await set(owner, profile.id);
    expect(saved.configuration?.config.providers).toEqual([
      expect.objectContaining({
        authMode: "codex_subscription_oauth_hosted_pool",
        model: "gpt-5.5",
      }),
    ]);
    // Repositories without a selection follow the default.
    expect(
      (
        await deps.policyHeads.readPolicyHeads({
          scope: "repository",
          workspaceId,
          repositoryId: repoB,
        })
      ).repository,
    ).toBeNull();
    const rotating = await attachDraft(
      owner,
      "direct_config",
      repoB,
      draftOf(
        { kind: "repository_rotating", repositoryId: repoB },
        {
          kind: "repository_rotating",
          authMode: "codex_subscription_oauth_rotating",
          repositoryId: repoB,
        },
        "gpt-5.5",
      ),
    );
    if (rotating.status !== "applied" || !rotating.profileId)
      throw new Error("rotating_attach_expected");
    const rotatingProfileId = rotating.profileId;
    // The candidate is validated before the write decides with the policy;
    // a rotating profile cannot even materialize as a default.
    await expect(set(owner, rotatingProfileId)).rejects.toMatchObject({
      code: "rotating_profile_repository_only",
    });
    expect(await denialOf(set(member, null))).toBe("workspace_admin_required");
    expect((await set(owner, null)).configuration).toBeNull();
    await clearRepositoryProviderSelection(
      {
        workspaceId,
        actor: owner,
        repository: { repositoryId: repoB, capability: "direct_config" },
      },
      deps,
    );
  });

  it("refuses to archive a used profile and never both archives and attaches it", async () => {
    const used = await hostedProfile("gpt-5.4");
    await setWorkspaceDefaultProvider(
      {
        workspaceId,
        actor: owner,
        selection: { profileId: used.id, ...settings },
      },
      deps,
    );
    const archive = (profileId: string) =>
      archiveWorkspaceProviderProfile(
        { workspaceId, profileId, actor: owner },
        profiles,
      );
    await expect(archive(used.id)).rejects.toMatchObject({
      code: "provider_profile_in_use",
    });
    await setWorkspaceDefaultProvider(
      { workspaceId, actor: owner, selection: null },
      deps,
    );
    await expect(archive(used.id)).resolves.toMatchObject({
      archivedAt: expect.any(Date),
    });

    // Concurrent archive and assignment: exactly one of them wins.
    for (let round = 0; round < 4; round += 1) {
      // The previous round archived its profile, releasing the identity.
      const profile = await hostedProfile("gpt-5.4-mini");
      const [archived, assigned] = await Promise.allSettled([
        archive(profile.id),
        assignProviderProfileToRepositories(
          {
            workspaceId,
            actor: owner,
            profileId: profile.id,
            settings,
            repositories: [
              { repositoryId: repoA, capability: "direct_config" },
            ],
          },
          deps,
        ),
      ]);
      const attached =
        assigned.status === "fulfilled" &&
        assigned.value[0]?.status === "applied";
      expect(archived.status === "fulfilled" && attached).toBe(false);
      if (archived.status === "rejected")
        expect(archived.reason).toMatchObject({
          code: "provider_profile_in_use",
        });
      // A repository never keeps a selection of an archived profile.
      const resolved = await deps.policyHeads.readPolicyHeads({
        scope: "repository",
        workspaceId,
        repositoryId: repoA,
      });
      const stored = resolved.repository?.policyJson
        ? (JSON.parse(resolved.repository.policyJson) as {
            readonly providers?: readonly { readonly profileId: string }[];
          })
        : null;
      for (const selection of stored?.providers ?? [])
        expect(
          resolved.profiles.get(selection.profileId)?.archivedAt,
        ).toBeNull();
      await clearRepositoryProviderSelection(
        {
          workspaceId,
          actor: owner,
          repository: { repositoryId: repoA, capability: "direct_config" },
        },
        deps,
      );
      if (archived.status === "rejected") await archive(profile.id);
    }
  });

  it("edits a model in place for every scope, refusing settings that do not fit", async () => {
    const profile = await hostedProfile("gpt-5.6-sol");
    // Only the default Codex model accepts the max effort.
    await setWorkspaceDefaultProvider(
      {
        workspaceId,
        actor: owner,
        selection: {
          profileId: profile.id,
          ...settings,
          reasoningEffort: "max",
        },
      },
      deps,
    );
    await assignProviderProfileToRepositories(
      {
        workspaceId,
        actor: owner,
        profileId: profile.id,
        settings,
        repositories: [{ repositoryId: repoB, capability: "direct_config" }],
      },
      deps,
    );
    const edit = (model: string) =>
      changeWorkspaceProviderProfileModel(
        { workspaceId, profileId: profile.id, actor: owner, model },
        { ...profiles, validator: acceptModelChange },
      );
    const versions = await countVersions();
    const refused = await edit("gpt-5.5").then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ProviderProfileError);
    expect(refused).toMatchObject({
      code: "provider_profile_model_incompatible",
      // Repository A inherits the default through its own document.
      affected: {
        profileId: profile.id,
        workspaceDefault: true,
        repositoryIds: [repoA],
      },
    });
    expect(await countVersions()).toBe(versions);
    await setWorkspaceDefaultProvider(
      {
        workspaceId,
        actor: owner,
        selection: { profileId: profile.id, ...settings },
      },
      deps,
    );
    const changed = await edit("gpt-5.3-codex-spark");
    expect(changed).toMatchObject({
      previousModel: "gpt-5.6-sol",
      affected: { workspaceDefault: true, repositoryIds: [repoB] },
    });
    // The generated label follows the model instead of naming the old one.
    expect(changed.profile.label).toBe(
      defaultProviderProfileLabel(profile.credential, "gpt-5.3-codex-spark"),
    );
    // In place: the documents keep their versions and select the same ID.
    expect(await countVersions()).toBe(versions + 1);
    const effective = await deps.configurations.findLatest({
      scope: "repository",
      workspaceId,
      repositoryId: repoB,
    });
    expect(effective?.config.providers[0]).toMatchObject({
      model: "gpt-5.3-codex-spark",
    });
    // The hosted gpt-5.5 profile of an earlier test has that identity.
    await expect(edit("gpt-5.5")).rejects.toMatchObject({
      code: "provider_profile_duplicate",
    });
    await setWorkspaceDefaultProvider(
      { workspaceId, actor: owner, selection: null },
      deps,
    );
    await clearRepositoryProviderSelection(
      {
        workspaceId,
        actor: owner,
        repository: { repositoryId: repoB, capability: "direct_config" },
      },
      deps,
    );
  });

  it("refuses a validated selection that a concurrent model edit no longer fits", async () => {
    // Only the default Codex model accepts the max effort; the profile is
    // unused while the selection is validated, so the edit is allowed.
    const profile = await hostedProfile("gpt-5.6-sol");
    let edited = false;
    const racing = {
      ...deps,
      validator: {
        validate: async () => {
          if (edited) return;
          edited = true;
          await changeWorkspaceProviderProfileModel(
            {
              workspaceId,
              profileId: profile.id,
              actor: owner,
              model: "gpt-5.1",
            },
            { ...profiles, validator: acceptModelChange },
          );
        },
      },
    };
    const versions = await countVersions();
    // The write sees the new model, reports a conflict, and the reread
    // refuses with the reason instead of a raw parse error.
    await expect(
      setWorkspaceDefaultProvider(
        {
          workspaceId,
          actor: owner,
          selection: {
            profileId: profile.id,
            ...settings,
            reasoningEffort: "max",
          },
        },
        racing,
      ),
    ).rejects.toMatchObject({ code: "review_provider_settings_incompatible" });
    expect(edited).toBe(true);
    expect(await countVersions()).toBe(versions);
    expect(
      (await profiles.profiles.list(workspaceId)).find(
        (candidate) => candidate.id === profile.id,
      )?.model,
    ).toBe("gpt-5.1");
  });

  it("fits a document's limits when its providers shrink, never an inconsistent write", async () => {
    const first = await hostedProfile("gpt-5.4-nano");
    const second = await hostedProfile("gpt-5.0");
    const workspaceTarget = { scope: "workspace" as const, workspaceId };
    const selection = (profileId: string) => ({ profileId, ...settings });
    const storedWorkspace = async () =>
      JSON.parse(
        (await deps.policyHeads.readPolicyHeads(workspaceTarget)).workspace!
          .policyJson!,
      ) as { readonly execution: unknown };
    // A default of two providers that run in parallel and must both agree.
    await deps.configurations.saveNextVersions({
      workspaceId,
      writes: [
        {
          target: workspaceTarget,
          policy: {
            ...defaultWorkspaceReviewPolicy(),
            providers: [selection(first.id), selection(second.id)],
            execution: { providerMaxParallel: 2, inlineMinAgreement: 2 },
          },
        },
      ],
    });
    // A repository with one provider of its own runs with at most one.
    await assignProviderProfileToRepositories(
      {
        workspaceId,
        actor: owner,
        profileId: first.id,
        settings,
        repositories: [{ repositoryId: repoA, capability: "direct_config" }],
      },
      deps,
    );
    expect(
      (
        await deps.configurations.findLatest({
          scope: "repository",
          workspaceId,
          repositoryId: repoA,
        })
      )?.config.execution,
    ).toEqual({
      providerLimit: 1,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    });
    // A default of one provider lowers the workspace's own limits with it.
    await setWorkspaceDefaultProvider(
      { workspaceId, actor: owner, selection: selection(first.id) },
      deps,
    );
    expect((await storedWorkspace()).execution).toEqual({
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    });
    // Any other write of limits its own providers cannot meet is refused.
    await expect(
      deps.configurations.saveNextVersions({
        workspaceId,
        writes: [
          {
            target: workspaceTarget,
            policy: {
              ...defaultWorkspaceReviewPolicy(),
              providers: [selection(first.id)],
              execution: { providerMaxParallel: 2, inlineMinAgreement: 2 },
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "review_execution_limits_incompatible" });
    await setWorkspaceDefaultProvider(
      { workspaceId, actor: owner, selection: null },
      deps,
    );
    await clearRepositoryProviderSelection(
      {
        workspaceId,
        actor: owner,
        repository: { repositoryId: repoA, capability: "direct_config" },
      },
      deps,
    );
  });

  it("replaces documents in a retired format when a provider is chosen", async () => {
    const retiredWorkspaceId = `${prefix}-retired-w`;
    const retiredRepository = `${prefix}-retired-repo`;
    const target = (repositoryId?: string) =>
      repositoryId
        ? ({
            scope: "repository",
            workspaceId: retiredWorkspaceId,
            repositoryId,
          } as const)
        : ({ scope: "workspace", workspaceId: retiredWorkspaceId } as const);
    await prisma.workspace.create({
      data: {
        id: retiredWorkspaceId,
        slug: retiredWorkspaceId,
        name: retiredWorkspaceId,
        members: {
          create: [
            { userId: owner.userId, role: "owner" },
            { userId: member.userId, role: "member" },
          ],
        },
      },
    });
    try {
      await prisma.repositoryConnection.create({
        data: {
          id: retiredRepository,
          workspaceId: retiredWorkspaceId,
          externalRepositoryId: retiredRepository,
          owner: "acme",
          name: retiredRepository,
          fullName: `acme/${retiredRepository}`,
          defaultBranch: "main",
          visibility: "private",
        },
      });
      // Heads in a retired format with settings, as a schema 3 install left
      // them.
      const retiredDocuments = {
        workspace: JSON.stringify({
          schemaVersion: 3,
          providers: [
            {
              kind: "claude",
              authMode: "claude_code_oauth",
              model: "opus",
              reasoningEffort: "high",
            },
          ],
          output: { reviewLanguage: "Deutsch" },
          limits: { inlineMaxComments: 7, targetTokensPerBatch: 40000 },
        }),
        repository: JSON.stringify({
          schemaVersion: 3,
          limits: { inlineMaxComments: 3 },
        }),
      };
      for (const scope of [target(), target(retiredRepository)]) {
        const configuration = await prisma.reviewConfiguration.create({
          data: {
            workspaceId: retiredWorkspaceId,
            repositoryId:
              scope.scope === "repository" ? scope.repositoryId : null,
            targetKey: reviewConfigurationTargetKey(scope),
          },
        });
        await prisma.reviewConfigurationVersion.create({
          data: {
            configurationId: configuration.id,
            workspaceId: retiredWorkspaceId,
            version: 1,
            schemaVersion: 3,
            policyJson: retiredDocuments[scope.scope],
          },
        });
      }
      const { profile } = await createWorkspaceProviderProfile(
        {
          workspaceId: retiredWorkspaceId,
          actor: owner,
          credential: { kind: "user_ci_secret", authMode: "claude_code_oauth" },
          model: "sonnet",
        },
        profiles,
      );
      const assign = async (who: typeof owner) =>
        (
          await assignProviderProfileToRepositories(
            {
              workspaceId: retiredWorkspaceId,
              actor: who,
              profileId: profile.id,
              settings,
              repositories: [
                {
                  repositoryId: retiredRepository,
                  capability: "direct_config",
                },
              ],
            },
            deps,
          )
        )[0]!;
      // A repository write never replaces the workspace's retired document,
      // whoever asks: its settings would be lost without a trace.
      for (const who of [member, owner])
        expect(await assign(who)).toMatchObject({
          status: "failed",
          code: "review_workspace_policy_retired",
        });
      expect(
        (await deps.policyHeads.readPolicyHeads(target())).workspace,
      ).toMatchObject({ version: 1, schemaVersion: 3 });
      // The owner's default replaces it with the built-in settings, audited.
      await setWorkspaceDefaultProvider(
        {
          workspaceId: retiredWorkspaceId,
          actor: owner,
          selection: { profileId: profile.id, ...settings },
        },
        deps,
      );
      expect(
        await resolveEffectiveReviewConfiguration(target(), deps),
      ).toMatchObject({ status: "ready", workspaceVersion: 2 });
      expect(
        await prisma.auditEvent.count({
          where: {
            workspaceId: retiredWorkspaceId,
            action: "provider_selection.default_set",
            targetType: "workspace",
          },
        }),
      ).toBe(1);
      // The repository's own retired document goes with its first choice.
      expect(await assign(member)).toMatchObject({ status: "applied" });
      expect(
        await prisma.auditEvent.findMany({
          where: {
            workspaceId: retiredWorkspaceId,
            action: "provider_selection.assigned",
          },
          select: { targetType: true },
        }),
      ).toEqual([{ targetType: "repository" }]);
      expect(
        await resolveEffectiveReviewConfiguration(
          target(retiredRepository),
          deps,
        ),
      ).toMatchObject({
        status: "ready",
        source: "repository",
        repositoryVersion: 2,
        selections: [expect.objectContaining({ profileId: profile.id })],
      });
    } finally {
      await prisma.workspace.deleteMany({ where: { id: retiredWorkspaceId } });
    }
  });

  it("answers outsiders before telling whether a profile exists", async () => {
    const profile = await hostedProfile("gpt-5.2");
    for (const profileId of [profile.id, `${prefix}-missing`]) {
      expect(
        await denialOf(
          renameWorkspaceProviderProfile(
            { workspaceId, profileId, actor: outsider, label: "Mine" },
            profiles,
          ),
        ),
      ).toBe("workspace_member_required");
      expect(
        await denialOf(
          archiveWorkspaceProviderProfile(
            { workspaceId, profileId, actor: outsider },
            profiles,
          ),
        ),
      ).toBe("workspace_member_required");
      // The caller's network check of a model edit never runs for them.
      let catalogChecks = 0;
      expect(
        await denialOf(
          changeWorkspaceProviderProfileModel(
            { workspaceId, profileId, actor: outsider, model: "gpt-5.4" },
            {
              ...profiles,
              validator: {
                ...acceptModelChange,
                beforeTransaction: async () => {
                  catalogChecks += 1;
                },
              },
            },
          ),
        ),
      ).toBe("workspace_member_required");
      expect(catalogChecks).toBe(0);
    }
    // A member who did not add it is refused before the network check too.
    let memberCatalogChecks = 0;
    expect(
      await denialOf(
        changeWorkspaceProviderProfileModel(
          {
            workspaceId,
            profileId: profile.id,
            actor: member,
            model: "gpt-5.4",
          },
          {
            ...profiles,
            validator: {
              ...acceptModelChange,
              beforeTransaction: async () => {
                memberCatalogChecks += 1;
              },
            },
          },
        ),
      ),
    ).toBe("profile_creator_required");
    expect(memberCatalogChecks).toBe(0);
    // A member sees not_found only for an ID that truly does not exist.
    await expect(
      renameWorkspaceProviderProfile(
        {
          workspaceId,
          profileId: `${prefix}-missing`,
          actor: member,
          label: "x",
        },
        profiles,
      ),
    ).rejects.toMatchObject({ code: "provider_profile_not_found" });
  });

  it("stores references only: no secret in any document, profile or audit event", async () => {
    const rows = [
      ...(
        await prisma.reviewConfigurationVersion.findMany({
          where: { workspaceId },
          select: { policyJson: true },
        })
      ).map((row) => row.policyJson ?? ""),
      ...(
        await prisma.workspaceProviderProfile.findMany({
          where: { workspaceId },
        })
      ).map((row) => JSON.stringify(row)),
      ...(
        await prisma.auditEvent.findMany({
          where: { workspaceId },
          select: { metadata: true },
        })
      ).map((row) => JSON.stringify(row.metadata)),
    ];
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row).not.toContain(secret);
      expect(row).not.toMatch(/encryptedApiKey|"apiKey"|sk-[A-Za-z0-9]/);
    }
  });
});
