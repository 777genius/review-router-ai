import type { PrismaClient } from "@prisma/client";
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
        {
          id: {
            in: input.processingIds.flatMap((id) =>
              [0, 1, 2, 3, ...input.knownEntryIds].map((child) =>
                automaticMemoryChildCommandId(id, child),
              ),
            ),
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
  const scopeKey = memoryKnowledgeScopeKey(scope);
  if (
    rows.some(
      (row) =>
        row.generation !== input.generation ||
        row.scopeKey !== scopeKey ||
        row.workspaceId !== scope.workspaceId,
    )
  )
    throw new Error("eval_durable_command_scope_invalid");
  return rows;
}
