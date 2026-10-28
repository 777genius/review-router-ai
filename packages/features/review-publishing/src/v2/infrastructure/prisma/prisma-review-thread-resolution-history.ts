import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  isQualifiedResolutionWriterProof,
  type ResolutionWriterDrainQualification,
} from "../../application/use-cases/activate-review-resolution-history";
import { canonicalReviewPublicationJson } from "../../domain/canonical-review-publication-json";
import type {
  ReviewPublicationOperation,
  ReviewPublicationAttempt,
  ReviewPublicationScope,
} from "../../domain/review-publication-attempt";
import {
  parseResolutionFacts,
  parseResolutionHistoryBootstrap,
  sameResolutionOperation,
  resolutionOperationIdentity,
  type ConfirmedResolutionFact,
  type PendingResolutionFact,
  type ResolutionHistory,
  type ResolutionThreadScope,
} from "../../domain/review-thread-resolution-history";

type Transaction = Prisma.TransactionClient;
type Connection = Readonly<{
  id: string;
  workspaceId: string;
  scmRepositoryIdentityId: string | null;
  lifecycleResolutionMode: string;
  lifecycleResolutionActivatedAt: Date | null;
  lifecycleResolutionActivationVersion: number;
  lifecycleResolutionWriterDigest: string | null;
  lifecycleResolutionBootstrapJson: unknown;
}>;
type GuardRow = Readonly<{
  version: number;
  confirmedFactJson: unknown;
  pendingFactsJson: unknown;
}>;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** All writers share this connection lock; retention of detailed receipts is independent. */
export async function lockResolutionConnection(
  transaction: Transaction,
  scope: Pick<ReviewPublicationScope, "workspaceId" | "repositoryConnectionId">,
): Promise<Connection> {
  const rows = await transaction.$queryRaw<Connection[]>(Prisma.sql`
    SELECT "id", "workspaceId", "scmRepositoryIdentityId", "lifecycleResolutionMode", "lifecycleResolutionActivatedAt", "lifecycleResolutionActivationVersion", "lifecycleResolutionWriterDigest", "lifecycleResolutionBootstrapJson"
    FROM "RepositoryConnection" WHERE "id" = ${scope.repositoryConnectionId} AND "workspaceId" = ${scope.workspaceId} FOR UPDATE`);
  const connection = rows[0];
  if (!connection) throw new Error("resolution_connection_missing");
  return connection;
}

async function readGuard(
  transaction: Transaction,
  scope: ResolutionThreadScope,
): Promise<GuardRow | null> {
  const rows = await transaction.$queryRaw<GuardRow[]>(Prisma.sql`
    SELECT "version", "confirmedFactJson", "pendingFactsJson" FROM "ReviewThreadResolutionGuardV1"
    WHERE "workspaceId"=${scope.workspaceId} AND "repositoryConnectionId"=${scope.repositoryConnectionId}
    AND "scmRepositoryIdentityId"=${scope.scmRepositoryIdentityId} AND "pullRequestNumber"=${scope.pullRequestNumber} AND "threadId"=${scope.threadId}`);
  return rows[0] ?? null;
}

