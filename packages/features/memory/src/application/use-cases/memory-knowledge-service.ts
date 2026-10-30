import type {
  MemoryAutomaticSourceStore,
  MemoryAutomaticSourceCurrentPort,
  MemoryAutomaticLearningResult,
} from "../ports/memory-automatic-source-port";
import { randomUUID } from "node:crypto";
import type { MemoryActor } from "../../domain/memory-actor";
import { createMemoryBodyHash } from "../../domain/memory-body";
import { evaluateMemorySafety } from "../../domain/memory-safety-policy";
import {
  MemoryKnowledgeError,
  automaticMemoryCohortId,
  memoryKnowledgeBodyMatches,
  memoryKnowledgeBodyVisible,
  memoryKnowledgeCommandDigest,
  memoryKnowledgeDigest,
  memoryKnowledgeTopicsDigest,
  normalizeMemoryKnowledgeCommand,
  sameMemoryKnowledgeScope,
  type MemoryEntryRef,
  type MemoryAutomaticSourceBinding,
  type MemoryKnowledgeCommand,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeOperation,
  type MemoryKnowledgeScope,
} from "../../domain/memory-knowledge";
import type { MemoryKnowledgeAccessPort } from "../ports/memory-knowledge-access-port";
import type {
  MemoryKnowledgeReader,
  MemoryKnowledgeWriter,
  MemoryOperationObserver,
  MemoryProviderEntry,
  MemoryProviderRecallItem,
  MemoryRequestControls,
} from "../ports/memory-knowledge-provider-port";
import type {
  MemoryKnowledgeStore,
  MemoryVerifiedCleanupReceipt,
} from "../ports/memory-knowledge-store-port";
import type {
  MemoryPolicyConfig,
  MemoryPolicyConfigPort,
} from "../ports/memory-policy-config-port";
import type { MemoryQuotaPolicyPort } from "../ports/memory-quota-policy-port";

function assertAutomaticMutationPolicy(
  policy: Pick<MemoryPolicyConfig, "requireConfirmation" | "settingsRevision">,
  settingsRevision: string,
): void {
  if (
    typeof settingsRevision !== "string" ||
    !/^(0|[1-9]\d{0,9})$/.test(settingsRevision)
  )
    throw new MemoryKnowledgeError("invalid_input");
  if (policy.requireConfirmation)
    throw new MemoryKnowledgeError("input_required");
  if (policy.settingsRevision !== settingsRevision)
    throw new MemoryKnowledgeError("conflict");
}

export type MemoryKnowledgeView = {
  readonly metadata: MemoryKnowledgeEntryMetadata;
  readonly body: string | null;
  readonly topicIds: readonly string[];
  readonly unavailableReason:
    | "unsettled"
    | "provider_unavailable"
    | "incomplete_evidence"
    | null;
};
export type MemoryKnowledgeBundleItem =
  | (Extract<MemoryProviderRecallItem, { readonly type: "entry" }> & {
      readonly metadata: MemoryKnowledgeEntryMetadata;
    })
  | (Extract<MemoryProviderRecallItem, { readonly type: "observation" }> & {
      readonly sourceMetadata: readonly MemoryKnowledgeEntryMetadata[];
    });

export type MemoryContextPolicy = {
  readonly audience: "internal" | "public" | "repository";
  readonly repositoryId: string;
  readonly allowedTasks: readonly (
    | "review"
    | "investigation"
    | "pr_description"
    | "conversation"
  )[];
};

export type MemoryKnowledgeBundleInput = {
  readonly contextPolicy?: MemoryContextPolicy;
  readonly actor: MemoryActor;
  readonly scopes: readonly MemoryKnowledgeScope[];
  readonly query: string;
  readonly limitPerScope?: number;
};

export type MemoryKnowledgeBundle = {
  readonly contextPolicy?: MemoryContextPolicy;
  readonly generation: string;
  readonly scopes: readonly {
    readonly scope: MemoryKnowledgeScope;
    readonly epoch: string;
    readonly items: readonly MemoryKnowledgeBundleItem[];
  }[];
  readonly hash: string;
  readonly expiresAt: string;
  readonly degraded: boolean;
};
export type MemoryKnowledgeAdmissionReceipt = {
  readonly contextPolicy?: MemoryContextPolicy;
  readonly generation: string;
  readonly bundleHash: string;
  readonly scopes: readonly {
    readonly scope: MemoryKnowledgeScope;
    readonly epoch: string;
    readonly entries: readonly {
      readonly ref: MemoryEntryRef;
      readonly revision: string;
      readonly contentApprovalRevision: string;
      readonly automaticSource?: MemoryAutomaticSourceBinding;
    }[];
  }[];
  readonly expiresAt: string;
};
export type MemoryCoreExport = {
  readonly format: "memory-core-export/v1";
  readonly historyFidelity: "metadata_only";
  readonly generatedAt: string;
  readonly entries: readonly {
    readonly metadata: MemoryKnowledgeEntryMetadata;
    readonly body: string;
    readonly topicIds: readonly string[];
  }[];
  readonly omitted: readonly {
    readonly entryId: string;
    readonly reason: string;
  }[];
  readonly nextCursor: string | null;
};

export class MemoryKnowledgeService {
  constructor(
    private readonly dependencies: {
      readonly generation: string;
      readonly providerProfileVersion: string;
      readonly store: MemoryKnowledgeStore;
      readonly reader: MemoryKnowledgeReader;
      readonly writer: MemoryKnowledgeWriter;
      readonly observer: MemoryOperationObserver;
      readonly access: MemoryKnowledgeAccessPort;
      readonly policy: MemoryPolicyConfigPort;
      readonly quota: MemoryQuotaPolicyPort;
      readonly automaticSources?: {
        readonly store: MemoryAutomaticSourceStore;
        readonly current: MemoryAutomaticSourceCurrentPort;
      };
      readonly now?: () => Date;
      readonly deliveryRetentionMs?: number;
      /** Enable only within a qualified native operation-UUID retention/no-prune profile. */
      readonly resubmitWindowMs?: number;
    },
  ) {}

