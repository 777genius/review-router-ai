import type {
  Prisma,
  PrismaClient,
  WorkspaceDeletionOperation,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import {
  ProviderAccountError,
  assertExpectedRevision,
  assertOpaqueReference,
  snapshotBindingFence,
  type ScopedBindingFence,
} from "../../domain/provider-account";
import type {
  WorkspaceDeletionRepositoryPort,
  WorkspaceDeletionOperationView,
} from "../../application/ports/workspace-deletion-repository-port";
import type {
  WorkspaceDeletionLifecycleTarget,
  WorkspaceDeletionLifecycleReadback,
} from "../../application/ports/workspace-deletion-lifecycle-port";
import {
  assertWorkspaceDeletionLifecycleCompleted,
  workspaceDeletionIntentHash,
} from "../../application/use-cases/workspace-account-deletion";
import { rethrowProductStorageError } from "./connection-mapping";

type Scope = {
  readonly operatorActor: import("../../application/use-cases/workspace-account-bindings").WorkspaceAccountActor;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedWorkspaceRevision?: number;
};
type Snapshot = {
  readonly targets: readonly WorkspaceDeletionLifecycleTarget[];
  readonly bindingIds: readonly string[];
  readonly policyFences: readonly ScopedBindingFence[];
};

function references(values: unknown): string[] {
  if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
    throw new ProviderAccountError("operation_conflict");
  const result = values as string[];
  result.forEach(assertOpaqueReference);
  if (new Set(result).size !== result.length)
    throw new ProviderAccountError("operation_conflict");
  return result;
}

function snapshot(value: Prisma.JsonValue): Snapshot {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("targets" in value) ||
    !("bindingIds" in value) ||
    !Array.isArray(value.targets)
  )
    throw new ProviderAccountError("operation_conflict");
  const targets = value.targets.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new ProviderAccountError("operation_conflict");
    const {
      connectionId,
      gatewayAccountRef,
      profileRef,
      expectedMetadataRevision,
      expectedAuthorizationEpoch,
      bindingIds,
      owner,
      disableOperationId,
      disableExpectedGatewayRevision,
      disableExpectedGatewayEpoch,
      disableIssued,
    } = raw;
    if (
      typeof connectionId !== "string" ||
      typeof gatewayAccountRef !== "string" ||
      (profileRef !== null && typeof profileRef !== "string") ||
      typeof disableOperationId !== "string" ||
      typeof expectedMetadataRevision !== "number" ||
      (expectedAuthorizationEpoch !== null &&
        typeof expectedAuthorizationEpoch !== "number") ||
      typeof disableIssued !== "boolean" ||
      (disableExpectedGatewayRevision !== null &&
        typeof disableExpectedGatewayRevision !== "number") ||
      (disableExpectedGatewayEpoch !== null &&
        typeof disableExpectedGatewayEpoch !== "number") ||
      (disableIssued &&
        (disableExpectedGatewayRevision === null ||
          disableExpectedGatewayEpoch === null))
    )
      throw new ProviderAccountError("operation_conflict");
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      (owner.kind !== "user" && owner.kind !== "workspace") ||
      (owner.kind === "user"
        ? typeof owner.userId !== "string"
        : typeof owner.workspaceId !== "string")
    )
      throw new ProviderAccountError("operation_conflict");
    const capturedOwner =
      owner.kind === "user"
        ? { kind: "user" as const, userId: owner.userId as string }
        : {
            kind: "workspace" as const,
            workspaceId: owner.workspaceId as string,
          };
    assertOpaqueReference(
      capturedOwner.kind === "user"
        ? capturedOwner.userId
        : capturedOwner.workspaceId,
    );
    [connectionId, gatewayAccountRef, disableOperationId].forEach(
      assertOpaqueReference,
    );
    assertExpectedRevision(expectedMetadataRevision);
    if (
      expectedAuthorizationEpoch !== null &&
      (!Number.isSafeInteger(expectedAuthorizationEpoch) ||
        expectedAuthorizationEpoch < 1)
    )
      throw new ProviderAccountError("operation_conflict");
    if (
      [disableExpectedGatewayRevision, disableExpectedGatewayEpoch].some(
        (v) => v !== null && (!Number.isSafeInteger(v) || v < 0),
      )
    )
      throw new ProviderAccountError("operation_conflict");
    return {
      connectionId,
      owner: capturedOwner,
      gatewayAccountRef,
      profileRef,
      expectedMetadataRevision,
      expectedAuthorizationEpoch,
      bindingIds: references(bindingIds),
      disableOperationId,
      disableExpectedGatewayRevision,
      disableExpectedGatewayEpoch,
      disableIssued,
    };
  });
  if (
    new Set(targets.map((t) => t.connectionId)).size !== targets.length ||
    new Set(targets.map((t) => t.gatewayAccountRef)).size !== targets.length
  )
    throw new ProviderAccountError("operation_conflict");
  if (!Array.isArray(value.policyFences))
    throw new ProviderAccountError("operation_conflict");
  const policyFences = value.policyFences.map((fence) => {
    if (
      !fence ||
      typeof fence !== "object" ||
      Array.isArray(fence) ||
      typeof fence.operationId !== "string" ||
      typeof fence.bindingId !== "string" ||
      typeof fence.workspaceId !== "string" ||
      typeof fence.policySubject !== "string" ||
      typeof fence.policyRevision !== "number"
    )
      throw new ProviderAccountError("operation_conflict");
    return snapshotBindingFence({
      operationId: fence.operationId,
      bindingId: fence.bindingId,
      workspaceId: fence.workspaceId,
      policySubject: fence.policySubject,
      policyRevision: fence.policyRevision,
    });
  });
  const bindingIds = references(value.bindingIds);
  if (
    new Set(policyFences.map((f) => f.bindingId)).size !== bindingIds.length ||
    policyFences.length !== bindingIds.length ||
    policyFences.some((f) => !bindingIds.includes(f.bindingId))
  )
    throw new ProviderAccountError("operation_conflict");
  return { targets, bindingIds, policyFences };
}

