import {
  MemoryKnowledgeError,
  type MemoryActor,
} from "@reviewrouter/features-memory";
import {
  createPrismaAutomaticMemorySourceCurrent,
  createMemoryKnowledgeRuntime,
} from "@reviewrouter/features-memory/composition";
import {
  PrismaMemoryKnowledgeAccess,
  PrismaMemoryPermission,
  approvedMemorySourceApplicable,
  createPrismaMemoryRepositoryMaintainers,
} from "@reviewrouter/features-memory/infrastructure";
import {
  createMemoryDashboardController,
  memoryDashboardScope,
} from "../features/memory/adapters/memory-dashboard-controller";
import type {
  MemoryDashboardMutation,
  MemoryScopeSelection,
} from "../features/memory/application/memory-knowledge-view";
import { PrismaWorkspaceMemorySettings } from "@reviewrouter/features-review-config";
import {
  createGitHubAppInstallationOctokit,
  getDashboardSignedInActor,
} from "./dashboard-mutations";
import { getPrisma } from "./prisma";

/** Every browser request obtains fresh product identity. No support-login bypass. */
async function productionMemoryDashboard(workspaceId: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(workspaceId))
    throw new MemoryKnowledgeError("invalid_input");
  const signedIn = await getDashboardSignedInActor({ readOnly: true });
  if (!signedIn?.userId) throw new MemoryKnowledgeError("forbidden");
  const prisma = getPrisma();
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { deletionState: true },
  });
  if (!workspace || workspace.deletionState !== "active")
    throw new MemoryKnowledgeError("forbidden");
  const actor: MemoryActor = {
    kind: "workspace_user",
    id: signedIn.userId,
    githubUserId: null,
    login: null,
  };
  const runtime = await createMemoryKnowledgeRuntime({
    prisma,
    env: process.env,
    workspaceSettings: (workspaceId, transaction) =>
      new PrismaWorkspaceMemorySettings(transaction ?? prisma).read(
        workspaceId,
      ),
  });
  const permissions = new PrismaMemoryPermission(prisma, {
    repositoryMaintainers: createPrismaMemoryRepositoryMaintainers({
      prisma,
      createClient: createGitHubAppInstallationOctokit,
    }),
  });
  const access = new PrismaMemoryKnowledgeAccess({
    prisma,
    permissions,
    policy: runtime.policy,
    sourceAuthority: {
      async verifySource() {
        throw new MemoryKnowledgeError("forbidden");
      },
      sourceApplicable: approvedMemorySourceApplicable,
    },
  });
  const controller = createMemoryDashboardController({
    actor,
    access,
    service: runtime.forAccess(
      access,
      createPrismaAutomaticMemorySourceCurrent({
        prisma,
        policy: runtime.policy,
        env: process.env,
        createClient: async (installationId) =>
          createGitHubAppInstallationOctokit(
            installationId,
          ) as unknown as import("@reviewrouter/features-memory/composition").MemorySourceGitHubClient,
      }),
    ),
    store: runtime.store,
    generation: runtime.generation,
    providerProfileVersion: runtime.providerProfileVersion,
    enabled: runtime.enabled,
    mutationsEnabled:
      process.env.REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS === "1",
  });
  return { controller, prisma, runtime };
}

export async function loadDashboardMemoryKnowledge(
  input: MemoryScopeSelection & {
    readonly cursor?: string | null;
    readonly topicId?: string | null;
  },
) {
  const { controller, prisma, runtime } = await productionMemoryDashboard(
    input.workspaceId,
  );
  const workspaceVisible = await controller.allowed(
    { kind: "workspace", workspaceId: input.workspaceId },
    "read",
  );
  const candidates = await prisma.repositoryConnection.findMany({
    where: { workspaceId: input.workspaceId, selected: true, archived: false },
    select: { id: true, owner: true, name: true },
    orderBy: { id: "asc" },
    take: 50,
  });
  if (
    input.repositoryId &&
    !candidates.some((repository) => repository.id === input.repositoryId)
  ) {
    const requested = await prisma.repositoryConnection.findFirst({
      where: {
        workspaceId: input.workspaceId,
        id: input.repositoryId,
        selected: true,
        archived: false,
      },
      select: { id: true, owner: true, name: true },
    });
    if (requested) candidates.push(requested);
  }
  const repositories = workspaceVisible
    ? candidates
    : (
        await Promise.all(
          candidates.map(async (repository) =>
            (await controller.allowed(
              {
                kind: "repository",
                workspaceId: input.workspaceId,
                repositoryId: repository.id,
              },
              "read",
            ))
              ? repository
              : null,
          ),
        )
      ).filter(
        (repository): repository is (typeof candidates)[number] =>
          repository !== null,
      );
  const repositoryId =
    input.repositoryId ??
    (workspaceVisible ? null : (repositories[0]?.id ?? null));
  if (!workspaceVisible && repositoryId === null)
    throw new MemoryKnowledgeError("forbidden");
  const selection = { workspaceId: input.workspaceId, repositoryId };
  const scope = memoryDashboardScope(selection);
  await controller.authorize(scope, "read");
  const policy = await runtime.policy.getPolicy({
    workspaceId: input.workspaceId,
    repositoryId,
  });
  return controller.list(
    {
      ...selection,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.topicId ? { topicId: input.topicId } : {}),
    },
    {
      workspaceVisible,
      repositories: repositories.map((repository) => ({
        id: repository.id,
        label: `${repository.owner}/${repository.name}`,
      })),
      writesEnabled:
        policy.memoryEnabled &&
        policy.allowedScopes[
          scope.kind === "repository" ? "repository" : "workspace"
        ],
    },
  );
}
export async function mutateDashboardMemoryKnowledge(
  input: MemoryDashboardMutation,
) {
  return (await productionMemoryDashboard(input.workspaceId)).controller.mutate(
    input,
  );
}
export async function readDashboardMemoryOperation(
  input: MemoryScopeSelection & { readonly commandId: string },
) {
  return (
    await productionMemoryDashboard(input.workspaceId)
  ).controller.progress(input);
}
export async function exportDashboardMemoryKnowledge(
  input: MemoryScopeSelection & { readonly cursor?: string },
) {
  return (await productionMemoryDashboard(input.workspaceId)).controller.export(
    input,
  );
}
