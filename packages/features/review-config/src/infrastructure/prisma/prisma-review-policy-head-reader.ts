import type { Prisma, PrismaClient } from "@prisma/client";
import {
  reviewConfigurationTargetKey,
  type ReviewConfigurationTarget,
} from "../../domain/review-configuration-target";
import { storedReviewPolicyProfileIds } from "../../domain/review-policy-document";
import type {
  ReviewPolicyHead,
  ReviewPolicyHeadReaderPort,
} from "../../application/ports/review-configuration-repository-port";
import { readProviderProfiles } from "./prisma-provider-profile-rows";

export type ReviewPolicyReader = Pick<
  PrismaClient | Prisma.TransactionClient,
  "reviewConfiguration" | "workspaceProviderProfile"
>;

const policyHeadSelect = {
  version: true,
  schemaVersion: true,
  policyJson: true,
} as const;

/** Reads with the given client, or inside the caller's transaction. */
export class PrismaReviewPolicyHeadReader implements ReviewPolicyHeadReaderPort {
  constructor(private readonly reader: ReviewPolicyReader) {}

  /** Reads all heads and profiles of one call in a single RepeatableRead snapshot. */
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
      readWorkspacePolicyHeads: (workspaceId) =>
        inSnapshot((heads) => heads.readWorkspacePolicyHeads(workspaceId)),
      readProviderProfiles: (input) =>
        new PrismaReviewPolicyHeadReader(prisma).readProviderProfiles(input),
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
    const profiles = await readProviderProfiles(
      this.reader,
      target.workspaceId,
      referencedProfileIds([workspace, repository]),
    );
    return { workspace, repository, profiles };
  }

  readRepositoryPolicyHeads(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }) {
    const repositoryIds = [...new Set(input.repositoryIds)];
    return this.readHeads(input.workspaceId, repositoryIds);
  }

  readWorkspacePolicyHeads(workspaceId: string) {
    return this.readHeads(workspaceId, null);
  }

  readProviderProfiles(input: {
    readonly workspaceId: string;
    readonly profileIds: readonly string[];
  }) {
    return readProviderProfiles(
      this.reader,
      input.workspaceId,
      input.profileIds,
    );
  }

  /** Null repository IDs read every active repository head. */
  private async readHeads(
    workspaceId: string,
    repositoryIds: readonly string[] | null,
  ) {
    const workspace = await readActivePolicyHead(this.reader, {
      workspaceId,
      targetKey: workspaceTargetKey(workspaceId),
    });
    const records =
      repositoryIds?.length === 0
        ? []
        : await this.reader.reviewConfiguration.findMany({
            where: {
              workspaceId,
              repositoryId: repositoryIds
                ? { in: [...repositoryIds] }
                : { not: null },
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
    const repositories = new Map(
      records.flatMap((record) =>
        record.repositoryId && record.versions[0]
          ? [[record.repositoryId, record.versions[0]] as const]
          : [],
      ),
    );
    const profiles = await readProviderProfiles(
      this.reader,
      workspaceId,
      referencedProfileIds([workspace, ...repositories.values()]),
    );
    return { workspace, repositories, profiles };
  }
}

/** The raw head of one active target, including heads in retired formats. */
export async function readActivePolicyHead(
  reader: Pick<ReviewPolicyReader, "reviewConfiguration">,
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

export function referencedProfileIds(
  heads: readonly (ReviewPolicyHead | null)[],
): readonly string[] {
  return [
    ...new Set(
      heads.flatMap((head) => (head ? storedReviewPolicyProfileIds(head) : [])),
    ),
  ];
}

function workspaceTargetKey(workspaceId: string): string {
  return reviewConfigurationTargetKey({ scope: "workspace", workspaceId });
}
