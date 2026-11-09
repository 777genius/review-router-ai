import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export type ClaimedReviewProgress = Readonly<{
  scope: Readonly<{
    workspaceId: string;
    repositoryConnectionId: string;
    scmRepositoryIdentityId: string;
    pullRequestNumber: number;
  }>;
  executionId: string;
  generation: bigint;
  headSha: string;
  planHash: string;
  desiredVersion: bigint;
  publishedVersion: bigint;
  commentId: bigint | null;
  publishedBodyHash: string | null;
  failureCount: number;
  snapshot: unknown;
  terminal: boolean;
  repository: Readonly<{
    owner: string;
    name: string;
    githubInstallationId: bigint;
  }>;
  claim: Readonly<{
    claimId: string;
    ownerIdHash: string;
    claimUntil: Date;
  }>;
}>;

export class PrismaReviewProgressPublicationStore {
  private readonly allowedRepositoryFullNames: ReadonlySet<string> | null;

  constructor(
    private readonly prisma: PrismaClient,
    options: {
      readonly allowedRepositoryFullNames?: ReadonlySet<string> | null;
    } = {},
  ) {
    this.allowedRepositoryFullNames =
      options.allowedRepositoryFullNames === undefined
        ? null
        : options.allowedRepositoryFullNames;
  }

