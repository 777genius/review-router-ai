import type { PrismaClient } from "@prisma/client";
import { conversationDigest } from "../../packages/features/conversations/src/index.js";
import {
  automaticMemoryChildCommandId,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeScope,
} from "../../packages/features/memory/src/index.js";

/** Independent durable inventory, including wrong-scope commands tied to fresh fixture identities. */
export async function readDurableCommands(input: {
  prisma: Pick<PrismaClient, "memoryKnowledgeCommand">;
  namespace: string;
  scope: MemoryKnowledgeScope;
  generation: string;
  knownEntryIds: readonly string[];
  processingIds: readonly string[];
  returnedIds: readonly string[];
  knownScopes?: readonly MemoryKnowledgeScope[];
  sourceIds?: readonly string[];
}) {
  const rows = await input.prisma.memoryKnowledgeCommand.findMany({
    where: {
      OR: [
        { workspaceId: input.scope.workspaceId },
        { entryId: { in: [...input.knownEntryIds] } },
        { id: { in: [...input.returnedIds] } },
        {
          envelope: {
            path: ["source", "sourceId"],
            string_starts_with: `${input.namespace}:`,
          },
        },
        ...(input.sourceIds ?? []).map((sourceId) => ({
          envelope: { path: ["source", "sourceId"], equals: sourceId },
        })),
        {
          id: {
            in: input.processingIds.flatMap((id) => {
              const digest = conversationDigest([
                "conversation-explicit-command",
                id,
              ]);
              const explicitId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
              return [
                explicitId,
                ...[0, 1, 2, 3, ...input.knownEntryIds].map((child) =>
                  automaticMemoryChildCommandId(id, child),
                ),
              ];
            }),
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: 257,
  });
  if (rows.length > 256)
    throw new Error("eval_command_inventory_exceeds_bounded_fixture");
  const scope = input.scope;
  const scopeKeys = new Set(
    (input.knownScopes ?? [scope]).map(memoryKnowledgeScopeKey),
  );
  if (
    rows.some(
      (row) =>
        row.generation !== input.generation ||
        !scopeKeys.has(row.scopeKey) ||
        row.workspaceId !== scope.workspaceId,
    )
  )
    throw new Error("eval_durable_command_scope_invalid");
  return rows;
}
