import type { PrismaClient } from "@prisma/client";
import type { ProviderAccountRepositoryPort } from "../../application/ports/provider-account-repository-port";
import {
  ProviderAccountError,
  assertExecutable,
  assertExpectedRevision,
  assertWorkspaceOwner,
  type BindingScope,
  type BindingState,
} from "../../domain/provider-account";
import {
  mapBinding,
  mapConnection,
  rethrowProductStorageError,
} from "./connection-mapping";

export class PrismaProviderAccountRepository implements ProviderAccountRepositoryPort {
  private readonly prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findOwnedConnection(request: BindingScope) {
    const scope = {
      workspaceId: request.workspaceId,
      connectionId: request.connectionId,
    };
    const row = await this.prisma.providerAccountConnection.findFirst({
      where: {
        id: scope.connectionId,
        ownerWorkspaceId: scope.workspaceId,
        ownerUserId: null,
      },
    });
    return row ? mapConnection(row) : null;
  }
  async findBinding(request: {
    readonly workspaceId: string;
    readonly bindingId: string;
  }) {
    const input = {
      workspaceId: request.workspaceId,
      bindingId: request.bindingId,
    };
    const row = await this.prisma.workspaceAccountBinding.findUnique({
      where: {
        id_workspaceId: { id: input.bindingId, workspaceId: input.workspaceId },
      },
      include: { connection: true },
    });
    return row
      ? { binding: mapBinding(row), connection: mapConnection(row.connection) }
      : null;
  }
  async compareAndSetBinding(
    request: BindingScope & {
      readonly expectedRevision: number;
      readonly state: BindingState;
    },
  ) {
    const input = {
      workspaceId: request.workspaceId,
      connectionId: request.connectionId,
      expectedRevision: request.expectedRevision,
      state: request.state,
    };
    assertExpectedRevision(input.expectedRevision, input.state === "active");
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Lock the owned connection before inspecting status or the binding.
          // Synchronization UPDATEs use this same row lock. Initial bind/bind and
          // bind/revoke races are serialized without an absent-row lock gap.
          const locked = await tx.$queryRaw<readonly { id: string }[]>`
          SELECT "id" FROM "ProviderAccountConnection"
          WHERE "id" = ${input.connectionId} AND "ownerWorkspaceId" = ${input.workspaceId}
            AND "ownerUserId" IS NULL FOR UPDATE`;
          if (locked.length !== 1)
            throw new ProviderAccountError("connection_unavailable");
          const record = await tx.providerAccountConnection.findFirst({
            where: {
              id: input.connectionId,
              ownerWorkspaceId: input.workspaceId,
              ownerUserId: null,
            },
          });
          const connection = record ? mapConnection(record) : null;
          assertWorkspaceOwner(connection, input.workspaceId);
          if (input.state === "active") assertExecutable(connection);
          const pair = {
            workspaceId: input.workspaceId,
            connectionId: input.connectionId,
          };
          const current = await tx.workspaceAccountBinding.findUnique({
            where: { workspaceId_connectionId: pair },
          });
          if (!current) {
            if (input.expectedRevision !== 0 || input.state !== "active") {
              throw new ProviderAccountError("revision_conflict");
            }
            return mapBinding(
              await tx.workspaceAccountBinding.create({
                data: { ...pair, state: "active", revision: 1 },
              }),
            );
          }
          const changed = await tx.workspaceAccountBinding.updateMany({
            where: { ...pair, revision: input.expectedRevision },
            data: { state: input.state, revision: { increment: 1 } },
          });
          if (changed.count !== 1)
            throw new ProviderAccountError("revision_conflict");
          const updated = await tx.workspaceAccountBinding.findUniqueOrThrow({
            where: { workspaceId_connectionId: pair },
          });
          return mapBinding(updated);
        },
        { isolationLevel: "ReadCommitted" },
      );
    } catch (error) {
      return rethrowProductStorageError(error);
    }
  }
}
