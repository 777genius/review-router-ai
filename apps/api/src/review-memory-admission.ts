import type { PrismaInvestigationStoreOptions } from "@reviewrouter/features-review-investigations/composition";
import { Prisma } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import {
  memoryKnowledgeBodyVisible,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  sameMemoryKnowledgeScope,
  type MemoryActor,
  type MemoryKnowledgeAdmissionReceipt,
  type MemoryKnowledgeEntryMetadata,
} from "@reviewrouter/features-memory";
import {
  approvedMemorySourceApplicable,
  automaticMemoryEntryApplicable,
  lockMemoryKnowledgeScopes,
  tryLockMemoryKnowledgeMaintenance,
} from "@reviewrouter/features-memory/infrastructure";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import type { ReviewExecutionInputAdmissionPort } from "@reviewrouter/features-review-executions/composition";
import { reviewMemoryRuntimeScopes } from "./review-memory-runtime.js";
import { reviewMemoryBinding } from "./review-memory-wire.js";

type MemoryAdmissionPhase =
  | "runtime"
  | "maintenance"
  | "receipt_binding"
  | "authorization"
  | "repository"
  | "policy"
  | "task"
  | "scope"
  | "epoch"
  | "metadata"
  | "expiry"
  | "complete";
type MemoryAdmissionTrace = { phase: MemoryAdmissionPhase };
export type MemoryAdmissionDiagnostic = Readonly<{
  boundary: "review_lease" | "preflight";
  outcome: "eligible" | "denied" | "error";
  phase: MemoryAdmissionPhase;
  elapsedMs: number;
  authorizationId?: string;
  snapshotHashPrefix?: string;
  errorCode?: string;
}>;
export type MemoryAdmissionObserver = (
  event: MemoryAdmissionDiagnostic,
) => void;

/** Diagnostic sinks have no authority over admission and receive no raw errors. */
function observeMemoryAdmission(
  observer: MemoryAdmissionObserver | undefined,
  event: MemoryAdmissionDiagnostic,
): void {
  try {
    observer?.(event);
  } catch {
    // Logging must never change the transaction's decision.
  }
}

function memoryAdmissionErrorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return /^P\d{4}$/.test(error.code) ? error.code : "prisma_known";
  if (error instanceof Prisma.PrismaClientUnknownRequestError)
    return "prisma_unknown";
  return "unexpected";
}

/** The lease transaction is the admission linearization point. It performs no provider I/O.
 * Scope row locks serialize all memory publication/revocation with a new lease grant.
 * Existing lease retries are restored by the execution store before this hook is called.
 */
