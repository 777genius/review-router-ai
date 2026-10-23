import { createHash } from "node:crypto";
import type { MemoryActor } from "./memory-actor";
import { createMemoryBodyHash, normalizeMemoryBody } from "./memory-body";

/** An authorization boundary, never a provider bank or a cosmetic topic. */
export type MemoryKnowledgeScope =
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | { readonly kind: "repository"; readonly workspaceId: string; readonly repositoryId: string }
  | { readonly kind: "user_preference"; readonly workspaceId: string; readonly userId: string };

export type MemoryEntryRef = { readonly type: "entry"; readonly scope: MemoryKnowledgeScope; readonly entryId: string };
export type MemoryObservationRef = { readonly type: "observation"; readonly scope: MemoryKnowledgeScope; readonly observationId: string };
export type MemoryKnowledgeKind = "rule" | "exception" | "observation";
export type MemoryKnowledgeLifecycle = "active" | "retired" | "expired" | "forget_pending" | "forgotten";
export type MemoryKnowledgeOperationState = "queued" | "submitted" | "processing" | "published" | "failed" | "unknown" | "cleanup_pending" | "completed";
export type MemoryKnowledgeErrorCode = "invalid_input" | "forbidden" | "unavailable" | "conflict" | "not_found" | "unsupported" | "incomplete_evidence" | "unknown_write" | "deadline_exceeded" | "quota_exceeded" | "disabled" | "input_required";

export class MemoryKnowledgeError extends Error {
  constructor(readonly code: MemoryKnowledgeErrorCode, readonly retryable = false) {
    super(`memory_${code}`);
    this.name = "MemoryKnowledgeError";
  }
}

/** Metadata checked by a host source adapter. A claimed digest is not source-body verification. */
export type MemoryKnowledgeSource = {
  readonly type: "manual" | "github_comment" | "migration";
  readonly sourceId: string;
  readonly revision: string;
  readonly updatedAt: string;
  readonly statementAt: string;
  readonly repositoryId: string | null;
  readonly pullRequestNumber: number | null;
  readonly url: string | null;
  readonly visibility: "private" | "internal" | "public";
  readonly claimedBodyDigest: string | null;
  readonly observedCommitSha: string | null;
};

export type MemoryKnowledgeApproval = {
  readonly actor: MemoryActor;
  readonly approvedAt: string;
  readonly authorityRevision: string;
};

export type MemoryKnowledgeApplicability = {
  readonly validUntil: string | null;
  readonly observedCommitSha: string | null;
  readonly exceptionRule: MemoryEntryRef | null;
};