  async claimNext(input: {
    readonly ownerIdHash: string;
    readonly now: Date;
    readonly claimDurationMs: number;
  }): Promise<ClaimedReviewProgress | null> {
    assertOwner(input.ownerIdHash);
    assertDuration(input.claimDurationMs);
    const repositoryPredicate = this.allowedRepositoryFullNames
      ? Prisma.sql`
          AND EXISTS (
            SELECT 1 FROM "RepositoryConnection" repository
            WHERE repository."id" = publication."repositoryConnectionId"
              AND LOWER(repository."fullName") IN (${Prisma.join([
                ...this.allowedRepositoryFullNames,
              ])})
          )`
      : Prisma.empty;
    return this.prisma.$transaction(
      (transaction) =>
        claimDuePublication(transaction, input, repositoryPredicate),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reserveInstallationMutation(input: {
    readonly publication: ClaimedReviewProgress;
    readonly now: Date;
    readonly minimumIntervalMs: number;
  }): Promise<{ allowed: true } | { allowed: false; retryAt: Date }> {
    assertDuration(input.minimumIntervalMs);
    return this.prisma.$transaction(
      (transaction) => reserveInstallationBudgetMutation(transaction, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async complete(input: {
    readonly publication: ClaimedReviewProgress;
    readonly commentId: bigint;
    readonly bodyHash: string;
    readonly now: Date;
  }): Promise<boolean> {
    const nextPublishAt = input.publication.terminal
      ? input.now
      : new Date(input.now.getTime() + 60_000);
    const result = await this.prisma.reviewProgressPublicationV1.updateMany({
      where: {
        ...claimedPublicationFence(input.publication),
      },
      data: {
        publishedVersion: input.publication.desiredVersion,
        commentId: input.commentId,
        publishedBodyHash: input.bodyHash,
        lastPublishedAt: input.now,
        nextPublishAt,
        claimId: null,
        claimOwnerIdHash: null,
        claimUntil: null,
        failureCount: 0,
        lastErrorCode: null,
        updatedAt: input.now,
      },
    });
    return result.count === 1;
  }

  async retry(input: {
    readonly publication: ClaimedReviewProgress;
    readonly safeCode: string;
    readonly retryAt: Date;
    readonly installationCooldownUntil?: Date | undefined;
    readonly now: Date;
    readonly maxFailures: number;
    readonly countFailure?: boolean | undefined;
  }): Promise<"retried" | "suppressed"> {
    assertDuration(input.maxFailures);
    return this.prisma.$transaction((transaction) =>
      retryPublicationMutation(transaction, input),
    );
  }

  async suppress(input: {
    readonly publication: ClaimedReviewProgress;
    readonly safeCode: string;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.reviewProgressPublicationV1.updateMany({
      where: {
        ...claimedPublicationFence(input.publication),
      },
      data: {
        publishedVersion: input.publication.desiredVersion,
        claimId: null,
        claimOwnerIdHash: null,
        claimUntil: null,
        lastErrorCode: safeCode(input.safeCode),
        updatedAt: input.now,
      },
    });
    return result.count === 1;
  }

  async promoteSettledExecutions(input: {
    readonly settlements: readonly Readonly<{
      executionId: string;
      outcome: "succeeded" | "failed" | "superseded";
    }>[];
    readonly now: Date;
  }): Promise<number> {
    let promoted = 0;
    const settlements = new Map(
      input.settlements.map((settlement) => [
        settlement.executionId,
        settlement.outcome,
      ]),
    );
    for (const [executionId, publicationOutcome] of settlements) {
      const changed = await this.prisma.$transaction(
        (transaction) =>
          promoteSettledExecution(
            transaction,
            executionId,
            publicationOutcome,
            input.now,
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (changed) promoted += 1;
    }
    return promoted;
  }
}

/** Persist retry and installation cooldown inside the same transaction. */
async function retryPublicationMutation(
  transaction: Prisma.TransactionClient,
  input: Parameters<PrismaReviewProgressPublicationStore["retry"]>[0],
): Promise<"retried" | "suppressed"> {
  let outcome: "retried" | "suppressed" = "retried";
  const mutation = retryMutationData(input);
  await transaction.reviewProgressPublicationV1.updateMany({
    where: {
      ...claimedPublicationFence(input.publication),
    },
    data: mutation.data,
  });
  if (mutation.reachesLimit) outcome = "suppressed";
  if (input.installationCooldownUntil) {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "ReviewProgressInstallationBudgetV1"
        ("githubInstallationId", "nextMutationAt", "cooldownUntil", "updatedAt")
      VALUES (
        ${input.publication.repository.githubInstallationId},
        ${input.installationCooldownUntil},
        ${input.installationCooldownUntil},
        ${input.now}
      )
      ON CONFLICT ("githubInstallationId") DO UPDATE SET
        "nextMutationAt" = GREATEST(
          "ReviewProgressInstallationBudgetV1"."nextMutationAt",
          EXCLUDED."nextMutationAt"
        ),
        "cooldownUntil" = GREATEST(
          "ReviewProgressInstallationBudgetV1"."cooldownUntil",
          EXCLUDED."cooldownUntil"
        ),
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }
  return outcome;
}

/** Reserve the installation budget inside the same serializable transaction. */
async function reserveInstallationBudgetMutation(
  transaction: Prisma.TransactionClient,
  input: Parameters<
    PrismaReviewProgressPublicationStore["reserveInstallationMutation"]
  >[0],
): Promise<{ allowed: true } | { allowed: false; retryAt: Date }> {
  await transaction.$executeRaw(Prisma.sql`
  INSERT INTO "ReviewProgressInstallationBudgetV1"
    ("githubInstallationId", "nextMutationAt", "updatedAt")
  VALUES (${input.publication.repository.githubInstallationId}, ${input.now}, ${input.now})
  ON CONFLICT DO NOTHING
`);
  await transaction.$queryRaw(Prisma.sql`
  SELECT 1 FROM "ReviewProgressInstallationBudgetV1"
  WHERE "githubInstallationId" = ${input.publication.repository.githubInstallationId}
  FOR UPDATE
`);
  const budget =
    await transaction.reviewProgressInstallationBudgetV1.findUniqueOrThrow({
      where: {
        githubInstallationId: input.publication.repository.githubInstallationId,
      },
    });
  const stillClaimed = await transaction.reviewProgressPublicationV1.count({
    where: {
      ...claimedPublicationFence(input.publication),
      claimUntil: { gt: input.now },
    },
  });
  if (stillClaimed !== 1)
    return { allowed: false as const, retryAt: input.now };
  const availableAt = maxDate(budget.nextMutationAt, budget.cooldownUntil);
  if (availableAt > input.now)
    return { allowed: false as const, retryAt: availableAt };
  await transaction.reviewProgressInstallationBudgetV1.update({
    where: {
      githubInstallationId: input.publication.repository.githubInstallationId,
    },
    data: {
      nextMutationAt: new Date(input.now.getTime() + input.minimumIntervalMs),
      updatedAt: input.now,
    },
  });
  return { allowed: true as const };
}

/** Select one due publication scope under the existing row lock and priority policy. */
async function selectDuePublicationScope(
  transaction: Prisma.TransactionClient,
  now: Date,
  repositoryPredicate: Prisma.Sql,
): Promise<ClaimedReviewProgress["scope"] | null> {
  const rows = await transaction.$queryRaw<
    Array<ClaimedReviewProgress["scope"]>
  >(Prisma.sql`
  SELECT publication."workspaceId", publication."repositoryConnectionId",
    publication."scmRepositoryIdentityId", publication."pullRequestNumber"
  FROM "ReviewProgressPublicationV1" publication
  WHERE publication."desiredVersion" > publication."publishedVersion"
    AND publication."nextPublishAt" <= ${now}
    AND (publication."claimUntil" IS NULL OR publication."claimUntil" <= ${now})
    ${repositoryPredicate}
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM "ReviewExecutionProgressV1" progress
      WHERE progress."executionId" = publication."activeExecutionId"
        AND progress."terminalOutcome" IS NOT NULL
    ) THEN 0 ELSE 1 END,
    publication."nextPublishAt", publication."updatedAt"
  LIMIT 1
  FOR UPDATE SKIP LOCKED
`);
  return rows[0] ?? null;
}

/** Claim the next due projection under the same serializable transaction. */
async function claimDuePublication(
  transaction: Prisma.TransactionClient,
  input: Parameters<PrismaReviewProgressPublicationStore["claimNext"]>[0],
  repositoryPredicate: Prisma.Sql,
): Promise<ClaimedReviewProgress | null> {
  const candidate = await selectDuePublicationScope(
    transaction,
    input.now,
    repositoryPredicate,
  );
  if (!candidate) return null;
  const publication =
    await transaction.reviewProgressPublicationV1.findUniqueOrThrow({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          candidate,
      },
    });
  const progress = await transaction.reviewExecutionProgressV1.findUnique({
    where: { executionId: publication.activeExecutionId },
  });
  if (
    !progress ||
    progress.generation !== publication.activeGeneration ||
    progress.headSha !== publication.activeHeadSha ||
    progress.planHash !== publication.activePlanHash ||
    progress.desiredVersion !== publication.desiredVersion
  ) {
    await deferUnavailablePublication(
      transaction,
      candidate,
      input.now,
      "review_progress_projection_identity_corrupted",
    );
    return null;
  }
  const repository = await transaction.repositoryConnection.findUnique({
    where: { id: publication.repositoryConnectionId },
    include: {
      installation: {
        select: { githubInstallationId: true, status: true },
      },
    },
  });
  if (
    !repository ||
    repository.workspaceId !== publication.workspaceId ||
    repository.scmRepositoryIdentityId !==
      publication.scmRepositoryIdentityId ||
    !repository.installation ||
    repository.installation.status !== "active" ||
    repository.selected !== true ||
    repository.archived !== false ||
    repository.provider !== "github"
  ) {
    await deferUnavailablePublication(
      transaction,
      candidate,
      input.now,
      "review_progress_github_repository_unavailable",
    );
    return null;
  }
  return claimPreparedPublication(
    transaction,
    input,
    candidate,
    publication,
    progress,
    repository,
    repository.installation,
  );
}

/** Persist the fenced claim and construct its owned publication projection. */
async function claimPreparedPublication(
  transaction: Prisma.TransactionClient,
  input: Parameters<PrismaReviewProgressPublicationStore["claimNext"]>[0],
  candidate: ClaimedReviewProgress["scope"],
  publication: {
    readonly publishedVersion: bigint;
    readonly commentId: bigint | null;
    readonly publishedBodyHash: string | null;
    readonly failureCount: number;
  },
  progress: {
    readonly executionId: string;
    readonly generation: bigint;
    readonly headSha: string;
    readonly planHash: string;
    readonly desiredVersion: bigint;
    readonly snapshotJson: unknown;
    readonly terminalOutcome: string | null;
  },
  repository: {
    readonly owner: string;
    readonly name: string;
  },
  installation: { readonly githubInstallationId: bigint },
): Promise<ClaimedReviewProgress> {
  const claimId = randomUUID();
  const claimUntil = new Date(input.now.getTime() + input.claimDurationMs);
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        candidate,
    },
    data: { claimId, claimOwnerIdHash: input.ownerIdHash, claimUntil },
  });
  return {
    scope: candidate,
    executionId: progress.executionId,
    generation: progress.generation,
    headSha: progress.headSha,
    planHash: progress.planHash,
    desiredVersion: progress.desiredVersion,
    publishedVersion: publication.publishedVersion,
    commentId: publication.commentId,
    publishedBodyHash: publication.publishedBodyHash,
    failureCount: publication.failureCount,
    snapshot: progress.snapshotJson,
    terminal: progress.terminalOutcome !== null,
    repository: {
      owner: repository.owner,
      name: repository.name,
      githubInstallationId: installation.githubInstallationId,
    },
    claim: { claimId, ownerIdHash: input.ownerIdHash, claimUntil },
  };
}

/** Promote one settlement only when its active progress still owns the projection. */
async function promoteSettledExecution(
  transaction: Prisma.TransactionClient,
  executionId: string,
  publicationOutcome: "succeeded" | "failed" | "superseded",
  now: Date,
): Promise<boolean> {
  const execution = await transaction.reviewExecutionV2.findUnique({
    where: { executionId },
    select: { executionId: true, state: true },
  });
  const terminalOutcome = executionStateTerminal(
    execution?.state,
    publicationOutcome,
  );
  if (!execution || !terminalOutcome) return false;
  const progress = await transaction.reviewExecutionProgressV1.findUnique({
    where: { executionId },
  });
  if (!progress || progress.terminalOutcome !== null) return false;
  const publication = await transaction.reviewProgressPublicationV1.findUnique({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        {
          workspaceId: progress.workspaceId,
          repositoryConnectionId: progress.repositoryConnectionId,
          scmRepositoryIdentityId: progress.scmRepositoryIdentityId,
          pullRequestNumber: progress.pullRequestNumber,
        },
    },
  });
  if (
    !publication ||
    publication.activeExecutionId !== executionId ||
    publication.activeGeneration !== progress.generation ||
    publication.activeHeadSha !== progress.headSha ||
    publication.activePlanHash !== progress.planHash
  )
    return false;
  const desiredVersion = publication.desiredVersion + 1n;
  const snapshot = terminalSnapshot(
    progress.snapshotJson,
    terminalOutcome,
    now,
  );
  const snapshotHash = hashProgressSnapshot(snapshot);
  await transaction.reviewExecutionProgressV1.update({
    where: { executionId },
    data: {
      phase: "terminal",
      terminalOutcome,
      snapshotJson: snapshot,
      snapshotHash,
      desiredVersion,
      updatedAt: now,
    },
  });
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        {
          workspaceId: progress.workspaceId,
          repositoryConnectionId: progress.repositoryConnectionId,
          scmRepositoryIdentityId: progress.scmRepositoryIdentityId,
          pullRequestNumber: progress.pullRequestNumber,
        },
    },
    data: {
      version: { increment: 1n },
      desiredVersion,
      nextPublishAt: now,
      updatedAt: now,
      // Preserve a live claim. Its completion is fenced by desiredVersion,
      // while clearing it here could allow two simultaneous GitHub writes.
    },
  });
  return true;
}

