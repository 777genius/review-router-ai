import {
  HindsightMemoryStore,
  MemoryEngineError,
  hasHindsightExactChunksStrategy,
} from "context-memory";
import {
  createClient,
  createConfig,
  sdk,
  type Client,
  type DocumentResponse,
  type RecallResult,
} from "@vectorize-io/hindsight-client";
import { createMemoryBodyHash } from "../../domain/memory-body";
import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  memoryKnowledgeTopicsDigest,
  type MemoryEntryRef,
  type MemoryKnowledgeKind,
  type MemoryKnowledgeScope,
} from "../../domain/memory-knowledge";
import type {
  MemoryKnowledgeReader,
  MemoryKnowledgeWriter,
  MemoryOperationObserver,
  MemoryProviderEntry,
  MemoryProviderOperation,
  MemoryProviderRecallItem,
  MemoryRequestControls,
} from "../../application/ports/memory-knowledge-provider-port";
import type { MemoryProviderConfig } from "../config/memory-provider-config";
import { hindsightMemoryBankId } from "./hindsight-scope";

type Config = Extract<MemoryProviderConfig, { kind: "hindsight" }>;
type CurrentDocument = Pick<
  DocumentResponse,
  "id" | "bank_id" | "original_text" | "tags" | "document_metadata"
>;
type Delivery = Parameters<MemoryKnowledgeWriter["submit"]>[0];
type NativeFact = {
  readonly id: string;
  readonly document_id?: string | null;
  readonly fact_type?: string | null;
  readonly mentioned_at?: string | null;
  readonly occurred_start?: string | null;
  readonly state?: string;
  readonly metadata?: Record<string, unknown>;
};
type NativeResult<T> = {
  readonly data?: T;
  readonly error?: unknown;
  readonly response?: Response;
};
const strategy = "router-approved-v1";
const factLimit = 100;