export function createReviewMemoryInputAdmission(
  runtime: MemoryKnowledgeRuntime,
  observer?: MemoryAdmissionObserver,
): ReviewExecutionInputAdmissionPort {
  return {
    lock: async (transaction, command) => {
      if (!preparedMemoryHash(command.preparedManifestCanonicalJson)) return;
      await acquireCurrentScopeGuards(transaction, [
        {
          scope: "workspace",
          workspaceId: command.scope.workspaceId,
          mode: "shared",
        },
        {
          scope: "repository",
          workspaceId: command.scope.workspaceId,
          repositoryId: command.scope.repositoryConnectionId,
          mode: "shared",
        },
      ]);
    },
    admit: async (transaction, { command, execution, now }) => {
      const hash = preparedMemoryHash(command.preparedManifestCanonicalJson);
      if (hash === null || hash === undefined) return true;
      const startedAt = performance.now();
      const trace: MemoryAdmissionTrace = { phase: "runtime" };
      let eligible = false;
      let errorCode: string | undefined;
      try {
        if (
          !runtime.enabled ||
          typeof hash !== "string" ||
          !/^[a-f0-9]{64}$/.test(hash)
        )
          return false;
        trace.phase = "maintenance";
        const maintenance = await tryLockMemoryKnowledgeMaintenance(
          transaction,
          runtime.generation,
        );
        if (!maintenance || maintenance.paused) return false;
        await transaction.$queryRaw(
          Prisma.sql`SELECT "authorizationId" FROM "ReviewRunAuthorization" WHERE "authorizationId"=${execution.authorizationId} FOR SHARE`,
        );
        await lockSourceRepositories(transaction, [
          execution.repositoryConnectionId,
        ]);
        trace.phase = "receipt_binding";
        const row = await transaction.memoryKnowledgeBundleReceipt.findUnique({
          where: {
            authorizationId_snapshotHash: {
              authorizationId: execution.authorizationId,
              snapshotHash: hash,
            },
          },
        });
        if (
          !row ||
          row.workspaceId !== execution.workspaceId ||
          row.bindingDigest !==
            memoryKnowledgeDigest(
              reviewMemoryBinding({ ...execution, ...execution.revision }),
            )
        )
          return false;
        trace.phase = "expiry";
        if (row.expiresAt <= now) return false;
        trace.phase = "authorization";
        const authorization =
          await transaction.reviewRunAuthorization.findUnique({
            where: { authorizationId: execution.authorizationId },
          });
        if (
          !authorization ||
          authorization.state !== "active" ||
          authorization.mutationEpoch !== execution.mutationEpoch ||
          authorization.workspaceId !== execution.workspaceId ||
          authorization.repositoryConnectionId !==
            execution.repositoryConnectionId ||
          authorization.scmRepositoryIdentityId !==
            execution.scmRepositoryIdentityId ||
          memoryKnowledgeDigest(reviewMemoryBinding(authorization)) !==
            row.bindingDigest
        )
          return false;
        trace.phase = "expiry";
        if (authorization.expiresAt <= now || authorization.maxExpiresAt <= now)
          return false;
        trace.phase = "repository";
        const repository = await transaction.repositoryConnection.findFirst({
          where: {
            id: execution.repositoryConnectionId,
            workspaceId: execution.workspaceId,
            selected: true,
            archived: false,
          },
        });
        if (!repository) return false;
        trace.phase = "policy";
        const policy = await runtime.policy.getPolicy({
          workspaceId: execution.workspaceId,
          repositoryId: execution.repositoryConnectionId,
        });
        if (!policy.memoryEnabled || policy.policyVersion !== row.policyVersion)
          return false;
        const allowed = reviewMemoryRuntimeScopes(authorization, policy);
        const receipt =
          row.receipt as unknown as MemoryKnowledgeAdmissionReceipt;
        trace.phase = "task";
        if (!memoryTaskAllowed(receipt, command.preparedManifestCanonicalJson))
          return false;
        trace.phase = "scope";
        if (
          receipt.generation !== runtime.generation ||
          receipt.expiresAt !== row.expiresAt.toISOString() ||
          !Array.isArray(receipt.scopes) ||
          receipt.scopes.length === 0 ||
          receipt.scopes.length > 2 ||
          receipt.scopes.some(
            (section) =>
              !allowed.some((scope) =>
                sameMemoryKnowledgeScope(scope, section.scope),
              ) || section.entries.length > 1_000,
          )
        )
          return false;
        eligible = await admitMemoryReceiptInTransaction(
          transaction,
          runtime,
          receipt,
          {
            workspaceId: execution.workspaceId,
            repositoryId: execution.repositoryConnectionId,
            headSha: authorization.headSha,
            task: memoryManifestTask(command.preparedManifestCanonicalJson),
            now,
            authorizationExpiresAt: authorization.expiresAt,
            authorizationMaxExpiresAt: authorization.maxExpiresAt,
          },
          trace,
        );
        return eligible;
      } catch (error) {
        // No provider/native/SQL diagnostics enter the protocol response or logs.
        errorCode = memoryAdmissionErrorCode(error);
        return false;
      } finally {
        observeMemoryAdmission(observer, {
          boundary: "review_lease",
          outcome: errorCode ? "error" : eligible ? "eligible" : "denied",
          phase: eligible ? "complete" : trace.phase,
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
          authorizationId: execution.authorizationId,
          ...(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)
            ? { snapshotHashPrefix: hash.slice(0, 12) }
            : {}),
          ...(errorCode ? { errorCode } : {}),
        });
      }
    },
  };
}

