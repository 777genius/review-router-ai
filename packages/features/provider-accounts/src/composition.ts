import type { PrismaClient } from "@prisma/client";
export { createAccountLimits } from "./account-limits/composition";
export { createGatewayAccountLimitsReader } from "./account-limits/infrastructure/gateway/gateway-account-limits-reader";
import type { WorkspaceAccessRepositoryPort } from "@reviewrouter/features-auth";
import type {
  WorkspaceBindingFenceDeliveryPort,
  WorkspaceBindingClosureDeliveryPort,
} from "./application/ports/workspace-binding-fence-port";
import type { WorkspaceDeletionLifecyclePort } from "./application/ports/workspace-deletion-lifecycle-port";
import { PrismaProviderAccountRepository } from "./infrastructure/prisma/prisma-provider-account-repository";
import { PrismaWorkspaceDeletionRepository } from "./infrastructure/prisma/prisma-workspace-deletion-repository";
import {
  beginWorkspaceAccountDeletion,
  advanceWorkspaceAccountDeletion,
  readWorkspaceAccountDeletion,
} from "./application/use-cases/workspace-account-deletion";
export {
  GatewayWorkspaceDeletionLifecycle,
  createGatewayBindingClosureDelivery,
} from "./infrastructure/gateway/gateway-workspace-deletion-lifecycle";

/** Server support/operator composition. Authentication remains live on every
 * command; no browser route, local-login override, synthetic actor or provider.
 */
export function createWorkspaceAccountDeletionCoordinator(input: {
  readonly prisma: PrismaClient;
  readonly workspaceAccess: WorkspaceAccessRepositoryPort;
  readonly operatorWorkspaceId: string;
  readonly fenceDelivery: WorkspaceBindingFenceDeliveryPort;
  readonly lifecycle: WorkspaceDeletionLifecyclePort;
  readonly closures: WorkspaceBindingClosureDeliveryPort;
}) {
  const dependencies = {
    deletion: new PrismaWorkspaceDeletionRepository(
      input.prisma,
      input.operatorWorkspaceId,
    ),
    fences: new PrismaProviderAccountRepository(
      input.prisma,
      input.operatorWorkspaceId,
    ),
    workspaceAccess: input.workspaceAccess,
    operatorWorkspaceId: input.operatorWorkspaceId,
    fenceDelivery: input.fenceDelivery,
    lifecycle: input.lifecycle,
    closures: input.closures,
  };
  return {
    begin: (request: Parameters<typeof beginWorkspaceAccountDeletion>[0]) =>
      beginWorkspaceAccountDeletion(request, dependencies),
    advance: (request: Parameters<typeof advanceWorkspaceAccountDeletion>[0]) =>
      advanceWorkspaceAccountDeletion(request, dependencies),
    read: (request: Parameters<typeof readWorkspaceAccountDeletion>[0]) =>
      readWorkspaceAccountDeletion(request, dependencies),
  };
}

/** One finite trusted server gate. Never read from a request, session or config DTO. */
export function readPersonalAccountSharingEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED === "1";
}