/** Keep retry exhaustion and error-code policy outside persistence effects. */
function retryMutationData(
  input: Parameters<PrismaReviewProgressPublicationStore["retry"]>[0],
) {
  const reachesLimit =
    input.countFailure !== false &&
    input.publication.failureCount + 1 >= input.maxFailures;
  return {
    reachesLimit,
    data: {
      ...(reachesLimit
        ? { publishedVersion: input.publication.desiredVersion }
        : {}),
      claimId: null,
      claimOwnerIdHash: null,
      claimUntil: null,
      ...(input.countFailure === false
        ? {}
        : { failureCount: { increment: 1 } }),
      lastErrorCode: reachesLimit
        ? "review_progress_retry_limit_reached"
        : safeCode(input.safeCode),
      nextPublishAt: input.retryAt,
      updatedAt: input.now,
    },
  };
}

/** Keep the optimistic claim fence identical across progress mutations. */
function claimedPublicationFence(publication: ClaimedReviewProgress) {
  return {
    ...publication.scope,
    activeExecutionId: publication.executionId,
    activeGeneration: publication.generation,
    activeHeadSha: publication.headSha,
    activePlanHash: publication.planHash,
    desiredVersion: publication.desiredVersion,
    claimId: publication.claim.claimId,
    claimOwnerIdHash: publication.claim.ownerIdHash,
  };
}