/** The existing investigation lease owner invokes this after issued-lease restoration and before new grant. */
export function createInvestigationMemoryInputAdmission(
  runtime: MemoryKnowledgeRuntime,
): NonNullable<PrismaInvestigationStoreOptions["inputAdmission"]> {
  return {
    async lock(transaction, candidate) {
      if (!preparedMemoryHash(candidate.investigationManifestCanonicalJson))
        return;
      await acquireCurrentScopeGuards(transaction, [
        {
          scope: "workspace",
          workspaceId: candidate.workspaceId,
          mode: "shared",
        },
        {
          scope: "repository",
          workspaceId: candidate.workspaceId,
          repositoryId: candidate.repositoryConnectionId,
          mode: "shared",
        },
      ]);
    },
    async admit(transaction, candidate, now) {
      const hash = preparedMemoryHash(
        candidate.investigationManifestCanonicalJson,
      );
      if (hash === null || hash === undefined) return true;
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
        return false;
      await transaction.$queryRaw(
        Prisma.sql`SELECT "authorizationId" FROM "ReviewRunAuthorization" WHERE "authorizationId"=${candidate.authorizationId} FOR SHARE`,
      );
      const authorization = await transaction.reviewRunAuthorization.findUnique(
        { where: { authorizationId: candidate.authorizationId } },
      );
      const row = await transaction.memoryKnowledgeBundleReceipt.findUnique({
        where: {
          authorizationId_snapshotHash: {
            authorizationId: candidate.authorizationId,
            snapshotHash: hash,
          },
        },
      });
      const binding = reviewMemoryBinding({
        ...candidate,
        ...candidate.revision,
      });
      if (
        !authorization ||
        !row ||
        authorization.state !== "active" ||
        authorization.expiresAt <= now ||
        authorization.maxExpiresAt <= now ||
        authorization.mutationEpoch !== candidate.mutationEpoch ||
        authorization.workspaceId !== candidate.workspaceId ||
        authorization.repositoryConnectionId !==
          candidate.repositoryConnectionId ||
        authorization.scmRepositoryIdentityId !==
          candidate.scmRepositoryIdentityId ||
        row.workspaceId !== candidate.workspaceId ||
        row.expiresAt <= now ||
        row.bindingDigest !== memoryKnowledgeDigest(binding) ||
        memoryKnowledgeDigest(reviewMemoryBinding(authorization)) !==
          row.bindingDigest
      )
        return false;
      const policy = await runtime.policy.getPolicy({
        workspaceId: candidate.workspaceId,
        repositoryId: candidate.repositoryConnectionId,
      });
      const receipt = row.receipt as unknown as MemoryKnowledgeAdmissionReceipt;
      const allowed = reviewMemoryRuntimeScopes(authorization, policy);
      if (
        row.policyVersion !== policy.policyVersion ||
        !Array.isArray(receipt.scopes) ||
        receipt.expiresAt !== row.expiresAt.toISOString() ||
        receipt.scopes.some(
          (section) =>
            !allowed.some((scope) =>
              sameMemoryKnowledgeScope(scope, section.scope),
            ),
        )
      )
        return false;
      return admitMemoryReceiptInTransaction(transaction, runtime, receipt, {
        workspaceId: candidate.workspaceId,
        repositoryId: candidate.repositoryConnectionId,
        headSha: candidate.revision.headSha,
        task: "investigation",
        now,
        authorizationExpiresAt: authorization.expiresAt,
        authorizationMaxExpiresAt: authorization.maxExpiresAt,
      });
    },
  };
}

