import type { PrismaClient } from "@prisma/client";
import type { MemoryAutomaticSourceCurrentPort } from "../application/ports/memory-automatic-source-port";
import type { MemoryPolicyConfigPort } from "../application/ports/memory-policy-config-port";
import {
  createGitHubAutomaticMemorySourceCurrent,
  type MemorySourceGitHubClient,
} from "../infrastructure/github/github-automatic-memory-source-current";
import { readMemorySourceProcessingQualification } from "../infrastructure/config/memory-source-processing-qualification";
/** Shared API/web composition with host-injected App credential custody. */
export function createPrismaAutomaticMemorySourceCurrent(input: {
  readonly prisma: PrismaClient;
  readonly policy: MemoryPolicyConfigPort;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly createClient: (
    installationId: string,
  ) => Promise<MemorySourceGitHubClient>;
}): MemoryAutomaticSourceCurrentPort {
  const qualification = readMemorySourceProcessingQualification(
    input.env.REVIEW_ROUTER_CONVERSATION_QUALIFICATION,
  );
  return {
    async current(value, controls) {
      const selectedScope = value.scope;
      if (
        !qualification ||
        selectedScope.kind !== "repository" ||
        !qualification.repositories.some(
          (scope) =>
            scope.workspaceId === selectedScope.workspaceId &&
            scope.repositoryId === selectedScope.repositoryId,
        )
      )
        return false;
      const repository = await input.prisma.repositoryConnection.findFirst({
        where: {
          id: selectedScope.repositoryId,
          workspaceId: selectedScope.workspaceId,
          provider: "github",
          selected: true,
          archived: false,
        },
        select: {
          githubRepositoryId: true,
          fullName: true,
          installation: {
            select: { status: true, githubInstallationId: true },
          },
        },
      });
      if (
        !repository?.githubRepositoryId ||
        repository.installation?.status !== "active"
      )
        return false;
      const sourceScope = selectedScope;
      const reader = createGitHubAutomaticMemorySourceCurrent({
        scope: {
          ...sourceScope,
          githubRepositoryId: String(repository.githubRepositoryId),
          repositoryFullName: repository.fullName,
        },
        createClient: () =>
          input.createClient(
            String(repository.installation!.githubInstallationId),
          ),
        sourceProcessingAllowed: async () =>
          qualification.repositories.some(
            (scope) =>
              scope.workspaceId === sourceScope.workspaceId &&
              scope.repositoryId === sourceScope.repositoryId,
          ),
        standingPolicyRevision: async () => {
          const policy = await input.policy.getPolicy({
            workspaceId: sourceScope.workspaceId,
            repositoryId: sourceScope.repositoryId,
          });
          return `${policy.policyVersion}:${policy.safetyPolicyVersion}:${qualification.proofId}`;
        },
      });
      return reader.current(value, controls);
    },
  };
}
