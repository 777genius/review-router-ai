import { createHash } from "node:crypto";
import type { MemoryActor } from "./memory-actor";
import { createMemoryBodyHash, normalizeMemoryBody } from "./memory-body";

/** An authorization boundary, never a provider bank or a cosmetic topic. */
export type MemoryKnowledgeScope =
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | {
      readonly kind: "repository";
      readonly workspaceId: string;
      readonly repositoryId: string;
    }
  | {
      readonly kind: "user_preference";
      readonly workspaceId: string;
      readonly userId: string;
    };

export type MemoryEntryRef = {
  readonly type: "entry";
  readonly scope: MemoryKnowledgeScope;
  readonly entryId: string;
};
export type MemoryObservationRef = {
  readonly type: "observation";
  readonly scope: MemoryKnowledgeScope;
  readonly observationId: string;
};
export type MemoryKnowledgeKind = "rule" | "exception" | "observation";
export type MemoryKnowledgeLifecycle =
  | "active"
  | "retired"
  | "expired"
  | "forget_pending"
  | "forgotten";
export type MemoryKnowledgeOperationState =
  | "queued"
  | "submitted"
  | "processing"
  | "published"
  | "failed"
  | "unknown"
  | "cleanup_pending"
  | "completed";
export type MemoryKnowledgeErrorCode =
  | "invalid_input"
  | "forbidden"
  | "unavailable"
  | "conflict"
  | "not_found"
  | "unsupported"
  | "incomplete_evidence"
  | "unknown_write"
  | "deadline_exceeded"
  | "quota_exceeded"
  | "disabled"
  | "input_required";

export class MemoryKnowledgeError extends Error {
  constructor(
    readonly code: MemoryKnowledgeErrorCode,
    readonly retryable = false,
  ) {
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
  /** Present only when workspace policy authorizes an AI-generated mutation. */
  readonly automaticSettingsRevision?: string;
};

export type MemoryKnowledgeApplicability = {
  readonly validUntil: string | null;
  readonly observedCommitSha: string | null;
  readonly exceptionRule: MemoryEntryRef | null;
};

/** Bodyless revisions of the complete checked thread used by automatic selection. */
export type MemoryAutomaticContextEvidence = {
  readonly threadId: string;
  readonly messages: readonly {
    readonly id: string;
    readonly updatedAt: string;
    readonly bodyDigest: string;
    readonly replyTo: string | null;
  }[];
};

export function normalizeMemoryAutomaticContextEvidence(
  evidence: MemoryAutomaticContextEvidence,
): MemoryAutomaticContextEvidence {
  assertKeys(evidence, ["threadId", "messages"]);
  const rootId =
    typeof evidence.threadId === "string"
      ? evidence.threadId.match(
          /^github-review-thread:([1-9][0-9]{0,15})$/,
        )?.[1]
      : undefined;
  if (
    !rootId ||
    !Number.isSafeInteger(Number(rootId)) ||
    !Array.isArray(evidence.messages) ||
    evidence.messages.length < 2 ||
    evidence.messages.length > 10_000
  )
    throw new MemoryKnowledgeError("invalid_input");
  const ids = new Set<string>();
  let roots = 0;
  const messages = evidence.messages.map((message) => {
    assertKeys(message, ["id", "updatedAt", "bodyDigest", "replyTo"]);
    if (
      typeof message.id !== "string" ||
      !/^github-node:[a-zA-Z0-9_+/=-]{1,256}$/.test(message.id) ||
      ids.has(message.id) ||
      typeof message.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(message.updatedAt)) ||
      new Date(message.updatedAt).toISOString() !== message.updatedAt ||
      typeof message.bodyDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(message.bodyDigest) ||
      (message.replyTo !== null && message.replyTo !== rootId)
    )
      throw new MemoryKnowledgeError("invalid_input");
    ids.add(message.id);
    if (message.replyTo === null) roots++;
    return {
      id: message.id,
      updatedAt: message.updatedAt,
      bodyDigest: message.bodyDigest,
      replyTo: message.replyTo,
    };
  });
  if (roots !== 1) throw new MemoryKnowledgeError("invalid_input");
  return { threadId: evidence.threadId, messages };
}

export type MemoryAutomaticSourceBinding = {
  readonly lineageKey: string;
  readonly cohortId: string;
  readonly epoch: string;
  readonly sourceRevision: string;
  readonly policyRevision: string;
  readonly sourceActorId: string;
  readonly observedCommitSha: string;
  /** Absent only on cohorts selected under the previous source-only contract. */
  readonly contextEvidence?: MemoryAutomaticContextEvidence;
};

