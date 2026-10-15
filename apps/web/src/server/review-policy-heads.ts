import type { PrismaClient } from "@reviewrouter/platform-db";

/** Read opaque policy heads before parsing so legacy policies retain CAS protection. */
export async function readReviewPolicyHeadVersions(
  prisma: Pick<PrismaClient, "reviewConfiguration">,
  workspaceId: string,
  repositoryIds: readonly string[] = [],
): Promise<Map<string, number | null>> {
  const heads = await prisma.reviewConfiguration.findMany({
    where: {
      workspaceId,
      active: true,
      OR: [
        { targetKey: "workspace:default", repositoryId: null },
        ...repositoryIds.map((repositoryId) => ({
          targetKey: `repo:${repositoryId}`,
          repositoryId,
        })),
      ],
    },
    select: {
      targetKey: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true },
      },
    },
  });
  return new Map(
    heads.map((head) => [head.targetKey, head.versions[0]?.version ?? null]),
  );
}
