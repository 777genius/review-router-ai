import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ReviewConfigurationOperatorOperation,
  type ReviewConfigurationOperatorRateLimitPort,
} from "@reviewrouter/features-review-config";
import type { InstalledGatewayReviewConfirmationResult } from "@reviewrouter/features-workflow-provisioning";
import {
  WorkflowProvisioningOperatorAccessError,
  type createWorkflowProvisioningOperatorAuthorization,
  type WorkflowProvisioningOperatorScope,
} from "./workflow-provisioning-operator-authorization.js";

const commandSchema = z
  .strictObject({
    workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/),
    repository: z
      .string()
      .max(255)
      .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/),
    confirm: z.string().max(255),
  })
  .refine((command) => command.confirm === command.repository);

export interface WorkflowProvisioningOperatorDependencies {
  authorization: ReturnType<
    typeof createWorkflowProvisioningOperatorAuthorization
  >;
  rateLimits: ReviewConfigurationOperatorRateLimitPort;
  confirm(
    scope: WorkflowProvisioningOperatorScope,
  ): Promise<InstalledGatewayReviewConfirmationResult>;
}

export async function registerWorkflowProvisioningOperatorRoutes(
  app: FastifyInstance,
  dependencies: WorkflowProvisioningOperatorDependencies,
): Promise<void> {
  app.post(
    "/api/operator/v1/workflow-provisioning/confirm-installed-gateway",
    {
      bodyLimit: 2_048,
      errorHandler: (error, _request, reply) =>
        reply
          .header("Cache-Control", "no-store")
          .code(error.statusCode === 413 ? 413 : 400)
          .send({ error: { code: "invalid_request" } }),
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const command = commandSchema.safeParse(request.body);
      if (!command.success)
        return reply.code(400).send({ error: { code: "invalid_request" } });
      try {
        const credential =
          /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? "")?.[1] ??
          "";
        const scope = await dependencies.authorization.authorize(
          credential,
          command.data.workspace,
          command.data.repository,
        );
        if (
          !(await dependencies.rateLimits.consume({
            operatorId: scope.operatorId,
            operation:
              ReviewConfigurationOperatorOperation.ConfirmInstalledGatewayWorkflow,
            repositoryFullName: scope.repository,
          }))
        )
          return reply.code(429).send({ error: { code: "rate_limited" } });
        // Re-check after the rate-limit await as well as every application phase.
        await dependencies.authorization.assertCurrent(scope);
        const result = await dependencies.confirm(scope);
        if (result.status !== "ready")
          return reply.send({
            result: { status: result.status, issue: result.issue },
          });
        // Explicit projection keeps future internal fields/capabilities off this API.
        return reply.send({
          result: {
            status: result.status,
            outcome: result.outcome,
            repositoryId: result.repositoryId,
            repository: result.repository,
            authorityVersion: result.authorityVersion,
            authorityEpoch: result.authorityEpoch,
            workflowPath: result.workflowPath,
            sourceCommitSha: result.sourceCommitSha,
            callerBlobSha: result.callerBlobSha,
            actionCommitSha: result.actionCommitSha,
            attemptId: result.attemptId,
            revision: result.revision,
          },
        });
      } catch (error) {
        if (error instanceof WorkflowProvisioningOperatorAccessError)
          return reply
            .code(error.code === "unauthorized" ? 401 : 403)
            .send({ error: { code: error.code } });
        // Database, transport and entitlement errors must never expose raw details.
        return reply
          .code(503)
          .send({ error: { code: "workflow_confirmation_unavailable" } });
      }
    },
  );
}