/** Metadata-only eligibility check inside the host's authoritative grant transaction. Source reads run before this transaction. */
export async function admitMemoryReceiptInTransaction(
  transaction: Prisma.TransactionClient,
  runtime: MemoryKnowledgeRuntime,
  receipt: MemoryKnowledgeAdmissionReceipt,
  input: {
    readonly workspaceId: string;
    readonly repositoryId: string;
    readonly headSha: string;
    readonly task:
      | "review"
      | "investigation"
      | "pr_description"
      | "conversation";
    readonly now: Date;
    readonly authorizationExpiresAt?: Date;
    readonly authorizationMaxExpiresAt?: Date;
  },
  trace?: MemoryAdmissionTrace,
): Promise<boolean> {
  const phase = (value: MemoryAdmissionPhase) => {
    if (trace) trace.phase = value;
  };
  phase("maintenance");
  const maintenance = await tryLockMemoryKnowledgeMaintenance(
    transaction,
    runtime.generation,
  );
  if (!runtime.enabled || !maintenance || maintenance.paused) return false;
  phase("scope");
  if (
    receipt.generation !== runtime.generation ||
    !Array.isArray(receipt.scopes) ||
    receipt.scopes.length > 2
  )
    return false;
  phase("expiry");
  if (
    !Number.isFinite(Date.parse(receipt.expiresAt)) ||
    new Date(receipt.expiresAt) <= input.now
  )
    return false;
  phase("task");
  if (
    receipt.contextPolicy &&
    (receipt.contextPolicy.repositoryId !== input.repositoryId ||
      !receipt.contextPolicy.allowedTasks.includes(input.task))
  )
    return false;
  if (
    receipt.contextPolicy?.audience === "internal" &&
    (input.task === "pr_description" || input.task === "conversation")
  )
    return false;
  if (
    !receipt.contextPolicy &&
    (input.task === "conversation" || input.task === "pr_description")
  )
    return false;
  phase("repository");
  const repository = await transaction.repositoryConnection.findFirst({
    where: {
      id: input.repositoryId,
      workspaceId: input.workspaceId,
      selected: true,
      archived: false,
    },
    select: { visibility: true },
  });
  if (
    !repository ||
    (receipt.contextPolicy?.audience === "repository" &&
      repository.visibility !== "private")
  )
    return false;
  phase("policy");
  const policy = await runtime.policy.getPolicy({
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
  });
  if (
    !policy.memoryEnabled ||
    receipt.scopes.some(
      (section: MemoryKnowledgeAdmissionReceipt["scopes"][number]) =>
        section.scope.workspaceId !== input.workspaceId ||
        section.scope.kind === "user_preference" ||
        !policy.allowedScopes[section.scope.kind] ||
        (section.scope.kind === "repository" &&
          section.scope.repositoryId !== input.repositoryId),
    )
  )
    return false;
  phase("scope");
  await lockMemoryKnowledgeScopes(
    transaction,
    receipt.scopes.map((section) => section.scope),
    runtime.generation,
  );
  phase("expiry");
  const [clock] = await transaction.$queryRaw<{ now: Date }[]>(
    Prisma.sql`SELECT clock_timestamp() AS now`,
  );
  const admittedAt = clock?.now;
  if (
    !admittedAt ||
    new Date(receipt.expiresAt) <= admittedAt ||
    (input.authorizationExpiresAt !== undefined &&
      input.authorizationExpiresAt <= admittedAt) ||
    (input.authorizationMaxExpiresAt !== undefined &&
      input.authorizationMaxExpiresAt <= admittedAt)
  )
    return false;
  const actor: MemoryActor = {
    kind: "system",
    id: `memory:${input.repositoryId}`,
    githubUserId: null,
    login: null,
  };
  const controls = { deadlineAt: new Date(admittedAt.getTime() + 2_000) };
  for (const section of receipt.scopes) {
    phase("epoch");
    const scopeKey = memoryKnowledgeScopeKey(section.scope);
    const scopeState = await transaction.memoryKnowledgeScopeState.findUnique({
      where: {
        generation_scopeKey: {
          generation: runtime.generation,
          scopeKey,
        },
      },
    });
    if (!scopeState || String(scopeState.epoch) !== section.epoch) return false;
    phase("metadata");
    const entries = await transaction.memoryKnowledgeEntry.findMany({
      where: {
        generation: runtime.generation,
        scopeKey,
        entryId: {
          in: section.entries.map(
            (
              entry: MemoryKnowledgeAdmissionReceipt["scopes"][number]["entries"][number],
            ) => entry.ref.entryId,
          ),
        },
      },
    });
    const metadata = new Map(
      entries.map((entry) => [
        entry.entryId,
        entry.metadata as unknown as MemoryKnowledgeEntryMetadata,
      ]),
    );
    const sourceRepositoryIds = [
      ...new Set(
        entries.flatMap((entry) => {
          const source = (
            entry.metadata as unknown as MemoryKnowledgeEntryMetadata
          ).source;
          return source?.repositoryId ? [source.repositoryId] : [];
        }),
      ),
    ];
    const sources = await currentSourceRepositories(
      transaction,
      input.workspaceId,
      sourceRepositoryIds,
    );
    for (const expected of section.entries) {
      const entry = metadata.get(expected.ref.entryId);
      if (
        !entry ||
        !sameMemoryKnowledgeScope(expected.ref.scope, section.scope) ||
        !sameMemoryKnowledgeScope(entry.ref.scope, section.scope) ||
        entry.generation !== runtime.generation ||
        entry.revision !== expected.revision ||
        entry.contentApprovalRevision !== expected.contentApprovalRevision ||
        memoryKnowledgeDigest(entry.automaticSource ?? null) !==
          memoryKnowledgeDigest(expected.automaticSource ?? null) ||
        !memoryKnowledgeBodyVisible(entry, "runtime", admittedAt) ||
        !entry.source ||
        (entry.source.repositoryId && !sources.has(entry.source.repositoryId))
      )
        return false;
      if (
        entry.automaticSource &&
        !(await automaticMemoryEntryApplicable(
          transaction,
          entry.ref,
          runtime.generation,
          entry.automaticSource,
        ))
      )
        return false;
      if (
        receipt.contextPolicy &&
        !memoryAudienceAllows(entry, receipt.contextPolicy)
      )
        return false;
      if (
        !entry.automaticSource &&
        entry.applicability.observedCommitSha &&
        entry.applicability.observedCommitSha !== input.headSha
      )
        return false;
      if (
        entry.source.url &&
        entry.source.visibility !== "public" &&
        entry.source.repositoryId !== input.repositoryId
      )
        return false;
      if (
        !entry.automaticSource &&
        entry.source.type !== "manual" &&
        !(await approvedMemorySourceApplicable(
          {
            actor,
            scope: section.scope,
            source: entry.source,
            consumer: "runtime",
            headSha: input.headSha,
          },
          controls,
        ))
      )
        return false;
    }
  }
  return true;
}
function memoryManifestTask(
  canonical: string | null | undefined,
): "review" | "pr_description" {
  try {
    return (
      JSON.parse(canonical ?? "{}") as { taskKindSet?: unknown[] }
    ).taskKindSet?.includes("pr_description")
      ? "pr_description"
      : "review";
  } catch {
    return "review";
  }
}

