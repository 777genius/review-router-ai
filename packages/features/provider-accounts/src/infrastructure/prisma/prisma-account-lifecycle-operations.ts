import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type PersonalAccountOperation,
  type ProviderAccountConnection,
} from "@prisma/client";
import {
  accountLifecycleIntentHash,
  snapshotAccountLifecycleIntent,
  type AccountLifecycleIntent,
} from "../../domain/account-lifecycle";
import { canonicalFenceOperationId } from "../../domain/personal-canonical-operation";
import {
  ProviderAccountError,
  assertOpaqueReference,
} from "../../domain/provider-account";
import type {
  AccountLifecycleClosure,
  AccountLifecycleOperationStore,
  AccountLifecycleReceipt,
  AccountLifecyclePhase,
} from "../../application/ports/account-lifecycle-operation-port";
import type { PersonalGatewayAccount } from "../../application/ports/provider-account-synchronization-port";
import { personalOperationId } from "../../application/use-cases/personal-account-operations";
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
function intentOf(row: PersonalAccountOperation): AccountLifecycleIntent {
  return snapshotAccountLifecycleIntent({
    ...row,
    expectedGatewayRevision: Number(row.expectedGatewayRevision),
    expectedAuthorizationEpoch: Number(row.expectedAuthorizationEpoch),
  } as AccountLifecycleIntent);
}
/** The existing immutable ledger and single source reservation are the authority. */
export class PrismaAccountLifecycleOperations implements AccountLifecycleOperationStore {
  private readonly unenteredClaims = new Map<
    string,
    {
      actor: string;
      operationId: string;
      sourceId: string;
      claimedAt: string;
    }
  >();
  constructor(private readonly prisma: PrismaClient) {}
  private async load(tx: Tx, operationId: string) {
    assertOpaqueReference(operationId);
    const row = await tx.personalAccountOperation.findUnique({
      where: { id: operationId },
    });
    if (!row) throw new ProviderAccountError("not_found");
    if (!["suspend", "resume", "delete"].includes(row.action))
      return fail("operation_conflict");
    return row;
  }
  private async lockSource(
    tx: Tx,
    actor: string,
    intent: AccountLifecycleIntent,
    requireLiveRole = true,
  ) {
    assertOpaqueReference(actor);
    // Authority keys precede Source, then Operation, then ordered Bindings.
    const users = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "User" WHERE "id"=${actor} FOR KEY SHARE`;
    const scope = intent.personalWorkspaceId ?? intent.owningWorkspaceId;
    const workspaces = await tx.$queryRaw<
      { id: string; personalOwnerUserId: string | null }[]
    >`SELECT "id", "personalOwnerUserId" FROM "Workspace" WHERE "id"=${scope} AND "deletionState"='active' FOR SHARE`;
    if (users.length !== 1 || workspaces.length !== 1) return fail();
    if (intent.personalWorkspaceId !== null) {
      if (
        intent.actorUserId !== actor ||
        workspaces[0]!.personalOwnerUserId !== actor
      )
        return fail();
    } else {
      if (workspaces[0]!.personalOwnerUserId !== null) return fail();
      if (requireLiveRole) {
        const members = await tx.$queryRaw<
          { role: string }[]
        >`SELECT "role" FROM "WorkspaceMember" WHERE "workspaceId"=${scope} AND "userId"=${actor} FOR SHARE`;
        if (
          workspaces[0]!.personalOwnerUserId !== null ||
          members.length !== 1 ||
          !["owner", "admin"].includes(members[0]!.role)
        )
          return fail();
      }
    }
    const sources = await tx.$queryRaw<
      ProviderAccountConnection[]
    >`SELECT * FROM "ProviderAccountConnection" WHERE "id"=${intent.sourceId} FOR UPDATE`;
    const source = sources[0];
    if (
      !source ||
      (intent.personalWorkspaceId !== null
        ? source.ownerUserId !== actor || source.ownerWorkspaceId !== null
        : source.ownerWorkspaceId !== scope || source.ownerUserId !== null)
    )
      return fail();
    return source;
  }
  private async locked(tx: Tx, actor: string, operationId: string) {
    const before = await this.load(tx, operationId);
    const source = await this.lockSource(tx, actor, intentOf(before));
    await tx.$queryRaw`SELECT "id" FROM "PersonalAccountOperation" WHERE "id"=${operationId} FOR UPDATE`;
    return { source, row: await this.load(tx, operationId) };
  }
  private receipt(
    row: PersonalAccountOperation,
    source: ProviderAccountConnection,
  ): AccountLifecycleReceipt {
    return {
      id: row.id,
      intent: intentOf(row),
      phase: row.phase as AccountLifecyclePhase,
      source: mapConnection(source),
      retirementOperationId: row.deleteRemoteRetirementProofRef,
      closureComplete: row.action === "delete" && row.phase === "applied",
    };
  }
  read(actor: string, operationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.locked(tx, actor, operationId);
      return this.receipt(row, source);
    });
  }
  async reserve(request: AccountLifecycleIntent) {
    const intent = snapshotAccountLifecycleIntent(request);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await this.lockSource(tx, intent.actorUserId, intent);
        const prior = await tx.personalAccountOperation.findUnique({
          where: {
            actorUserId_clientOperationId: {
              actorUserId: intent.actorUserId,
              clientOperationId: intent.clientOperationId,
            },
          },
        });
        if (prior) {
          if (prior.normalizedIntentHash !== accountLifecycleIntentHash(intent))
            return fail("operation_conflict");
          return this.receipt(prior, source);
        }
        if (
          source.pendingSourceOperationId ||
          !source.profileRef ||
          source.metadataRevision !== intent.expectedSourceMetadataRevision ||
          ((source.authorizationEpochMirror !== null ||
            intent.personalWorkspaceId !== null) &&
            Number(source.authorizationEpochMirror) !==
              intent.expectedAuthorizationEpoch) ||
          source.metadataRevision >= 2147483646 ||
          (intent.action === "resume"
            ? source.state !== "suspended"
            : intent.action === "suspend"
              ? source.state !== "active"
              : !["active", "suspended", "quarantined"].includes(source.state))
        )
          return fail("revision_conflict");
        if (
          await tx.personalAccountOperation.findFirst({
            where: { sourceId: source.id, action: "delete" },
          })
        )
          return fail();
        const id = personalOperationId(
          intent.actorUserId,
          intent.clientOperationId,
        );
        const row = await tx.personalAccountOperation.create({
          data: {
            ...intent,
            id,
            originalOperationId: id,
            normalizedIntentHash: accountLifecycleIntentHash(intent),
            expectedGatewayRevision: BigInt(intent.expectedGatewayRevision),
            expectedAuthorizationEpoch: BigInt(
              intent.expectedAuthorizationEpoch,
            ),
            phase: "fencing",
          },
        });
        await tx.providerAccountConnection.update({
          where: { id: source.id },
          data: {
            state: "pending",
            pendingSourceOperationId: id,
            metadataRevision: { increment: 1 },
          },
        });
        await this.fenceBindings(tx, intent, id);
        return this.receipt(
          row,
          await tx.providerAccountConnection.findUniqueOrThrow({
            where: { id: source.id },
          }),
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const prior = await this.prisma.personalAccountOperation.findUnique({
          where: {
            actorUserId_clientOperationId: {
              actorUserId: intent.actorUserId,
              clientOperationId: intent.clientOperationId,
            },
          },
        });
        if (
          prior &&
          prior.normalizedIntentHash === accountLifecycleIntentHash(intent)
        )
          return this.read(intent.actorUserId, prior.id);
        return fail("operation_conflict");
      }
      return rethrowProductStorageError(error);
    }
  }
  private async fenceBindings(
    tx: Tx,
    intent: AccountLifecycleIntent,
    id: string,
  ) {
    const bindings = await tx.workspaceAccountBinding.findMany({
      where: { connectionId: intent.sourceId, state: "active" },
      orderBy: { id: "asc" },
    });
    for (const binding of bindings) {
      await tx.$queryRaw`SELECT "id" FROM "WorkspaceAccountBinding" WHERE "id"=${binding.id} FOR UPDATE`;
      const current = await tx.workspaceAccountBinding.findUniqueOrThrow({
        where: { id: binding.id },
      });
      if (current.state !== "active") continue;
      if (current.pendingFenceOperationId) continue;
      if (
        intent.action !== "delete" &&
        current.fenceAckOperationId ===
          canonicalFenceOperationId(id, current.id) &&
        current.fenceAckPolicyRevision === current.policyRevision
      )
        continue;
      if (
        current.policyRevision >= 2147483646 ||
        current.revision >= 2147483646
      )
        return fail("operation_conflict");
      await tx.workspaceAccountBinding.update({
        where: { id: current.id },
        data: {
          ...(intent.action === "delete" ? { state: "revoked" } : {}),
          revision: { increment: 1 },
          policyRevision: { increment: 1 },
          pendingFenceOperationId: canonicalFenceOperationId(id, current.id),
          pendingFencePolicySubject: current.id,
          pendingFencePolicyRevision: current.policyRevision + 1,
        },
      });
    }
  }
  async listFences(
    actor: string,
    operationId: string,
    afterBindingId?: string,
  ) {
    if (afterBindingId !== undefined) assertOpaqueReference(afterBindingId);
    const receipt = await this.read(actor, operationId);
    const rows = await this.prisma.workspaceAccountBinding.findMany({
      where: {
        connectionId: receipt.intent.sourceId,
        pendingFenceOperationId: { not: null },
        ...(afterBindingId ? { id: { gt: afterBindingId } } : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    // Cursor bounds one page, never the entire denial scope. Caller drains all pages.
    await this.read(actor, operationId);
    return rows.map((row) => ({
      bindingId: row.id,
      workspaceId: row.workspaceId,
      operationId: row.pendingFenceOperationId!,
      policySubject: row.pendingFencePolicySubject!,
      policyRevision: row.pendingFencePolicyRevision!,
    }));
  }
  ready(actor: string, operationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.locked(tx, actor, operationId);
      if (
        row.phase === "fencing" &&
        source.pendingSourceOperationId === row.id
      ) {
        await this.fenceBindings(tx, intentOf(row), row.id);
      }
      if (
        row.phase === "fencing" &&
        source.pendingSourceOperationId === row.id &&
        !(await tx.workspaceAccountBinding.count({
          where: {
            connectionId: source.id,
            pendingFenceOperationId: { not: null },
          },
        }))
      ) {
        const next = await tx.personalAccountOperation.update({
          where: { id: row.id },
          data: { phase: "ready" },
        });
        return this.receipt(next, source);
      }
      return this.receipt(row, source);
    });
  }
  async claim(actor: string, operationId: string) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.locked(tx, actor, operationId);
      if (
        row.phase !== "ready" ||
        source.pendingSourceOperationId !== row.id ||
        (await tx.workspaceAccountBinding.count({
          where: {
            connectionId: source.id,
            pendingFenceOperationId: { not: null },
          },
        }))
      )
        return null;
      const updatedAt = new Date(
        Math.max(Date.now(), row.updatedAt.getTime() + 1),
      );
      await tx.personalAccountOperation.update({
        where: { id: row.id },
        data: { phase: "submitted", updatedAt },
      });
      return { sourceId: source.id, claimedAt: updatedAt.toISOString() };
    });
    if (!claimed) return null;
    const claimToken = randomUUID();
    this.unenteredClaims.set(claimToken, { actor, operationId, ...claimed });
    return { claimToken };
  }
  async enterClaim(actor: string, operationId: string, token: string) {
    const proof = this.unenteredClaims.get(token);
    if (!proof || proof.actor !== actor || proof.operationId !== operationId)
      return false;
    this.unenteredClaims.delete(token);
    try {
      const entered = await this.prisma.$transaction(async (tx) => {
        const { row, source } = await this.locked(tx, actor, operationId);
        return (
          row.phase === "submitted" &&
          row.updatedAt.toISOString() === proof.claimedAt &&
          source.id === proof.sourceId &&
          source.pendingSourceOperationId === row.id
        );
      });
      // Consumption precedes remote ingress; a consumed proof can never release.
      return entered;
    } catch (error) {
      this.unenteredClaims.set(token, proof);
      throw error;
    }
  }
  async releaseUnenteredClaim(
    actor: string,
    operationId: string,
    token: string,
  ) {
    const proof = this.unenteredClaims.get(token);
    if (!proof || proof.actor !== actor || proof.operationId !== operationId)
      return false;
    this.unenteredClaims.delete(token);
    try {
      const released = await this.prisma.$transaction(async (tx) => {
        const before = await this.load(tx, operationId);
        // This capability only abandons proven unentered ingress. It grants no
        // management/read access and deliberately survives the claimer's role loss.
        const source = await this.lockSource(
          tx,
          actor,
          intentOf(before),
          false,
        );
        await tx.$queryRaw`SELECT "id" FROM "PersonalAccountOperation" WHERE "id"=${operationId} FOR UPDATE`;
        const row = await this.load(tx, operationId);
        if (
          row.phase !== "submitted" ||
          row.updatedAt.toISOString() !== proof.claimedAt ||
          source.id !== proof.sourceId ||
          source.pendingSourceOperationId !== row.id
        )
          return false;
        await tx.personalAccountOperation.update({
          where: { id: row.id },
          data: {
            phase: "fencing",
            updatedAt: new Date(
              Math.max(Date.now(), row.updatedAt.getTime() + 1),
            ),
          },
        });
        return true;
      });
      return released;
    } catch (error) {
      this.unenteredClaims.set(token, proof);
      throw error;
    }
  }
  async unknown(actor: string, operationId: string) {
    await this.prisma.$transaction(async (tx) => {
      const { row } = await this.locked(tx, actor, operationId);
      if (["submitted", "unknown"].includes(row.phase))
        await tx.personalAccountOperation.update({
          where: { id: row.id },
          data: { phase: "unknown" },
        });
    });
  }
  reject(
    actor: string,
    operationId: string,
    requestAccount: PersonalGatewayAccount,
    noEffectProofRef: string,
  ) {
    const account = Object.freeze({ ...requestAccount });
    assertOpaqueReference(noEffectProofRef);
    return this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.locked(tx, actor, operationId);
      const intent = intentOf(row);
      if (row.phase === "rejected") return this.receipt(row, source);
      if (
        !["submitted", "unknown"].includes(row.phase) ||
        source.pendingSourceOperationId !== row.id ||
        source.metadataRevision !== intent.expectedSourceMetadataRevision + 1 ||
        source.gatewayAccountRef !== account.accountRef ||
        source.profileRef !== account.profileId ||
        account.metadataRevision !== intent.expectedGatewayRevision ||
        account.authorizationEpoch !== intent.expectedAuthorizationEpoch ||
        account.state !== (intent.action === "resume" ? "suspended" : "active")
      )
        return fail();
      const next = await tx.personalAccountOperation.update({
        where: { id: row.id },
        data: {
          phase: "rejected",
          noEffectRejectionProofRef: noEffectProofRef,
        },
      });
      // Delete's immutable record remains a denial forever, including rejection.
      if (intent.action !== "delete") {
        if (
          await tx.personalAccountOperation.findFirst({
            where: { sourceId: source.id, action: "delete" },
          })
        )
          return fail();
        await tx.providerAccountConnection.update({
          where: { id: source.id },
          data: {
            state: intent.action === "resume" ? "suspended" : "active",
            authorizationEpochMirror: BigInt(account.authorizationEpoch),
            pendingSourceOperationId: null,
            metadataRevision: { increment: 1 },
          },
        });
      }
      return this.receipt(
        next,
        await tx.providerAccountConnection.findUniqueOrThrow({
          where: { id: source.id },
        }),
      );
    });
  }
  finalize(
    actor: string,
    operationId: string,
    requestAccount: PersonalGatewayAccount,
    retirementOperationId: string | null,
    requestClosure: AccountLifecycleClosure | null,
  ) {
    const account = Object.freeze({ ...requestAccount });
    const closure = requestClosure
      ? Object.freeze({ ...requestClosure })
      : null;
    return this.prisma.$transaction(async (tx) => {
      const { row, source } = await this.locked(tx, actor, operationId);
      const intent = intentOf(row);
      if (row.phase === "applied") return this.receipt(row, source);
      if (
        !["submitted", "unknown"].includes(row.phase) ||
        source.pendingSourceOperationId !== row.id ||
        source.metadataRevision !== intent.expectedSourceMetadataRevision + 1 ||
        source.gatewayAccountRef !== account.accountRef ||
        source.profileRef !== account.profileId ||
        !Number.isSafeInteger(account.metadataRevision) ||
        !Number.isSafeInteger(account.authorizationEpoch) ||
        account.metadataRevision <= intent.expectedGatewayRevision ||
        account.authorizationEpoch <= intent.expectedAuthorizationEpoch ||
        (account.state !==
          (intent.action === "suspend"
            ? "suspended"
            : intent.action === "resume"
              ? "active"
              : "disabled") &&
          !(intent.action === "delete" && account.state === "tombstoned"))
      )
        return fail();
      if (
        intent.action !== "delete" &&
        (await tx.personalAccountOperation.findFirst({
          where: { sourceId: source.id, action: "delete" },
        }))
      )
        return fail();
      if (intent.action === "delete") {
        if (!retirementOperationId) return fail();
        assertOpaqueReference(retirementOperationId);
        if (
          row.deleteRemoteRetirementProofRef &&
          row.deleteRemoteRetirementProofRef !== retirementOperationId
        )
          return fail();
        // Applied retirement alone is not erasure. Keep pending denial while closure is absent.
        if (!closure) {
          const next = await tx.personalAccountOperation.update({
            where: { id: row.id },
            data: {
              phase: "unknown",
              deleteRemoteRetirementProofRef: retirementOperationId,
            },
          });
          return this.receipt(next, source);
        }
      }
      if (closure) {
        if (
          intent.action !== "delete" ||
          closure.retirementOperationId !== retirementOperationId
        )
          return fail();
        for (const ref of [
          closure.bindingErasureProofRef,
          closure.transportErasureProofRef,
          closure.nativeErasureProofRef,
        ])
          assertOpaqueReference(ref);
      }
      if (intent.action === "delete") {
        await tx.personalAccountOperation.update({
          where: { id: row.id },
          data: {
            deleteRemoteRetirementProofRef: retirementOperationId,
            deleteBindingErasureProofRef: closure!.bindingErasureProofRef,
            deleteTransportErasureProofRef: closure!.transportErasureProofRef,
            deleteNativeErasureProofRef: closure!.nativeErasureProofRef,
          },
        });
      }
      await tx.providerAccountConnection.update({
        where: { id: source.id },
        data: {
          state:
            intent.action === "delete"
              ? "disabled"
              : intent.action === "suspend"
                ? "suspended"
                : "active",
          authorizationEpochMirror: BigInt(account.authorizationEpoch),
          gatewayOperationRef: row.id,
          pendingSourceOperationId: intent.action === "delete" ? row.id : null,
          metadataRevision: { increment: 1 },
        },
      });
      const next = await tx.personalAccountOperation.update({
        where: { id: row.id },
        data: {
          phase: "applied",
          resultSourceId: source.id,
          ...(intent.action === "delete"
            ? {
                deleteRemoteRetirementProofRef: retirementOperationId,
                deleteBindingErasureProofRef: closure!.bindingErasureProofRef,
                deleteTransportErasureProofRef:
                  closure!.transportErasureProofRef,
                deleteNativeErasureProofRef: closure!.nativeErasureProofRef,
              }
            : {}),
        },
      });
      return this.receipt(
        next,
        await tx.providerAccountConnection.findUniqueOrThrow({
          where: { id: source.id },
        }),
      );
    });
  }
}
