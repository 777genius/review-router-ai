"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  archiveWorkspaceProviderProfile,
  assertProviderProfileManagementGate,
  assertProviderSelectionAccessRights,
  assignProviderProfileToRepositories,
  changeWorkspaceProviderProfileModel,
  clearRepositoryProviderSelection,
  createWorkspaceProviderProfile,
  parseProviderProfileDraft,
  parseProviderProfileLabel,
  ProviderManagementDeniedError,
  ProviderProfileError,
  renameWorkspaceProviderProfile,
  reviewProviderSelectionSchema,
  setWorkspaceDefaultProvider,
  type ProviderManagementDenialReason,
  type ProviderRepositoryFacts,
} from "@reviewrouter/features-review-config";
import {
  assertDashboardMutationAllowed,
  assertDashboardRepositoryConfigMutationAllowed,
  assertDashboardSignedInMutationActor,
  type DashboardMutationActor,
} from "../../src/server/dashboard-mutations";
import {
  assertDialogSelectableCredential,
  dashboardProviderActor,
  dashboardProviderProfiles,
  dashboardProviderSelection,
  dashboardRepositoryCapability,
  dashboardSelectionDependencies,
} from "../../src/server/dashboard-provider-selections";
import {
  assertDashboardGatewayProviderModelAllowed,
  dashboardProfileModelChangeValidator,
} from "../../src/server/dashboard-review-configuration-validation";
import { createDashboardRateLimitPolicy } from "../../src/server/dashboard-rate-limits";
import {
  assertDashboardEntitlement,
  assertGatewayReviewActorUnchanged,
  assertRepositoryConfigMutable,
  loadDashboardRepository,
  type DashboardRepository,
} from "../../src/server/dashboard-repository-guards";
import { getPrisma } from "../../src/server/prisma";
import {
  managedKeyDenial,
  PROVIDER_SETUP_MAX_REPOSITORIES,
  type ProviderSetupDenialReason,
} from "../../src/features/provider-setup/provider-setup-model";
import { safeDashboardErrorCode } from "./dashboard-error-codes";

/** Outcome of one repository of a provider assignment. */
export type ProviderSetupAssignmentResult = Readonly<{
  repositoryId: string;
  fullName: string;
  status: "applied" | "denied" | "conflict" | "failed";
  /** Policy reason of a denial, as the dialog explains it. */
  reason?: ProviderSetupDenialReason;
  /** Error code of a failure. */
  error?: string;
}>;

export type ProviderSetupActionResult =
  | Readonly<{
      status: "saved";
      results: readonly ProviderSetupAssignmentResult[];
    }>
  | Readonly<{
      status: "error";
      error: string;
      reason?: ProviderManagementDenialReason;
    }>;

const settingsSchema = reviewProviderSelectionSchema
  .omit({ profileId: true, requiredHealthy: true })
  .strict();

const saveRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("workspace") }).strict(),
      z
        .object({
          kind: z.literal("repositories"),
          repositoryIds: z
            .array(z.string().trim().min(1))
            .min(1)
            .max(PROVIDER_SETUP_MAX_REPOSITORIES),
        })
        .strict(),
    ]),
    provider: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("profile"), profileId: z.string().min(1) })
        .strict(),
      z
        .object({
          kind: z.literal("new"),
          credential: z.unknown(),
          model: z.string(),
        })
        .strict(),
    ]),
    settings: settingsSchema,
  })
  .strict();

export type ProviderSetupSaveRequest = z.input<typeof saveRequestSchema>;

/**
 * Saves the provider of the workspace default or of fixed repositories. A
 * repository target never changes the default; attaching a new provider
 * registers it in the workspace list. Each repository is authorized and
 * written on its own and reported in the result.
 */
