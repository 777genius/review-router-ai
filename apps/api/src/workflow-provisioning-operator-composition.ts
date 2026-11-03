import type { PrismaClient } from "@reviewrouter/platform-db";
import { SystemClock } from "@reviewrouter/shared";
import { PrismaRateLimitStore } from "@reviewrouter/features-rate-limits";
import { HashedReviewConfigurationOperatorAuthorization } from "@reviewrouter/features-review-config";
import {
  assertWorkspaceFeatureEntitlement,
  EntitlementDeniedError,
  PrismaEntitlementRepository,
} from "@reviewrouter/features-entitlements";
import { createInstalledGatewayReviewConfirmation } from "@reviewrouter/features-workflow-provisioning";
import { ReviewConfigurationOperatorRateLimit } from "./review-configuration-operator-rate-limit.js";
import {
  createWorkflowProvisioningOperatorAuthorization,
  prismaWorkflowProvisioningOperatorAccess,
  readWorkflowProvisioningOperatorGrants,
  WorkflowProvisioningOperatorAccessError,
} from "./workflow-provisioning-operator-authorization.js";
import type { WorkflowProvisioningOperatorDependencies } from "./workflow-provisioning-operator-routes.js";

export function createWorkflowProvisioningOperatorComposition(input: {
  prisma: PrismaClient;
  env: Readonly<Record<string, string | undefined>>;
  credentialSha256: string;
}): WorkflowProvisioningOperatorDependencies | undefined {
  const grants = readWorkflowProvisioningOperatorGrants(
    input.env.REVIEW_ROUTER_WORKFLOW_PROVISIONING_OPERATOR_GRANTS_JSON,
  );
  if (!grants.length) return undefined;
  const access = prismaWorkflowProvisioningOperatorAccess(
    input.prisma,
    async (workspaceId, operatorId) => {
      try {
        await assertWorkspaceFeatureEntitlement(
          { workspaceId, actor: operatorId, feature: "workflow_provisioning" },
          { entitlements: new PrismaEntitlementRepository(input.prisma) },
        );
      } catch (error) {
        if (error instanceof EntitlementDeniedError)
          throw new WorkflowProvisioningOperatorAccessError("forbidden");
        throw error;
      }
    },
  );
  const authorization = createWorkflowProvisioningOperatorAuthorization({
    grants,
    access,
    authorization: new HashedReviewConfigurationOperatorAuthorization(
      "reviewrouter-operator",
      input.credentialSha256,
    ),
  });
  return {
    authorization,
    rateLimits: new ReviewConfigurationOperatorRateLimit(
      new PrismaRateLimitStore(input.prisma),
      new SystemClock(),
    ),
    confirm: (scope) =>
      createInstalledGatewayReviewConfirmation({
        prisma: input.prisma,
        env: input.env,
        assertAuthorized: () => authorization.assertCurrent(scope),
      }).confirm({
        workspaceId: scope.workspaceId,
        repositoryId: scope.repositoryId,
        actor: scope.operatorId,
        operatorAudit: {
          operatorId: scope.operatorId,
          ownerUserId: scope.ownerUserId,
        },
      }),
  };
}