/** Current provider bodies and current topic membership are deliberately absent. */
export type MemoryKnowledgeEntryMetadata = {
  readonly ref: MemoryEntryRef;
  readonly automaticSource?: MemoryAutomaticSourceBinding;
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
export type MemoryKnowledgeCommand = MemoryKnowledgeCommandContext &
  (
    | {
        readonly kind: "save";
        readonly body: string;
        readonly knowledgeKind: MemoryKnowledgeKind;
        readonly topicIds: readonly string[];
        readonly source: MemoryKnowledgeSource;
        readonly applicability: MemoryKnowledgeApplicability;
        readonly temporalMode: "preserve_original";
      }
    | { readonly kind: "topics"; readonly topicIds: readonly string[] }
    | { readonly kind: "retire" | "expire" | "forget" }
  );

/** Reject every non-identifier character, including terminal line separators. */
function isMemoryScopeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[^a-zA-Z0-9_-]/.test(value)
  );
}

export function memoryKnowledgeScopeKey(scope: MemoryKnowledgeScope): string {
  assertKeys(scope, [
    "kind",
    "workspaceId",
    ...(scope.kind === "repository"
      ? ["repositoryId"]
      : scope.kind === "user_preference"
        ? ["userId"]
        : []),
  ]);
  if (!["workspace", "repository", "user_preference"].includes(scope.kind))
    throw new MemoryKnowledgeError("invalid_input");
  const subject =
    scope.kind === "repository"
      ? scope.repositoryId
      : scope.kind === "user_preference"
        ? scope.userId
        : "";
  if (
    !isMemoryScopeIdentifier(scope.workspaceId) ||
    (scope.kind !== "workspace" && !isMemoryScopeIdentifier(subject))
  )
    throw new MemoryKnowledgeError("invalid_input");
  return JSON.stringify([scope.workspaceId, scope.kind, subject]);
}

