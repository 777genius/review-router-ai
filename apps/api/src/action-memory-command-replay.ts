import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  sameMemoryKnowledgeScope,
  type MemoryActor,
  type MemoryEntryRef,
  type MemoryKnowledgeApproval,
  type MemoryKnowledgeSource,
  type MemoryKnowledgeStore,
  type MemoryStoredCommand,
} from "@reviewrouter/features-memory";

/** Only a hash and the original CAS revision survive approved-envelope cleanup. */
export async function prepareActionMemoryCommand(input: {
  readonly store: MemoryKnowledgeStore;
  readonly generation: string;
  readonly ref: MemoryEntryRef;
  readonly actor: MemoryActor;
  readonly source: MemoryKnowledgeSource;
  readonly commandId: string;
  readonly expectedRevision: string | null;
  readonly wire: unknown;
  readonly now: Date;
}): Promise<{
  readonly approval: MemoryKnowledgeApproval;
  readonly replay: MemoryStoredCommand["operation"] | null;
}> {
  const fingerprint = memoryKnowledgeDigest({
    wire: input.wire,
    ref: input.ref,
    source: input.source,
    actor: {
      kind: input.actor.kind,
      id: input.actor.id,
      githubUserId: input.actor.githubUserId,
    },
  });
  const authorityRevision = `github-command:v2:${input.expectedRevision ?? "new"}:${fingerprint}`;
  const existing = await input.store.findCommand({
    commandId: input.commandId,
    scope: input.ref.scope,
    generation: input.generation,
  });
  if (existing) {
    assertSameCommandOwner(existing, input.actor, input.ref);
    if (existing.approval.authorityRevision !== authorityRevision)
      throw new MemoryKnowledgeError("conflict");
    return { approval: existing.approval, replay: existing.operation };
  }
  return {
    approval: {
      actor: input.actor,
      approvedAt: input.now.toISOString(),
      authorityRevision,
    },
    replay: null,
  };
}

export function originalActionMemoryRevision(
  command: MemoryStoredCommand,
  actor: MemoryActor,
  ref: MemoryEntryRef,
): string {
  assertSameCommandOwner(command, actor, ref);
  const match = /^github-command:v2:([1-9]\d{0,9}):[a-f0-9]{64}$/.exec(
    command.approval.authorityRevision,
  );
  if (!match) throw new MemoryKnowledgeError("conflict");
  return match[1]!;
}

function assertSameCommandOwner(
  command: MemoryStoredCommand,
  actor: MemoryActor,
  ref: MemoryEntryRef,
): void {
  if (
    command.approval.actor.kind !== actor.kind ||
    command.approval.actor.id !== actor.id ||
    command.approval.actor.githubUserId !== actor.githubUserId ||
    command.operation.ref.entryId !== ref.entryId ||
    !sameMemoryKnowledgeScope(command.operation.ref.scope, ref.scope)
  )
    throw new MemoryKnowledgeError("conflict");
}