export async function saveProviderSetupAction(
  request: ProviderSetupSaveRequest,
): Promise<ProviderSetupActionResult> {
  const parsed = saveRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "error", error: "invalid_form" };
  const { workspaceId, target, settings } = parsed.data;
  const provider =
    parsed.data.provider.kind === "profile"
      ? parsed.data.provider
      : {
          kind: "new" as const,
          credential: parsed.data.provider.credential as never,
          model: parsed.data.provider.model,
        };
  // One provider per scope in this dialog; it is always required healthy.
  const selectionSettings = { ...settings, requiredHealthy: true };
  const prisma = getPrisma();
  try {
    if (target.kind === "workspace") {
      const actor = await assertDashboardMutationAllowed(workspaceId);
      // Refusals that need no quota come first (a hosted pool, for one).
      const { selection, draft } = await dashboardProviderSelection({
        prisma,
        workspaceId,
        provider,
        settings: selectionSettings,
      });
      await assertDashboardEntitlement({
        prisma,
        workspaceId,
        actor: actor.actor,
        feature: "action_control_plane",
      });
      await createDashboardRateLimitPolicy(
        prisma,
      ).assertReviewConfigSaveAllowed({ workspaceId });
      await setWorkspaceDefaultProvider(
        {
          workspaceId,
          actor: dashboardProviderActor(actor),
          selection,
          ...(draft ? { draft } : {}),
        },
        selectionDependencies({
          workspaceId,
          actor,
          repositories: new Map(),
          recheck: async () =>
            assertGatewayReviewActorUnchanged(
              actor,
              await assertDashboardMutationAllowed(workspaceId),
            ),
        }),
      );
      revalidateDashboard();
      return { status: "saved", results: [] };
    }

    // Access rights and the chosen provider are decided before the rate
    // limit, the entitlement and the GitHub permission checks of each
    // repository; every write decides again under its locks.
    await assertProviderSelectionAccessRights(
      {
        workspaceId,
        actor: dashboardProviderActor(
          await assertDashboardSignedInMutationActor(),
        ),
      },
      { profiles: dashboardProviderProfiles(prisma) },
    );
    const { selection, draft, credentialKind } =
      await dashboardProviderSelection({
        prisma,
        workspaceId,
        provider,
        settings: selectionSettings,
      });
    const authorized = await authorizeRepositories(
      workspaceId,
      target.repositoryIds,
    );
    const first = authorized.allowed[0];
    if (!first) {
      revalidateDashboard();
      return { status: "saved", results: authorized.refused };
    }
    const byId = new Map(
      authorized.allowed.map((item) => [item.repository.id, item] as const),
    );
    const assignments = await assignProviderProfileToRepositories(
      {
        workspaceId,
        actor: dashboardProviderActor(first.actor),
        profileId: selection.profileId,
        settings: settingsWithoutProfile(selection),
        ...(draft ? { draft } : {}),
        repositories: authorized.allowed.map(
          (item): ProviderRepositoryFacts => ({
            repositoryId: item.repository.id,
            capability: dashboardRepositoryCapability(item.actor),
          }),
        ),
      },
      selectionDependencies({
        workspaceId,
        actor: first.actor,
        repositories: new Map(
          authorized.allowed.map((item) => [
            item.repository.id,
            item.repository,
          ]),
        ),
        recheck: async (repositoryId) => {
          const item = repositoryId ? byId.get(repositoryId) : undefined;
          if (!item || !repositoryId) throw new Error("repository_not_found");
          const current = await loadDashboardRepository({
            prisma,
            workspaceId,
            repositoryId,
          });
          assertRepositoryConfigMutable(current);
          assertGatewayReviewActorUnchanged(
            item.actor,
            await assertDashboardRepositoryConfigMutationAllowed(
              workspaceId,
              current,
            ),
          );
        },
      }),
    );
    revalidateDashboard();
    return {
      status: "saved",
      results: target.repositoryIds.flatMap((repositoryId) => {
        const refused = authorized.refused.find(
          (item) => item.repositoryId === repositoryId,
        );
        if (refused) return [refused];
        const assignment = assignments.find(
          (item) => item.repositoryId === repositoryId,
        );
        const fullName = byId.get(repositoryId)?.repository.fullName ?? "";
        if (!assignment) return [];
        switch (assignment.status) {
          case "applied":
          case "conflict":
            return [{ repositoryId, fullName, status: assignment.status }];
          case "denied": {
            const decision = credentialKind
              ? managedKeyDenial(credentialKind, {
                  allowed: false,
                  reason: assignment.reason,
                })
              : { allowed: false as const, reason: assignment.reason };
            return [
              {
                repositoryId,
                fullName,
                status: "denied",
                ...(decision.allowed ? {} : { reason: decision.reason }),
              },
            ];
          }
          case "failed":
            return [
              {
                repositoryId,
                fullName,
                status: "failed",
                error: safeDashboardErrorCode(new Error(assignment.code)),
              },
            ];
        }
      }),
    };
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Removes the repository's own provider so it uses the workspace default.
 * Its other repository settings stay.
 */
export async function inheritWorkspaceDefaultProviderAction(input: {
  readonly workspaceId: string;
  readonly repositoryId: string;
}): Promise<ProviderSetupActionResult> {
  const prisma = getPrisma();
  try {
    await assertProviderSelectionAccessRights(
      {
        workspaceId: input.workspaceId,
        actor: dashboardProviderActor(
          await assertDashboardSignedInMutationActor(),
        ),
      },
      { profiles: dashboardProviderProfiles(prisma) },
    );
    const authorized = await authorizeRepositories(input.workspaceId, [
      input.repositoryId,
    ]);
    const item = authorized.allowed[0];
    if (!item) {
      const refused = authorized.refused[0];
      return { status: "error", error: refused?.error ?? "invalid_form" };
    }
    await clearRepositoryProviderSelection(
      {
        workspaceId: input.workspaceId,
        actor: dashboardProviderActor(item.actor),
        repository: {
          repositoryId: item.repository.id,
          capability: dashboardRepositoryCapability(item.actor),
        },
      },
      selectionDependencies({
        workspaceId: input.workspaceId,
        actor: item.actor,
        repositories: new Map([[item.repository.id, item.repository]]),
        recheck: async () => {
          const current = await loadDashboardRepository({
            prisma,
            workspaceId: input.workspaceId,
            repositoryId: input.repositoryId,
          });
          assertRepositoryConfigMutable(current);
          assertGatewayReviewActorUnchanged(
            item.actor,
            await assertDashboardRepositoryConfigMutationAllowed(
              input.workspaceId,
              current,
            ),
          );
        },
      }),
    );
    revalidateDashboard();
    return {
      status: "saved",
      results: [
        {
          repositoryId: item.repository.id,
          fullName: item.repository.fullName,
          status: "applied",
        },
      ],
    };
  } catch (error) {
    return actionError(error);
  }
}

/** Outcome of a write from the Providers list. */
export type ProviderProfileActionResult =
  | Readonly<{ status: "saved"; created?: boolean }>
  | Readonly<{
      status: "error";
      error: string;
      reason?: ProviderManagementDenialReason;
      /** What blocks a removal or a model edit, by repository name. */
      blocking?: Readonly<{
        workspaceDefault: boolean;
        repositories: readonly string[];
      }>;
    }>;

const createProfileRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    credential: z.unknown(),
    model: z.string(),
  })
  .strict();

