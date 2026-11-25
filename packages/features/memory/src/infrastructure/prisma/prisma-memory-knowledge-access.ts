import type { Prisma, PrismaClient } from "@prisma/client";
import {
  MemoryKnowledgeError,
  memoryKnowledgeScopeKey,
  sameMemoryKnowledgeScope,
  type MemoryKnowledgeScope,
  type MemoryKnowledgeSource,
} from "../../domain/memory-knowledge";
import type { MemoryKnowledgeAccessPort } from "../../application/ports/memory-knowledge-access-port";
import type { MemoryRequestControls } from "../../application/ports/memory-knowledge-provider-port";
import type { MemoryPermissionPort } from "../../application/ports/memory-permission-port";
import type { MemoryPolicyConfigPort } from "../../application/ports/memory-policy-config-port";
import {
  resolveMemoryProductUserId,
  resolveMemoryWorkspaceRole,
} from "./prisma-memory-permission";

export type MemoryKnowledgeRuntimeGrant = {
  readonly actorId: string;
  readonly scopes: readonly MemoryKnowledgeScope[];
  readonly headSha: string;
};
export type MemoryKnowledgeSourceAuthority = {
  verifySource(
    input: Parameters<MemoryKnowledgeAccessPort["verifySource"]>[0],
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeSource>;
  sourceApplicable?(
    input: Parameters<MemoryKnowledgeAccessPort["sourceApplicable"]>[0] & {
      readonly headSha?: string;
    },
    controls: MemoryRequestControls,
  ): Promise<boolean>;
};

/** Product authorization only. Host composition supplies verified review/source grants. */
export class PrismaMemoryKnowledgeAccess implements MemoryKnowledgeAccessPort {
  constructor(
    private readonly dependencies: {
      readonly prisma: PrismaClient | Prisma.TransactionClient;
      readonly permissions: MemoryPermissionPort;
      readonly policy: MemoryPolicyConfigPort;
      readonly sourceAuthority?: MemoryKnowledgeSourceAuthority;
      readonly runtimeGrant?: MemoryKnowledgeRuntimeGrant;
      readonly now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
  private check(controls: MemoryRequestControls): void {
    if (
      controls.signal?.aborted ||
      this.now().getTime() >= controls.deadlineAt.getTime()
    )
      throw new MemoryKnowledgeError("deadline_exceeded", true);
  }

  async authorize(
    input: Parameters<MemoryKnowledgeAccessPort["authorize"]>[0],
    controls: MemoryRequestControls,
  ): Promise<void> {
    this.check(controls);
    memoryKnowledgeScopeKey(input.scope);
    if (input.actor.kind === "system") {
      const grant = this.dependencies.runtimeGrant;
      if (
        input.action !== "runtime" ||
        !grant ||
        grant.actorId !== input.actor.id ||
        !grant.scopes.some((scope) =>
          sameMemoryKnowledgeScope(scope, input.scope),
        ) ||
        input.scope.kind === "user_preference"
      )
        throw new MemoryKnowledgeError("forbidden");
      if (
        input.scope.kind === "repository" &&
        !(await this.repositoryAvailable(
          input.scope.workspaceId,
          input.scope.repositoryId,
        ))
      )
        throw new MemoryKnowledgeError("forbidden");
      this.check(controls);
      return;
    }
    if (
      !input.actor.id ||
      (input.actor.kind === "github_user" &&
        (!input.actor.githubUserId || !/^\d+$/.test(input.actor.githubUserId)))
    )
      throw new MemoryKnowledgeError("forbidden");
    const policy = await this.dependencies.policy.getPolicy({
      workspaceId: input.scope.workspaceId,
      repositoryId:
        input.scope.kind === "repository" ? input.scope.repositoryId : null,
    });
    if (
      input.scope.kind === "repository" &&
      !(await this.repositoryAvailable(
        input.scope.workspaceId,
        input.scope.repositoryId,
      ))
    )
      throw new MemoryKnowledgeError("forbidden");
    if (input.scope.kind === "user_preference") {
      if (
        (await resolveMemoryProductUserId(
          this.dependencies.prisma,
          input.actor,
        )) !== input.scope.userId
      )
        throw new MemoryKnowledgeError("forbidden");
      this.check(controls);
      return;
    }
    const role = await resolveMemoryWorkspaceRole(this.dependencies.prisma, {
      workspaceId: input.scope.workspaceId,
      actor: input.actor,
    });
    const admin = role === "owner" || role === "admin";
    if (input.action === "manage") {
      if (
        !admin &&
        input.scope.kind === "repository" &&
        !policy.authority.repositoryMaintainerCanManage
      )
        throw new MemoryKnowledgeError("forbidden");
      const decision = await this.dependencies.permissions.canConfirmMemory({
        workspaceId: input.scope.workspaceId,
        repositoryId:
          input.scope.kind === "repository" ? input.scope.repositoryId : null,
        userId: null,
        scope: input.scope.kind,
        actor: input.actor,
      });
      if (!decision.allowed)
        throw new MemoryKnowledgeError(
          decision.retryable ? "unavailable" : "forbidden",
          decision.retryable,
        );
    } else if (
      !admin &&
      !(role === "member" && policy.authority.membersCanView)
    ) {
      if (
        input.scope.kind !== "repository" ||
        !policy.authority.repositoryMaintainerCanManage
      )
        throw new MemoryKnowledgeError("forbidden");
      const decision = await this.dependencies.permissions.canConfirmMemory({
        workspaceId: input.scope.workspaceId,
        repositoryId: input.scope.repositoryId,
        userId: null,
        scope: "repository",
        actor: input.actor,
      });
      if (!decision.allowed)
        throw new MemoryKnowledgeError(
          decision.retryable ? "unavailable" : "forbidden",
          decision.retryable,
        );
    }
    this.check(controls);
  }

  async verifySource(
    input: Parameters<MemoryKnowledgeAccessPort["verifySource"]>[0],
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeSource> {
    await this.authorize(
      { actor: input.actor, scope: input.scope, action: "manage" },
      controls,
    );
    if (input.source.type === "manual") {
      const source = input.source;
      const uuid =
        "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
      if (
        !new RegExp(`^(?:(?:manual|decision):)?${uuid}$`, "i").test(
          source.sourceId,
        ) ||
        source.url !== null ||
        source.pullRequestNumber !== null ||
        source.claimedBodyDigest !== null ||
        source.updatedAt !== source.statementAt ||
        !Number.isFinite(Date.parse(source.statementAt)) ||
        Date.parse(source.statementAt) > this.now().getTime() ||
        (source.repositoryId &&
          (input.scope.kind !== "repository" ||
            source.repositoryId !== input.scope.repositoryId))
      )
        throw new MemoryKnowledgeError("invalid_input");
      if (
        source.observedCommitSha &&
        (input.scope.kind !== "repository" ||
          !/^[0-9a-f]{40,64}$/i.test(source.observedCommitSha))
      )
        throw new MemoryKnowledgeError("invalid_input");
      return {
        ...source,
        visibility:
          input.scope.kind === "user_preference" ? "private" : "internal",
      };
    }
    if (!this.dependencies.sourceAuthority)
      throw new MemoryKnowledgeError("forbidden");
    try {
      const verified = await this.dependencies.sourceAuthority.verifySource(
        input,
        controls,
      );
      if (
        verified.type !== input.source.type ||
        verified.sourceId !== input.source.sourceId ||
        verified.revision !== input.source.revision ||
        (verified.repositoryId &&
          !(await this.repositoryAvailable(
            input.scope.workspaceId,
            verified.repositoryId,
          )))
      )
        throw new MemoryKnowledgeError("forbidden");
      // A promoted statement may broaden readership only after its trusted source
      // adapter removes provenance links the broader scope cannot read.
      if (
        input.scope.kind === "workspace" &&
        verified.visibility !== "public" &&
        verified.url !== null
      )
        throw new MemoryKnowledgeError("forbidden");
      this.check(controls);
      return verified;
    } catch (error) {
      if (error instanceof MemoryKnowledgeError) throw error;
      throw new MemoryKnowledgeError("unavailable", true);
    }
  }

  async sourceApplicable(
    input: Parameters<MemoryKnowledgeAccessPort["sourceApplicable"]>[0],
    controls: MemoryRequestControls,
  ): Promise<boolean> {
    this.check(controls);
    if (
      input.source.repositoryId &&
      !(await this.repositoryAvailable(
        input.scope.workspaceId,
        input.source.repositoryId,
      ))
    )
      return false;
    if (
      input.source.url &&
      input.source.visibility !== "public" &&
      input.source.repositoryId
    ) {
      try {
        await this.authorize(
          {
            actor: input.actor,
            scope: {
              kind: "repository",
              workspaceId: input.scope.workspaceId,
              repositoryId: input.source.repositoryId,
            },
            action: input.consumer === "runtime" ? "runtime" : "read",
          },
          controls,
        );
      } catch {
        return false;
      }
    }
    const headSha = this.dependencies.runtimeGrant?.headSha;
    if (
      input.consumer === "runtime" &&
      input.source.observedCommitSha &&
      input.source.observedCommitSha !== headSha
    ) {
      if (!this.dependencies.sourceAuthority?.sourceApplicable) return false;
    }
    if (
      this.dependencies.sourceAuthority?.sourceApplicable &&
      input.source.type !== "manual"
    ) {
      try {
        return await this.dependencies.sourceAuthority.sourceApplicable(
          { ...input, ...(headSha ? { headSha } : {}) },
          controls,
        );
      } catch {
        return false;
      }
    }
    if (
      input.consumer === "runtime" &&
      input.source.observedCommitSha &&
      input.source.observedCommitSha !== headSha
    )
      return false;
    this.check(controls);
    return (
      input.source.type === "manual" ||
      Boolean(this.dependencies.sourceAuthority)
    );
  }

  private async repositoryAvailable(
    workspaceId: string,
    repositoryId: string,
  ): Promise<boolean> {
    const repository =
      await this.dependencies.prisma.repositoryConnection.findFirst({
        where: { id: repositoryId, workspaceId },
        select: { selected: true, archived: true },
      });
    return Boolean(repository?.selected && !repository.archived);
  }
}
