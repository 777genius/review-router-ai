import type { MemoryKnowledgeAccessPort } from "../../application/ports/memory-knowledge-access-port";
import type { MemoryRequestControls } from "../../application/ports/memory-knowledge-provider-port";

/**
 * Reads approved provenance without reopening the upstream discussion. The caller
 * must first authorize the consumer and check that the linked repository remains
 * selected in this workspace (PrismaMemoryKnowledgeAccess does both).
 * Later edits or removal of that discussion do not repeal an approved statement.
 */
export async function approvedMemorySourceApplicable(
  input: Parameters<MemoryKnowledgeAccessPort["sourceApplicable"]>[0] & {
    readonly headSha?: string;
  },
  controls: MemoryRequestControls,
): Promise<boolean> {
  if (controls.signal?.aborted || controls.deadlineAt.getTime() <= Date.now())
    return false;
  const { source, scope } = input;
  if (
    source.type !== "github_comment" ||
    !/^github-node:[A-Za-z0-9_+/=-]{1,256}$/.test(source.sourceId) ||
    !source.repositoryId ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(source.repositoryId) ||
    !source.revision ||
    !Number.isFinite(Date.parse(source.statementAt)) ||
    !Number.isFinite(Date.parse(source.updatedAt))
  )
    return false;
  if (scope.kind === "repository" && source.repositoryId !== scope.repositoryId)
    return false;
  if (
    scope.kind === "workspace" &&
    source.visibility !== "public" &&
    source.url !== null
  )
    return false;
  if (source.url !== null) {
    try {
      const url = new URL(source.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.port ||
        url.username ||
        url.password ||
        !/^\/[^/]+\/[^/]+\/(?:pull|issues)\/\d+(?:\/.*)?$/.test(url.pathname)
      )
        return false;
      if (
        source.pullRequestNumber !== null &&
        Number(url.pathname.split("/")[4]) !== source.pullRequestNumber
      )
        return false;
    } catch {
      return false;
    }
  }
  if (
    source.observedCommitSha &&
    (!/^[0-9a-f]{40,64}$/i.test(source.observedCommitSha) ||
      (input.consumer === "runtime" &&
        source.observedCommitSha !== input.headSha))
  )
    return false;
  return true;
}