  async save(
    command: Extract<MemoryKnowledgeCommand, { readonly kind: "save" }>,
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeOperation> {
    return this.mutate(command, controls);
  }
  async retire(
    command: MemoryKnowledgeCommand & { readonly kind: "retire" | "expire" },
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeOperation> {
    return this.mutate(command, controls);
  }
  async forget(
    command: MemoryKnowledgeCommand & { readonly kind: "forget" },
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeOperation> {
    return this.mutate(command, controls);
  }
  async setTopics(
    command: Extract<MemoryKnowledgeCommand, { readonly kind: "topics" }>,
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeOperation> {
    return this.mutate(command, controls);
  }

  async authorizeAutomaticSource(
    actor: MemoryActor,
    scope: MemoryKnowledgeScope,
    controls: MemoryRequestControls,
  ): Promise<void> {
    await this.dependencies.access.authorize(
      { actor, scope, action: "manage" },
      controls,
    );
    const policy = await this.dependencies.policy.getPolicy({
      workspaceId: scope.workspaceId,
      repositoryId: scope.kind === "repository" ? scope.repositoryId : null,
    });
    if (
      !policy.memoryEnabled ||
      !policy.automaticLearning ||
      scope.kind !== "repository"
    )
      throw new MemoryKnowledgeError("disabled");
  }
  /** Explicit maintainer transition; ordinary edits/replays never clear a source suppression. */
  async relearnAutomatic(
    input: {
      readonly actor: MemoryActor;
      readonly ref: MemoryEntryRef;
      readonly expectedRevision: string;
      readonly automaticSettingsRevision?: string;
    },
    controls: MemoryRequestControls,
  ): Promise<void> {
    await this.authorizeAutomaticSource(input.actor, input.ref.scope, controls);
    if (input.automaticSettingsRevision !== undefined)
      assertAutomaticMutationPolicy(
        await this.dependencies.policy.getPolicy({
          workspaceId: input.ref.scope.workspaceId,
          repositoryId:
            input.ref.scope.kind === "repository"
              ? input.ref.scope.repositoryId
              : null,
        }),
        input.automaticSettingsRevision,
      );
    const metadata = await this.dependencies.store.findEntry(
      input.ref,
      this.dependencies.generation,
    );
    const automatic = this.dependencies.automaticSources;
    if (
      !metadata?.automaticSource ||
      !automatic ||
      metadata.revision !== input.expectedRevision
    )
      throw new MemoryKnowledgeError("conflict");
    const state = await automatic.store.lookupLineage(
      input.ref.scope,
      metadata.automaticSource.lineageKey,
    );
    if (!state) throw new MemoryKnowledgeError("not_found");
    await automatic.store.clearSuppression({
      scope: input.ref.scope,
      sourceId: state.sourceId,
      expectedEpoch: state.binding.epoch,
      expectedSuppressionEpoch: state.suppressionEpoch ?? "0",
      ...(input.automaticSettingsRevision === undefined
        ? {}
        : { automaticSettingsRevision: input.automaticSettingsRevision }),
      entry: {
        ref: input.ref,
        generation: this.dependencies.generation,
        expectedRevision: input.expectedRevision,
      },
      now: this.now(),
    });
  }

  /** Trusted application seam: standing policy is not a forged per-fact human approval. */
  async saveAutomatic(
    command: Extract<MemoryKnowledgeCommand, { readonly kind: "save" }>,
    binding: MemoryAutomaticSourceBinding,
    controls: MemoryRequestControls,
  ) {
    if (
      command.knowledgeKind !== "observation" ||
      command.ref.scope.kind !== "repository"
    )
      throw new MemoryKnowledgeError("forbidden");
    return this.mutate(command, controls, { automaticSource: binding });
  }
  /** Prevalidate every frozen child before the owning store commits the cohort and all effects. */
  async admitAutomaticSelection(
    input: {
      readonly reservation: Parameters<
        MemoryKnowledgeStore["admitAutomaticSelection"]
      >[0]["reservation"];
      readonly children: readonly Extract<
        MemoryKnowledgeCommand,
        { kind: "save" }
      >[];
      readonly retirements: readonly {
        readonly command: MemoryKnowledgeCommand & { kind: "retire" };
        readonly binding: MemoryAutomaticSourceBinding;
      }[];
    },
    controls: MemoryRequestControls,
  ) {
    assertAutomaticMutationPolicy(
      await this.dependencies.policy.getPolicy({
        workspaceId: input.reservation.input.scope.workspaceId,
        repositoryId: input.reservation.input.scope.repositoryId,
      }),
      input.reservation.input.settingsRevision ?? "0",
    );
    const children = [];
    for (const command of input.children) {
      if (
        command.knowledgeKind !== "observation" ||
        command.ref.scope.kind !== "repository"
      )
        throw new MemoryKnowledgeError("forbidden");
      children.push(await this.prepareMutation(command, controls));
    }
    const retirements = [];
    for (const item of input.retirements)
      retirements.push(
        await this.prepareMutation(item.command, controls, {
          internalRetirement: item.binding,
        }),
      );
    this.check(controls);
    return this.dependencies.store.admitAutomaticSelection({
      reservation: input.reservation,
      children,
      retirements,
    });
  }
  async retireAutomatic(
    command: MemoryKnowledgeCommand & { readonly kind: "retire" },
    binding: MemoryAutomaticSourceBinding,
    controls: MemoryRequestControls,
  ) {
    return this.mutate(command, controls, { internalRetirement: binding });
  }
  async metadata(ref: MemoryEntryRef) {
    return this.dependencies.store.findEntry(ref, this.dependencies.generation);
  }

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

  private async mutate(
    input: MemoryKnowledgeCommand,
    controls: MemoryRequestControls,
    authority: {
      readonly automaticSource?: MemoryAutomaticSourceBinding;
      readonly internalRetirement?: MemoryAutomaticSourceBinding;
    } = {},
  ): Promise<MemoryKnowledgeOperation> {
    return this.dependencies.store.admit(
      await this.prepareMutation(input, controls, authority),
    );
  }

  private async prepareMutation(
    input: MemoryKnowledgeCommand,
    controls: MemoryRequestControls,
    authority: {
      readonly automaticSource?: MemoryAutomaticSourceBinding;
      readonly internalRetirement?: MemoryAutomaticSourceBinding;
    } = {},
  ): Promise<Parameters<MemoryKnowledgeStore["admit"]>[0]> {
    this.check(controls);
    let command = normalizeMemoryKnowledgeCommand(input);
    if (
      command.generation !== this.dependencies.generation ||
      command.providerProfileVersion !==
        this.dependencies.providerProfileVersion
    )
      throw new MemoryKnowledgeError("conflict");
    await this.dependencies.access.authorize(
      {
        actor: command.approval.actor,
        scope: command.ref.scope,
        action: "manage",
      },
      controls,
    );
    const policy = await this.dependencies.policy.getPolicy({
      workspaceId: command.ref.scope.workspaceId,
      repositoryId:
        command.ref.scope.kind === "repository"
          ? command.ref.scope.repositoryId
          : null,
    });
    if (
      command.approval.automaticSettingsRevision !== undefined &&
      !authority.internalRetirement
    )
      assertAutomaticMutationPolicy(
        policy,
        command.approval.automaticSettingsRevision,
      );
    if (command.kind === "save" || command.kind === "topics") {
      const scopeKey =
        command.ref.scope.kind === "user_preference"
          ? "user_prefs"
          : command.ref.scope.kind;
      if (!policy.memoryEnabled || !policy.allowedScopes[scopeKey])
        throw new MemoryKnowledgeError("disabled");
    }
    if (command.kind === "save") {
      const safety = evaluateMemorySafety({
        body: command.body,
        scope:
          command.ref.scope.kind === "user_preference"
            ? "user_prefs"
            : command.ref.scope.kind,
      });
      if (safety.severity !== "safe")
        throw new MemoryKnowledgeError("invalid_input");
      const source = await this.dependencies.access.verifySource(
        {
          actor: command.approval.actor,
          scope: command.ref.scope,
          source: command.source,
        },
        controls,
      );
      if (
        source.repositoryId &&
        command.ref.scope.kind === "repository" &&
        source.repositoryId !== command.ref.scope.repositoryId
      )
        throw new MemoryKnowledgeError("forbidden");
      command = normalizeMemoryKnowledgeCommand({ ...command, source });
      if (command.kind === "save" && command.applicability.exceptionRule) {
        const target = command.applicability.exceptionRule;
        if (
          command.ref.scope.kind !== "repository" ||
          target.scope.kind !== "workspace" ||
          target.scope.workspaceId !== command.ref.scope.workspaceId
        )
          throw new MemoryKnowledgeError("forbidden");
        await this.dependencies.access.authorize(
          {
            actor: command.approval.actor,
            scope: target.scope,
            action: "read",
          },
          controls,
        );
        const rule = await this.dependencies.store.findEntry(
          target,
          this.dependencies.generation,
        );
        if (
          !rule ||
          rule.kind !== "rule" ||
          !memoryKnowledgeBodyVisible(rule, "runtime", this.now()) ||
          !rule.source ||
          !(await this.dependencies.access.sourceApplicable(
            {
              actor: command.approval.actor,
              scope: target.scope,
              source: rule.source,
              consumer: "runtime",
            },
            controls,
          ))
        )
          throw new MemoryKnowledgeError("conflict");
      }
    }
    const quota = await this.dependencies.quota.getWorkspaceQuota({
      workspaceId: command.ref.scope.workspaceId,
    });
    this.check(controls);
    const now = this.now();
    const retentionMs = this.dependencies.deliveryRetentionMs ?? 7 * 86_400_000;
    const retryMs = this.dependencies.resubmitWindowMs ?? 0;
    if (retryMs < 0 || retryMs > retentionMs)
      throw new MemoryKnowledgeError("invalid_input");
    return {
      ...authority,
      command,
      digest: memoryKnowledgeCommandDigest(command),
      now,
      deliveryExpiresAt: new Date(now.getTime() + retentionMs),
      resubmitUntil: new Date(now.getTime() + retryMs),
      activeEntryLimit: quota.activeItems.limit,
      pendingCommandLimit: 100,
    };
  }

  /** Bodyless progress for an accepted selection; reconciles lifecycle without extraction or delivery. */
  async automaticOperations(
    input: {
      readonly actor: MemoryActor;
      readonly scope: MemoryKnowledgeScope;
      readonly sourceId: string;
      readonly processingId: string;
    },
    controls: MemoryRequestControls,
  ): Promise<MemoryAutomaticLearningResult | null> {
    this.check(controls);
    await this.dependencies.access.authorize(
      { actor: input.actor, scope: input.scope, action: "read" },
      controls,
    );
    const operations = await this.dependencies.store.findAutomaticOperations({
      scope: input.scope,
      generation: this.dependencies.generation,
      sourceId: input.sourceId,
      processingId: input.processingId,
    });
    const cohortId = automaticMemoryCohortId(input.processingId);
    const sources = this.dependencies.automaticSources?.store;
    let source = await sources?.lookup(input.scope, input.sourceId);
    const uncertainDelivery = operations.some(
      (operation) =>
        operation.state === "unknown" ||
        operation.state === "failed" ||
        operation.state === "cleanup_pending" ||
        operation.safeReason === "input_required",
    );
    if (
      sources &&
      source?.state === "pending" &&
      source.binding.cohortId === cohortId
    ) {
      const missingChildren = operations.length !== source.entryIds.length;
      if (missingChildren || uncertainDelivery) {
        await sources.invalidate({
          scope: input.scope,
          sourceId: input.sourceId,
          cause: missingChildren ? "unavailable" : "delivery_uncertain",
          expectedBinding: source.binding,
          now: this.now(),
        });
        // A concurrent verified completion or supersession wins the conditional transition.
        source = await sources.lookup(input.scope, input.sourceId);
      }
    }
    const current =
      source &&
      source.state !== "unselected" &&
      source.binding.cohortId === cohortId
        ? source
        : null;
    if (!current && !operations.length) return null;
    return {
      cohortId,
      entryIds:
        current?.entryIds ??
        operations.map((operation) => operation.ref.entryId),
      operations,
      state: !current
        ? "needs_refresh"
        : current.suppressed
          ? "suppressed"
          : current.state === "active" || current.state === "needs_refresh"
            ? current.state
            : uncertainDelivery || operations.length !== current.entryIds.length
              ? "needs_refresh"
              : "queued",
    };
  }

  async progress(
    input: {
      readonly actor: MemoryActor;
      readonly scope: MemoryKnowledgeScope;
      readonly commandId: string;
    },
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeOperation> {
    this.check(controls);
    await this.dependencies.access.authorize(
      { actor: input.actor, scope: input.scope, action: "read" },
      controls,
    );
    const command = await this.dependencies.store.findCommand({
      commandId: input.commandId,
      scope: input.scope,
      generation: this.dependencies.generation,
    });
    if (!command) throw new MemoryKnowledgeError("not_found");
    return command.operation;
  }

  /** Worker entrypoint. Outbox retries retain one UUID and observe uncertain execution. */
  async deliver(
    input: { readonly scope: MemoryKnowledgeScope; readonly commandId: string },
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeOperation | null> {
    this.check(controls);
    const now = this.now();
    const claim = await this.dependencies.store.claim({
      ...input,
      generation: this.dependencies.generation,
      now,
      claimId: randomUUID(),
      claimUntil: new Date(controls.deadlineAt.getTime() + 5_000),
    });
    if (!claim) return null;
    const command = claim.command.envelope;
    if (!command) throw new MemoryKnowledgeError("input_required");
    const metadata = await this.dependencies.store.findEntry(
      command.ref,
      this.dependencies.generation,
    );
    const revoked = Boolean(
      metadata?.revocationCommandId &&
      metadata.revocationCommandId !== command.commandId,
    );
    const context = {
      command,
      revision: claim.command.operation.revision,
      contentApprovalRevision: claim.command.contentApprovalRevision,
      originalStatementAt: claim.command.originalStatementAt,
      allowResubmit:
        !revoked &&
        this.now().getTime() < Date.parse(claim.command.resubmitUntil),
      resubmitUntil: claim.command.resubmitUntil,
    };
    try {
      const delivery = await this.dependencies.store.withDeliveryPermit(
        {
          ...input,
          generation: this.dependencies.generation,
          claimId: claim.claimId,
          now: this.now(),
          deadlineAt: controls.deadlineAt,
        },
        async (permit) => {
          this.check(controls);
          if (claim.mode === "submit" && permit.revoked)
            return {
              commandId: command.commandId,
              state: "failed" as const,
              executionSettled: true,
              safeReason: "conflict" as const,
            };
          const admitted = {
            ...context,
            allowResubmit: context.allowResubmit && !permit.revoked,
          };
          return claim.mode === "submit"
            ? this.dependencies.writer.submit(admitted, controls)
            : this.dependencies.observer.observe(admitted, controls);
        },
      );
      if (!delivery.permitted) return null;
      const result = delivery.value;
      if (result.commandId !== input.commandId)
        throw new MemoryKnowledgeError("unknown_write", true);
      return await this.dependencies.store.settle({
        ...input,
        generation: this.dependencies.generation,
        claimId: claim.claimId,
        result,
        now: this.now(),
      });
    } catch (error) {
      const safeReason =
        error instanceof MemoryKnowledgeError ? error.code : "unknown_write";
      await this.dependencies.store.recordFailure({
        ...input,
        generation: this.dependencies.generation,
        claimId: claim.claimId,
        safeReason,
        now: this.now(),
      });
      throw new MemoryKnowledgeError(safeReason, true);
    }
  }

  async expireDeliveryEnvelopes(limit = 100): Promise<number> {
    return this.dependencies.store.expireDeliveryEnvelopes({
      now: this.now(),
      limit: Math.min(1_000, Math.max(1, limit)),
    });
  }

  /** Trusted worker path: due-time and expected revision are checked again in admission. */
  async expireDueEntries(limit = 100): Promise<number> {
    const now = this.now();
    const entries = await this.dependencies.store.listExpiredEntries({
      generation: this.dependencies.generation,
      now,
      limit: Math.min(1000, Math.max(1, limit)),
    });
    let expired = 0;
    for (const metadata of entries) {
      const validUntil = metadata.applicability.validUntil;
      if (
        !validUntil ||
        metadata.lifecycle !== "active" ||
        Date.parse(validUntil) > now.getTime()
      )
        continue;
      const hash = memoryKnowledgeDigest({
        generation: this.dependencies.generation,
        ref: metadata.ref,
        revision: metadata.revision,
        validUntil,
        operation: "expire",
      });
      const commandId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const command = normalizeMemoryKnowledgeCommand({
        kind: "expire",
        commandId,
        ref: metadata.ref,
        expectedRevision: metadata.revision,
        generation: this.dependencies.generation,
        providerProfileVersion: this.dependencies.providerProfileVersion,
        approval: {
          actor: {
            kind: "system",
            id: "memory-expiry-worker",
            githubUserId: null,
            login: null,
          },
          approvedAt: new Date(validUntil).toISOString(),
          authorityRevision: `automatic-expiry:${metadata.revision}`,
        },
      });
      try {
        await this.dependencies.store.admit({
          command,
          digest: memoryKnowledgeCommandDigest(command),
          now,
          deliveryExpiresAt: new Date(
            now.getTime() +
              (this.dependencies.deliveryRetentionMs ?? 7 * 86_400_000),
          ),
          resubmitUntil: now,
          activeEntryLimit: null,
          pendingCommandLimit: 100,
        });
        expired++;
      } catch (error) {
        if (
          !(error instanceof MemoryKnowledgeError) ||
          !["conflict", "not_found"].includes(error.code)
        )
          throw error;
      }
    }
    return expired;
  }

  async scheduleDueDeliveries(limit = 100): Promise<number> {
    return this.dependencies.store.scheduleDueDeliveries({
      generation: this.dependencies.generation,
      now: this.now(),
      limit: Math.min(1000, Math.max(1, limit)),
    });
  }

  /** Trusted host operator methods. Customer principals cannot create this grant. */
  maintenanceState() {
    return this.dependencies.store.maintenanceState(
      this.dependencies.generation,
    );
  }

  async setMaintenancePaused(
    input: {
      readonly paused: boolean;
      readonly expectedEpoch: string;
      readonly actor: string;
    },
    controls: MemoryRequestControls,
  ) {
    this.check(controls);
    return this.dependencies.store.setMaintenancePaused({
      ...input,
      generation: this.dependencies.generation,
      now: this.now(),
      deadlineAt: controls.deadlineAt,
    });
  }

  /** Host operator integration only; receipt verification is a prerequisite. */
  async settleCleanup(
    receipt: MemoryVerifiedCleanupReceipt,
  ): Promise<MemoryKnowledgeOperation> {
    if (receipt.generation !== this.dependencies.generation)
      throw new MemoryKnowledgeError("conflict");
    return this.dependencies.store.completeCleanup({
      receipt,
      now: this.now(),
    });
  }

  async read(
    input: { readonly actor: MemoryActor; readonly ref: MemoryEntryRef },
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeView> {
    this.check(controls);
    await this.dependencies.access.authorize(
      { actor: input.actor, scope: input.ref.scope, action: "read" },
      controls,
    );
    const epoch = await this.dependencies.store.scopeEpoch(
      input.ref.scope,
      this.dependencies.generation,
    );
    const metadata = await this.dependencies.store.findEntry(
      input.ref,
      this.dependencies.generation,
    );
    if (!metadata) throw new MemoryKnowledgeError("not_found");
    const view = await this.view(metadata, input.actor, "management", controls);
    await this.recheck(input.ref.scope, epoch, controls);
    return view;
  }

  async list(
    input: {
      readonly actor: MemoryActor;
      readonly scope: MemoryKnowledgeScope;
      readonly limit?: number;
      readonly cursor?: string;
      /** Current provider topic membership; pending unpublished entries remain in the unfiltered list. */
      readonly topicId?: string;
    },
    controls: MemoryRequestControls,
  ): Promise<{
    readonly entries: readonly MemoryKnowledgeView[];
    readonly nextCursor: string | null;
  }> {
    this.check(controls);
    if (
      input.topicId !== undefined &&
      !/^[a-zA-Z0-9_-]{1,100}$/.test(input.topicId)
    )
      throw new MemoryKnowledgeError("invalid_input");
    await this.dependencies.access.authorize(
      { actor: input.actor, scope: input.scope, action: "read" },
      controls,
    );
    const epoch = await this.dependencies.store.scopeEpoch(
      input.scope,
      this.dependencies.generation,
    );
    if (input.topicId !== undefined) {
      const page = await this.dependencies.reader.list(
        {
          scope: input.scope,
          limit: Math.min(100, Math.max(1, input.limit ?? 30)),
          ...(input.cursor ? { cursor: input.cursor } : {}),
          topicId: input.topicId,
        },
        controls,
      );
      const entries: MemoryKnowledgeView[] = [];
      for (const candidate of page.entries) {
        if (!sameMemoryKnowledgeScope(candidate.ref.scope, input.scope))
          throw new MemoryKnowledgeError("incomplete_evidence");
        const metadata = await this.dependencies.store.findEntry(
          candidate.ref,
          this.dependencies.generation,
        );
        if (!metadata) continue;
        const view = await this.view(
          metadata,
          input.actor,
          "management",
          controls,
        );
        if (view.body !== null && view.topicIds.includes(input.topicId))
          entries.push(view);
      }
      await this.recheck(input.scope, epoch, controls);
      return { entries, nextCursor: page.nextCursor };
    }
    const page = await this.dependencies.store.listEntries({
      ...input,
      generation: this.dependencies.generation,
      limit: Math.min(100, Math.max(1, input.limit ?? 30)),
    });
    const entries: MemoryKnowledgeView[] = [];
    for (const metadata of page.entries)
      entries.push(
        await this.view(metadata, input.actor, "management", controls),
      );
    await this.recheck(input.scope, epoch, controls);
    return { entries, nextCursor: page.nextCursor };
  }

  async export(
    input: {
      readonly actor: MemoryActor;
      readonly scope: MemoryKnowledgeScope;
      readonly limit?: number;
      readonly cursor?: string;
    },
    controls: MemoryRequestControls,
  ): Promise<MemoryCoreExport> {
    this.check(controls);
    await this.dependencies.access.authorize(
      { actor: input.actor, scope: input.scope, action: "export" },
      controls,
    );
    const epoch = await this.dependencies.store.scopeEpoch(
      input.scope,
      this.dependencies.generation,
    );
    const page = await this.dependencies.store.listEntries({
      ...input,
      generation: this.dependencies.generation,
      limit: Math.min(1_000, Math.max(1, input.limit ?? 100)),
    });
    const entries: MemoryCoreExport["entries"][number][] = [];
    const omitted: { entryId: string; reason: string }[] = [];
    for (const metadata of page.entries) {
      const view = await this.view(metadata, input.actor, "export", controls);
      if (view.body !== null)
        entries.push({ metadata, body: view.body, topicIds: view.topicIds });
      else
        omitted.push({
          entryId: metadata.ref.entryId,
          reason: view.unavailableReason ?? "ineligible",
        });
    }
    await this.recheck(input.scope, epoch, controls);
    return {
      format: "memory-core-export/v1",
      historyFidelity: "metadata_only",
      generatedAt: this.now().toISOString(),
      entries,
      omitted,
      nextCursor: page.nextCursor,
    };
  }

  async bundle(
    input: MemoryKnowledgeBundleInput,
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeBundle> {
    const remaining = Math.min(
      2000,
      controls.deadlineAt.getTime() - this.now().getTime(),
    );
    const empty = (): MemoryKnowledgeBundle => {
      const snapshot = {
        generation: this.dependencies.generation,
        scopes: [],
        expiresAt: new Date(this.now().getTime() + 30000).toISOString(),
        degraded: true,
      };
      return { ...snapshot, hash: memoryKnowledgeDigest(snapshot) };
    };
    if (remaining <= 0 || controls.signal?.aborted) return empty();
    const cancelled = new AbortController();
    const signal = controls.signal
      ? AbortSignal.any([controls.signal, cancelled.signal])
      : cancelled.signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cancelled.abort();
        resolve(empty());
      }, remaining);
      this.buildBundle(input, {
        deadlineAt: new Date(this.now().getTime() + remaining),
        signal,
      }).then(
        (bundle) => {
          clearTimeout(timer);
          resolve(bundle);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private async buildBundle(
    input: MemoryKnowledgeBundleInput,
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeBundle> {
    const budget: MemoryRequestControls = {
      ...controls,
      deadlineAt: new Date(
        Math.min(controls.deadlineAt.getTime(), this.now().getTime() + 2_000),
      ),
    };
    this.check(budget);
    if (
      input.scopes.length > 2 ||
      input.scopes.some((scope) => scope.kind === "user_preference") ||
      new Set(input.scopes.map((scope) => memoryKnowledgeDigest(scope)))
        .size !== input.scopes.length ||
      new Set(input.scopes.map((scope) => scope.workspaceId)).size > 1 ||
      input.query.length > 1_000 ||
      !input.query.trim()
    )
      throw new MemoryKnowledgeError("invalid_input");
    const scopes: {
      scope: MemoryKnowledgeScope;
      epoch: string;
      items: MemoryKnowledgeBundleItem[];
    }[] = [];
    let degraded = false;
    try {
      if (
        (
          await this.dependencies.store.maintenanceState(
            this.dependencies.generation,
          )
        ).paused
      )
        throw new MemoryKnowledgeError("unavailable", true);
      for (const scope of input.scopes) {
        await this.dependencies.access.authorize(
          { actor: input.actor, scope, action: "runtime" },
          budget,
        );
        const policy = await this.dependencies.policy.getPolicy({
          workspaceId: scope.workspaceId,
          repositoryId: scope.kind === "repository" ? scope.repositoryId : null,
        });
        if (
          !policy.memoryEnabled ||
          scope.kind === "user_preference" ||
          !policy.allowedScopes[scope.kind]
        )
          continue;
        const epoch = await this.dependencies.store.scopeEpoch(
          scope,
          this.dependencies.generation,
        );
        const recalled = await this.dependencies.reader.recall(
          {
            scope,
            query: input.query,
            limit: Math.min(20, Math.max(1, input.limitPerScope ?? 8)),
            includeHistoricalObservations: true,
          },
          budget,
        );
        const items: MemoryKnowledgeBundleItem[] = [];
        for (const item of recalled) {
          const admitted = await this.admittedRecall(
            item,
            scope,
            input.actor,
            budget,
          );
          if (admitted && this.audienceEligible(admitted, input.contextPolicy))
            items.push(admitted);
        }
        scopes.push({ scope, epoch, items });
      }
      for (const section of scopes) {
        await this.dependencies.access.authorize(
          { actor: input.actor, scope: section.scope, action: "runtime" },
          budget,
        );
        await this.recheck(section.scope, section.epoch, budget);
      }
      if (
        (
          await this.dependencies.store.maintenanceState(
            this.dependencies.generation,
          )
        ).paused
      )
        throw new MemoryKnowledgeError("unavailable", true);
    } catch {
      scopes.length = 0;
      degraded = true;
    }
    const validityBounds = scopes.flatMap((section) =>
      section.items.flatMap((item) =>
        (item.type === "entry" ? [item.metadata] : item.sourceMetadata).flatMap(
          (metadata) =>
            metadata.applicability.validUntil
              ? [Date.parse(metadata.applicability.validUntil)]
              : [],
        ),
      ),
    );
    const expiry = Math.min(this.now().getTime() + 30_000, ...validityBounds);
    if (expiry <= this.now().getTime()) {
      scopes.length = 0;
      degraded = true;
    }
    const expiresAt = new Date(
      expiry <= this.now().getTime() ? this.now().getTime() + 30_000 : expiry,
    ).toISOString();
    const snapshot = {
      ...(input.contextPolicy ? { contextPolicy: input.contextPolicy } : {}),
      generation: this.dependencies.generation,
      scopes,
      expiresAt,
      degraded,
    };
    return { ...snapshot, hash: memoryKnowledgeDigest(snapshot) };
  }

  async admitBundle(
    input: {
      readonly actor: MemoryActor;
      readonly bundle: MemoryKnowledgeBundle;
    },
    controls: MemoryRequestControls,
  ): Promise<boolean> {
    try {
      return await this.admitReceipt(
        { actor: input.actor, receipt: this.createBundleReceipt(input.bundle) },
        controls,
      );
    } catch {
      return false;
    }
  }

  createBundleReceipt(
    bundle: MemoryKnowledgeBundle,
  ): MemoryKnowledgeAdmissionReceipt {
    const { hash, ...snapshot } = bundle;
    if (memoryKnowledgeDigest(snapshot) !== hash)
      throw new MemoryKnowledgeError("conflict");
    return {
      ...(bundle.contextPolicy ? { contextPolicy: bundle.contextPolicy } : {}),
      generation: bundle.generation,
      bundleHash: hash,
      expiresAt: bundle.expiresAt,
      scopes: bundle.scopes.map((section) => {
        const entries = new Map<
          string,
          {
            ref: MemoryEntryRef;
            revision: string;
            contentApprovalRevision: string;
            automaticSource?: MemoryAutomaticSourceBinding;
          }
        >();
        for (const item of section.items)
          for (const metadata of item.type === "entry"
            ? [item.metadata]
            : item.sourceMetadata) {
            if (!metadata.contentApprovalRevision)
              throw new MemoryKnowledgeError("incomplete_evidence");
            entries.set(memoryKnowledgeDigest(metadata.ref), {
              ref: metadata.ref,
              revision: metadata.revision,
              contentApprovalRevision: metadata.contentApprovalRevision,
              ...(metadata.automaticSource
                ? { automaticSource: metadata.automaticSource }
                : {}),
            });
          }
        return {
          scope: section.scope,
          epoch: section.epoch,
          entries: [...entries.values()],
        };
      }),
    };
  }

  async admitReceipt(
    input: {
      readonly actor: MemoryActor;
      readonly receipt: MemoryKnowledgeAdmissionReceipt;
    },
    controls: MemoryRequestControls,
  ): Promise<boolean> {
    const receipt = input.receipt;
    if (
      receipt.generation !== this.dependencies.generation ||
      !Number.isFinite(Date.parse(receipt.expiresAt)) ||
      Date.parse(receipt.expiresAt) <= this.now().getTime() ||
      receipt.scopes.length > 2 ||
      receipt.scopes.some(
        (section) =>
          section.scope.kind === "user_preference" ||
          section.entries.length > 1_000,
      ) ||
      new Set(receipt.scopes.map((section) => section.scope.workspaceId)).size >
        1
    )
      return false;
    try {
      if (
        (
          await this.dependencies.store.maintenanceState(
            this.dependencies.generation,
          )
        ).paused
      )
        return false;
      for (const section of receipt.scopes) {
        await this.dependencies.access.authorize(
          { actor: input.actor, scope: section.scope, action: "runtime" },
          controls,
        );
        const policy = await this.dependencies.policy.getPolicy({
          workspaceId: section.scope.workspaceId,
          repositoryId:
            section.scope.kind === "repository"
              ? section.scope.repositoryId
              : null,
        });
        if (
          !policy.memoryEnabled ||
          section.scope.kind === "user_preference" ||
          !policy.allowedScopes[section.scope.kind]
        )
          return false;
        await this.recheck(section.scope, section.epoch, controls);
        for (const expected of section.entries) {
          if (!sameMemoryKnowledgeScope(expected.ref.scope, section.scope))
            return false;
          const metadata = await this.dependencies.store.findEntry(
            expected.ref,
            this.dependencies.generation,
          );
          if (
            !metadata ||
            metadata.revision !== expected.revision ||
            metadata.contentApprovalRevision !==
              expected.contentApprovalRevision ||
            memoryKnowledgeDigest(metadata.automaticSource ?? null) !==
              memoryKnowledgeDigest(expected.automaticSource ?? null) ||
            !memoryKnowledgeBodyVisible(metadata, "runtime", this.now()) ||
            !metadata.source ||
            !(metadata.automaticSource
              ? await this.automaticEligible(metadata, controls)
              : await this.dependencies.access.sourceApplicable(
                  {
                    actor: input.actor,
                    scope: section.scope,
                    source: metadata.source,
                    consumer: "runtime",
                  },
                  controls,
                ))
          )
            return false;
        }
        await this.dependencies.access.authorize(
          { actor: input.actor, scope: section.scope, action: "runtime" },
          controls,
        );
        await this.recheck(section.scope, section.epoch, controls);
      }
      if (
        (
          await this.dependencies.store.maintenanceState(
            this.dependencies.generation,
          )
        ).paused
      )
        return false;
      return true;
    } catch {
      return false;
    }
  }

  private async view(
    metadata: MemoryKnowledgeEntryMetadata,
    actor: MemoryActor,
    consumer: "management" | "export",
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeView> {
    if (!memoryKnowledgeBodyVisible(metadata, consumer, this.now()))
      return {
        metadata,
        body: null,
        topicIds: [],
        unavailableReason: "unsettled",
      };
    try {
      this.check(controls);
      const entry = await this.dependencies.reader.read(metadata.ref, controls);
      if (
        !entry ||
        !(await this.entryEligible(entry, metadata, actor, consumer, controls))
      )
        return {
          metadata,
          body: null,
          topicIds: [],
          unavailableReason: "incomplete_evidence",
        };
      return {
        metadata,
        body: entry.body,
        topicIds: entry.topicIds,
        unavailableReason: null,
      };
    } catch {
      return {
        metadata,
        body: null,
        topicIds: [],
        unavailableReason: "provider_unavailable",
      };
    }
  }

  private audienceEligible(
    item: MemoryKnowledgeBundleItem,
    policy: MemoryContextPolicy | undefined,
  ): boolean {
    if (!policy || policy.audience === "internal") return true;
    return (
      item.type === "entry" ? [item.metadata] : item.sourceMetadata
    ).every(
      (metadata) =>
        metadata.source &&
        (metadata.source.visibility === "public" ||
          (policy.audience === "repository" &&
            metadata.ref.scope.kind === "repository" &&
            metadata.ref.scope.repositoryId === policy.repositoryId &&
            metadata.source.repositoryId === policy.repositoryId)),
    );
  }

  private async automaticEligible(
    metadata: MemoryKnowledgeEntryMetadata,
    controls: MemoryRequestControls,
  ): Promise<boolean> {
    const binding = metadata.automaticSource,
      automatic = this.dependencies.automaticSources;
    if (!binding || !automatic || !metadata.source) return false;
    const state = await automatic.store.lookupLineage(
      metadata.ref.scope,
      binding.lineageKey,
    );
    if (
      !state ||
      state.binding.cohortId !== binding.cohortId ||
      state.binding.sourceRevision !== binding.sourceRevision
    )
      return false;
    const recoverable =
      state.state === "needs_refresh" &&
      state.invalidatedBy === "unavailable" &&
      state.lastCompleteCohort === true;
    if (
      !recoverable &&
      !(await automatic.store.applicable(
        metadata.ref,
        metadata.generation,
        binding,
      ))
    )
      return false;
    let current: boolean;
    try {
      current = await automatic.current.current(
        { scope: metadata.ref.scope, source: metadata.source, binding },
        controls,
      );
    } catch {
      current = false;
    }
    if (!current) {
      await automatic.store.invalidate({
        scope: metadata.ref.scope,
        sourceId: metadata.source.sourceId,
        cause: "unavailable",
        expectedBinding: state.binding,
        now: this.now(),
      });
      return false;
    }
    if (recoverable) {
      // Fresh checked provenance may recover the same complete cohort, never a changed/deleted source.
      // This capture is discarded because its epoch changed; subsequent reads see the renewed receipt.
      await automatic.store.recoverAvailability({
        ref: metadata.ref,
        generation: metadata.generation,
        binding,
        now: this.now(),
      });
      return false;
    }
    return automatic.store.applicable(
      metadata.ref,
      metadata.generation,
      binding,
    );
  }

  private async entryEligible(
    entry: MemoryProviderEntry,
    metadata: MemoryKnowledgeEntryMetadata,
    actor: MemoryActor,
    consumer: "runtime" | "management" | "export",
    controls: MemoryRequestControls,
  ): Promise<boolean> {
    if (
      !sameMemoryKnowledgeScope(entry.ref.scope, metadata.ref.scope) ||
      entry.ref.entryId !== metadata.ref.entryId ||
      entry.contentApprovalRevision !== metadata.contentApprovalRevision ||
      entry.kind !== metadata.kind ||
      !memoryKnowledgeBodyMatches(entry.body, metadata) ||
      entry.bodyDigest !== createMemoryBodyHash(entry.body) ||
      memoryKnowledgeTopicsDigest(entry.topicIds) !== metadata.topicsDigest ||
      entry.statementAt !== metadata.originalStatementAt ||
      !metadata.source ||
      !memoryKnowledgeBodyVisible(metadata, consumer, this.now())
    )
      return false;
    if (metadata.automaticSource)
      return this.automaticEligible(metadata, controls);
    return this.dependencies.access.sourceApplicable(
      { actor, scope: metadata.ref.scope, source: metadata.source, consumer },
      controls,
    );
  }

  private async admittedRecall(
    item: MemoryProviderRecallItem,
    scope: MemoryKnowledgeScope,
    actor: MemoryActor,
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeBundleItem | null> {
    this.check(controls);
    if (item.type === "entry") {
      if (!sameMemoryKnowledgeScope(item.entry.ref.scope, scope)) return null;
      const metadata = await this.dependencies.store.findEntry(
        item.entry.ref,
        this.dependencies.generation,
      );
      return metadata &&
        (await this.entryEligible(
          item.entry,
          metadata,
          actor,
          "runtime",
          controls,
        ))
        ? { type: "entry", entry: item.entry, metadata }
        : null;
    }
    if (
      !sameMemoryKnowledgeScope(item.ref.scope, scope) ||
      !item.evidenceComplete ||
      item.temporalStatus !== "historical" ||
      item.sourceEntries.length === 0 ||
      item.sourceEntries.length > 100 ||
      item.body.length > 4_000
    )
      return null;
    const sourceMetadata: MemoryKnowledgeEntryMetadata[] = [];
    for (const ref of item.sourceEntries) {
      if (!sameMemoryKnowledgeScope(ref.scope, scope)) return null;
      const metadata = await this.dependencies.store.findEntry(
        ref,
        this.dependencies.generation,
      );
      if (
        !metadata ||
        !memoryKnowledgeBodyVisible(metadata, "runtime", this.now()) ||
        !metadata.source
      )
        return null;
      const entry = await this.dependencies.reader.read(ref, controls);
      if (
        !entry ||
        !(await this.entryEligible(entry, metadata, actor, "runtime", controls))
      )
        return null;
      sourceMetadata.push(metadata);
    }
    return {
      type: "observation",
      ref: item.ref,
      body: item.body,
      sourceEntries: item.sourceEntries,
      evidenceComplete: true,
      temporalStatus: "historical",
      sourceMetadata,
    };
  }

  private async recheck(
    scope: MemoryKnowledgeScope,
    epoch: string,
    controls: MemoryRequestControls,
  ): Promise<void> {
    this.check(controls);
    if (
      (await this.dependencies.store.scopeEpoch(
        scope,
        this.dependencies.generation,
      )) !== epoch
    )
      throw new MemoryKnowledgeError("conflict", true);
    this.check(controls);
  }
}
