import { Prisma, type ReviewContextConnection } from "@prisma/client";
import {
  ContextConnectionError,
  type ContextConnectionStore,
} from "../application/connections.js";
import {
  contextConnectionDefinitionSchema,
  type ContextConnection,
} from "../domain/context-tools.js";

type Client = Pick<Prisma.TransactionClient, "reviewContextConnection">;
export class PrismaContextConnectionStore implements ContextConnectionStore {
  constructor(private readonly client: Client) {}
  async find(
    workspaceId: string,
    connectionId: string,
  ): Promise<ContextConnection | null> {
    const row = await this.client.reviewContextConnection.findUnique({
      where: { workspaceId_connectionId: { workspaceId, connectionId } },
    });
    return row ? fromRow(row) : null;
  }
  async list(workspaceId: string): Promise<ContextConnection[]> {
    return (
      await this.client.reviewContextConnection.findMany({
        where: { workspaceId },
        orderBy: { connectionId: "asc" },
      })
    ).map(fromRow);
  }
  async save(
    connection: ContextConnection,
    expectedVersion: number | null,
  ): Promise<boolean> {
    if (
      connection.version !== (expectedVersion ?? 0) + 1 ||
      !Number.isSafeInteger(connection.version) ||
      connection.version < 1
    )
      return false;
    const {
      workspaceId,
      version: revision,
      enabled,
      definition,
      encryptedSecrets,
    } = connection;
    const data = {
      workspaceId,
      connectionId: definition.id,
      revision,
      enabled,
      definition: definition as Prisma.InputJsonValue,
      encryptedSecrets,
    };
    if (expectedVersion === null) {
      try {
        await this.client.reviewContextConnection.create({ data });
        return true;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          return false;
        throw error;
      }
    }
    const result = await this.client.reviewContextConnection.updateMany({
      where: {
        workspaceId,
        connectionId: definition.id,
        revision: expectedVersion,
      },
      data,
    });
    return result.count === 1;
  }
}
function fromRow(row: ReviewContextConnection): ContextConnection {
  const parsed = contextConnectionDefinitionSchema.safeParse(row.definition);
  if (
    !parsed.success ||
    parsed.data.id !== row.connectionId ||
    row.revision < 1
  )
    throw new ContextConnectionError("context_connection_invalid");
  return {
    workspaceId: row.workspaceId,
    version: row.revision,
    enabled: row.enabled,
    definition: parsed.data,
    encryptedSecrets: row.encryptedSecrets,
  };
}