async function writeGuard(
  transaction: Transaction,
  scope: ResolutionThreadScope,
  confirmed: ConfirmedResolutionFact | null,
  pending: readonly PendingResolutionFact[],
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "ReviewThreadResolutionGuardV1" ("workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","threadId","version","confirmedFactJson","pendingFactsJson","createdAt","updatedAt")
    VALUES (${scope.workspaceId},${scope.repositoryConnectionId},${scope.scmRepositoryIdentityId},${scope.pullRequestNumber},${scope.threadId},1,${JSON.stringify(confirmed)}::jsonb,${JSON.stringify(pending)}::jsonb,NOW(),NOW())
    ON CONFLICT ("workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","threadId") DO UPDATE
    SET "version"="ReviewThreadResolutionGuardV1"."version"+1,"confirmedFactJson"=EXCLUDED."confirmedFactJson","pendingFactsJson"=EXCLUDED."pendingFactsJson","updatedAt"=NOW()`);
}

export async function recordPendingResolution(
  transaction: Transaction,
  scope: ResolutionThreadScope,
  fact: PendingResolutionFact,
  options: {
    readonly allowDuringDrain?: boolean;
    readonly reconciliationOnly?: boolean;
    readonly parentCreatedAt?: string;
  } = {},
): Promise<void> {
  const connection = await lockResolutionConnection(transaction, scope);
  if (connection.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId)
    throw new Error("resolution_repository_binding_changed");
  if (
    !["legacy_open", "draining", "guarded"].includes(
      connection.lifecycleResolutionMode,
    ) ||
    (connection.lifecycleResolutionMode === "guarded" &&
      (!connection.lifecycleResolutionActivatedAt ||
        !connection.lifecycleResolutionWriterDigest ||
        connection.lifecycleResolutionActivationVersion < 1))
  )
    throw new Error("resolution_entry_mode_invalid");
  if (
    connection.lifecycleResolutionMode === "draining" &&
    !options.allowDuringDrain
  )
    throw new Error("resolution_writers_draining");
  if (
    fact.sourceKind === "legacy_entry" &&
    connection.lifecycleResolutionMode !== "legacy_open"
  )
    throw new Error("guarded_publication_required");
  const existing = await readGuard(transaction, scope);
  const { confirmed, pending } = parseResolutionFacts(
    existing?.confirmedFactJson,
    existing?.pendingFactsJson,
  );
  const same = pending.find((item) => item.operationId === fact.operationId);
  if (same) {
    if (!sameResolutionOperation(same, fact))
      throw new Error("resolution_operation_identity_conflict");
    if (!options.reconciliationOnly)
      throw new Error("resolution_effect_unknown");
    return;
  }
  if (!options.reconciliationOnly && (confirmed || pending.length))
    throw new Error(
      confirmed
        ? "previously_resolved_thread_reopened"
        : "resolution_effect_unknown",
    );
  const bootstrap = connection.lifecycleResolutionActivatedAt
    ? parseResolutionHistoryBootstrap(
        connection.lifecycleResolutionBootstrapJson,
        connection.lifecycleResolutionActivatedAt.toISOString(),
      )
    : undefined;
  if (
    bootstrap &&
    fact.sourceKind === "canonical_operation" &&
    !options.reconciliationOnly
  ) {
    if (
      !options.parentCreatedAt ||
      !Number.isFinite(Date.parse(options.parentCreatedAt))
    )
      throw new Error("resolution_parent_creation_unavailable");
    if (
      Date.parse(options.parentCreatedAt) <= Date.parse(bootstrap.activationCut)
    )
      throw new Error("untracked_legacy_possibility");
  }
  await writeGuard(transaction, scope, confirmed, [...pending, fact]);
}

export async function settleResolution(
  transaction: Transaction,
  scope: ResolutionThreadScope,
  operationId: string,
  outcome: "confirmed" | "no_effect" | "effect_unknown" | "may_have_started",
  effect?: Readonly<{ effectId: string; observedAt: string }>,
): Promise<void> {
  await lockResolutionConnection(transaction, scope);
  const existing = await readGuard(transaction, scope);
  const { confirmed, pending } = parseResolutionFacts(
    existing?.confirmedFactJson,
    existing?.pendingFactsJson,
  );
  const fact = pending.find((item) => item.operationId === operationId);
  if (!fact) {
    if (confirmed?.operationId === operationId && outcome === "confirmed")
      return;
    throw new Error("resolution_pending_missing");
  }
  if (outcome === "confirmed" && !effect)
    throw new Error("resolution_confirmation_missing");
  const next = pending.flatMap((item): PendingResolutionFact[] =>
    item.operationId !== operationId
      ? [item]
      : outcome === "no_effect" || outcome === "confirmed"
        ? []
        : [
            {
              ...item,
              state:
                outcome === "may_have_started"
                  ? "may_have_started"
                  : "effect_unknown",
            },
          ],
  );
  const nextConfirmed =
    outcome !== "confirmed"
      ? confirmed
      : confirmed
        ? {
            ...confirmed,
            latestConfirmed: {
              ...resolutionOperationIdentity(fact),
              ...effect!,
            },
          }
        : { ...resolutionOperationIdentity(fact), ...effect! };
  await writeGuard(transaction, scope, nextConfirmed, next);
}

export type LegacyResolutionEntry = Readonly<{
  scope: ResolutionThreadScope;
  operationId: string;
}>;
/** Trusted rollout adapter proof, deliberately unavailable from HTTP/request inputs. */
export type ResolutionWriterQuiescenceProof =
  ResolutionWriterDrainQualification;

export class PrismaReviewThreadResolutionHistory {
  constructor(private readonly prisma: PrismaClient) {}

  async enterLegacy(
    input: Readonly<{
      workspaceId: string;
      repositoryConnectionId: string;
      pullRequestNumber: number;
      threadId: string;
      reviewedHeadSha: string;
      bodyHash: string;
      now: Date;
    }>,
  ): Promise<LegacyResolutionEntry> {
    return this.prisma.$transaction(async (transaction) => {
      const connection = await lockResolutionConnection(transaction, input);
      if (!connection.scmRepositoryIdentityId)
        throw new Error("resolution_repository_binding_missing");
      const scope = {
        workspaceId: input.workspaceId,
        repositoryConnectionId: input.repositoryConnectionId,
        scmRepositoryIdentityId: connection.scmRepositoryIdentityId,
        pullRequestNumber: input.pullRequestNumber,
        threadId: input.threadId,
      };
      const operationId = `legacy-resolution:${randomUUID()}`;
      await recordPendingResolution(transaction, scope, {
        sourceKind: "legacy_entry",
        operationId,
        reviewedHeadSha: input.reviewedHeadSha,
        bodyHash: input.bodyHash,
        state: "entered",
        enteredAt: input.now.toISOString(),
      });
      return { scope, operationId };
    });
  }

  async settleLegacy(
    entry: LegacyResolutionEntry,
    outcome: "confirmed" | "no_effect" | "effect_unknown" | "may_have_started",
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction((transaction) =>
      settleResolution(
        transaction,
        entry.scope,
        entry.operationId,
        outcome,
        outcome === "confirmed"
          ? { effectId: entry.operationId, observedAt: now.toISOString() }
          : undefined,
      ),
    );
  }

  async read(
    scope: ReviewPublicationScope,
    threadIds: readonly string[],
  ): Promise<readonly ResolutionHistory[]> {
    return this.prisma.$transaction(async (transaction) => {
      const connection = await lockResolutionConnection(transaction, scope);
      if (connection.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId)
        throw new Error("resolution_repository_binding_changed");
      const historyCut =
        connection.lifecycleResolutionMode === "guarded" &&
        connection.lifecycleResolutionActivatedAt &&
        connection.lifecycleResolutionWriterDigest &&
        connection.lifecycleResolutionActivationVersion > 0
          ? {
              activatedAt:
                connection.lifecycleResolutionActivatedAt.toISOString(),
              activationVersion:
                connection.lifecycleResolutionActivationVersion,
              writerDigest: connection.lifecycleResolutionWriterDigest,
              ...(connection.lifecycleResolutionBootstrapJson == null
                ? {}
                : {
                    bootstrap: parseResolutionHistoryBootstrap(
                      connection.lifecycleResolutionBootstrapJson,
                      connection.lifecycleResolutionActivatedAt.toISOString(),
                    )!,
                  }),
            }
          : null;
      const ids = [...new Set(threadIds)].sort();
      const guards = new Map<string, GuardRow>();
      for (let offset = 0; offset < ids.length; offset += 512) {
        const batch = ids.slice(offset, offset + 512);
        const rows = await transaction.$queryRaw<
          (GuardRow & { threadId: string })[]
        >(Prisma.sql`
          SELECT "threadId","version","confirmedFactJson","pendingFactsJson" FROM "ReviewThreadResolutionGuardV1"
          WHERE "workspaceId"=${scope.workspaceId} AND "repositoryConnectionId"=${scope.repositoryConnectionId}
          AND "scmRepositoryIdentityId"=${scope.scmRepositoryIdentityId} AND "pullRequestNumber"=${scope.pullRequestNumber}
          AND "threadId" IN (${Prisma.join(batch)})`);
        for (const row of rows) guards.set(row.threadId, row);
      }
      return ids.map((threadId) => {
        const row = guards.get(threadId);
        return {
          threadId,
          version: row?.version ?? 0,
          historyCut,
          ...parseResolutionFacts(
            row?.confirmedFactJson,
            row?.pendingFactsJson,
          ),
        };
      });
    });
  }

  async beginDrain(scope: ReviewPublicationScope): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const connection = await lockResolutionConnection(transaction, scope);
      if (connection.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId)
        throw new Error("resolution_repository_binding_changed");
      if (connection.lifecycleResolutionMode === "guarded") return;
      await transaction.$executeRaw(
        Prisma.sql`UPDATE "RepositoryConnection" SET "lifecycleResolutionMode"='draining' WHERE "id"=${scope.repositoryConnectionId}`,
      );
    });
  }

  async activate(
    scope: ReviewPublicationScope,
    proof: ResolutionWriterQuiescenceProof,
  ): Promise<void> {
    if (!isQualifiedResolutionWriterProof(proof, new Date(), sha))
      throw new Error("resolution_writer_quiescence_unqualified");
    await this.prisma.$transaction(
      async (transaction) => {
        const connection = await lockResolutionConnection(transaction, scope);
        if (
          connection.scmRepositoryIdentityId !== scope.scmRepositoryIdentityId
        )
          throw new Error("resolution_repository_binding_changed");
        if (connection.lifecycleResolutionMode === "guarded") {
          const existingBootstrap = parseResolutionHistoryBootstrap(
            connection.lifecycleResolutionBootstrapJson,
            connection.lifecycleResolutionActivatedAt!.toISOString(),
          );
          if (
            connection.lifecycleResolutionWriterDigest !== proof.writerDigest ||
            (existingBootstrap?.qualificationSource ??
              "managed_executor_handler_settlement.v1") !==
              proof.qualificationSource ||
            (proof.qualificationSource ===
              "retired_legacy_writers_quarantine.v1" &&
              existingBootstrap?.proofHash !== proof.proofHash)
          )
            throw new Error("resolution_activation_writer_conflict");
          return;
        }
        if (connection.lifecycleResolutionMode !== "draining")
          throw new Error("resolution_drain_required");
        // Include issued capabilities even when no receipt/effect was ever returned.
        const attempts = await transaction.reviewPublicationAttemptV2.findMany({
          where: {
            workspaceId: scope.workspaceId,
            repositoryConnectionId: scope.repositoryConnectionId,
            scmRepositoryIdentityId: scope.scmRepositoryIdentityId,
          },
        });
        for (const attemptRow of attempts) {
          const operations =
            await transaction.reviewPublicationOperationV2.findMany({
              where: {
                publicationAttemptId: attemptRow.publicationAttemptId,
                publicationKind: "thread_lifecycle",
              },
            });
          for (const operation of operations) {
            const issued =
              await transaction.reviewPublicationOperationAttemptV2.findMany({
                where: {
                  publicationOperationId: operation.publicationOperationId,
                  state: { not: "no_effect_proven" },
                },
              });
            const effects =
              await transaction.reviewPublicationExternalEffectV2.findMany({
                where: {
                  publicationOperationId: operation.publicationOperationId,
                  effectKind: { not: "lifecycle_compensated" },
                },
                orderBy: { observedAt: "asc" },
              });
            if (!issued.length && !effects.length) continue;
            const target = await canonicalResolutionTarget(
              transaction,
              {
                publicationAttemptId: attemptRow.publicationAttemptId,
                permit: attemptRow,
              } as unknown as ReviewPublicationAttempt,
              operation as unknown as ReviewPublicationOperation,
            );
            if (!target) continue; // Historical reopen operations are not resolves.
            const entryScope = {
              ...scope,
              pullRequestNumber: attemptRow.pullRequestNumber,
              threadId: target.threadId,
            };
            const current = await readGuard(transaction, entryScope);
            const facts = parseResolutionFacts(
              current?.confirmedFactJson,
              current?.pendingFactsJson,
            );
            if (
              facts.confirmed?.operationId === operation.publicationOperationId
            )
              continue;
            const fact = canonicalResolutionFact(
              {
                publicationAttemptId: attemptRow.publicationAttemptId,
                permit: attemptRow,
              } as unknown as ReviewPublicationAttempt,
              operation as unknown as ReviewPublicationOperation,
              issued[0]?.startedAt ?? effects[0]!.observedAt,
            );
            await recordPendingResolution(transaction, entryScope, fact, {
              allowDuringDrain: true,
              reconciliationOnly: true,
            });
            const confirmed = effects.find(
              (effect) =>
                effect.externalObjectId === `thread:${target.threadId}`,
            );
            if (confirmed)
              await settleResolution(
                transaction,
                entryScope,
                operation.publicationOperationId,
                "confirmed",
                {
                  effectId: confirmed.effectId,
                  observedAt: confirmed.observedAt.toISOString(),
                },
              );
          }
        }
        const [clock] = await transaction.$queryRaw<{ now: Date }[]>(
          Prisma.sql`SELECT clock_timestamp() AS "now"`,
        );
        if (!clock || !isQualifiedResolutionWriterProof(proof, clock.now, sha))
          throw new Error("resolution_writer_quiescence_unqualified");
        const bootstrap =
          proof.qualificationSource === "retired_legacy_writers_quarantine.v1"
            ? {
                qualificationSource: proof.qualificationSource,
                executorSetHash: proof.executorSetHash,
                proofHash: proof.proofHash,
                retiredAt: proof.retiredAt,
                activationCut: clock.now.toISOString(),
              }
            : null;
        await transaction.$executeRaw(
          Prisma.sql`UPDATE "RepositoryConnection" SET "lifecycleResolutionMode"='guarded',"lifecycleResolutionActivatedAt"=${clock.now},"lifecycleResolutionActivationVersion"="lifecycleResolutionActivationVersion"+1,"lifecycleResolutionWriterDigest"=${proof.writerDigest},"lifecycleResolutionBootstrapJson"=${JSON.stringify(bootstrap)}::jsonb WHERE "id"=${scope.repositoryConnectionId}`,
        );
      },
      { timeout: 30_000 },
    );
  }
}

export function canonicalResolutionFact(
  attempt: Pick<ReviewPublicationAttempt, "publicationAttemptId" | "permit">,
  operation: Pick<
    ReviewPublicationOperation,
    "publicationOperationId" | "bodyHash" | "targetCommitId"
  >,
  now: Date,
): PendingResolutionFact {
  return {
    sourceKind: "canonical_operation",
    operationId: operation.publicationOperationId,
    publicationAttemptId: attempt.publicationAttemptId,
    executionId: attempt.permit.executionId,
    generation: attempt.permit.generation.toString(),
    reviewedHeadSha: operation.targetCommitId,
    bodyHash: operation.bodyHash,
    state: "may_have_started",
    enteredAt: now.toISOString(),
  };
}

/** Resolve target is authenticated by the frozen projection plus both planned hashes. */
export async function canonicalResolutionTarget(
  transaction: Transaction,
  attempt: Pick<ReviewPublicationAttempt, "publicationAttemptId" | "permit">,
  operation: Pick<
    ReviewPublicationOperation,
    | "publicationOperationId"
    | "publicationKind"
    | "bodyHash"
    | "markerHash"
    | "targetCommitId"
  >,
): Promise<Readonly<{ threadId: string; parentCreatedAt?: string }> | null> {
  if (operation.publicationKind !== "thread_lifecycle") return null;
  const artifact =
    await transaction.finalizedReviewProjectionArtifactV2.findUnique({
      where: { executionId: attempt.permit.executionId },
    });
  if (!artifact) {
    const guards = await transaction.$queryRaw<
      (GuardRow & { threadId: string })[]
    >(Prisma.sql`
      SELECT "threadId","version","confirmedFactJson","pendingFactsJson" FROM "ReviewThreadResolutionGuardV1"
      WHERE "workspaceId"=${attempt.permit.workspaceId} AND "repositoryConnectionId"=${attempt.permit.repositoryConnectionId}
      AND "scmRepositoryIdentityId"=${attempt.permit.scmRepositoryIdentityId} AND "pullRequestNumber"=${attempt.permit.pullRequestNumber}`);
    const own = canonicalResolutionFact(
      attempt,
      {
        ...operation,
        publicationOperationId: operation.publicationOperationId,
      },
      new Date(0),
    );
    for (const guard of guards) {
      const facts = parseResolutionFacts(
        guard.confirmedFactJson,
        guard.pendingFactsJson,
      );
      const candidates = [
        ...facts.pending,
        ...(facts.confirmed
          ? [
              facts.confirmed,
              ...(facts.confirmed.latestConfirmed
                ? [facts.confirmed.latestConfirmed]
                : []),
            ]
          : []),
      ];
      if (
        candidates.some((fact) => sameResolutionOperation(fact, own)) &&
        sha(
          canonicalReviewPublicationJson({
            resolve: true,
            threadId: guard.threadId,
          }),
        ) === operation.bodyHash
      )
        return { threadId: guard.threadId };
    }
    // Retained native effects can authenticate historical positive facts even after artifact pruning.
    const effects =
      await transaction.reviewPublicationExternalEffectV2.findMany({
        where: { publicationAttemptId: attempt.publicationAttemptId },
        select: { publicationOperationId: true, externalObjectId: true },
      });
    const matches = effects.filter(
      (effect) =>
        effect.publicationOperationId === operation.publicationOperationId &&
        effect.externalObjectId.startsWith("thread:") &&
        sha(
          canonicalReviewPublicationJson({
            resolve: true,
            threadId: effect.externalObjectId.slice(7),
          }),
        ) === operation.bodyHash,
    );
    if (
      matches.length &&
      new Set(matches.map((effect) => effect.externalObjectId)).size === 1
    )
      return { threadId: matches[0]!.externalObjectId.slice(7) };
    throw new Error("resolution_projection_missing");
  }
  if (
    artifact.projectionHash !== attempt.permit.projectionHash ||
    artifact.reviewedHeadSha !== operation.targetCommitId
  )
    throw new Error("resolution_projection_mismatch");
  const envelope = JSON.parse(artifact.projectionEnvelopeCanonicalJson) as {
    publishing?: {
      lifecycle?: readonly {
        targetId?: string;
        threadId?: string;
        verdict?: string;
        mutationEligible?: boolean;
        parentCreatedAt?: string;
      }[];
    };
  };
  const target = envelope.publishing?.lifecycle?.find(
    (item) =>
      item.verdict === "resolved" &&
      item.mutationEligible === true &&
      typeof item.threadId === "string" &&
      typeof item.targetId === "string" &&
      sha(
        canonicalReviewPublicationJson({
          resolve: true,
          threadId: item.threadId,
        }),
      ) === operation.bodyHash &&
      sha(`reviewrouter-lifecycle:${item.targetId}:resolved`) ===
        operation.markerHash,
  );
  if (target?.threadId) {
    const execution = await transaction.reviewExecutionV2.findUnique({
      where: { executionId: attempt.permit.executionId },
    });
    let parentCreatedAt: string | undefined;
    if (
      execution &&
      execution.workspaceId === attempt.permit.workspaceId &&
      execution.repositoryConnectionId ===
        attempt.permit.repositoryConnectionId &&
      execution.scmRepositoryIdentityId ===
        attempt.permit.scmRepositoryIdentityId &&
      execution.pullRequestNumber === attempt.permit.pullRequestNumber &&
      execution.generation === attempt.permit.generation &&
      execution.headSha === operation.targetCommitId &&
      execution.reviewRevisionHash === attempt.permit.reviewRevisionHash &&
      execution.assignmentManifestVersion === 2
    ) {
      const manifest = execution.assignmentManifestJson as {
        lifecyclePlan?: {
          targets?: readonly {
            targetId?: string;
            threadId?: string;
            parentCreatedAt?: string;
          }[];
        };
      } | null;
      const selected = Array.isArray(manifest?.lifecyclePlan?.targets)
        ? manifest.lifecyclePlan.targets.filter(
            (candidate) =>
              candidate.targetId === target.targetId &&
              candidate.threadId === target.threadId,
          )
        : [];
      if (
        selected.length === 1 &&
        typeof selected[0]?.parentCreatedAt === "string" &&
        Number.isFinite(Date.parse(selected[0].parentCreatedAt))
      )
        parentCreatedAt = selected[0].parentCreatedAt;
    }
    if (
      typeof target.parentCreatedAt === "string" &&
      Number.isFinite(Date.parse(target.parentCreatedAt))
    ) {
      if (
        parentCreatedAt &&
        Date.parse(parentCreatedAt) !== Date.parse(target.parentCreatedAt)
      )
        throw new Error("resolution_parent_creation_mismatch");
      // A publishing timestamp alone is not selected-witness authority.
    }
    return {
      threadId: target.threadId,
      ...(parentCreatedAt ? { parentCreatedAt } : {}),
    };
  }
  const reopen = envelope.publishing?.lifecycle?.some(
    (item) =>
      item.verdict === "still_valid" &&
      item.mutationEligible === true &&
      typeof item.threadId === "string" &&
      sha(
        canonicalReviewPublicationJson({
          resolve: false,
          threadId: item.threadId,
        }),
      ) === operation.bodyHash,
  );
  if (reopen) return null;
  throw new Error("resolution_operation_target_invalid");
}

/** Used only for an already issued capability, never to mint a new resolve. */
export async function accountIssuedResolution(
  transaction: Transaction,
  attempt: ReviewPublicationAttempt,
  operation: ReviewPublicationOperation,
  issuedAt: Date,
): Promise<Readonly<{ threadId: string; parentCreatedAt?: string }> | null> {
  const target = await canonicalResolutionTarget(
    transaction,
    attempt,
    operation,
  );
  if (!target) return null;
  const scope = { ...attempt.permit, threadId: target.threadId };
  await lockResolutionConnection(transaction, scope);
  const row = await readGuard(transaction, scope);
  const facts = parseResolutionFacts(
    row?.confirmedFactJson,
    row?.pendingFactsJson,
  );
  if (
    facts.confirmed?.operationId !== operation.publicationOperationId &&
    !facts.pending.some(
      (fact) => fact.operationId === operation.publicationOperationId,
    )
  ) {
    await recordPendingResolution(
      transaction,
      scope,
      canonicalResolutionFact(attempt, operation, issuedAt),
      { reconciliationOnly: true, allowDuringDrain: true },
    );
  }
  return target;
}
