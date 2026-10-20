import {
  Prisma,
  type PrismaClient,
  type PersonalAccountOperation,
  type ProviderAccountConnection,
  type WorkspaceAccountBinding,
} from "@prisma/client";
import {
  ProviderAccountError,
  assertExpectedRevision,
  assertMetadata,
  assertOpaqueReference,
} from "../../domain/provider-account";
import {
  canonicalFenceOperationId,
  canonicalIntentHash,
  snapshotCanonicalIntent,
  type PersonalCanonicalIntent,
} from "../../domain/personal-canonical-operation";
import { personalOperationId } from "../../application/use-cases/personal-account-operations";
import type {
  PersonalCanonicalOperationStore,
  PersonalCanonicalReceipt,
  PersonalCanonicalPhase,
} from "../../application/ports/personal-canonical-operation-port";
import type { PersonalGatewayAccount } from "../../application/ports/provider-account-synchronization-port";
import { PrismaPersonalAccountOperations } from "./prisma-personal-account-operations";
import {
  mapConnection,
  rethrowProductStorageError,
} from "./connection-mapping";

type Tx = Prisma.TransactionClient;
const fail = (
  code:
    | "connection_unavailable"
    | "revision_conflict"
    | "operation_conflict" = "connection_unavailable",
): never => {
  throw new ProviderAccountError(code);
};
const key = (actorUserId: string, clientOperationId: string) => ({
  actorUserId_clientOperationId: { actorUserId, clientOperationId },
});
function intentOf(row: PersonalAccountOperation): PersonalCanonicalIntent {
  return snapshotCanonicalIntent({
    ...row,
    expectedGatewayRevision: Number(row.expectedGatewayRevision),
    expectedAuthorizationEpoch: Number(row.expectedAuthorizationEpoch),
  } as PersonalCanonicalIntent);
}
/** Disabled package composition. All effects are outside these RR transactions. */
export class PrismaPersonalCanonicalOperations implements PersonalCanonicalOperationStore {
  private readonly personal: PrismaPersonalAccountOperations;
  constructor(private readonly prisma: PrismaClient) {
    this.personal = new PrismaPersonalAccountOperations(prisma);
  }
  findOwnedSource(actorUserId: string, sourceId: string) {
    return this.personal.findOwnedSource(actorUserId, sourceId);
  }
  private async operation(
    tx: Tx,
    actorUserId: string,
    clientOperationId: string,
  ) {
    assertOpaqueReference(actorUserId);
    assertOpaqueReference(clientOperationId);
    const row = await tx.personalAccountOperation.findUnique({
      where: key(actorUserId, clientOperationId),
    });
    if (!row) throw new ProviderAccountError("not_found");
    if (!["rename", "reconnect", "retire"].includes(row.action))
      return fail("operation_conflict");
    return row;
  }
  private async receipt(
    tx: Tx,
    row: PersonalAccountOperation,
  ): Promise<PersonalCanonicalReceipt> {
    const intent = intentOf(row);
    const source = await tx.providerAccountConnection.findFirst({
      where: {
        id: intent.sourceId,
        ownerUserId: intent.actorUserId,
        ownerWorkspaceId: null,
      },
    });
    if (
      !source ||
      !(await tx.workspace.findFirst({
        where: {
          id: intent.personalWorkspaceId,
          personalOwnerUserId: intent.actorUserId,
        },
      }))
    )
      return fail();
    return {
      id: row.id,
      intent,
      phase: row.phase as PersonalCanonicalPhase,
      source: mapConnection(source),
    };
  }
  read(actorUserId: string, clientOperationId: string) {
    return this.prisma.$transaction(async (tx) =>
      this.receipt(
        tx,
        await this.operation(tx, actorUserId, clientOperationId),
      ),
    );
  }
  private async lockSource(tx: Tx, intent: PersonalCanonicalIntent) {
    // U/P FK authority before Source; canonical writes never lock org membership after Source.
    const users = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "User" WHERE "id"=${intent.actorUserId} FOR KEY SHARE`;
    const scopes = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "Workspace" WHERE "id"=${intent.personalWorkspaceId} AND "personalOwnerUserId"=${intent.actorUserId} FOR KEY SHARE`;
    if (users.length !== 1 || scopes.length !== 1) return fail();
    const sources = await tx.$queryRaw<
      ProviderAccountConnection[]
    >`SELECT * FROM "ProviderAccountConnection" WHERE "id"=${intent.sourceId} AND "ownerUserId"=${intent.actorUserId} AND "ownerWorkspaceId" IS NULL FOR UPDATE`;
    if (sources.length !== 1) return fail();
    return sources[0]!;
  }
  private async lockOperation(
    tx: Tx,
    actorUserId: string,
    clientOperationId: string,
  ) {
    const before = await this.operation(tx, actorUserId, clientOperationId);
    const source = await this.lockSource(tx, intentOf(before));
    await tx.$queryRaw`SELECT "id" FROM "PersonalAccountOperation" WHERE "id"=${before.id} FOR UPDATE`;
    return {
      source,
      row: await this.operation(tx, actorUserId, clientOperationId),
    };
  }
  async reserve(request: PersonalCanonicalIntent) {
    const intent = snapshotCanonicalIntent(request);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await this.lockSource(tx, intent);
        const existing = await tx.personalAccountOperation.findUnique({
          where: key(intent.actorUserId, intent.clientOperationId),
        });
        if (existing) {
          if (existing.normalizedIntentHash !== canonicalIntentHash(intent))
            return fail("operation_conflict");
          return this.receipt(tx, existing);
        }
        if (
          source.pendingSourceOperationId ||
          source.state === "disabled" ||
          source.state === "suspended" ||
          source.state === "pending" ||
          source.state === "unknown" ||
          source.metadataRevision !== intent.expectedSourceMetadataRevision ||
          Number(source.authorizationEpochMirror) !==
            intent.expectedAuthorizationEpoch ||
          !source.profileRef
        )
          return fail("revision_conflict");
        assertExpectedRevision(source.metadataRevision);
        if (intent.action !== "rename" && source.metadataRevision >= 2147483646)
          return fail("revision_conflict");
        const id = personalOperationId(
          intent.actorUserId,
          intent.clientOperationId,
        );
        const row = await tx.personalAccountOperation.create({
          data: {
            ...intent,
            id,
            expectedGatewayRevision: BigInt(intent.expectedGatewayRevision),
            expectedAuthorizationEpoch: BigInt(
              intent.expectedAuthorizationEpoch,
            ),
            normalizedIntentHash: canonicalIntentHash(intent),
            phase: intent.action === "rename" ? "reserved" : "fencing",
          },
        });
        if (intent.action !== "rename") {
          await tx.providerAccountConnection.update({
            where: { id: source.id },
            data: {
              state: "pending",
              metadataRevision: { increment: 1 },
              pendingSourceOperationId: id,
            },
          });
          const bindings = await tx.$queryRaw<
            WorkspaceAccountBinding[]
          >`SELECT * FROM "WorkspaceAccountBinding" WHERE "connectionId"=${source.id} AND "state"='active' ORDER BY "id" FOR UPDATE`;
          for (const binding of bindings) {
            // Do not overwrite an unresolved earlier fence intent.
            if (binding.pendingFenceOperationId)
              return fail("operation_conflict");
            assertExpectedRevision(binding.revision);
            assertExpectedRevision(binding.policyRevision);
            await tx.workspaceAccountBinding.update({
              where: { id: binding.id },
              data: {
                ...(intent.action === "retire" ? { state: "revoked" } : {}),
                revision: { increment: 1 },
                policyRevision: { increment: 1 },
                pendingFenceOperationId: canonicalFenceOperationId(
                  id,
                  binding.id,
                ),
                pendingFencePolicySubject: binding.id,
                pendingFencePolicyRevision: binding.policyRevision + 1,
              },
            });
          }
        }
        return this.receipt(tx, row);
      });
    } catch (error) {
      // Same-nonce UNIQUE race returns its exact original; changed intent remains conflict.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        try {
          const original = await this.read(
            intent.actorUserId,
            intent.clientOperationId,
          );
          if (
            canonicalIntentHash(original.intent) === canonicalIntentHash(intent)
          )
            return original;
        } catch {
          /* Different nonce owns the source's pending canonical operation. */
        }
        return fail("operation_conflict");
      }
      return rethrowProductStorageError(error);
    }
  }
  async listFences(
    actorUserId: string,
    clientOperationId: string,
    afterBindingId?: string,
  ) {
    if (afterBindingId !== undefined) assertOpaqueReference(afterBindingId);
    const original = await this.read(actorUserId, clientOperationId);
    if (original.intent.action === "rename") return [];
    const rows = await this.prisma.workspaceAccountBinding.findMany({
      where: {
        connectionId: original.intent.sourceId,
        pendingFenceOperationId: { not: null },
        ...(afterBindingId === undefined ? {} : { id: { gt: afterBindingId } }),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    // Current higher retirement fences are retained too; their exact ACK safely covers older authority.
    return rows.map((row) => ({
      bindingId: row.id,
      workspaceId: row.workspaceId,
      operationId: row.pendingFenceOperationId!,
      policySubject: row.pendingFencePolicySubject!,
      policyRevision: row.pendingFencePolicyRevision!,
    }));
  }
  async ready(actorUserId: string, clientOperationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.lockOperation(
        tx,
        actorUserId,
        clientOperationId,
      );
      if (row.phase === "fencing") {
        if (source.pendingSourceOperationId !== row.id) return fail();
        if (
          (await tx.workspaceAccountBinding.count({
            where: {
              connectionId: source.id,
              pendingFenceOperationId: { not: null },
            },
          })) === 0
        ) {
          const ready = await tx.personalAccountOperation.update({
            where: { id: row.id },
            data: {
              phase: "ready",
              updatedAt: new Date(
                Math.max(Date.now(), row.updatedAt.getTime() + 1),
              ),
            },
          });
          return this.receipt(tx, ready);
        }
      }
      return this.receipt(tx, row);
    });
  }
  async claim(actorUserId: string, clientOperationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.lockOperation(
        tx,
        actorUserId,
        clientOperationId,
      );
      const intent = intentOf(row);
      if (row.phase !== (intent.action === "rename" ? "reserved" : "ready"))
        return null;
      if (
        intent.action !== "rename" &&
        (source.pendingSourceOperationId !== row.id ||
          (await tx.workspaceAccountBinding.count({
            where: {
              connectionId: source.id,
              pendingFenceOperationId: { not: null },
            },
          })) !== 0)
      )
        return null;
      // Millisecond precision matches Prisma's persisted DateTime. Monotonic even
      // for rapid release/reclaim prevents an old caller releasing a new winner.
      const claimedAt = new Date(
        Math.max(Date.now(), row.updatedAt.getTime() + 1),
      );
      const changed = await tx.personalAccountOperation.updateMany({
        where: { id: row.id, phase: row.phase },
        data: { phase: "submitted", updatedAt: claimedAt },
      });
      return changed.count === 1
        ? { claimToken: claimedAt.toISOString() }
        : null;
    });
  }
  async releaseUnenteredClaim(
    actorUserId: string,
    clientOperationId: string,
    claimToken: string,
  ) {
    const claimedAt = new Date(claimToken);
    if (!Number.isFinite(claimedAt.getTime())) return false;
    return this.prisma.$transaction(async (tx) => {
      const { row } = await this.lockOperation(
        tx,
        actorUserId,
        clientOperationId,
      );
      // Never reset unknown, terminal, or a different submitted winner.
      if (
        row.phase !== "submitted" ||
        row.updatedAt.getTime() !== claimedAt.getTime()
      )
        return false;
      const changed = await tx.personalAccountOperation.updateMany({
        where: { id: row.id, phase: "submitted", updatedAt: claimedAt },
        data: {
          phase: row.action === "rename" ? "reserved" : "fencing",
          updatedAt: new Date(Math.max(Date.now(), claimedAt.getTime() + 1)),
        },
      });
      return changed.count === 1;
    });
  }
  async notePhase(
    actorUserId: string,
    clientOperationId: string,
    phase: "unknown" | "rejected",
  ) {
    const original = await this.read(actorUserId, clientOperationId);
    await this.prisma.personalAccountOperation.updateMany({
      where: { id: original.id, phase: { in: ["submitted", "unknown"] } },
      data: { phase },
    });
  }
  async finalize(
    actorUserId: string,
    clientOperationId: string,
    request: PersonalGatewayAccount,
  ) {
    const account = {
      accountRef: request.accountRef,
      profileId: request.profileId,
      displayName: request.displayName,
      state: request.state,
      metadataRevision: request.metadataRevision,
      authorizationEpoch: request.authorizationEpoch,
    };
    assertOpaqueReference(account.accountRef);
    assertOpaqueReference(account.profileId);
    for (const counter of [
      account.metadataRevision,
      account.authorizationEpoch,
    ])
      if (!Number.isSafeInteger(counter) || counter < 1) return fail();
    return this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.lockOperation(
        tx,
        actorUserId,
        clientOperationId,
      );
      if (row.phase === "applied") return this.receipt(tx, row);
      const intent = intentOf(row);
      if (
        !["submitted", "unknown"].includes(row.phase) ||
        account.accountRef !== source.gatewayAccountRef ||
        account.profileId !== source.profileRef ||
        account.metadataRevision <= intent.expectedGatewayRevision ||
        source.metadataRevision !==
          intent.expectedSourceMetadataRevision +
            (intent.action === "rename" ? 0 : 1) ||
        (intent.action === "rename"
          ? source.pendingSourceOperationId !== null ||
            account.authorizationEpoch !== intent.expectedAuthorizationEpoch ||
            account.displayName !== intent.displayName ||
            account.state !== source.state
          : source.pendingSourceOperationId !== row.id ||
            account.authorizationEpoch <= intent.expectedAuthorizationEpoch ||
            (intent.action === "retire"
              ? !["disabled", "tombstoned"].includes(account.state)
              : account.state !== "active"))
      )
        return fail();
      const state =
        intent.action === "retire"
          ? "disabled"
          : intent.action === "rename" && source.state === "quarantined"
            ? "quarantined"
            : "active";
      assertMetadata({
        displayName: account.displayName,
        profileRef: account.profileId,
        gatewayOperationRef: row.id,
        state,
      });
      assertExpectedRevision(source.metadataRevision);
      if (intent.action === "reconnect") {
        const bindings = await tx.$queryRaw<
          WorkspaceAccountBinding[]
        >`SELECT * FROM "WorkspaceAccountBinding" WHERE "connectionId"=${source.id} AND "state"='active' ORDER BY "id" FOR UPDATE`;
        for (const binding of bindings) {
          if (
            binding.pendingFenceOperationId ||
            binding.fenceAckPolicyRevision !== binding.policyRevision ||
            binding.fenceAckOperationId !==
              canonicalFenceOperationId(row.id, binding.id)
          )
            return fail();
          const workspace = await tx.workspace.findUnique({
            where: { id: binding.workspaceId },
            select: { personalOwnerUserId: true },
          });
          const member = await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: binding.workspaceId,
                userId: actorUserId,
              },
            },
            select: { role: true },
          });
          const eligible =
            workspace?.personalOwnerUserId === actorUserId ||
            (workspace?.personalOwnerUserId === null &&
              (member?.role === "owner" || member?.role === "admin"));
          // Coordinated role-loss normally already retired it; never revive a lost donor's ref.
          if (!eligible) return fail();
          assertExpectedRevision(binding.revision);
          assertExpectedRevision(binding.policyRevision);
          await tx.workspaceAccountBinding.update({
            where: { id: binding.id },
            data: {
              revision: { increment: 1 },
              policyRevision: { increment: 1 },
            },
          });
        }
      }
      await tx.providerAccountConnection.update({
        where: { id: source.id },
        data: {
          displayName: account.displayName,
          state,
          authorizationEpochMirror: BigInt(account.authorizationEpoch),
          gatewayOperationRef: row.id,
          pendingSourceOperationId: null,
          metadataRevision: { increment: 1 },
        },
      });
      const result = await tx.personalAccountOperation.update({
        where: { id: row.id },
        data: { phase: "applied", resultSourceId: source.id },
      });
      return this.receipt(tx, result);
    });
  }
}