/** Current provider bodies and current topic membership are deliberately absent. */
export type MemoryKnowledgeEntryMetadata = {
  readonly ref: MemoryEntryRef;
  readonly generation: string;
  readonly revision: string;
  readonly contentApprovalRevision: string | null;
  readonly bodyDigest: string | null;
  readonly topicsDigest: string | null;
  readonly kind: MemoryKnowledgeKind;
  readonly lifecycle: MemoryKnowledgeLifecycle;
  readonly approval: MemoryKnowledgeApproval | null;
  readonly source: MemoryKnowledgeSource | null;
  readonly applicability: MemoryKnowledgeApplicability;
  readonly originalStatementAt: string | null;
  readonly lastVerifiedAt: string | null;
  readonly pendingCommandId: string | null;
  readonly revocationCommandId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type MemoryKnowledgeOperation = {
  readonly id: string;
  readonly ref: MemoryEntryRef;
  readonly revision: string;
  readonly state: MemoryKnowledgeOperationState;
  readonly safeReason?: MemoryKnowledgeErrorCode;
};

export type MemoryKnowledgeCommandContext = {
  readonly ref: MemoryEntryRef;
  readonly commandId: string;
  readonly expectedRevision: string | null;
  readonly generation: string;
  readonly providerProfileVersion: string;
  readonly approval: MemoryKnowledgeApproval;
};

/** Immutable, bounded approved delivery input; purged on verified terminal settlement. */
export type MemoryKnowledgeCommand = MemoryKnowledgeCommandContext & (
  | { readonly kind: "save"; readonly body: string; readonly knowledgeKind: MemoryKnowledgeKind; readonly topicIds: readonly string[]; readonly source: MemoryKnowledgeSource; readonly applicability: MemoryKnowledgeApplicability; readonly temporalMode: "preserve_original" }
  | { readonly kind: "topics"; readonly topicIds: readonly string[] }
  | { readonly kind: "retire" | "expire" | "forget" }
);

export function memoryKnowledgeScopeKey(scope: MemoryKnowledgeScope): string {
  if (!scope.workspaceId || /[\u0000-\u001f]/.test(scope.workspaceId)) throw new MemoryKnowledgeError("invalid_input");
  const subject = scope.kind === "repository" ? scope.repositoryId : scope.kind === "user_preference" ? scope.userId : "";
  if (scope.kind !== "workspace" && !subject) throw new MemoryKnowledgeError("invalid_input");
  return JSON.stringify([scope.workspaceId, scope.kind, subject]);
}

export function sameMemoryKnowledgeScope(a: MemoryKnowledgeScope, b: MemoryKnowledgeScope): boolean {
  return memoryKnowledgeScopeKey(a) === memoryKnowledgeScopeKey(b);
}

export function memoryKnowledgeTopicsDigest(topics: readonly string[]): string {
  return memoryKnowledgeDigest([...new Set(topics)].sort());
}

export function memoryKnowledgeDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function normalizeMemoryKnowledgeCommand(command: MemoryKnowledgeCommand): MemoryKnowledgeCommand {
  memoryKnowledgeScopeKey(command.ref.scope);
  if (command.ref.type !== "entry" || !command.ref.entryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.commandId) || !command.generation || !command.providerProfileVersion || !command.approval.actor.id || !command.approval.authorityRevision || !Number.isFinite(Date.parse(command.approval.approvedAt))) throw new MemoryKnowledgeError("invalid_input");
  if (command.expectedRevision !== null && !/^[1-9]\d*$/.test(command.expectedRevision)) throw new MemoryKnowledgeError("invalid_input");
  if (command.kind === "topics" || command.kind === "save") {
    if (command.topicIds.length > 20 || command.topicIds.some((topic) => !/^[a-zA-Z0-9_-]{1,100}$/.test(topic) || topic.startsWith("rr_"))) throw new MemoryKnowledgeError("invalid_input");
    const topicIds = [...new Set(command.topicIds)].sort();
    if (command.kind === "topics") return { ...command, topicIds };
    if (command.temporalMode !== "preserve_original") throw new MemoryKnowledgeError("unsupported");
    const body = normalizeMemoryBody(command.body);
    if (!body || body.length > 1_000 || !command.source.sourceId || !command.source.revision || !Number.isFinite(Date.parse(command.source.updatedAt)) || !Number.isFinite(Date.parse(command.source.statementAt))) throw new MemoryKnowledgeError("invalid_input");
    return { ...command, body, topicIds };
  }
  return command;
}

export function memoryKnowledgeCommandDigest(command: MemoryKnowledgeCommand): string {
  return memoryKnowledgeDigest(normalizeMemoryKnowledgeCommand(command));
}

export function memoryKnowledgeBodyMatches(body: string, metadata: MemoryKnowledgeEntryMetadata): boolean {
  return metadata.bodyDigest !== null && createMemoryBodyHash(body) === metadata.bodyDigest;
}

export function memoryKnowledgeBodyVisible(metadata: MemoryKnowledgeEntryMetadata, consumer: "runtime" | "management" | "export", now: Date): boolean {
  if (metadata.pendingCommandId || metadata.revocationCommandId || metadata.lifecycle === "forget_pending" || metadata.lifecycle === "forgotten" || !metadata.contentApprovalRevision || !metadata.approval) return false;
  if (consumer !== "runtime") return true;
  return metadata.lifecycle === "active" && (!metadata.applicability.validUntil || Date.parse(metadata.applicability.validUntil) > now.getTime());
}