/** Native DTOs, bank IDs, strategies and asynchronous operation semantics stop here. */
export class HindsightMemoryProvider
  implements
    MemoryKnowledgeReader,
    MemoryKnowledgeWriter,
    MemoryOperationObserver
{
  private readonly client: Client;
  private readonly sources: HindsightMemoryStore;

  constructor(
    private readonly config: Config,
    options: { readonly fetch?: typeof fetch } = {},
  ) {
    this.sources = new HindsightMemoryStore({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      bankForScope: (key) =>
        hindsightMemoryBankId(config, JSON.parse(key) as MemoryKnowledgeScope),
      exactStatementStrategy: strategy,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.client = createClient(
      createConfig({
        baseUrl: config.baseUrl,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
    );
  }

  private bank(scope: MemoryKnowledgeScope): string {
    return hindsightMemoryBankId(this.config, scope);
  }

  private path(scope: MemoryKnowledgeScope): { bank_id: string } {
    return { bank_id: this.bank(scope) };
  }
  private documentId(ref: MemoryEntryRef): string {
    return `entry-${ref.entryId}`;
  }
  private signal(controls: MemoryRequestControls): AbortSignal {
    const remaining = controls.deadlineAt.getTime() - Date.now();
    if (remaining <= 0 || controls.signal?.aborted)
      throw new MemoryKnowledgeError("deadline_exceeded", true);
    const timeout = AbortSignal.timeout(Math.ceil(remaining));
    return controls.signal
      ? AbortSignal.any([controls.signal, timeout])
      : timeout;
  }

  private async result<T>(
    request: Promise<NativeResult<T>>,
    controls: MemoryRequestControls,
    missing = false,
  ): Promise<Exclude<T, undefined> | null> {
    try {
      const result = await request;
      this.signal(controls);
      if (missing && result.response?.status === 404) return null;
      if (
        !result.response?.ok ||
        result.data === undefined ||
        result.data === null ||
        result.error !== undefined
      ) {
        throw new MemoryKnowledgeError(
          result.response?.status === 404 ? "not_found" : "unavailable",
          true,
        );
      }
      return result.data as Exclude<T, undefined>;
    } catch (error) {
      if (error instanceof MemoryKnowledgeError) throw error;
      // SDK errors can contain response bodies, credentials or source text. Never propagate them.
      throw new MemoryKnowledgeError(
        controls.signal?.aborted || Date.now() >= controls.deadlineAt.getTime()
          ? "deadline_exceeded"
          : "unavailable",
        true,
      );
    }
  }

  private async portable<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof MemoryEngineError)
        throw new MemoryKnowledgeError(
          error.code === "deadline"
            ? "deadline_exceeded"
            : error.code === "incomplete"
              ? "incomplete_evidence"
              : error.code,
          true,
        );
      throw new MemoryKnowledgeError("unavailable", true);
    }
  }
  private async document(
    ref: MemoryEntryRef,
    controls: MemoryRequestControls,
  ): Promise<CurrentDocument | null> {
    const source = await this.portable(
      this.sources.readSource(
        { scope: JSON.stringify(ref.scope), id: this.documentId(ref) },
        controls,
      ),
    );
    return source
      ? {
          id: source.ref.id,
          bank_id: this.bank(ref.scope),
          original_text: source.body,
          tags: [...source.tags],
          document_metadata: { ...source.metadata },
        }
      : null;
  }

  /** Fact enumeration is complete or rejected; a truncated prefix is never evidence. */
  private async facts(
    ref: MemoryEntryRef,
    controls: MemoryRequestControls,
    state: "valid" | "invalidated" = "valid",
  ): Promise<readonly NativeFact[]> {
    const page = await this.result(
      sdk.listMemories({
        client: this.client,
        path: this.path(ref.scope),
        query: {
          document_id: this.documentId(ref),
          state,
          limit: factLimit,
          offset: 0,
        },
        signal: this.signal(controls),
      }),
      controls,
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      !Number.isSafeInteger(page.total) ||
      page.total < 0 ||
      page.total > factLimit ||
      page.items.length !== page.total ||
      page.items.some((fact) => !fact || typeof fact.id !== "string") ||
      new Set(page.items.map((fact) => fact.id)).size !== page.items.length
    )
      throw new MemoryKnowledgeError("incomplete_evidence");
    return page.items.filter(
      (fact) => fact.fact_type === "world" || fact.fact_type === "experience",
    );
  }

  private entry(
    ref: MemoryEntryRef,
    document: CurrentDocument,
    facts: readonly NativeFact[],
  ): MemoryProviderEntry {
    const metadata = document.document_metadata ?? {};
    const body = document.original_text;
    const kind = metadata.rr_kind;
    const revision = metadata.rr_content_revision;
    const statementAt = metadata.rr_statement_at;
    if (
      document.id !== this.documentId(ref) ||
      document.bank_id !== this.bank(ref.scope) ||
      typeof body !== "string" ||
      !body ||
      body.length > 1_000 ||
      metadata.rr_entry_id !== ref.entryId ||
      metadata.rr_profile !== this.config.profileVersion ||
      metadata.rr_scope !==
        memoryKnowledgeDigest(memoryKnowledgeScopeKey(ref.scope)) ||
      typeof revision !== "string" ||
      !/^[1-9]\d*$/.test(revision) ||
      !["rule", "exception", "observation"].includes(String(kind)) ||
      typeof statementAt !== "string" ||
      !Number.isFinite(Date.parse(statementAt)) ||
      createMemoryBodyHash(body) !== metadata.rr_body_digest ||
      facts.length === 0
    )
      throw new MemoryKnowledgeError("incomplete_evidence");
    const time = Date.parse(statementAt);
    if (
      facts.some(
        (fact) =>
          fact.document_id !== document.id ||
          Date.parse(fact.mentioned_at || fact.occurred_start || "") !== time,
      )
    )
      throw new MemoryKnowledgeError("incomplete_evidence");
    if (
      !Array.isArray(document.tags) ||
      document.tags.some((tag) => typeof tag !== "string") ||
      !document.tags.includes("rr:approved") ||
      !document.tags.includes(`kind:${kind}`) ||
      document.tags.filter((tag) => tag.startsWith("kind:")).length !== 1
    )
      throw new MemoryKnowledgeError("incomplete_evidence");
    const topicIds = (document.tags ?? [])
      .filter((tag) => tag.startsWith("topic:"))
      .map((tag) => tag.slice(6))
      .sort();
    if (
      topicIds.length > 20 ||
      topicIds.some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    )
      throw new MemoryKnowledgeError("incomplete_evidence");
    return {
      ref,
      body,
      bodyDigest: createMemoryBodyHash(body),
      contentApprovalRevision: revision,
      kind: kind as MemoryKnowledgeKind,
      topicIds,
      statementAt: new Date(statementAt).toISOString(),
      sourceFactIds: facts.map((fact) => fact.id),
    };
  }

  async read(
    ref: MemoryEntryRef,
    controls: MemoryRequestControls,
  ): Promise<MemoryProviderEntry | null> {
    const document = await this.document(ref, controls);
    if (!document) return null;
    const valid = await this.facts(ref, controls);
    const facts = valid.length
      ? valid
      : await this.facts(ref, controls, "invalidated");
    return this.entry(ref, document, facts);
  }

  async list(
    input: Parameters<MemoryKnowledgeReader["list"]>[0],
    controls: MemoryRequestControls,
  ): ReturnType<MemoryKnowledgeReader["list"]> {
    const offset = input.cursor ? Number(input.cursor) : 0;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new MemoryKnowledgeError("invalid_input");
    const page = await this.portable(
      this.sources.listSources(
        {
          scope: JSON.stringify(input.scope),
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.topicId ? { tags: [`topic:${input.topicId}`] } : {}),
        },
        controls,
      ),
    );
    const entries: MemoryProviderEntry[] = [];
    for (const document of page.sources) {
      if (!document.id.startsWith("entry-")) continue;
      const entry = await this.read(
        { type: "entry", scope: input.scope, entryId: document.id.slice(6) },
        controls,
      );
      if (entry) entries.push(entry);
    }
    return {
      entries,
      nextCursor: page.nextCursor,
    };
  }

  async recall(
    input: Parameters<MemoryKnowledgeReader["recall"]>[0],
    controls: MemoryRequestControls,
  ): ReturnType<MemoryKnowledgeReader["recall"]> {
    const recalled = await this.result(
      sdk.recallMemories({
        client: this.client,
        path: this.path(input.scope),
        body: {
          query: input.query,
          types: input.includeHistoricalObservations
            ? ["world", "experience", "observation"]
            : ["world", "experience"],
          budget: "low",
          max_tokens: 4_000,
          include: {
            source_facts: {
              max_tokens: 6_000,
              max_tokens_per_observation: 2_000,
            },
          },
          tags: ["rr:approved"],
          tags_match: "all",
          trace: false,
        },
        signal: this.signal(controls),
      }),
      controls,
      true,
    );
    if (!recalled) return [];
    const entries = new Map<string, MemoryProviderEntry | null>();
    const results: MemoryProviderRecallItem[] = [];
    const load = async (
      documentId: string,
    ): Promise<MemoryProviderEntry | null> => {
      if (!documentId.startsWith("entry-")) return null;
      if (!entries.has(documentId))
        entries.set(
          documentId,
          await this.read(
            { type: "entry", scope: input.scope, entryId: documentId.slice(6) },
            controls,
          ),
        );
      return entries.get(documentId) ?? null;
    };
    const seen = new Set<string>();
    for (const fact of recalled.results.slice(
      0,
      Math.min(40, input.limit * 3),
    )) {
      if (results.length >= input.limit) break;
      if (fact.type !== "observation") {
        if (!fact.document_id || seen.has(fact.document_id)) continue;
        const entry = await load(fact.document_id);
        if (entry && entry.sourceFactIds.includes(fact.id)) {
          results.push({ type: "entry", entry });
          seen.add(fact.document_id);
        }
        continue;
      }
      if (
        !input.includeHistoricalObservations ||
        !fact.source_fact_ids?.length ||
        fact.source_fact_ids.length > 32 ||
        fact.text.length > 1_000
      )
        continue;
      const sources: MemoryEntryRef[] = [];
      let complete = true;
      for (const id of fact.source_fact_ids) {
        let source: Pick<RecallResult, "id" | "document_id"> | undefined =
          recalled.source_facts?.[id];
        if (!source) {
          const hydrated = await this.result(
            sdk.getMemory({
              client: this.client,
              path: { ...this.path(input.scope), memory_id: id },
              signal: this.signal(controls),
            }),
            controls,
            true,
          );
          if (
            hydrated &&
            typeof hydrated === "object" &&
            "document_id" in hydrated &&
            typeof hydrated.document_id === "string"
          )
            source = { id, document_id: hydrated.document_id };
        }
        const entry = source?.document_id
          ? await load(source.document_id)
          : null;
        if (!entry || !entry.sourceFactIds.includes(id)) {
          complete = false;
          break;
        }
        if (!sources.some((ref) => ref.entryId === entry.ref.entryId))
          sources.push(entry.ref);
      }
      if (complete && sources.length)
        results.push({
          type: "observation",
          ref: {
            type: "observation",
            scope: input.scope,
            observationId: fact.id,
          },
          body: fact.text,
          sourceEntries: sources,
          evidenceComplete: true,
          temporalStatus: "historical",
        });
    }
    return results;
  }

  /** Only a fresh empty bank may be configured. Existing profile drift fails closed. */
  private async ensureBank(
    scope: MemoryKnowledgeScope,
    controls: MemoryRequestControls,
  ): Promise<void> {
    let current = await this.result(
      sdk.getBankConfig({
        client: this.client,
        path: this.path(scope),
        signal: this.signal(controls),
      }),
      controls,
      true,
    );
    if (!current) {
      await this.result(
        sdk.createOrUpdateBank({
          client: this.client,
          path: this.path(scope),
          body: {},
          signal: this.signal(controls),
        }),
        controls,
      );
    }
    if (!current || !this.matchesProfile(current.config)) {
      const documents = await this.result(
        sdk.listDocuments({
          client: this.client,
          path: this.path(scope),
          query: { limit: 1, offset: 0 },
          signal: this.signal(controls),
        }),
        controls,
      );
      if (!documents || documents.total !== 0)
        throw new MemoryKnowledgeError("unsupported");
      current = await this.result(
        sdk.updateBankConfig({
          client: this.client,
          path: this.path(scope),
          body: {
            updates: {
              retain_strategies: {
                [strategy]: { retain_extraction_mode: "chunks" },
              },
              retain_default_strategy: strategy,
              audit_log_enabled: false,
              store_document_text: true,
            },
          },
          signal: this.signal(controls),
        }),
        controls,
      );
    }
    if (!current || !this.matchesProfile(current.config))
      throw new MemoryKnowledgeError("unsupported");
  }

  private matchesProfile(config: Record<string, unknown>): boolean {
    return (
      config.retain_default_strategy === strategy &&
      config.audit_log_enabled === false &&
      config.store_document_text === true &&
      hasHindsightExactChunksStrategy(config, strategy)
    );
  }

  async submit(
    input: Delivery,
    controls: MemoryRequestControls,
  ): Promise<MemoryProviderOperation> {
    const { command } = input;
    if (
      command.generation !== this.config.generation ||
      command.providerProfileVersion !== this.config.profileVersion
    )
      throw new MemoryKnowledgeError("conflict");
    if (command.kind === "forget")
      return { commandId: command.commandId, state: "cleanup_pending" };
    if (command.kind !== "save") return this.applyCuration(input, controls);
    await this.ensureBank(command.ref.scope, controls);
    const sourceTime = Date.parse(
      input.originalStatementAt ?? command.source.statementAt,
    );
    if (!Number.isFinite(sourceTime))
      throw new MemoryKnowledgeError("invalid_input");
    const statementAt = new Date(sourceTime).toISOString();
    await this.portable(
      this.sources.replaceSource(
        {
          operationId: command.commandId,
          statementAt,
          derivationTags: [`kind:${command.knowledgeKind}`],
          source: {
            ref: {
              scope: JSON.stringify(command.ref.scope),
              id: this.documentId(command.ref),
            },
            body: command.body,
            tags: [
              "rr:approved",
              `kind:${command.knowledgeKind}`,
              ...command.topicIds.map((topic) => `topic:${topic}`),
            ],
            metadata: {
              rr_entry_id: command.ref.entryId,
              rr_kind: command.knowledgeKind,
              rr_content_revision: input.contentApprovalRevision,
              rr_body_digest: createMemoryBodyHash(command.body),
              rr_statement_at: statementAt,
              rr_profile: this.config.profileVersion,
              rr_scope: memoryKnowledgeDigest(
                memoryKnowledgeScopeKey(command.ref.scope),
              ),
              rr_command_id: command.commandId,
            },
          },
        },
        controls,
      ),
    );
    return { commandId: command.commandId, state: "submitted" };
  }

  async observe(
    input: Delivery,
    controls: MemoryRequestControls,
  ): Promise<MemoryProviderOperation> {
    const { command } = input;
    if (
      command.generation !== this.config.generation ||
      command.providerProfileVersion !== this.config.profileVersion
    )
      throw new MemoryKnowledgeError("conflict");
    if (command.kind === "forget")
      return { commandId: command.commandId, state: "cleanup_pending" };
    if (command.kind !== "save") return this.applyCuration(input, controls);
    const operation = await this.portable(
      this.sources.operation(
        { scope: JSON.stringify(command.ref.scope), id: command.commandId },
        controls,
      ),
    );
    const status = operation
      ? {
          status: operation.state,
          operation_type: operation.kind,
          child_operations: operation.children.map((child) => ({
            status: child.state,
          })),
        }
      : null;
    if (!status) {
      // Absence after native retention is not proof of non-execution. The app owns the retry window.
      const resubmitUntil = Date.parse(input.resubmitUntil);
      if (input.allowResubmit && Date.now() < resubmitUntil)
        return this.submit(input, controls);
      return {
        commandId: command.commandId,
        state: "unknown",
        safeReason: "unknown_write",
      };
    }
    if (status.status !== "completed")
      return {
        commandId: command.commandId,
        state:
          status.status === "pending" || status.status === "processing"
            ? "processing"
            : "unknown",
        ...(status.status === "failed" || status.status === "cancelled"
          ? { safeReason: "unknown_write" as const }
          : {}),
      };
    if (
      status.operation_type !== "batch_retain" ||
      !Array.isArray(status.child_operations) ||
      status.child_operations.length === 0
    )
      return {
        commandId: command.commandId,
        state: "unknown",
        safeReason: "incomplete_evidence",
      };
    if (
      (status.child_operations?.length ?? 0) > 32 ||
      status.child_operations?.some((child) => child.status !== "completed")
    )
      return { commandId: command.commandId, state: "processing" };
    const entry = await this.read(command.ref, controls);
    const expectedTime = Date.parse(
      input.originalStatementAt ?? command.source.statementAt,
    );
    if (
      !entry ||
      !Number.isFinite(expectedTime) ||
      entry.contentApprovalRevision !== input.contentApprovalRevision ||
      entry.bodyDigest !== createMemoryBodyHash(command.body) ||
      memoryKnowledgeTopicsDigest(entry.topicIds) !==
        memoryKnowledgeTopicsDigest(command.topicIds) ||
      Date.parse(entry.statementAt) !== expectedTime
    )
      return {
        commandId: command.commandId,
        state: "unknown",
        safeReason: "incomplete_evidence",
      };
    return {
      commandId: command.commandId,
      state: "published",
      verifiedEntry: entry,
    };
  }

  private async applyCuration(
    input: Delivery,
    controls: MemoryRequestControls,
  ): Promise<MemoryProviderOperation> {
    const { command } = input;
    if (command.kind === "topics") {
      const before = await this.read(command.ref, controls);
      if (!before) throw new MemoryKnowledgeError("not_found");
      await this.result(
        sdk.updateDocument({
          client: this.client,
          path: {
            ...this.path(command.ref.scope),
            document_id: this.documentId(command.ref),
          },
          body: {
            tags: [
              "rr:approved",
              `kind:${before.kind}`,
              ...command.topicIds.map((topic) => `topic:${topic}`),
            ],
          },
          signal: this.signal(controls),
        }),
        controls,
      );
      const entry = await this.read(command.ref, controls);
      if (
        !entry ||
        entry.contentApprovalRevision !== input.contentApprovalRevision ||
        memoryKnowledgeTopicsDigest(entry.topicIds) !==
          memoryKnowledgeTopicsDigest(command.topicIds)
      )
        throw new MemoryKnowledgeError("incomplete_evidence");
      return {
        commandId: command.commandId,
        state: "published",
        verifiedEntry: entry,
      };
    }
    const document = await this.document(command.ref, controls);
    if (!document) return { commandId: command.commandId, state: "completed" };
    const active = await this.facts(command.ref, controls);
    for (const fact of active)
      await this.result(
        sdk.updateMemory({
          client: this.client,
          path: { ...this.path(command.ref.scope), memory_id: fact.id },
          body: { state: "invalidated", reason: "router_entry_retired" },
          signal: this.signal(controls),
        }),
        controls,
      );
    if ((await this.facts(command.ref, controls)).length !== 0)
      throw new MemoryKnowledgeError("incomplete_evidence");
    return { commandId: command.commandId, state: "completed" };
  }
}
