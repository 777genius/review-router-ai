import type { PrismaClient } from "@prisma/client";
import type {
  CurrentWorkflowSetupQueryPort,
  CurrentWorkflowSetupScope,
} from "../../application/ports/current-workflow-setup-query-port.js";
import type { CurrentWorkflowSetupAttempt } from "../../domain/workflow-setup-authority.js";

export class PrismaCurrentWorkflowSetupQuery implements CurrentWorkflowSetupQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findEligibleRepository(
    scope: CurrentWorkflowSetupScope,
  ): Promise<Readonly<{ defaultBranch: string }> | null> {
    return this.prisma.repositoryConnection.findFirst({
      where: {
        id: scope.repositoryId,
        workspaceId: scope.workspaceId,
        installationId: scope.installationId,
        provider: "github",
        selected: true,
        archived: false,
        installation: { status: "active" },
      },
      select: { defaultBranch: true },
    });
  }

  async findCurrentAttempt(
    repositoryId: string,
  ): Promise<CurrentWorkflowSetupAttempt | null> {
    return this.prisma.workflowProvisioning.findUnique({
      where: { repositoryId },
    });
  }
}
