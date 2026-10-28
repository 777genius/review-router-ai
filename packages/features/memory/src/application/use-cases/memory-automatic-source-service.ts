import type { MemorySourcePreviewPort } from "../ports/memory-source-preview-port";
import { createHash } from "node:crypto";
import {
  normalizeMemoryBody,
  createMemoryBodyHash,
} from "../../domain/memory-body";
import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeCommand,
  type MemoryEntryRef,
} from "../../domain/memory-knowledge";
import type {
  AutomaticMemoryLearningPort,
  MemoryAutomaticSourceCurrentPort,
  MemoryAutomaticSourceInput,
  MemoryAutomaticSourceStore,
  MemoryAutomaticLearningResult,
} from "../ports/memory-automatic-source-port";
import type { MemoryRequestControls } from "../ports/memory-knowledge-provider-port";
import type { MemoryKnowledgeService } from "./memory-knowledge-service";

/** Semantic selection belongs to the native engine; this owner only coordinates authority and exact delivery. */
export class MemoryAutomaticSourceService implements AutomaticMemoryLearningPort {
  constructor(
    private readonly dependencies: {
      readonly preview: MemorySourcePreviewPort;
      readonly current: MemoryAutomaticSourceCurrentPort;
      readonly sources: MemoryAutomaticSourceStore;
      readonly knowledge: MemoryKnowledgeService;
      readonly generation: string;
      readonly providerProfileVersion: string;
      readonly now?: () => Date;
    },
  ) {}
  private now() {
    return this.dependencies.now?.() ?? new Date();
  }
  async learn(
    input: MemoryAutomaticSourceInput,
    controls: MemoryRequestControls,
  ): Promise<MemoryAutomaticLearningResult> {
    const cohortId = memoryKnowledgeDigest([
      "automatic-cohort",
      input.processingId,
    ]);
    const outcome = (
      state: MemoryAutomaticLearningResult["state"],
      entryIds: readonly string[] = [],
      operations: MemoryAutomaticLearningResult["operations"] = [],
    ): MemoryAutomaticLearningResult => ({
      state,
      cohortId,
      entryIds,
      operations,
    });
    memoryKnowledgeScopeKey(input.scope);
    if (
      input.source.type !== "github_comment" ||
      input.source.repositoryId !== input.scope.repositoryId ||
      input.sourceActor.kind !== "github_user" ||
      !input.policyRevision ||
      !input.processingId ||
      !input.threadDigest ||
      !input.selectableBody ||
      input.source.observedCommitSha !== input.headSha ||
      !/^[0-9a-f]{40,64}$/i.test(input.headSha) ||
      createHash("sha256")
        .update(input.selectableBody, "utf8")
        .digest("hex") !== input.source.claimedBodyDigest
    )
      throw new MemoryKnowledgeError("invalid_input");
    const prior = await this.dependencies.sources.lookup(
      input.scope,
      input.source.sourceId,
    );
    if (prior?.suppressed) return outcome("suppressed", prior.entryIds);
    // Replay never consumes another native inference, even after delivery envelopes were purged.
    if (prior?.binding.cohortId === cohortId)
      return outcome(
        prior.state === "active"
          ? "active"
          : prior.state === "needs_refresh"
            ? "needs_refresh"
            : "queued",
        prior.entryIds,
      );
    if (prior && prior.source.revision !== input.source.revision)
      await this.revoke(
        {
          scope: input.scope,
          sourceId: input.source.sourceId,
          cause: "changed",
        },
        controls,
      );
    const expectedPrior = await this.dependencies.sources.lookup(
      input.scope,
      input.source.sourceId,
    );
    if (expectedPrior?.suppressed)
      return outcome("suppressed", expectedPrior.entryIds);
    await this.dependencies.knowledge.authorizeAutomaticSource(
      input.sourceActor,
      input.scope,
      controls,
    );
    const current = () =>
      this.dependencies.current.current(
        {
          scope: input.scope,
          source: input.source,
          binding: {
            policyRevision: input.policyRevision,
            sourceActorId: input.sourceActor.id,
            observedCommitSha: input.headSha,
          },
        },
        controls,
      );
    if (!(await current())) return outcome("needs_refresh");
    const selected = await this.dependencies.preview.preview(
      {
        scope: memoryKnowledgeScopeKey(input.scope),
        source: {
          id: input.source.sourceId,
          revision: input.source.revision,
          body: input.selectableBody,
        },
        readOnlyContext: input.readOnlyContext,
        maxStatements: 4,
      },
      controls,
    );
    if (selected.status !== "complete")
      return outcome(
        selected.status === "unsupported" ? "unavailable" : "needs_refresh",
      );
    if (
      selected.source.id !== input.source.sourceId ||
      selected.source.revision !== input.source.revision ||
      selected.statements.length > 4 ||
      selected.statements.some(
        (s) =>
          !s.body.trim() ||
          s.body.length > 1000 ||
          s.body !== normalizeMemoryBody(s.body),
      )
    )
      return outcome("needs_refresh");
    if (!(await current())) return outcome("needs_refresh");
    const ids = selected.statements.map(
      (_, i) =>
        `auto_${memoryKnowledgeDigest([input.processingId, i]).slice(0, 48)}`,
    );
    const reserved = await this.dependencies.sources.reserve({
      input,
      generation: this.dependencies.generation,
      expectedPriorEpoch: expectedPrior?.binding.epoch ?? null,
      entryIds: ids,
      bodyDigests: selected.statements.map((s) => createMemoryBodyHash(s.body)),
      now: this.now(),
    });
    if (reserved.suppressed) return outcome("suppressed");
    const approval = {
      actor: input.sourceActor,
      approvedAt: this.now().toISOString(),
      authorityRevision: `automatic:${input.policyRevision}`,
    };
    const operations = [];
    // Withdrawn old children use the existing CAS/retire owner. Ownership transfer wins a race.
    if (prior)
      for (const entryId of prior.entryIds) {
        const ref: MemoryEntryRef = {
          type: "entry",
          scope: input.scope,
          entryId,
        };
        const entry = await this.dependencies.knowledge.metadata(ref);
        if (
          !entry?.automaticSource ||
          entry.automaticSource.cohortId !== prior.binding.cohortId
        )
          continue;
        try {
          await this.dependencies.knowledge.retireAutomatic(
            {
              kind: "retire",
              commandId: childUuid(input.processingId, entryId),
              ref,
              expectedRevision: entry.revision,
              generation: this.dependencies.generation,
              providerProfileVersion: this.dependencies.providerProfileVersion,
              approval,
            },
            prior.binding,
            controls,
          );
        } catch (error) {
          if (
            !(error instanceof MemoryKnowledgeError) ||
            error.code !== "conflict"
          )
            throw error;
        }
      }
    for (const [index, statement] of selected.statements.entries()) {
      const ref: MemoryEntryRef = {
        type: "entry",
        scope: input.scope,
        entryId: ids[index]!,
      };
      const command: Extract<MemoryKnowledgeCommand, { kind: "save" }> = {
        kind: "save",
        commandId: childUuid(input.processingId, index),
        ref,
        expectedRevision: null,
        generation: this.dependencies.generation,
        providerProfileVersion: this.dependencies.providerProfileVersion,
        approval,
        body: statement.body,
        knowledgeKind: "observation",
        topicIds: [],
        source: input.source,
        applicability: {
          validUntil: null,
          observedCommitSha: input.headSha,
          exceptionRule: null,
        },
        temporalMode: "preserve_original",
      };
      operations.push(
        await this.dependencies.knowledge.saveAutomatic(
          command,
          reserved.binding,
          controls,
        ),
      );
    }
    return outcome(ids.length ? "queued" : "active", ids, operations);
  }
  async revoke(
    input: Parameters<AutomaticMemoryLearningPort["revoke"]>[0],
    controls: MemoryRequestControls,
  ): Promise<void> {
    if (controls.signal?.aborted || this.now() >= controls.deadlineAt)
      throw new MemoryKnowledgeError("deadline_exceeded");
    await this.dependencies.sources.invalidate({ ...input, now: this.now() });
  }
}
function childUuid(processingId: string, index: number | string): string {
  const hex = memoryKnowledgeDigest(["automatic-command", processingId, index]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