/** No remote I/O in these transactions. The workspace lock serializes the
 * pending flag with migration127's admission SHARE locks; full sets have no LIMIT.
 * Retained rows/FKs and immutable lifecycle audit survive the logical tombstone.
 */
export class PrismaWorkspaceDeletionRepository implements WorkspaceDeletionRepositoryPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorWorkspaceId: string,
  ) {
    assertOpaqueReference(operatorWorkspaceId);
  }

  private async lock(tx: Prisma.TransactionClient, input: Scope) {
    assertOpaqueReference(input.workspaceId);
    assertOpaqueReference(input.operationId);
    const actor = input.operatorActor;
    if (actor.userId !== undefined) assertOpaqueReference(actor.userId);
    if (
      typeof actor.githubUserId !== "string" ||
      typeof actor.githubLogin !== "string" ||
      (actor.userId === undefined && !/^[0-9]+$/.test(actor.githubUserId))
    )
      throw new ProviderAccountError("invalid_input");
    const membership =
      actor.userId !== undefined
        ? await tx.$queryRaw<readonly { id: string }[]>`
          SELECT "id" FROM "WorkspaceMember" WHERE "workspaceId" = ${this.operatorWorkspaceId}
            AND "userId" = ${actor.userId} AND "role" IN ('owner', 'admin') FOR SHARE`
        : await tx.$queryRaw<readonly { id: string }[]>`
          SELECT m."id" FROM "WorkspaceMember" m JOIN "User" u ON u."id" = m."userId"
          WHERE m."workspaceId" = ${this.operatorWorkspaceId} AND u."githubUserId" = ${BigInt(actor.githubUserId)}
            AND m."role" IN ('owner', 'admin') FOR SHARE OF m, u`;
    if (membership.length !== 1)
      throw new ProviderAccountError("workspace_forbidden");
    if (input.expectedWorkspaceRevision !== undefined)
      assertExpectedRevision(input.expectedWorkspaceRevision);
    const rows = await tx.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Workspace" WHERE "id" = ${input.workspaceId} FOR UPDATE`;
    if (rows.length !== 1) throw new ProviderAccountError("not_found");
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: input.workspaceId },
    });
    return workspace;
  }

  private async operation(tx: Prisma.TransactionClient, input: Scope) {
    const row = await tx.workspaceDeletionOperation.findUnique({
      where: { id: input.operationId },
    });
    if (!row || row.workspaceId !== input.workspaceId)
      throw new ProviderAccountError("not_found");
    return row;
  }

  private async view(
    tx: Prisma.TransactionClient,
    row: WorkspaceDeletionOperation,
  ): Promise<WorkspaceDeletionOperationView> {
    const data = snapshot(row.targets);
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: row.workspaceId },
    });
    const bindings = await tx.workspaceAccountBinding.findMany({
      where: { id: { in: [...data.bindingIds] } },
    });
    if (bindings.length !== data.bindingIds.length)
      throw new ProviderAccountError("operation_conflict");
    const pendingPersonalOperationCount =
      await tx.personalAccountOperation.count({
        where: {
          OR: [
            { personalWorkspaceId: row.workspaceId },
            { targetWorkspaceId: row.workspaceId },
            ...(workspace.personalOwnerUserId === null
              ? []
              : [{ actorUserId: workspace.personalOwnerUserId }]),
          ],
          // Only applied/rejected are positive terminal local facts. Unknown or
          // reserved enrollment may already exist remotely outside source-row inventory.
          phase: { notIn: ["applied", "rejected"] },
        },
      });
    const pendingOwnedSourceCount = await tx.providerAccountConnection.count({
      where: {
        OR: [
          { ownerWorkspaceId: row.workspaceId },
          ...(workspace.personalOwnerUserId === null
            ? []
            : [{ ownerUserId: workspace.personalOwnerUserId }]),
        ],
        pendingSourceOperationId: { not: null },
      },
    });
    const pendingFenceCount = bindings.filter(
      (b) =>
        b.state !== "revoked" ||
        b.pendingFenceOperationId !== null ||
        b.fenceAckOperationId === null ||
        b.fenceAckPolicyRevision === null ||
        b.fenceAckPolicyRevision < b.policyRevision,
    ).length;
    const facts = await tx.workspaceDeletionFact.findMany({
      where: { operationId: row.id, kind: "binding_fence" },
    });
    const pendingPolicyFences = data.policyFences.filter(
      (f) =>
        !facts.some(
          (fact) =>
            fact.subjectRef === f.bindingId && fact.proofRef === f.operationId,
        ),
    );
    const pendingPolicyClosureCount = pendingPolicyFences.length;
    return {
      operationId: row.id,
      workspaceId: row.workspaceId,
      expectedWorkspaceRevision: row.expectedWorkspaceRevision,
      currentWorkspaceRevision: workspace.deletionRevision,
      intentHash: row.normalizedIntentHash,
      actorRef: row.actorRef,
      stage: row.stage,
      stageReason:
        row.stageReason as WorkspaceDeletionOperationView["stageReason"],
      targets: data.targets,
      affectedBindingIds: data.bindingIds,
      pendingFenceCount,
      pendingPolicyClosureCount,
      policyFenceTargets: pendingPolicyFences,
      pendingPersonalOperationCount:
        pendingPersonalOperationCount + pendingOwnedSourceCount,
      startedAt: row.createdAt,
      completedAt: row.completedAt,
    };
  }

  async beginWorkspaceDeletion(
    input: Scope & {
      readonly expectedWorkspaceRevision: number;
      readonly actorRef: string;
    },
  ) {
    assertOpaqueReference(input.actorRef);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Restoration checks the original intent before the newly advanced revision.
        const workspace = await this.lock(tx, {
          operationId: input.operationId,
          workspaceId: input.workspaceId,
          operatorActor: input.operatorActor,
        });
        const existing = await tx.workspaceDeletionOperation.findUnique({
          where: { workspaceId: input.workspaceId },
        });
        const hash = workspaceDeletionIntentHash(input);
        if (existing) {
          if (
            existing.id !== input.operationId ||
            existing.normalizedIntentHash !== hash ||
            existing.actorRef !== input.actorRef
          )
            throw new ProviderAccountError("operation_conflict");
          return this.view(tx, existing);
        }
        if (
          workspace.deletionState !== "active" ||
          workspace.deletionRevision !== input.expectedWorkspaceRevision
        )
          throw new ProviderAccountError("revision_conflict");
        // The canonical personal workspace owns this User partition. Resolve it
        // from the locked workspace, never from a caller-supplied owner override.
        const personalOwnerId = workspace.personalOwnerUserId;
        await tx.$queryRaw`SELECT "id" FROM "PersonalAccountOperation"
          WHERE "personalWorkspaceId" = ${input.workspaceId} OR "targetWorkspaceId" = ${input.workspaceId}
            OR (${personalOwnerId}::text IS NOT NULL AND "actorUserId" = ${personalOwnerId})
          ORDER BY "id" FOR UPDATE`;
        if (input.workspaceId === this.operatorWorkspaceId)
          throw new ProviderAccountError("workspace_forbidden");
        await tx.$queryRaw`SELECT "id" FROM "ProviderAccountConnection"
          WHERE "ownerWorkspaceId" = ${input.workspaceId}
            OR (${personalOwnerId}::text IS NOT NULL AND "ownerUserId" = ${personalOwnerId})
          ORDER BY "id" FOR UPDATE`;
        const connections = await tx.providerAccountConnection.findMany({
          where: {
            OR: [
              { ownerWorkspaceId: input.workspaceId, ownerUserId: null },
              ...(personalOwnerId === null
                ? []
                : [{ ownerUserId: personalOwnerId, ownerWorkspaceId: null }]),
            ],
          },
          orderBy: { id: "asc" },
        });
        const connectionIds = connections.map((c) => c.id);
        // Includes every recipient grant for an owned account, and recipient-only
        // bindings in the deleted workspace. Recipient-only accounts are not erased.
        await tx.$queryRaw`SELECT "id" FROM "WorkspaceAccountBinding"
          WHERE "workspaceId" = ${input.workspaceId} OR "connectionId" IN (
            SELECT "id" FROM "ProviderAccountConnection" WHERE "ownerWorkspaceId" = ${input.workspaceId}
              OR (${personalOwnerId}::text IS NOT NULL AND "ownerUserId" = ${personalOwnerId}))
          ORDER BY "id" FOR UPDATE`;
        const bindings = await tx.workspaceAccountBinding.findMany({
          where: {
            OR: [
              { workspaceId: input.workspaceId },
              { connectionId: { in: connectionIds } },
            ],
          },
          orderBy: { id: "asc" },
        });
        const targets = connections.map((c) => ({
          connectionId: c.id,
          owner:
            c.ownerUserId !== null
              ? { kind: "user" as const, userId: c.ownerUserId }
              : {
                  kind: "workspace" as const,
                  workspaceId: c.ownerWorkspaceId!,
                },
          gatewayAccountRef: c.gatewayAccountRef,
          profileRef: c.profileRef,
          expectedMetadataRevision: c.metadataRevision,
          expectedAuthorizationEpoch:
            c.authorizationEpochMirror === null
              ? null
              : Number(c.authorizationEpochMirror),
          bindingIds: bindings
            .filter((b) => b.connectionId === c.id)
            .map((b) => b.id),
          disableOperationId: randomUUID(),
          disableExpectedGatewayRevision: null,
          disableExpectedGatewayEpoch: null,
          disableIssued: false,
        }));
        const policyFences = bindings.map((b) =>
          snapshotBindingFence({
            bindingId: b.id,
            workspaceId: b.workspaceId,
            operationId: randomUUID(),
            policySubject: b.id,
            policyRevision: b.policyRevision + 1,
          }),
        );
        const captured: Snapshot = {
          targets,
          bindingIds: bindings.map((b) => b.id),
          policyFences,
        };
        await tx.workspace.update({
          where: { id: input.workspaceId },
          data: {
            deletionState: "delete_pending",
            deletionRevision: { increment: 1 },
          },
        });
        for (const binding of bindings) {
          // New stronger fence covers existing pending/ACK versions; it is never
          // committed as an active grant and cannot lose any old requirement.
          await tx.workspaceAccountBinding.update({
            where: { id: binding.id },
            data: {
              state: "revoked",
              revision: { increment: 1 },
              policyRevision: { increment: 1 },
              pendingFenceOperationId: policyFences.find(
                (f) => f.bindingId === binding.id,
              )!.operationId,
              pendingFencePolicySubject: binding.id,
              pendingFencePolicyRevision: binding.policyRevision + 1,
            },
          });
        }
        const row = await tx.workspaceDeletionOperation.create({
          data: {
            id: input.operationId,
            workspaceId: input.workspaceId,
            actorRef: input.actorRef,
            expectedWorkspaceRevision: input.expectedWorkspaceRevision,
            normalizedIntentHash: hash,
            stage: "fences_pending",
            stageReason: "fence_ack_pending",
            targets: JSON.parse(
              JSON.stringify(captured),
            ) as Prisma.InputJsonValue,
          },
        });
        return this.view(tx, row);
      });
    } catch (error) {
      return rethrowProductStorageError(error);
    }
  }

  async readWorkspaceDeletion(input: Scope) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await this.lock(tx, input),
        row = await this.operation(tx, input);
      if (
        input.expectedWorkspaceRevision !== undefined &&
        workspace.deletionRevision !== input.expectedWorkspaceRevision &&
        !(
          row.stage === "deleted" &&
          workspace.deletionState === "deleted" &&
          workspace.deletionRevision === input.expectedWorkspaceRevision + 1
        )
      )
        throw new ProviderAccountError("revision_conflict");
      return this.view(tx, row);
    });
  }

  async reserveDisable(
    input: Scope & {
      readonly expectedWorkspaceRevision: number;
      readonly account: import("../../application/ports/workspace-deletion-lifecycle-port").WorkspaceDeletionGatewayAccount;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await this.lock(tx, input),
        row = await this.operation(tx, input),
        view = await this.view(tx, row);
      if (
        workspace.deletionState !== "delete_pending" ||
        workspace.deletionRevision !== input.expectedWorkspaceRevision ||
        row.stage === "deleted" ||
        row.stage === "refused" ||
        view.pendingFenceCount !== 0 ||
        view.pendingPolicyClosureCount !== 0 ||
        view.pendingPersonalOperationCount !== 0
      )
        throw new ProviderAccountError("operation_conflict");
      const data = snapshot(row.targets),
        target = data.targets.find(
          (t) => t.connectionId === input.account.connectionId,
        );
      if (
        !target ||
        input.account.gatewayAccountRef !== target.gatewayAccountRef ||
        input.account.profileRef !== target.profileRef ||
        !Number.isSafeInteger(input.account.metadataRevision) ||
        input.account.metadataRevision < 0 ||
        !Number.isSafeInteger(input.account.authorizationEpoch) ||
        input.account.authorizationEpoch < 0
      )
        throw new ProviderAccountError("operation_conflict");
      if (target.disableIssued)
        return { operation: view, dispatchTarget: null };
      const current = await tx.providerAccountConnection.findUniqueOrThrow({
        where: { id: target.connectionId },
      });
      const owns =
        current.ownerWorkspaceId === row.workspaceId ||
        (workspace.personalOwnerUserId !== null &&
          current.ownerUserId === workspace.personalOwnerUserId);
      if (
        !owns ||
        (target.owner.kind === "user"
          ? current.ownerUserId !== target.owner.userId
          : current.ownerWorkspaceId !== target.owner.workspaceId) ||
        current.gatewayAccountRef !== target.gatewayAccountRef ||
        current.profileRef !== target.profileRef ||
        current.metadataRevision !== target.expectedMetadataRevision ||
        current.pendingSourceOperationId !== null
      )
        throw new ProviderAccountError("operation_conflict");
      const dispatchTarget = {
        ...target,
        disableIssued: true,
        disableExpectedGatewayRevision: input.account.metadataRevision,
        disableExpectedGatewayEpoch: input.account.authorizationEpoch,
      };
      const updated = {
        ...data,
        targets: data.targets.map((t) =>
          t.connectionId === target.connectionId ? dispatchTarget : t,
        ),
      };
      // Durable claim before POST, with exact Gateway CAS. Crash/lost ACK never
      // re-arms this target; the original operation/retirement must be read back.
      const saved = await tx.workspaceDeletionOperation.update({
        where: { id: row.id },
        data: {
          targets: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue,
        },
      });
      return { operation: await this.view(tx, saved), dispatchTarget };
    });
  }

  async recordPolicyClosure(
    input: Scope & {
      readonly expectedWorkspaceRevision: number;
      readonly intent: ScopedBindingFence;
      readonly readback: import("../../application/ports/workspace-binding-fence-port").BindingClosureResponse;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await this.lock(tx, input),
        row = await this.operation(tx, input);
      if (row.stage === "deleted" || row.stage === "refused")
        return this.view(tx, row);
      if (workspace.deletionRevision !== input.expectedWorkspaceRevision)
        throw new ProviderAccountError("revision_conflict");
      const intent = snapshotBindingFence(input.intent),
        result = input.readback;
      const saved = snapshot(row.targets).policyFences.find(
        (f) => f.bindingId === intent.bindingId,
      );
      if (
        !saved ||
        JSON.stringify(saved) !== JSON.stringify(intent) ||
        result.operationRef !== intent.operationId ||
        result.policySubject !== intent.policySubject ||
        result.policyRevision !== intent.policyRevision
      )
        throw new ProviderAccountError("operation_conflict");
      if (result.state !== "completed" || !result.closed)
        return this.view(tx, row);
      const c = result.counts;
      if (
        [
          c.retainedExecutions,
          c.openExecutions,
          c.requests,
          c.occupiedTransports,
          c.acknowledgedNativeTransports,
          c.positiveKernelNonEntryRequests,
          c.unknownEffects,
        ].some((v) => !Number.isSafeInteger(v) || v < 0) ||
        c.openExecutions !== 0 ||
        c.occupiedTransports !== 0 ||
        c.acknowledgedNativeTransports + c.positiveKernelNonEntryRequests !==
          c.requests ||
        c.unknownEffects > c.requests
      )
        throw new ProviderAccountError("operation_conflict");
      const binding = await tx.workspaceAccountBinding.findUniqueOrThrow({
        where: { id: intent.bindingId },
      });
      if (
        binding.workspaceId !== intent.workspaceId ||
        binding.policyRevision !== intent.policyRevision ||
        binding.state !== "revoked" ||
        binding.pendingFenceOperationId !== null ||
        binding.fenceAckOperationId !== intent.operationId ||
        binding.fenceAckPolicyRevision !== intent.policyRevision
      )
        throw new ProviderAccountError("operation_conflict");
      const detail = JSON.parse(
        JSON.stringify(result),
      ) as Prisma.InputJsonValue;
      const digest = createHash("sha256")
        .update(JSON.stringify(detail))
        .digest("hex");
      const existing = await tx.workspaceDeletionFact.findUnique({
        where: {
          operationId_kind_subjectRef: {
            operationId: row.id,
            kind: "binding_fence",
            subjectRef: intent.bindingId,
          },
        },
      });
      if (existing && existing.digest !== digest)
        throw new ProviderAccountError("operation_conflict");
      if (!existing)
        await tx.workspaceDeletionFact.create({
          data: {
            operationId: row.id,
            kind: "binding_fence",
            subjectRef: intent.bindingId,
            proofRef: intent.operationId,
            detail,
            digest,
          },
        });
      return this.view(tx, row);
    });
  }

  async recordLifecycleReadback(
    input: Scope & {
      readonly expectedWorkspaceRevision: number;
      readonly readback: WorkspaceDeletionLifecycleReadback;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await this.lock(tx, input);
      const row = await this.operation(tx, input);
      if (row.stage === "deleted" || row.stage === "refused")
        return this.view(tx, row);
      if (workspace.deletionRevision !== input.expectedWorkspaceRevision)
        throw new ProviderAccountError("revision_conflict");
      if (
        input.readback.operationId !== row.id ||
        input.readback.workspaceId !== row.workspaceId ||
        input.readback.expectedWorkspaceRevision !==
          input.expectedWorkspaceRevision
      )
        throw new ProviderAccountError("operation_conflict");
      const stage =
        input.readback.state === "rejected"
          ? "refused"
          : input.readback.state === "completed"
            ? "finalize_pending"
            : "execution_closure_pending";
      const reason =
        input.readback.state === "rejected"
          ? "gateway_rejected"
          : input.readback.state === "completed"
            ? "finalize_pending"
            : "execution_closure_pending";
      if (input.readback.state === "completed") {
        const view = await this.view(tx, row);
        if (
          view.pendingFenceCount !== 0 ||
          view.pendingPolicyClosureCount !== 0 ||
          view.pendingPersonalOperationCount !== 0
        )
          throw new ProviderAccountError("operation_conflict");
        assertWorkspaceDeletionLifecycleCompleted(input.readback, view);
        for (const target of input.readback.targets) {
          const detail = JSON.parse(
            JSON.stringify(target),
          ) as Prisma.InputJsonValue;
          const digest = createHash("sha256")
            .update(JSON.stringify(detail))
            .digest("hex");
          const existing = await tx.workspaceDeletionFact.findUnique({
            where: {
              operationId_kind_subjectRef: {
                operationId: row.id,
                kind: "inert_readback",
                subjectRef: target.connectionId,
              },
            },
          });
          if (existing && existing.digest !== digest)
            throw new ProviderAccountError("operation_conflict");
          if (!existing)
            await tx.workspaceDeletionFact.create({
              data: {
                operationId: row.id,
                kind: "inert_readback",
                subjectRef: target.connectionId,
                proofRef: target.disableOperationId,
                detail,
                digest,
              },
            });
        }
      }
      return this.view(
        tx,
        await tx.workspaceDeletionOperation.update({
          where: { id: row.id },
          data: { stage, stageReason: reason },
        }),
      );
    });
  }

  async finalizeWorkspaceDeletion(
    input: Scope & {
      readonly expectedWorkspaceRevision: number;
      readonly readback: WorkspaceDeletionLifecycleReadback;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await this.lock(tx, input),
        row = await this.operation(tx, input);
      const view = await this.view(tx, row);
      if (row.stage === "deleted") return view;
      if (
        workspace.deletionState !== "delete_pending" ||
        workspace.deletionRevision !== input.expectedWorkspaceRevision ||
        row.stage !== "finalize_pending" ||
        view.pendingFenceCount !== 0 ||
        view.pendingPolicyClosureCount !== 0 ||
        view.pendingPersonalOperationCount !== 0
      )
        throw new ProviderAccountError("operation_conflict");
      assertWorkspaceDeletionLifecycleCompleted(input.readback, view);
      const current = await tx.providerAccountConnection.findMany({
        where: {
          OR: [
            { ownerWorkspaceId: row.workspaceId, ownerUserId: null },
            ...(workspace.personalOwnerUserId === null
              ? []
              : [
                  {
                    ownerUserId: workspace.personalOwnerUserId,
                    ownerWorkspaceId: null,
                  },
                ]),
          ],
        },
        orderBy: { id: "asc" },
      });
      if (
        current.length !== view.targets.length ||
        current.some(
          (c) =>
            !view.targets.some(
              (t) =>
                t.connectionId === c.id &&
                t.gatewayAccountRef === c.gatewayAccountRef &&
                t.profileRef === c.profileRef,
            ),
        )
      )
        throw new ProviderAccountError("operation_conflict");
      for (const target of input.readback.targets) {
        const fact = await tx.workspaceDeletionFact.findUnique({
          where: {
            operationId_kind_subjectRef: {
              operationId: row.id,
              kind: "inert_readback",
              subjectRef: target.connectionId,
            },
          },
        });
        const digest = createHash("sha256")
          .update(JSON.stringify(target))
          .digest("hex");
        if (!fact || fact.digest !== digest)
          throw new ProviderAccountError("operation_conflict");
        await tx.providerAccountConnection.update({
          where: { id: target.connectionId },
          data: {
            state: "disabled",
            metadataRevision: { increment: 1 },
            authorizationEpochMirror: BigInt(target.fenceAuthorizationEpoch!),
          },
        });
      }
      // Keep workspace/connection/binding/history FK identity. Removing membership
      // and install selection denies product access without deleting audit evidence.
      await tx.workspaceMember.deleteMany({
        where: { workspaceId: row.workspaceId },
      });
      await tx.repositoryConnection.updateMany({
        where: { workspaceId: row.workspaceId },
        data: { selected: false },
      });
      await tx.workspace.update({
        where: { id: row.workspaceId },
        data: {
          deletionState: "deleted",
          deletionRevision: { increment: 1 },
          deletionTombstonedAt: new Date(),
        },
      });
      return this.view(
        tx,
        await tx.workspaceDeletionOperation.update({
          where: { id: row.id },
          data: {
            stage: "deleted",
            stageReason: "deleted",
            completedAt: new Date(),
          },
        }),
      );
    });
  }
}