export function memoryTaskAllowed(
  receipt: MemoryKnowledgeAdmissionReceipt,
  canonical: string | null | undefined,
): boolean {
  if (!receipt.contextPolicy)
    return !canonical || !canonical.includes('"pr_description"');
  try {
    const manifest = JSON.parse(canonical ?? "{}") as { taskKindSet?: unknown };
    if (
      !Array.isArray(manifest.taskKindSet) ||
      manifest.taskKindSet.length === 0
    )
      return false;
    return manifest.taskKindSet.every((task) =>
      task === "pr_description"
        ? receipt.contextPolicy!.allowedTasks.includes("pr_description")
        : (task === "finding_discovery" || task === "lifecycle_revalidation") &&
          receipt.contextPolicy!.allowedTasks.includes("review"),
    );
  } catch {
    return false;
  }
}
function memoryAudienceAllows(
  metadata: MemoryKnowledgeEntryMetadata,
  policy: NonNullable<MemoryKnowledgeAdmissionReceipt["contextPolicy"]>,
): boolean {
  const source = metadata.source;
  if (!source) return false;
  if (policy.audience === "internal") return true;
  return (
    source.visibility === "public" ||
    (policy.audience === "repository" &&
      metadata.ref.scope.kind === "repository" &&
      metadata.ref.scope.repositoryId === policy.repositoryId &&
      source.repositoryId === policy.repositoryId)
  );
}

async function currentSourceRepositories(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  await lockSourceRepositories(transaction, ids);
  const repositories = await transaction.repositoryConnection.findMany({
    where: {
      id: { in: [...ids] },
      workspaceId,
      selected: true,
      archived: false,
    },
    select: { id: true },
  });
  return new Set(repositories.map((repository) => repository.id));
}

function preparedMemoryHash(canonical: string | undefined | null): unknown {
  if (!canonical) return null;
  try {
    return (
      (JSON.parse(canonical) as { memoryBundleHash?: unknown })
        .memoryBundleHash ?? null
    );
  } catch {
    return "invalid";
  }
}

async function lockSourceRepositories(
  transaction: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<void> {
  if (!ids.length) return;
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "RepositoryConnection" WHERE "id" IN (${Prisma.join([...new Set(ids)].sort())}) ORDER BY "id" FOR SHARE`,
  );
}
