import {
  MemoryKnowledgeError,
  type MemoryActor,
  type MemoryEntryRef,
  type MemoryKnowledgeAccessPort,
  type MemoryKnowledgeScope,
  type MemoryKnowledgeService,
  type MemoryKnowledgeStore,
  type MemoryRequestControls,
} from "@reviewrouter/features-memory";
import {
  memoryOperationMessage,
  type MemoryDashboardMutation,
  type MemoryKnowledgePage,
  type MemoryOperationView,
  type MemoryScopeSelection,
} from "../application/memory-knowledge-view";

type Dependencies = {
  readonly service: MemoryKnowledgeService;
  readonly store: MemoryKnowledgeStore;
  readonly access: MemoryKnowledgeAccessPort;
  readonly actor: MemoryActor;
  readonly generation: string;
  readonly providerProfileVersion: string;
  readonly enabled: boolean;
  readonly mutationsEnabled: boolean;
  readonly now?: () => Date;
};
export function memoryDashboardScope(
  input: MemoryScopeSelection,
): MemoryKnowledgeScope {
  return input.repositoryId
    ? {
        kind: "repository",
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
      }
    : { kind: "workspace", workspaceId: input.workspaceId };
}
export function createMemoryDashboardController(dependencies: Dependencies) {
  const now = () => dependencies.now?.() ?? new Date();
  const controls = (): MemoryRequestControls => ({
    deadlineAt: new Date(now().getTime() + 5_000),
  });
  const authorize = (
    scope: MemoryKnowledgeScope,
    action: "read" | "manage" | "export",
  ) =>
    dependencies.access.authorize(
      { actor: dependencies.actor, scope, action },
      controls(),
    );
  const allowed = async (
    scope: MemoryKnowledgeScope,
    action: "read" | "manage" | "export",
  ) => {
    try {
      await authorize(scope, action);
      return true;
    } catch (error) {
      if (error instanceof MemoryKnowledgeError && error.code === "forbidden")
        return false;
      throw error;
    }
  };
  const operationView = (
    operation: Awaited<ReturnType<MemoryKnowledgeService["progress"]>>,
  ): MemoryOperationView => ({
    id: operation.id,
    entryId: operation.ref.entryId,
    revision: operation.revision,
    state: operation.state,
    message: memoryOperationMessage(operation.state),
  });
  return {
    authorize,
    allowed,
    async list(
      input: MemoryScopeSelection & {
        readonly cursor?: string | null;
        readonly topicId?: string | null;
      },
      options: {
        readonly repositories: MemoryKnowledgePage["repositories"];
        readonly workspaceVisible: boolean;
        readonly writesEnabled: boolean;
      },
    ): Promise<MemoryKnowledgePage> {
      const scope = memoryDashboardScope(input);
      await authorize(scope, "read");
      const [page, canManage, canExport] = await Promise.all([
        dependencies.service.list(
          {
            actor: dependencies.actor,
            scope,
            limit: 30,
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.topicId ? { topicId: input.topicId } : {}),
          },
          controls(),
        ),
        allowed(scope, "manage"),
        allowed(scope, "export"),
      ]);
      return {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        ...options,
        cursor: input.cursor ?? null,
        topicId: input.topicId ?? null,
        nextCursor: page.nextCursor,
        canManage: dependencies.mutationsEnabled && canManage,
        canExport,
        writesEnabled: dependencies.enabled && options.writesEnabled,
        availability: !dependencies.enabled
          ? "disabled"
          : page.entries.some(
                (entry) => entry.unavailableReason === "provider_unavailable",
              )
            ? "unavailable"
            : "ready",
        entries: page.entries.map(
          ({ metadata, body, topicIds, unavailableReason }) => ({
            id: metadata.ref.entryId,
            revision: metadata.revision,
            kind: metadata.kind,
            status: metadata.lifecycle,
            body,
            topics: topicIds,
            sourceLabel: metadata.automaticSource
              ? "Learned from maintainer discussion"
              : metadata.source?.type === "manual"
                ? "Added in your workspace"
                : metadata.source?.type === "github_comment"
                  ? "GitHub discussion"
                  : "Imported knowledge",
            sourceUrl: safeSourceUrl(metadata.source?.url ?? null),
            statementAt:
              metadata.originalStatementAt ??
              metadata.source?.statementAt ??
              null,
            lastVerifiedAt: metadata.lastVerifiedAt,
            pendingCommandId: metadata.pendingCommandId,
            unavailable: unavailableReason,
          }),
        ),
      };
    },
    async mutate(input: MemoryDashboardMutation): Promise<MemoryOperationView> {
      if (!dependencies.mutationsEnabled)
        throw new MemoryKnowledgeError("forbidden");
      const scope = memoryDashboardScope(input);
      await authorize(scope, "manage");
      const previous = await dependencies.store.findCommand({
        commandId: input.commandId,
        scope,
        generation: dependencies.generation,
      });
      if (previous && previous.approval.actor.id !== dependencies.actor.id)
        throw new MemoryKnowledgeError("conflict");
      const approvedAt = previous?.approval.approvedAt ?? now().toISOString();
      const approval = previous?.approval ?? {
        actor: dependencies.actor,
        approvedAt,
        authorityRevision: `dashboard:${input.commandId}`,
      };
      const entryId =
        input.entryId ?? `mem_${input.commandId.replaceAll("-", "")}`;
      if ((input.entryId === null) !== (input.expectedRevision === null))
        throw new MemoryKnowledgeError("invalid_input");
      if (input.action !== "save" && input.entryId === null)
        throw new MemoryKnowledgeError("invalid_input");
      const ref: MemoryEntryRef = { type: "entry", scope, entryId };
      const command = {
        ref,
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        generation: dependencies.generation,
        providerProfileVersion: dependencies.providerProfileVersion,
        approval,
      };
      if (input.action === "retire")
        return operationView(
          await dependencies.service.retire(
            { ...command, kind: "retire" },
            controls(),
          ),
        );
      if (input.action === "forget")
        return operationView(
          await dependencies.service.forget(
            { ...command, kind: "forget" },
            controls(),
          ),
        );
      if (input.action !== "save")
        throw new MemoryKnowledgeError("invalid_input");
      const existing =
        input.entryId === null
          ? null
          : await dependencies.store.findEntry(ref, dependencies.generation);
      if (input.entryId !== null && !existing)
        throw new MemoryKnowledgeError("not_found");
      return operationView(
        await dependencies.service.save(
          {
            ...command,
            kind: "save",
            body: input.body,
            topicIds: input.topics,
            knowledgeKind: existing?.kind ?? "rule",
            temporalMode: "preserve_original",
            source: {
              type: "manual",
              sourceId: `manual:${input.commandId}`,
              revision: approvedAt,
              updatedAt: approvedAt,
              statementAt: approvedAt,
              repositoryId: input.repositoryId,
              pullRequestNumber: null,
              url: null,
              visibility: "internal",
              claimedBodyDigest: null,
              observedCommitSha:
                existing?.applicability.observedCommitSha ?? null,
            },
            applicability: existing?.applicability ?? {
              validUntil: null,
              observedCommitSha: null,
              exceptionRule: null,
            },
          },
          controls(),
        ),
      );
    },
    async progress(
      input: MemoryScopeSelection & { readonly commandId: string },
    ): Promise<MemoryOperationView> {
      return operationView(
        await dependencies.service.progress(
          {
            actor: dependencies.actor,
            scope: memoryDashboardScope(input),
            commandId: input.commandId,
          },
          controls(),
        ),
      );
    },
    async export(input: MemoryScopeSelection & { readonly cursor?: string }) {
      return dependencies.service.export(
        {
          actor: dependencies.actor,
          scope: memoryDashboardScope(input),
          limit: 1_000,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        },
        controls(),
      );
    },
  };
}
function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
export function memoryDashboardPublicError(error: unknown): {
  readonly error: string;
  readonly status: number;
} {
  if (!(error instanceof MemoryKnowledgeError))
    return { error: "memory_unavailable", status: 503 };
  return {
    error: `memory_${error.code}`,
    status:
      error.code === "forbidden"
        ? 403
        : error.code === "not_found"
          ? 404
          : error.code === "conflict"
            ? 409
            : error.code === "invalid_input"
              ? 400
              : 503,
  };
}