export function sameMemoryKnowledgeScope(
  a: MemoryKnowledgeScope,
  b: MemoryKnowledgeScope,
): boolean {
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
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function normalizeMemoryKnowledgeCommand(
  command: MemoryKnowledgeCommand,
): MemoryKnowledgeCommand {
  if (
    !command ||
    typeof command !== "object" ||
    !["save", "topics", "retire", "expire", "forget"].includes(command.kind)
  )
    throw new MemoryKnowledgeError("invalid_input");
  assertKeys(command, [
    "ref",
    "commandId",
    "expectedRevision",
    "generation",
    "providerProfileVersion",
    "approval",
    "kind",
    ...(command.kind === "save"
      ? [
          "body",
          "knowledgeKind",
          "topicIds",
          "source",
          "applicability",
          "temporalMode",
        ]
      : command.kind === "topics"
        ? ["topicIds"]
        : []),
  ]);
  assertKeys(command.ref, ["type", "scope", "entryId"]);
  assertKeys(command.approval, [
    "actor",
    "approvedAt",
    "authorityRevision",
    "automaticSettingsRevision",
  ]);
  assertKeys(command.approval.actor, ["kind", "id", "githubUserId", "login"]);
  memoryKnowledgeScopeKey(command.ref.scope);
  if (
    command.ref.type !== "entry" ||
    !command.ref.entryId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      command.commandId,
    ) ||
    !command.generation ||
    !command.providerProfileVersion ||
    !command.approval.actor.id ||
    !command.approval.authorityRevision ||
    !Number.isFinite(Date.parse(command.approval.approvedAt))
  )
    throw new MemoryKnowledgeError("invalid_input");
  if (
    command.approval.automaticSettingsRevision !== undefined &&
    (typeof command.approval.automaticSettingsRevision !== "string" ||
      !/^(0|[1-9]\d{0,9})$/.test(command.approval.automaticSettingsRevision))
  )
    throw new MemoryKnowledgeError("invalid_input");
  if (
    !/^[a-zA-Z0-9_-]{1,160}$/.test(command.ref.entryId) ||
    command.generation.length > 160 ||
    command.providerProfileVersion.length > 160 ||
    command.approval.authorityRevision.length > 256 ||
    command.approval.actor.id.length > 160 ||
    !["github_user", "workspace_user", "system"].includes(
      command.approval.actor.kind,
    )
  )
    throw new MemoryKnowledgeError("invalid_input");
  if (
    command.expectedRevision !== null &&
    (!/^[1-9]\d*$/.test(command.expectedRevision) ||
      Number(command.expectedRevision) >= 2_147_483_647)
  )
    throw new MemoryKnowledgeError("invalid_input");
  if (command.kind === "topics" || command.kind === "save") {
    if (
      command.topicIds.length > 20 ||
      command.topicIds.some(
        (topic) =>
          !/^[a-zA-Z0-9_-]{1,100}$/.test(topic) || topic.startsWith("rr_"),
      )
    )
      throw new MemoryKnowledgeError("invalid_input");
    const topicIds = [...new Set(command.topicIds)].sort();
    if (command.kind === "topics") return { ...command, topicIds };
    if (command.temporalMode !== "preserve_original")
      throw new MemoryKnowledgeError("unsupported");
    const body = normalizeMemoryBody(command.body);
    if (
      !body ||
      body.length > 1_000 ||
      !command.source.sourceId ||
      !command.source.revision ||
      !Number.isFinite(Date.parse(command.source.updatedAt)) ||
      !Number.isFinite(Date.parse(command.source.statementAt))
    )
      throw new MemoryKnowledgeError("invalid_input");
    assertKeys(command.source, [
      "type",
      "sourceId",
      "revision",
      "updatedAt",
      "statementAt",
      "repositoryId",
      "pullRequestNumber",
      "url",
      "visibility",
      "claimedBodyDigest",
      "observedCommitSha",
    ]);
    assertKeys(command.applicability, [
      "validUntil",
      "observedCommitSha",
      "exceptionRule",
    ]);
    if (
      !["rule", "exception", "observation"].includes(command.knowledgeKind) ||
      !["manual", "github_comment", "migration"].includes(
        command.source.type,
      ) ||
      !["private", "internal", "public"].includes(command.source.visibility) ||
      command.source.sourceId.length > 200 ||
      command.source.revision.length > 256 ||
      (command.source.url &&
        (command.source.url.length > 1_000 ||
          !/^https:\/\//.test(command.source.url))) ||
      (command.source.claimedBodyDigest &&
        !/^[0-9a-f]{64}$/.test(command.source.claimedBodyDigest)) ||
      (command.applicability.validUntil &&
        !Number.isFinite(Date.parse(command.applicability.validUntil)))
    )
      throw new MemoryKnowledgeError("invalid_input");
    if (command.applicability.exceptionRule) {
      const target = command.applicability.exceptionRule;
      assertKeys(target, ["type", "scope", "entryId"]);
      memoryKnowledgeScopeKey(target.scope);
      if (
        command.knowledgeKind !== "exception" ||
        target.type !== "entry" ||
        target.scope.workspaceId !== command.ref.scope.workspaceId ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(target.entryId)
      )
        throw new MemoryKnowledgeError("invalid_input");
    } else if (command.knowledgeKind === "exception")
      throw new MemoryKnowledgeError("invalid_input");
    return {
      ...command,
      body,
      topicIds,
      approval: {
        ...command.approval,
        approvedAt: new Date(command.approval.approvedAt).toISOString(),
      },
      source: {
        ...command.source,
        updatedAt: new Date(command.source.updatedAt).toISOString(),
        statementAt: new Date(command.source.statementAt).toISOString(),
      },
    };
  }
  return command;
}

function assertKeys(value: unknown, keys: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new MemoryKnowledgeError("invalid_input");
}

export function memoryKnowledgeCommandDigest(
  command: MemoryKnowledgeCommand,
): string {
  return memoryKnowledgeDigest(normalizeMemoryKnowledgeCommand(command));
}

/** One cohort identity shared by selection, admission and accepted-operation recovery. */
export function automaticMemoryCohortId(processingId: string): string {
  return memoryKnowledgeDigest(["automatic-cohort", processingId]);
}

/** Stable identity shared by automatic admission and accepted-operation recovery. */
export function automaticMemoryChildCommandId(
  processingId: string,
  index: number | string,
): string {
  const hex = memoryKnowledgeDigest(["automatic-command", processingId, index]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function memoryKnowledgeBodyMatches(
  body: string,
  metadata: MemoryKnowledgeEntryMetadata,
): boolean {
  return (
    metadata.bodyDigest !== null &&
    createMemoryBodyHash(body) === metadata.bodyDigest
  );
}

export function memoryKnowledgeBodyVisible(
  metadata: MemoryKnowledgeEntryMetadata,
  consumer: "runtime" | "management" | "export",
  now: Date,
): boolean {
  if (
    metadata.pendingCommandId ||
    metadata.revocationCommandId ||
    metadata.lifecycle === "forget_pending" ||
    metadata.lifecycle === "forgotten" ||
    !metadata.contentApprovalRevision ||
    !metadata.approval
  )
    return false;
  if (consumer !== "runtime") return true;
  return (
    metadata.lifecycle === "active" &&
    (!metadata.applicability.validUntil ||
      Date.parse(metadata.applicability.validUntil) > now.getTime())
  );
}
