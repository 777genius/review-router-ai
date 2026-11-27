import { Prisma, type PrismaClient } from "@prisma/client";

/** Retry the entire unit of work, including all authority reads. A transaction
 * client joins its caller's Serializable boundary; the caller owns its retries. */
export async function workflowProvisioningTransaction<T>(
  prisma: PrismaClient | Prisma.TransactionClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  // The interactive proxy may expose $transaction; lifecycle distinguishes root.
  if (!("$connect" in prisma) || typeof prisma.$connect !== "function")
    return work(prisma);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034"
      )
        throw error;
    }
  }
}