/**
 * Adds a provider to the workspace list without selecting it anywhere
 * (owner/admin). Adding one that already exists returns it unchanged.
 */
export async function createProviderProfileAction(
  request: z.input<typeof createProfileRequestSchema>,
): Promise<ProviderProfileActionResult> {
  const parsed = createProfileRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "error", error: "invalid_form" };
  const { workspaceId, credential, model } = parsed.data;
  const prisma = getPrisma();
  try {
    const actor = await assertDashboardMutationAllowed(workspaceId);
    const draft = parseProviderProfileDraft({ credential, model });
    assertDialogSelectableCredential(draft.credential.kind);
    await assertDashboardEntitlement({
      prisma,
      workspaceId,
      actor: actor.actor,
      feature: "action_control_plane",
    });
    await createDashboardRateLimitPolicy(prisma).assertReviewConfigSaveAllowed({
      workspaceId,
    });
    if (draft.credential.kind === "gateway_binding") {
      await assertDashboardGatewayProviderModelAllowed(
        workspaceId,
        {
          gatewayBindingId: draft.credential.bindingId,
          ...(draft.credential.gatewayProfileRef
            ? { gatewayProfileRef: draft.credential.gatewayProfileRef }
            : {}),
        },
        draft.model,
      );
      assertGatewayReviewActorUnchanged(
        actor,
        await assertDashboardMutationAllowed(workspaceId),
      );
    }
    const { created } = await createWorkspaceProviderProfile(
      {
        workspaceId,
        actor: dashboardProviderActor(actor),
        credential,
        model,
      },
      { profiles: dashboardProviderProfiles(prisma) },
    );
    revalidateDashboard();
    return { status: "saved", created };
  } catch (error) {
    return profileActionError(error, workspaceId);
  }
}

const updateProfileRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    profileId: z.string().trim().min(1),
    label: z.string().optional(),
    model: z.string().optional(),
  })
  .strict()
  .refine((value) => value.label !== undefined || value.model !== undefined);

/**
 * Renames a provider and changes its model, for every repository using it.
 * The policy decides under the write's locks: its creator while still a
 * member, or an owner or admin, and only owners and admins under admin-only
 * Access rights. The label is checked before anything is written.
 */
export async function updateProviderProfileAction(
  request: z.input<typeof updateProfileRequestSchema>,
): Promise<ProviderProfileActionResult> {
  const parsed = updateProfileRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "error", error: "invalid_form" };
  const { workspaceId, profileId, label, model } = parsed.data;
  const prisma = getPrisma();
  try {
    if (label !== undefined) parseProviderProfileLabel(label);
    const actor = await assertDashboardSignedInMutationActor();
    const providerActor = dashboardProviderActor(actor);
    const profiles = dashboardProviderProfiles(prisma);
    // Who may manage providers here at all is decided before the rate limit,
    // the entitlement and any read about the profile.
    await assertProviderProfileManagementGate(
      { workspaceId, actor: providerActor },
      { profiles },
    );
    await createDashboardRateLimitPolicy(prisma).assertReviewConfigSaveAllowed({
      workspaceId,
      resourceId: profileId,
    });
    if (model !== undefined) {
      await assertDashboardEntitlement({
        prisma,
        workspaceId,
        actor: actor.actor,
        feature: "action_control_plane",
      });
      const repositories = await prisma.repositoryConnection.findMany({
        where: { workspaceId },
        select: { id: true, fullName: true, visibility: true },
      });
      await changeWorkspaceProviderProfileModel(
        { workspaceId, profileId, actor: providerActor, model },
        {
          profiles,
          validator: dashboardProfileModelChangeValidator({
            workspaceId,
            afterGatewayCatalogCheck: async () => {
              assertGatewayReviewActorUnchanged(
                actor,
                await assertDashboardSignedInMutationActor(),
              );
            },
            repositories: new Map(
              repositories.map((repository) => [repository.id, repository]),
            ),
          }),
        },
      );
    }
    if (label !== undefined)
      await renameWorkspaceProviderProfile(
        { workspaceId, profileId, actor: providerActor, label },
        { profiles },
      );
    revalidateDashboard();
    return { status: "saved" };
  } catch (error) {
    return profileActionError(error, workspaceId);
  }
}

const profileRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    profileId: z.string().trim().min(1),
  })
  .strict();

/**
 * Removes a provider from the workspace list. One still selected by the
 * default or a repository is refused and the refusal names them.
 */
export async function archiveProviderProfileAction(
  request: z.input<typeof profileRequestSchema>,
): Promise<ProviderProfileActionResult> {
  const parsed = profileRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "error", error: "invalid_form" };
  const { workspaceId, profileId } = parsed.data;
  const prisma = getPrisma();
  try {
    const actor = await assertDashboardSignedInMutationActor();
    const providerActor = dashboardProviderActor(actor);
    const profiles = dashboardProviderProfiles(prisma);
    await assertProviderProfileManagementGate(
      { workspaceId, actor: providerActor },
      { profiles },
    );
    await createDashboardRateLimitPolicy(prisma).assertReviewConfigSaveAllowed({
      workspaceId,
      resourceId: profileId,
    });
    await archiveWorkspaceProviderProfile(
      { workspaceId, profileId, actor: providerActor },
      { profiles },
    );
    revalidateDashboard();
    return { status: "saved" };
  } catch (error) {
    return profileActionError(error, workspaceId);
  }
}

/**
 * Stops using any provider as the workspace default (owner/admin). The
 * provider stays in the list; repositories without their own provider wait
 * until a new default is chosen.
 */
