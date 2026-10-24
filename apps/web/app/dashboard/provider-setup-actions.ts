"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assignProviderProfileToRepositories,
  clearRepositoryProviderSelection,
  ProviderManagementDeniedError,
  reviewProviderSelectionSchema,
  setWorkspaceDefaultProvider,
  type ProviderManagementDenialReason,
  type ProviderRepositoryFacts,
} from "@reviewrouter/features-review-config";
import {
  assertDashboardMutationAllowed,
  assertDashboardRepositoryConfigMutationAllowed,
  type DashboardMutationActor,
} from "../../src/server/dashboard-mutations";
import {
  dashboardProviderActor,
  dashboardProviderSelection,
  dashboardRepositoryCapability,
  dashboardSelectionDependencies,
} from "../../src/server/dashboard-provider-selections";
import { createDashboardRateLimitPolicy } from "../../src/server/dashboard-rate-limits";
import {
  assertDashboardEntitlement,
  assertGatewayReviewActorUnchanged,
  assertRepositoryConfigMutable,
  loadDashboardRepository,
  type DashboardRepository,
} from "../../src/server/dashboard-repository-guards";
import { getPrisma } from "../../src/server/prisma";
import { PROVIDER_SETUP_MAX_REPOSITORIES } from "../../src/features/provider-setup/provider-setup-model";
import { safeDashboardErrorCode } from "./dashboard-error-codes";

/** Outcome of one repository of a provider assignment. */
export type ProviderSetupAssignmentResult = Readonly<{
  repositoryId: string;
  fullName: string;
  status: "applied" | "denied" | "conflict" | "failed";
  /** Policy reason of a denial. */
  reason?: ProviderManagementDenialReason;
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
      await assertDashboardEntitlement({
        prisma,
        workspaceId,
        actor: actor.actor,
        feature: "action_control_plane",
      });
      await createDashboardRateLimitPolicy(
        prisma,
      ).assertReviewConfigSaveAllowed({ workspaceId });
      const { selection, draft } = await dashboardProviderSelection({
        prisma,
        workspaceId,
        provider,
        settings: selectionSettings,
      });
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

    const authorized = await authorizeRepositories(
      workspaceId,
      target.repositoryIds,
    );
    const first = authorized.allowed[0];
    if (!first) {
      revalidateDashboard();
      return { status: "saved", results: authorized.refused };
    }
    const { selection, draft } = await dashboardProviderSelection({
      prisma,
      workspaceId,
      provider,
      settings: selectionSettings,
    });
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
          case "denied":
            return [
              {
                repositoryId,
                fullName,
                status: "denied",
                reason: assignment.reason,
              },
            ];
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

function actionError(error: unknown): ProviderSetupActionResult {
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