async function deferUnavailablePublication(
  transaction: Prisma.TransactionClient,
  scope: {
    workspaceId: string;
    repositoryConnectionId: string;
    scmRepositoryIdentityId: string;
    pullRequestNumber: number;
  },
  now: Date,
  code: string,
): Promise<void> {
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        scope,
    },
    data: {
      failureCount: { increment: 1 },
      lastErrorCode: code,
      nextPublishAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
    },
  });
}

type TerminalOutcome =
  | "complete"
  | "complete_with_gaps"
  | "failed"
  | "superseded";

function executionStateTerminal(
  value: string | undefined,
  publicationOutcome: "succeeded" | "failed" | "superseded",
): TerminalOutcome | null {
  if (publicationOutcome === "failed") return "failed";
  if (publicationOutcome === "superseded") return "superseded";
  if (value === "completed") return "complete";
  if (value === "partial") return "complete_with_gaps";
  if (value === "failed") return "failed";
  if (value === "superseded") return "superseded";
  return null;
}

function terminalSnapshot(
  value: Prisma.JsonValue,
  terminal: TerminalOutcome,
  now: Date,
): Prisma.InputJsonObject {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.counts)
  ) {
    throw new Error("review_progress_snapshot_invalid");
  }
  const counts = value.counts;
  const requiredCompleted = counts.requiredCompleted;
  const requiredTotal = counts.requiredTotal;
  const requiredExhausted = counts.requiredExhausted;
  const requiredCancelled = counts.requiredCancelled;
  if (
    typeof requiredCompleted !== "number" ||
    typeof requiredTotal !== "number" ||
    typeof requiredExhausted !== "number" ||
    typeof requiredCancelled !== "number"
  )
    throw new Error("review_progress_snapshot_invalid");
  if (
    terminal === "complete" &&
    (requiredCompleted !== requiredTotal ||
      requiredExhausted !== 0 ||
      requiredCancelled !== 0)
  )
    throw new Error("review_progress_complete_outcome_inconsistent");
  if (
    terminal === "complete_with_gaps" &&
    requiredExhausted + requiredCancelled < 1
  )
    throw new Error("review_progress_partial_outcome_inconsistent");
  return {
    ...value,
    phase: "terminal",
    terminal,
    updatedAt: now.toISOString(),
  } as Prisma.InputJsonObject;
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashProgressSnapshot(value: Prisma.InputJsonObject): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function assertOwner(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("review_progress_owner_invalid");
}
function assertDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("review_progress_duration_invalid");
}
function maxDate(first: Date, second: Date | null): Date {
  return second && second > first ? second : first;
}
function safeCode(value: string): string {
  return /^[a-z0-9_]{1,120}$/.test(value)
    ? value
    : "review_progress_publish_failed";
}