export async function clearWorkspaceDefaultProviderAction(input: {
  readonly workspaceId: string;
}): Promise<ProviderProfileActionResult> {
  const workspaceId =
    typeof input?.workspaceId === "string" ? input.workspaceId.trim() : "";
  if (!workspaceId) return { status: "error", error: "invalid_form" };
  const prisma = getPrisma();
  try {
    const actor = await assertDashboardMutationAllowed(workspaceId);
    await assertDashboardEntitlement({
      prisma,
      workspaceId,
      actor: actor.actor,
      feature: "action_control_plane",
    });
    await createDashboardRateLimitPolicy(prisma).assertReviewConfigSaveAllowed({
      workspaceId,
    });
    await setWorkspaceDefaultProvider(
      { workspaceId, actor: dashboardProviderActor(actor), selection: null },
      selectionDependencies({
        workspaceId,
        actor,
        repositories: new Map(),
        recheck: async () =>
          assertGatewayReviewActorUnchanged(
            actor,
            await assertDashboardMutationAllowed(workspaceId),
          ),
      }),
    );
    revalidateDashboard();
    return { status: "saved" };
  } catch (error) {
    return profileActionError(error, workspaceId);
  }
}

async function profileActionError(
  error: unknown,
  workspaceId: string,
): Promise<ProviderProfileActionResult> {
  if (error instanceof ProviderProfileError && error.affected) {
    const ids = error.affected.repositoryIds;
    const repositories = ids.length
      ? await getPrisma()
          .repositoryConnection.findMany({
            where: { workspaceId, id: { in: [...ids] } },
            select: { id: true, fullName: true },
          })
          .catch(() => [])
      : [];
    const names = new Map(
      repositories.map((repository) => [repository.id, repository.fullName]),
    );
    return {
      status: "error",
      error: error.code,
      blocking: {
        workspaceDefault: error.affected.workspaceDefault,
        repositories: ids.map((id) => names.get(id) ?? id).sort(),
      },
    };
  }
  return actionError(error);
}

type AuthorizedRepository = Readonly<{
  repository: DashboardRepository;
  actor: DashboardMutationActor;
}>;

/**
 * Authorizes each repository on its own: one the actor cannot change is
 * reported and the others continue. Entitlement and the rate limit are
 * checked before any write.
 */
async function authorizeRepositories(
  workspaceId: string,
  repositoryIds: readonly string[],
): Promise<
  Readonly<{
    allowed: readonly AuthorizedRepository[];
    refused: readonly ProviderSetupAssignmentResult[];
  }>
> {
  const prisma = getPrisma();
  const allowed: AuthorizedRepository[] = [];
  const refused: ProviderSetupAssignmentResult[] = [];
  let entitled = false;
  for (const repositoryId of [...new Set(repositoryIds)]) {
    let fullName = "";
    try {
      const repository = await loadDashboardRepository({
        prisma,
        workspaceId,
        repositoryId,
      });
      fullName = repository.fullName;
      assertRepositoryConfigMutable(repository);
      const actor = await assertDashboardRepositoryConfigMutationAllowed(
        workspaceId,
        repository,
      );
      if (!entitled) {
        await assertDashboardEntitlement({
          prisma,
          workspaceId,
          actor: actor.actor,
          feature: "action_control_plane",
        });
        entitled = true;
      }
      await createDashboardRateLimitPolicy(
        prisma,
      ).assertReviewConfigSaveAllowed({
        workspaceId,
        resourceId: repositoryId,
      });
      allowed.push({ repository, actor });
    } catch (error) {
      if (isEntitlementError(error)) throw error;
      const code = safeDashboardErrorCode(error);
      refused.push({
        repositoryId,
        fullName,
        status:
          code === "repository_config_mutation_forbidden" ||
          code === "repository_mutation_forbidden" ||
          code === "workspace_mutation_forbidden"
            ? "denied"
            : "failed",
        error: code,
      });
    }
  }
  return { allowed, refused };
}

function selectionDependencies(
  input: Omit<Parameters<typeof dashboardSelectionDependencies>[0], "prisma">,
) {
  return dashboardSelectionDependencies({ ...input, prisma: getPrisma() });
}

function settingsWithoutProfile(
  selection: z.infer<typeof reviewProviderSelectionSchema>,
) {
  const { profileId: _profileId, ...settings } = selection;
  void _profileId;
  return settings;
}

function actionError(
  error: unknown,
): Extract<ProviderSetupActionResult, { status: "error" }> {
  if (error instanceof ProviderManagementDeniedError)
    return {
      status: "error",
      error: "provider_management_forbidden",
      reason: error.reason,
    };
  return { status: "error", error: safeDashboardErrorCode(error) };
}

function isEntitlementError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("entitlement_denied:")
  );
}

function revalidateDashboard(): void {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/setup");
}
