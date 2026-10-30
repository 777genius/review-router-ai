import type { Prisma, PrismaClient } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import type { WorkspaceMemorySettings } from "../../application/use-cases/manage-workspace-memory-settings";
import { parseStoredReviewPolicy } from "../../application/use-cases/resolve-effective-review-configuration";
import { readActivePolicyHead } from "./prisma-review-policy-head-reader";

/** Fresh workspace-only reads, including inside a caller's admission transaction. */
export class PrismaWorkspaceMemorySettings {
  constructor(
    private readonly prisma: Pick<
      PrismaClient | Prisma.TransactionClient,
      "reviewConfiguration"
    >,
  ) {}

  /** Admission reads hold the settings writer's shared workspace guard until commit. */
  async read(
    workspaceId: string,
    admissionTransaction?: Prisma.TransactionClient,
  ): Promise<WorkspaceMemorySettings> {
    if (admissionTransaction)
      await acquireCurrentScopeGuards(admissionTransaction, [
        { scope: "workspace", workspaceId, mode: "shared" },
      ]);
    const head = await readActivePolicyHead(
      admissionTransaction ?? this.prisma,
      {
        workspaceId,
        targetKey: "workspace:default",
      },
    );
    if (!head) return { requireConfirmation: false, version: null };
    const policy = parseStoredReviewPolicy("workspace", head);
    if (!policy) throw new Error("review_policy_resave_required");
    return {
      requireConfirmation: policy.memory?.requireConfirmation ?? false,
      version: head.version,
    };
  }
}
