import type { PrismaClient } from "@prisma/client";
import { runScopeEpochSerializableTransaction } from "@reviewrouter/platform-db";
import type { ProviderAccountSynchronizationPort } from "../../application/ports/provider-account-synchronization-port";
import {
  ProviderAccountError,
  assertExpectedRevision,
  assertMetadata,
  assertOpaqueReference,
  type ConnectionMetadata,
} from "../../domain/provider-account";
import {
  mapConnection,
  rethrowProductStorageError,
} from "./connection-mapping";

/** Trusted backend adapter for a safe, already-qualified gateway status projection. */
export class PrismaProviderAccountSynchronization implements ProviderAccountSynchronizationPort {
  private readonly prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }
  async recordWorkspaceConnection(
    request: ConnectionMetadata & {
      readonly id: string;
      readonly workspaceId: string;
      readonly gatewayAccountRef: string;
      readonly authorizationEpoch: number;
    },
  ) {
    const input = {
      id: request.id,
      workspaceId: request.workspaceId,
      gatewayAccountRef: request.gatewayAccountRef,
      gatewayOperationRef: request.gatewayOperationRef,
      profileRef: request.profileRef,
      displayName: request.displayName,
      state: request.state,
      authorizationEpoch: request.authorizationEpoch,
    };
    assertMetadata(input);
    if (
      !Number.isSafeInteger(input.authorizationEpoch) ||
      input.authorizationEpoch < 1
    )
      throw new ProviderAccountError("invalid_input");
    for (const ref of [input.id, input.workspaceId, input.gatewayAccountRef])
      assertOpaqueReference(ref);
    try {
      // Deliberate field allowlist: never spread an upstream descriptor into Prisma.
      return mapConnection(
        await runScopeEpochSerializableTransaction(
          this.prisma,
          [
            { scope: "accountSource", sourceId: input.id, mode: "exclusive" },
            {
              scope: "workspace",
              workspaceId: input.workspaceId,
              mode: "shared",
            },
          ],
          (tx) =>
            tx.providerAccountConnection.create({
              data: {
                id: input.id,
                ownerWorkspaceId: input.workspaceId,
                ownerUserId: null,
                gatewayAccountRef: input.gatewayAccountRef,
                gatewayOperationRef: input.gatewayOperationRef,
                profileRef: input.profileRef,
                displayName: input.displayName,
                state: input.state,
                metadataRevision: 1,
                authorizationEpochMirror: BigInt(input.authorizationEpoch),
              },
            }),
        ),
      );
    } catch (error) {
      return rethrowProductStorageError(error);
    }
  }
  async synchronizeMetadata(
    request: ConnectionMetadata & {
      readonly workspaceId: string;
      readonly connectionId: string;
      readonly expectedRevision: number;
      readonly authorizationEpoch: number;
    },
  ) {
    const input = {
      workspaceId: request.workspaceId,
      connectionId: request.connectionId,
      expectedRevision: request.expectedRevision,
      gatewayOperationRef: request.gatewayOperationRef,
      profileRef: request.profileRef,
      displayName: request.displayName,
      state: request.state,
      authorizationEpoch: request.authorizationEpoch,
    };
    assertMetadata(input);
    if (
      !Number.isSafeInteger(input.authorizationEpoch) ||
      input.authorizationEpoch < 1
    )
      throw new ProviderAccountError("invalid_input");
    assertExpectedRevision(input.expectedRevision);
    assertOpaqueReference(input.workspaceId);
    assertOpaqueReference(input.connectionId);
    try {
      return await runScopeEpochSerializableTransaction(
        this.prisma,
        [
          {
            scope: "accountSource",
            sourceId: input.connectionId,
            mode: "exclusive",
          },
          {
            scope: "workspace",
            workspaceId: input.workspaceId,
            mode: "shared",
          },
        ],
        async (tx) => {
          const changed = await tx.providerAccountConnection.updateMany({
            where: {
              id: input.connectionId,
              ownerWorkspaceId: input.workspaceId,
              ownerUserId: null,
              metadataRevision: input.expectedRevision,
              pendingSourceOperationId: null,
              OR: [
                { authorizationEpochMirror: null },
                {
                  authorizationEpochMirror: {
                    lte: BigInt(input.authorizationEpoch),
                  },
                },
              ],
            },
            data: {
              gatewayOperationRef: input.gatewayOperationRef,
              profileRef: input.profileRef,
              displayName: input.displayName,
              state: input.state,
              metadataRevision: { increment: 1 },
              authorizationEpochMirror: BigInt(input.authorizationEpoch),
            },
          });
          if (changed.count !== 1)
            throw new ProviderAccountError("revision_conflict");
          return mapConnection(
            await tx.providerAccountConnection.findFirstOrThrow({
              where: {
                id: input.connectionId,
                ownerWorkspaceId: input.workspaceId,
                ownerUserId: null,
              },
            }),
          );
        },
      );
    } catch (error) {
      return rethrowProductStorageError(error);
    }
  }
}
