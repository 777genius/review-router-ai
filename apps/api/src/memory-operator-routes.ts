import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  MemoryKnowledgeError,
  type MemoryKnowledgeEntryMetadata,
} from "@reviewrouter/features-memory";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";

type Dependencies = {
  readonly prisma: PrismaClient;
  readonly runtime: MemoryKnowledgeRuntime;
  readonly operatorToken: string | undefined;
  readonly now?: () => Date;
};
const pauseInput = z
  .object({
    paused: z.boolean(),
    expectedEpoch: z.string().regex(/^(0|[1-9][0-9]*)$/),
  })
  .strict();

export async function registerMemoryOperatorRoutes(
  app: FastifyInstance,
  dependencies: Dependencies,
): Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  const authorize = (request: FastifyRequest): void => {
    const expected = dependencies.operatorToken;
    const actual = request.headers.authorization;
    if (
      !expected ||
      expected.length < 32 ||
      !actual ||
      actual.length > 8_200 ||
      !actual.startsWith("Bearer ") ||
      !timingSafeEqual(
        createHash("sha256").update(expected).digest(),
        createHash("sha256").update(actual.slice(7)).digest(),
      )
    )
      throw new MemoryKnowledgeError("forbidden");
  };
  const current = async (request: FastifyRequest) => {
    authorize(request);
    const id = z
      .uuid()
      .parse((request.params as { commandId: string }).commandId);
    const row = await dependencies.prisma.memoryKnowledgeCommand.findUnique({
      where: { id },
    });
    if (
      !row ||
      row.generation !== dependencies.runtime.generation ||
      row.commandKind !== "forget"
    )
      throw new MemoryKnowledgeError("not_found");
    const entry = await dependencies.prisma.memoryKnowledgeEntry.findUnique({
      where: {
        generation_scopeKey_entryId: {
          generation: row.generation,
          scopeKey: row.scopeKey,
          entryId: row.entryId,
        },
      },
    });
    if (!entry) throw new MemoryKnowledgeError("not_found");
    const metadata = entry.metadata as unknown as MemoryKnowledgeEntryMetadata;
    const command = await dependencies.runtime.store.findCommand({
      commandId: id,
      scope: metadata.ref.scope,
      generation: row.generation,
    });
    if (
      !command ||
      !["queued", "cleanup_pending", "unknown", "completed"].includes(
        command.operation.state,
      )
    )
      throw new MemoryKnowledgeError("conflict");
    if (command.operation.state !== "completed") {
      if (
        entry.lifecycle !== "forget_pending" ||
        entry.revision !== row.revision ||
        entry.revocationCommandId !== id ||
        !entry.pendingCommandId
      )
        throw new MemoryKnowledgeError("conflict");
      if (entry.pendingCommandId !== id) {
        const predecessor = await dependencies.runtime.store.findCommand({
          commandId: entry.pendingCommandId,
          scope: metadata.ref.scope,
          generation: row.generation,
        });
        if (
          !predecessor ||
          predecessor.operation.ref.entryId !== row.entryId ||
          predecessor.operation.revision !== String(row.revision - 1) ||
          ["published", "completed", "failed"].includes(
            predecessor.operation.state,
          )
        )
          throw new MemoryKnowledgeError("conflict");
      }
    }
    const maintenance = await dependencies.runtime.store.maintenanceState(
      row.generation,
    );
    if (!maintenance.paused) throw new MemoryKnowledgeError("conflict");
    return { command, maintenance };
  };
  const guarded =
    (work: (request: FastifyRequest) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
      reply.header("cache-control", "private, no-store");
      try {
        authorize(request);
        return reply.send(await work(request));
      } catch (error) {
        const code =
          error instanceof MemoryKnowledgeError
            ? error.code
            : error instanceof z.ZodError
              ? "invalid_input"
              : "unavailable";
        return reply
          .code(
            code === "forbidden"
              ? 403
              : code === "not_found"
                ? 404
                : code === "conflict"
                  ? 409
                  : code === "invalid_input"
                    ? 400
                    : 503,
          )
          .send({ code: `memory_${code}` });
      }
    };
  app.get(
    "/api/internal/memory/maintenance",
    { logLevel: "silent" },
    guarded(async () =>
      dependencies.runtime.store.maintenanceState(
        dependencies.runtime.generation,
      ),
    ),
  );
  app.post(
    "/api/internal/memory/maintenance",
    { logLevel: "silent", bodyLimit: 1_024 },
    guarded(async (request) => {
      const input = pauseInput.parse(request.body);
      const time = now();
      return dependencies.runtime.store.setMaintenancePaused({
        ...input,
        generation: dependencies.runtime.generation,
        actor: "memory-cleanup-operator",
        now: time,
        deadlineAt: new Date(time.getTime() + 30_000),
      });
    }),
  );
  app.get(
    "/api/internal/memory/cleanup/:commandId",
    { logLevel: "silent" },
    guarded(async (request) => {
      const input = await current(request);
      if (!dependencies.runtime.cleanupProof)
        throw new MemoryKnowledgeError("disabled");
      return {
        binding: dependencies.runtime.cleanupProof.describe(input),
        submissionsPaused: true,
        maintenance: input.maintenance,
      };
    }),
  );
  app.post(
    "/api/internal/memory/cleanup/:commandId/receipt",
    { logLevel: "silent", bodyLimit: 80_000 },
    guarded(async (request) => {
      const input = await current(request);
      if (!dependencies.runtime.cleanupProof)
        throw new MemoryKnowledgeError("disabled");
      const time = now();
      const receipt = dependencies.runtime.cleanupProof.verify({
        ...input,
        proof: request.body,
        now: time,
      });
      if (!receipt) throw new MemoryKnowledgeError("invalid_input");
      // Atomic store settlement rechecks paused generation/epoch, command digest,
      // entry revision and unresolved claim after signature verification.
      const operation = await dependencies.runtime.store.completeCleanup({
        receipt,
        now: time,
      });
      return { operationId: operation.id, state: operation.state };
    }),
  );
}
