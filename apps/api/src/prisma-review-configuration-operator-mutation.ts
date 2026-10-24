import type { PrismaClient } from "@prisma/client";
import { PrismaAuditLogRepository } from "@reviewrouter/features-audit-log";
import {
  acquireReviewConfigurationWriteScope,
  isPrismaReviewConfigurationWriteConflict,
  isReviewConfigurationWriteConflictError,
  PrismaReviewConfigurationTransactionRepository,
  resolveReviewConfiguration,
  ReviewConfigurationWriteConflictError,
  runReviewConfigurationTransaction,
  type ReviewConfigurationOperatorMutationPort,
} from "@reviewrouter/features-review-config";
import { ReviewConfigurationOperatorAudit } from "./review-configuration-operator-audit.js";

export class PrismaReviewConfigurationOperatorMutation implements ReviewConfigurationOperatorMutationPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorWorkspaceId?: string,
    private readonly personalAccountsEnabled = false,
  ) {}

  async commit(
    input: Parameters<ReviewConfigurationOperatorMutationPort["commit"]>[0],
  ) {
    try {
      return await runReviewConfigurationTransaction(
        this.prisma,
        async (transaction) => {
          await acquireReviewConfigurationWriteScope(transaction, input.target);
          const configurations =
            new PrismaReviewConfigurationTransactionRepository(
              transaction,
              this.operatorWorkspaceId,
              this.personalAccountsEnabled,
              undefined,
            );
          const current = await resolveReviewConfiguration(input.target, {
            configurations,
          });
          if (!current || current.revisionToken !== input.expectedRevisionToken)
            throw new ReviewConfigurationWriteConflictError();

          const saved = await configurations.saveNextVersion({
            target: input.target,
            policy: input.policy,
            expectedVersion:
              current.source === "repository" ? current.version : null,
          });
          await new ReviewConfigurationOperatorAudit(
            new PrismaAuditLogRepository(transaction),
          ).record({
            ...input.auditEvent,
            metadata: {
              ...input.auditEvent.metadata,
              version: saved.version,
            },
          });
          return saved;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        isReviewConfigurationWriteConflictError(error) ||
        isPrismaReviewConfigurationWriteConflict(error)
      )
        throw new ReviewConfigurationWriteConflictError();
      throw error;
    }
  }
}
