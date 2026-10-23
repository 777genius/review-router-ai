import type { Prisma, PrismaClient } from "@prisma/client";
import {
  reviewConfigurationTargetKey,
  type ReviewConfigurationTarget,
} from "../../domain/review-configuration-target";
import type {
  ReviewPolicyHead,
  ReviewPolicyHeadReaderPort,
} from "../../application/ports/review-configuration-repository-port";

export type ReviewPolicyReader = Pick<
  PrismaClient | Prisma.TransactionClient,
  "reviewConfiguration"
>;

const policyHeadSelect = {
  version: true,
  schemaVersion: true,
  policyJson: true,
} as const;

/** Reads with the given client, or inside the caller's transaction. */
export class PrismaReviewPolicyHeadReader implements ReviewPolicyHeadReaderPort {
  constructor(private readonly reader: ReviewPolicyReader) {}

  /** Reads all heads of one call in a single RepeatableRead snapshot. */
  static snapshot(prisma: PrismaClient): ReviewPolicyHeadReaderPort {
    const inSnapshot = <T>(
      read: (heads: PrismaReviewPolicyHeadReader) => Promise<T>,
    ) =>
      prisma.$transaction(
        (transaction) => read(new PrismaReviewPolicyHeadReader(transaction)),
        { isolationLevel: "RepeatableRead" },
      );
    return {
      readPolicyHeads: (target) =>
        inSnapshot((heads) => heads.readPolicyHeads(target)),
      readRepositoryPolicyHeads: (input) =>
        inSnapshot((heads) => heads.readRepositoryPolicyHeads(input)),
    };
  }

  async readPolicyHeads(target: ReviewConfigurationTarget) {
    const workspace = await readActivePolicyHead(this.reader, {
      workspaceId: target.workspaceId,
      targetKey: workspaceTargetKey(target.workspaceId),
    });
    const repository =
      target.scope === "repository"
        ? await readActivePolicyHead(this.reader, {
            workspaceId: target.workspaceId,
            targetKey: reviewConfigurationTargetKey(target),
          })
        : null;
    return { workspace, repository };
  }

  async readRepositoryPolicyHeads(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }) {
    const workspace = await readActivePolicyHead(this.reader, {
      workspaceId: input.workspaceId,
      targetKey: workspaceTargetKey(input.workspaceId),
    });
    const repositoryIds = [...new Set(input.repositoryIds)];
    const records =
      repositoryIds.length === 0
        ? []
        : await this.reader.reviewConfiguration.findMany({
            where: {
              workspaceId: input.workspaceId,
              repositoryId: { in: repositoryIds },
              active: true,
            },
            orderBy: { repositoryId: "asc" },
            select: {
              repositoryId: true,
              versions: {
                orderBy: { version: "desc" },
                take: 1,
                select: policyHeadSelect,
              },
            },
          });
    return {
      workspace,
      repositories: new Map(
        records.flatMap((record) =>
          record.repositoryId && record.versions[0]
            ? [[record.repositoryId, record.versions[0]] as const]
            : [],
        ),
      ),
    };
  }
}

/** The raw head of one active target, including heads in retired formats. */
export async function readActivePolicyHead(
  reader: ReviewPolicyReader,
  scope: { readonly workspaceId: string; readonly targetKey: string },
): Promise<ReviewPolicyHead | null> {
  const configuration = await reader.reviewConfiguration.findUnique({
    where: {
      workspaceId_targetKey: {
        workspaceId: scope.workspaceId,
        targetKey: scope.targetKey,
      },
      active: true,
    },
    select: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: policyHeadSelect,
      },
    },
  });
  return configuration?.versions[0] ?? null;
}

function workspaceTargetKey(workspaceId: string): string {
  return reviewConfigurationTargetKey({ scope: "workspace", workspaceId });
}
