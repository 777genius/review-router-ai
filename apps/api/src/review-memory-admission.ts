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
  lockMemoryKnowledgeScopes,
  tryLockMemoryKnowledgeMaintenance,
} from "@reviewrouter/features-memory/infrastructure";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import type { ReviewExecutionInputAdmissionPort } from "@reviewrouter/features-review-executions/composition";
import { reviewMemoryRuntimeScopes } from "./review-memory-runtime.js";
import { reviewMemoryBinding } from "./review-memory-wire.js";

/** The lease transaction is the admission linearization point. It performs no provider I/O.
 * Scope row locks serialize all memory publication/revocation with a new lease grant.
 * Existing lease retries are restored by the execution store before this hook is called.
 */
export function createReviewMemoryInputAdmission(
  runtime: MemoryKnowledgeRuntime,
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
      if (
        !runtime.enabled ||
        typeof hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(hash)
      )
        return false;
      try {
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
          row.expiresAt <= now ||
          row.bindingDigest !==
            memoryKnowledgeDigest(
              reviewMemoryBinding({ ...execution, ...execution.revision }),
            )
        )
          return false;
        const authorization =
          await transaction.reviewRunAuthorization.findUnique({
            where: { authorizationId: execution.authorizationId },
          });
        if (
          !authorization ||
          authorization.state !== "active" ||
          authorization.expiresAt <= now ||
          authorization.maxExpiresAt <= now ||
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
        const repository = await transaction.repositoryConnection.findFirst({
          where: {
            id: execution.repositoryConnectionId,
            workspaceId: execution.workspaceId,
            selected: true,
            archived: false,
          },
        });
        if (!repository) return false;
        const policy = await runtime.policy.getPolicy({
          workspaceId: execution.workspaceId,
          repositoryId: execution.repositoryConnectionId,
        });
        if (!policy.memoryEnabled || policy.policyVersion !== row.policyVersion)
          return false;
        const allowed = reviewMemoryRuntimeScopes(authorization, policy);
        const receipt =
          row.receipt as unknown as MemoryKnowledgeAdmissionReceipt;
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
        await lockMemoryKnowledgeScopes(
          transaction,
          receipt.scopes.map((section) => section.scope),
          runtime.generation,
        );
        const [clock] = await transaction.$queryRaw<{ now: Date }[]>(
          Prisma.sql`SELECT clock_timestamp() AS now`,
        );
        const admittedAt = clock?.now;
        if (
          !admittedAt ||
          row.expiresAt <= admittedAt ||
          authorization.expiresAt <= admittedAt ||
          authorization.maxExpiresAt <= admittedAt
        )
          return false;
        const actor: MemoryActor = {
          kind: "system",
          id: `review:${authorization.authorizationId}`,
          githubUserId: null,
          login: null,
        };
        const controls = { deadlineAt: new Date(admittedAt.getTime() + 2_000) };
        for (const section of receipt.scopes) {
          const scopeKey = memoryKnowledgeScopeKey(section.scope);
          const scopeState =
            await transaction.memoryKnowledgeScopeState.findUnique({
              where: {
                generation_scopeKey: {
                  generation: runtime.generation,
                  scopeKey,
                },
              },
            });
          if (!scopeState || String(scopeState.epoch) !== section.epoch)
            return false;
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
            execution.workspaceId,
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
              entry.contentApprovalRevision !==
                expected.contentApprovalRevision ||
              !memoryKnowledgeBodyVisible(entry, "runtime", admittedAt) ||
              !entry.source ||
              (entry.source.repositoryId &&
                !sources.has(entry.source.repositoryId))
            )
              return false;
            if (
              entry.applicability.observedCommitSha &&
              entry.applicability.observedCommitSha !== authorization.headSha
            )
              return false;
            if (
              entry.source.url &&
              entry.source.visibility !== "public" &&
              entry.source.repositoryId !== execution.repositoryConnectionId
            )
              return false;
            if (
              entry.source.type !== "manual" &&
              !(await approvedMemorySourceApplicable(
                {
                  actor,
                  scope: section.scope,
                  source: entry.source,
                  consumer: "runtime",
                  headSha: authorization.headSha,
                },
                controls,
              ))
            )
              return false;
          }
        }
        return true;
      } catch {
        // No provider/native/SQL diagnostics enter the protocol response or logs.
        return false;
      }
    },
  };
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
