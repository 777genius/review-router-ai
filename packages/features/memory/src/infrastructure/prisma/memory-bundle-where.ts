import type { Prisma } from "@prisma/client";
import type { ListActiveMemoryForBundleInput } from "../../application/ports/memory-item-repository-port";

/** Apply authorization and expiry before SQL LIMIT, for every canonical read. */
export function memoryBundleWhere(
  input: Omit<ListActiveMemoryForBundleInput, "limit">,
): Prisma.MemoryItemWhereInput {
  const scopes: Prisma.MemoryItemWhereInput[] = [];
  if (input.allowedScopes.includes("workspace")) {
    scopes.push({ scope: "workspace", repositoryId: null, userId: null });
  }
  if (input.allowedScopes.includes("repository")) {
    scopes.push({
      scope: "repository",
      repositoryId: input.repositoryId,
      userId: null,
    });
  }
  if (input.allowedScopes.includes("user_prefs") && input.userId) {
    scopes.push({
      scope: "user_prefs",
      repositoryId: null,
      userId: input.userId,
    });
  }
  return {
    workspaceId: input.workspaceId,
    status: "active",
    AND: [
      { OR: scopes },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: input.activeAt } }] },
    ],
  };
}
